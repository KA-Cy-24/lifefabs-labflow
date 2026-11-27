"""Lifefabs LabFlow: bounded, non-executing OT-2 recovery-plan compiler.

This reads *syntax*, not a running protocol or the robot's state. It expands
known finite loops into independent Python statements, then finds boundaries
where **all** pipettes have discarded their tips. It never runs uploaded code.

Only a deliberately narrow, explicitly checked subset qualifies for export.
An eligible file is a recovery *candidate*, never a certified robot run.
"""
from __future__ import annotations

import ast
import copy
import math
import operator
import hashlib
import re
from dataclasses import dataclass

MAX_SOURCE = 250_000
MAX_STEPS = 3000
MAX_ITERATIONS = 384

class Ineligible(ValueError):
    """Source cannot be transformed while preserving known execution semantics."""

def need(predicate, message):
    if not predicate:
        raise Ineligible(message)

@dataclass(frozen=True)
class Sequence:
    """Known-length runtime sequence, represented by its original Python name.

    Entries are *expressions*, never values obtained by executing uploaded code.
    For example, a loop over `wells` expands to `wells[0]`, `wells[1]` ...
    """
    items: tuple

@dataclass(frozen=True)
class Step:
    statement: ast.stmt
    line: int
    label: str
    kind: str

_NUM = (int, float)
_BINARY = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
           ast.FloorDiv: operator.floordiv, ast.Div: operator.truediv,
           ast.Mod: operator.mod}
_COMPARE = {ast.Eq: operator.eq, ast.NotEq: operator.ne,
            ast.Lt: operator.lt, ast.LtE: operator.le,
            ast.Gt: operator.gt, ast.GtE: operator.ge}
_PIPETTE_METHODS = {'pick_up_tip', 'drop_tip', 'aspirate', 'dispense', 'mix',
                    'air_gap', 'blow_out', 'touch_tip', 'move_to'}
_WELL_METHODS = {'top', 'bottom', 'center', 'move', 'wells', 'rows', 'columns'}
_CONTEXT_METHODS = {'comment', 'delay'}

# An intentionally SMALL, explicit catalogue for semantic pre-validation.
# This is NOT a replacement for exact, versioned official Opentrons definitions.
# Unknown/custom hardware is blocked until a validated definition is supplied.
# Geometry is rows, columns; pipette volume is microliters per channel.
LABWARE = {
    'corning_96_wellplate_360ul_flat': (8,12,'plate',None),
    'nest_96_wellplate_200ul_flat': (8,12,'plate',None),
    'nest_96_wellplate_100ul_pcr_full_skirt': (8,12,'plate',None),
    'nest_12_reservoir_15ml': (1,12,'reservoir',None),
    'nest_1_reservoir_195ml': (1,1,'reservoir',None),
    'opentrons_96_tiprack_20ul': (8,12,'tips',20),
    'opentrons_96_tiprack_200ul': (8,12,'tips',200),
    'opentrons_96_tiprack_300ul': (8,12,'tips',300),
    'opentrons_96_tiprack_1000ul': (8,12,'tips',1000),
    'opentrons_24_tuberack_nest_2ml_snapcap': (4,6,'tubes',None),
    'opentrons_24_tuberack_nest_1.5ml_snapcap': (4,6,'tubes',None),
    'opentrons_24_tuberack_eppendorf_1.5ml_safelock_snapcap': (4,6,'tubes',None),
    'opentrons_10_tuberack_falcon_4x50ml_6x15ml_conical': (2,5,'tubes',None),
    'opentrons_10_tuberack_nest_4x50ml_6x15ml_conical': (2,5,'tubes',None),
    'opentrons_6_tuberack_nest_50ml_conical': (2,3,'tubes',None),
}
PIPETTES = {
    'p20_single_gen2':  (20,1,{20}),
    'p20_multi_gen2':   (20,8,{20}),
    'p300_single_gen2':(300,1,{200,300}),
    'p300_multi_gen2': (300,8,{200,300}),
    'p1000_single_gen2': (1000,1,{1000}),
    'p300_single': (300,1,{200,300}),
    'p300_multi':  (300,8,{200,300}),
    'p1000_single':(1000,1,{1000}),
    'p20_single': (20,1,{20}),
}
SLOT_IDS = {str(i) for i in range(1,12)}
WELL_CODE = re.compile(r'^([A-Z]+)([1-9][0-9]*)$')


def literal_slot(node, values, line):
    value = literal(node, values)
    need(type(value) in (str,int) and str(value) in SLOT_IDS,
         f'Line {line}: deck slot must be one of the OT-2 slots 1–11.')
    return str(value)


def _well_index_ok(method, index, shape, line):
    rows, cols=shape
    if method=='wells': limit=rows*cols
    elif method=='rows': limit=rows
    else: limit=cols
    need(type(index) is int and 0<=index<limit,
         f'Line {line}: {method} index {index!r} outside this labware (limit {limit}).')


def validate_well_syntax(tree, shapes, values, line):
    """Check literal well/index lookups on known loaded labware without execution.

    Reject unresolved indexes instead of claiming they point to a real well.
    Nested access such as plate.rows()[0][5] validates both dimensions.
    """
    for node in ast.walk(tree):
        if not isinstance(node,ast.Subscript): continue
        if isinstance(node.value, ast.Name) and node.value.id in shapes:
            idx=literal(node.slice,values)
            shape=shapes[node.value.id]
            if type(idx) is str:
                match=WELL_CODE.fullmatch(idx)
                need(match is not None,f'Line {line}: invalid well name {idx!r}.')
                row=0
                for c in match.group(1):row=row*26+(ord(c)-ord('A')+1)
                row-=1
                col=int(match.group(2))-1
                need(0<=row<shape[0] and 0<=col<shape[1],
                     f'Line {line}: well {idx!r} is outside loaded labware.')
            else: raise Ineligible(f'Line {line}: named labware access needs an explicit well name.')
        if isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Attribute):
            attr=node.value.func.attr
            if attr not in {'wells','rows','columns'}:continue
            base=node.value.func.value
            if not isinstance(base,ast.Name) or base.id not in shapes:continue
            shape=shapes[base.id]
            if isinstance(node.slice,ast.Slice):
                for candidate in [node.slice.lower,node.slice.upper]:
                    if candidate is not None:
                        v=literal(candidate,values)
                        need(type(v) is int and 0<=v<=(shape[0]*shape[1] if attr=='wells' else shape[0] if attr=='rows' else shape[1]),
                             f'Line {line}: {attr} slice is beyond known geometry.')
            else:
                idx=literal(node.slice,values)
                _well_index_ok(attr,idx,shape,line)
        # A nested index of rows()[r][c] / columns()[c][r] is also bounded.
        mid=node.value
        if isinstance(mid,ast.Subscript) and isinstance(mid.value,ast.Call) and isinstance(mid.value.func,ast.Attribute):
            method=mid.value.func.attr
            base=mid.value.func.value
            if method not in ('rows','columns') or not isinstance(base,ast.Name) or base.id not in shapes:continue
            idx=literal(node.slice,values)
            rows,cols=shapes[base.id]
            limit=cols if method=='rows' else rows
            need(type(idx) is int and 0<=idx<limit,
                 f'Line {line}: {method} inner well index {idx!r} outside geometry.')


class Substitute(ast.NodeTransformer):
    """Replace loop variables in loads; never substitute assignment targets."""
    def __init__(self, bindings):
        self.bindings = bindings
    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load) and node.id in self.bindings:
            return copy.deepcopy(self.bindings[node.id])
        return node

def sub(node, bindings):
    return ast.fix_missing_locations(Substitute(bindings).visit(copy.deepcopy(node)))

def render_expr(node):
    return ast.unparse(node)

def literal(node, values):
    """Statically resolve arithmetic and bounded structural operations only.

    No imported Python module, call in the uploaded source, or file is executed.
    Unknown values raise Ineligible instead of being guessed.
    """
    if isinstance(node, ast.Constant) and type(node.value) in (int,float,str,bool,type(None)):
        return node.value
    if isinstance(node, ast.Name) and node.id in values:
        return values[node.id]
    if isinstance(node, (ast.Tuple, ast.List)):
        return [literal(n, values) for n in node.elts]
    if isinstance(node, ast.UnaryOp):
        a=literal(node.operand,values)
        if type(a) in _NUM and isinstance(node.op,(ast.USub,ast.UAdd)):
            return -a if isinstance(node.op,ast.USub) else a
    if isinstance(node,ast.BinOp) and type(node.op) in _BINARY:
        a,b=literal(node.left,values),literal(node.right,values)
        if type(a) in _NUM and type(b) in _NUM and abs(a)<1e6 and abs(b)<1e6:
            try: return _BINARY[type(node.op)](a,b)
            except (ZeroDivisionError,OverflowError): pass
    if isinstance(node,ast.Compare) and len(node.ops)==1 and type(node.ops[0]) in _COMPARE:
        a,b=literal(node.left,values),literal(node.comparators[0],values)
        if type(a) in (int,float,str,bool) and type(a) is type(b):
            return _COMPARE[type(node.ops[0])](a,b)
    if isinstance(node,ast.BoolOp) and isinstance(node.op,(ast.And,ast.Or)):
        vals=[literal(v,values) for v in node.values]
        if all(type(v) is bool for v in vals):
            return all(vals) if isinstance(node.op,ast.And) else any(vals)
    raise Ineligible(f'Unresolved static expression: {render_expr(node)[:90]}')

def iterable(node, values):
    """Find syntactically provable iterations; represent resulting values as AST."""
    if isinstance(node,ast.Name):
        v=values.get(node.id)
        need(isinstance(v,Sequence),f'Loop source {node.id} has unknown length.')
        return list(v.items)
    if isinstance(node,(ast.Tuple,ast.List)):
        return [copy.deepcopy(v) for v in node.elts]
    if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and not node.keywords:
        name=node.func.id
        if name=='range' and 1 <= len(node.args) <= 3:
            args=[literal(x,values) for x in node.args]
            need(all(type(a) is int and abs(a) < 10000 for a in args), 'Loop range is not a bounded integer range.')
            rows=list(range(*args))
            need(len(rows)<=MAX_ITERATIONS,'Loop exceeds the deterministic expansion limit.')
            return [ast.Constant(i) for i in rows]
        if name=='zip' and 1<=len(node.args)<=6:
            lists=[iterable(x,values) for x in node.args]
            return [ast.Tuple(elts=[copy.deepcopy(a[i]) for a in lists],ctx=ast.Load())
                    for i in range(min(map(len,lists)))]
        if name=='enumerate' and 1<=len(node.args)<=2:
            seq=iterable(node.args[0],values)
            begin=literal(node.args[1],values) if len(node.args)>1 else 0
            need(type(begin) is int,'enumerate start is unresolved.')
            return [ast.Tuple(elts=[ast.Constant(begin+i),copy.deepcopy(item)],ctx=ast.Load())
                    for i,item in enumerate(seq)]
        if name=='reversed' and len(node.args)==1:
            return list(reversed(iterable(node.args[0],values)))
    raise Ineligible(f'Loop iterator is not a supported deterministic sequence: {render_expr(node)[:95]}')

def collect_bindings(lhs, rhs, bindings):
    if isinstance(lhs,ast.Name):
        bindings[lhs.id]=rhs
    elif isinstance(lhs,(ast.Tuple,ast.List)) and isinstance(rhs,(ast.Tuple,ast.List)) and len(lhs.elts)==len(rhs.elts):
        for a,b in zip(lhs.elts,rhs.elts): collect_bindings(a,b,bindings)
    else:
        raise Ineligible('Loop destructuring is unresolved.')

def slice_sequence(expr, values, known_shapes):
    """Infer a bounded well-list length only for known, named labware geometry.

    A slice like `plate.rows()[0][:12]` does not itself prove the plate has
    12 columns. The labware name must have a known standard footprint here.
    """
    if not isinstance(expr,ast.Subscript) or not isinstance(expr.slice,ast.Slice):
        return None
    s=expr.slice
    need(s.step is None and s.lower is None,'Only well-list slices beginning at zero are supported.')
    n=literal(s.upper,values) if s.upper else None
    need(type(n) is int and 0<=n<=MAX_ITERATIONS,'Well-list length must be a small constant.')
    rows=expr.value
    need(isinstance(rows,ast.Subscript) and isinstance(rows.value,ast.Call)
         and isinstance(rows.value.func,ast.Attribute) and rows.value.func.attr in {'rows','columns','wells'},
         'Only an explicit bounded labware well-list slice is supported.')
    call=rows.value
    need(isinstance(call.func.value,ast.Name) and call.func.value.id in known_shapes,
         'Well-list source is not a known loaded labware definition.')
    shape=known_shapes[call.func.value.id]
    method=call.func.attr
    if method=='rows':
        need(isinstance(rows.slice,ast.Constant) and type(rows.slice.value) is int and
             0<=rows.slice.value<shape[0] and n<=shape[1],
             'Well-list slice exceeds known row geometry.')
    elif method=='columns':
        need(isinstance(rows.slice,ast.Constant) and type(rows.slice.value) is int and
             0<=rows.slice.value<shape[1] and n<=shape[0],
             'Well-list slice exceeds known column geometry.')
    else:
        need(n<=shape[0]*shape[1],'Well-list slice exceeds known labware capacity.')
    return Sequence(tuple(ast.Subscript(value=copy.deepcopy(expr),slice=ast.Constant(i),ctx=ast.Load())
                          for i in range(n)))

def geometry(loadname):
    """Small explicit OT-2 library fixture set; unknown definitions are blocked.

    No regex treating an arbitrary custom 96-well fixture as verified geometry.
    Users can extend this table after checking the actual official definition.
    """
    info=LABWARE.get(loadname)
    return info[:2] if info else None

def safe_expression(node, names):
    """Whitelist expression syntax; reject arbitrary helper calls and side effects."""
    if isinstance(node,ast.Constant): return type(node.value) in (str,bool,int,float,type(None))
    if isinstance(node,ast.Name): return node.id in names
    if isinstance(node,(ast.Tuple,ast.List)):
        return all(safe_expression(x,names) for x in node.elts)
    if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.USub,ast.UAdd)):
        return safe_expression(node.operand,names)
    if isinstance(node,ast.BinOp) and type(node.op) in _BINARY:
        return safe_expression(node.left,names) and safe_expression(node.right,names)
    if isinstance(node,ast.Subscript):
        return safe_expression(node.value,names) and safe_expression(node.slice,names)
    if isinstance(node,ast.Slice):
        return all(x is None or safe_expression(x,names) for x in (node.lower,node.upper,node.step))
    if isinstance(node,ast.Attribute):
        return node.attr in {'flow_rate','aspirate','dispense','top','bottom','center','wells','rows','columns'} and safe_expression(node.value,names)
    if isinstance(node,ast.Call):
        if isinstance(node.func,ast.Name) and node.func.id=='Point' and 'Point' in names:
            return len(node.args)<=3 and all(safe_expression(x,names) for x in node.args) and all(k.arg in ('x','y','z') and safe_expression(k.value,names) for k in node.keywords)
        if isinstance(node.func,ast.Attribute) and node.func.attr in _WELL_METHODS:
            return (safe_expression(node.func.value,names) and all(safe_expression(a,names) for a in node.args) and
                    all(k.arg is not None and safe_expression(k.value,names) for k in node.keywords))
    return False

class Planner:
    def __init__(self,source):
        self.source=source
        self.tree=ast.parse(source)
        funcs=[x for x in self.tree.body if isinstance(x,ast.FunctionDef) and x.name=='run']
        need(len(funcs)==1,'Expected exactly one top-level run(context).')
        self.run=funcs[0]
        args=self.run.args
        need(len(args.posonlyargs+args.args)==1 and not (self.run.decorator_list or args.kwonlyargs or args.defaults or args.vararg or args.kwarg),
             'Unsupported run() signature.')
        self.ctx=(args.posonlyargs+args.args)[0].arg
        self.scalar={}
        self.available={self.ctx:'context'}
        self.well_shapes={}
        self.pipettes={}
        self.tipracks=set()
        self.tipracks_by_name={}
        self.tip_lists={}
        self.deck_slots={}
        self.mounts={}
        self.pipette_models={}
        self.remaining_volume={}
        self.target_expressions={}
        self.explicit_tips=set()
        self.plan=[]
        self.boundaries=[]
        self.attached=set()
        self.warnings=[]
        self.started=False
        self.first_root=None
        self._globals()
    def _globals(self):
        meta={}
        # Report an explicit Flex mismatch before a secondary rejection such
        # as Flex-specific `add_parameters()` or gripper helper declarations.
        for n in self.tree.body:
            if (isinstance(n,ast.Assign) and len(n.targets)==1 and
                    isinstance(n.targets[0],ast.Name) and
                    n.targets[0].id in ('metadata','requirements')):
                try:
                    declaration=ast.literal_eval(n.value)
                    if isinstance(declaration,dict): meta.update(declaration)
                except (ValueError,SyntaxError,TypeError):
                    pass
        need(meta.get('robotType','OT-2')=='OT-2',
             'Recovery export is OT-2-only; Flex scripts are inspection-only.')
        for n in self.tree.body:
            if n is self.run: continue
            if isinstance(n,(ast.Import,ast.ImportFrom)):
                need(isinstance(n,ast.ImportFrom) and n.level==0 and
                     ((n.module=='opentrons' and all(a.name=='protocol_api' and a.asname is None for a in n.names)) or
                      (n.module=='opentrons.types' and all(a.name=='Point' and a.asname is None for a in n.names))),
                     'Unsupported external import outside run().')
                if n.module=='opentrons.types': self.available['Point']='point'
            elif isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name):
                name=n.targets[0].id
                need(name not in self.scalar and name not in ('range','zip','enumerate','reversed','Point','get_values'),
                     'Repeated or shadowed global binding may be stateful.')
                if name in ('metadata','requirements'):
                    value=ast.literal_eval(n.value)
                    need(isinstance(value,dict),'Invalid robot metadata.')
                    meta.update(value)
                    self.available[name]='metadata'
                else:
                    value=literal(n.value,self.scalar)
                    need(type(value) in (int,float,str,bool,list,tuple), 'Unsupported module-level initializer.')
                    self.scalar[name]=value
                    self.available[name]='constant'
            elif not (isinstance(n,ast.Expr) and isinstance(n.value,ast.Constant) and type(n.value.value) is str):
                raise Ineligible('Executable or unrecognized module-level code cannot be preserved safely.')
        need(meta.get('robotType','OT-2')=='OT-2','Recovery export is OT-2-only; Flex scripts are inspection-only.')
        need(isinstance(meta.get('apiLevel'),str) and meta.get('apiLevel').startswith('2.'),
             'An OT-2 API level is required.')
    def _setup(self,node):
        """Preserve setup verbatim, while registering known handles and lists."""
        line=node.lineno
        if isinstance(node,ast.Expr) and isinstance(node.value,ast.Constant): return True
        if not isinstance(node,ast.Assign): return False
        if len(node.targets)!=1: raise Ineligible(f'Line {line}: multi-assignment setup is unresolved.')
        name=node.targets[0]
        expr=node.value
        if isinstance(name,(ast.List,ast.Tuple)):
            need(isinstance(expr,(ast.List,ast.Tuple)) and len(name.elts)==len(expr.elts) and
                 all(isinstance(x,ast.Name) for x in name.elts),
                 f'Line {line}: configure Library parameters before building a recovery plan.')
            vals=[literal(x,self.scalar) for x in expr.elts]
            for n,v in zip(name.elts,vals):
                self.scalar[n.id]=v;self.available[n.id]='constant'
            return True
        if isinstance(name,ast.Attribute):
            # Initialization of flow rates must be before any execution steps.
            need(isinstance(name.value,ast.Attribute) and name.value.attr=='flow_rate' and
                 name.attr in ('aspirate','dispense','blow_out') and
                 isinstance(name.value.value,ast.Name) and
                 self.available.get(name.value.value.id)=='pipette' and
                 safe_expression(expr,set(self.available)),
                 f'Line {line}: unsupported hardware property initialization.')
            return True
        need(isinstance(name,ast.Name),f'Line {line}: unsupported setup target.')
        key=name.id
        need(key not in self.available,f'Line {line}: setup rebinding is not supported.')
        if isinstance(expr,ast.Call) and isinstance(expr.func,ast.Attribute) and isinstance(expr.func.value,ast.Name):
            obj=expr.func.value.id
            method=expr.func.attr
            if obj==self.ctx and method in {'load_labware','load_instrument','load_module'}:
                need(len(expr.args)>=1 and safe_expression(expr.args[0],set(self.available)),f'Line {line}: unresolved load name.')
                # A hardware declaration must be reproducible from saved setup,
                # not from a helper that might execute arbitrary Python.
                need(all(safe_expression(a,set(self.available)|set(self.scalar)) for a in expr.args) and
                     all(k.arg is not None and safe_expression(k.value,set(self.available)|set(self.scalar))
                         for k in expr.keywords),
                     f'Line {line}: dynamic hardware arguments cannot be replayed safely.')
                if method=='load_labware':
                    loadname=literal(expr.args[0],self.scalar)
                    need(type(loadname) is str and loadname in LABWARE,
                         f'Line {line}: unknown labware {loadname!r}; official definition required.')
                    slot_expr=expr.args[1] if len(expr.args)>1 else next((k.value for k in expr.keywords if k.arg in ('location','slot')),None)
                    need(slot_expr is not None,f'Line {line}: labware deck slot missing.')
                    slot=literal_slot(slot_expr,self.scalar,line)
                    need(slot not in self.deck_slots,f'Line {line}: deck slot {slot} already occupied by {self.deck_slots.get(slot)}.')
                    self.deck_slots[slot]=key
                    self.available[key]='labware'
                    self.well_shapes[key]=geometry(loadname)
                    if LABWARE[loadname][2]=='tips':
                        self.tipracks.add(key)
                        self.tipracks_by_name[key]=LABWARE[loadname][3]
                elif method=='load_instrument':
                    mount=(expr.args[1] if len(expr.args)>1 else next((k.value for k in expr.keywords if k.arg=='mount'),None))
                    need(mount is not None and literal(mount,self.scalar) in ('left','right'),
                         f'Line {line}: pipette mount must resolve to left or right.')
                    model=literal(expr.args[0],self.scalar)
                    need(model in PIPETTES,
                         f'Line {line}: unknown or unsupported OT-2 pipette {model!r}.')
                    mount_name=literal(mount,self.scalar)
                    need(mount_name not in self.mounts,
                         f'Line {line}: pipette mount {mount_name} already occupied.')
                    self.mounts[mount_name]=key
                    self.pipette_models[key]=model
                    self.remaining_volume[key]=0.0
                    racks=next((k.value for k in expr.keywords if k.arg=='tip_racks'),None)
                    # A real tip rack must be linked to the pipette. Avoid
                    # claiming an arbitrary array of objects is a tip source.
                    if racks is not None:
                        if isinstance(racks,ast.Name):
                            need(racks.id in self.tipracks,f'Line {line}: linked tip rack is unresolved.')
                        elif isinstance(racks,ast.List):
                            need(bool(racks.elts) and all(isinstance(v,ast.Name) and v.id in self.tipracks
                                                         for v in racks.elts),
                                 f'Line {line}: linked tip racks are unresolved.')
                        else:
                            raise Ineligible(f'Line {line}: linked tip racks must be explicit.')
                    allowed_sizes=PIPETTES[model][2]
                    if racks is not None:
                        listed=[racks.id] if isinstance(racks,ast.Name) else [v.id for v in racks.elts]
                        for rack in listed:
                            sizes=self.tip_lists.get(rack,[self.tipracks_by_name[rack]] if rack in self.tipracks_by_name else [])
                            need(bool(sizes) and all(size in allowed_sizes for size in sizes),
                                 f'Line {line}: tip rack {rack!r} incompatible with {model}.')
                    # Count nominal full pickups; 8-channel heads consume one
                    # tip from every row in a column. A fresh recovery run must
                    # begin with enough confirmed unused tips for its suffix.
                    count=0
                    for rack in listed if racks is not None else []:
                        n=len(self.tip_lists[rack]) if rack in self.tip_lists else 1
                        count += n * (12 if PIPETTES[model][1]==8 else 96)
                    self.pipettes[key]={'racks':racks is not None,'implicit':False,'at_well':False,
                                        'pickup_count':0,'nominal_pickup_capacity':count}
                    self.available[key]='pipette'
                else: self.available[key]='module'
                return True
        # Labware arrays created by a single statically bounded comprehension.
        if isinstance(expr,ast.ListComp) and len(expr.generators)==1:
            g=expr.generators[0]
            need(isinstance(g.target,ast.Name) and not (g.ifs or g.is_async) and
                 isinstance(expr.elt,ast.Call) and isinstance(expr.elt.func,ast.Attribute) and
                 isinstance(expr.elt.func.value,ast.Name) and expr.elt.func.value.id==self.ctx and
                 expr.elt.func.attr=='load_labware',
                 f'Line {line}: only finite labware-load comprehensions are supported in setup.')
            choices=iterable(g.iter,self.scalar)
            need(0<len(choices)<=24,f'Line {line}: hardware comprehension has an unsupported length.')
            need(bool(expr.elt.args) and type(literal(expr.elt.args[0],self.scalar)) is str,
                 f'Line {line}: rack type must be literal.')
            rack_name=literal(expr.elt.args[0],self.scalar)
            need(rack_name in LABWARE and LABWARE[rack_name][2]=='tips',
                 f'Line {line}: only known tip-rack load comprehensions are supported.')
            for choice in choices:
                chk=sub(expr.elt,{g.target.id:choice})
                need(all(safe_expression(a,set(self.available)|set(self.scalar)) for a in chk.args) and
                     all(k.arg is not None and safe_expression(k.value,set(self.available)|set(self.scalar))
                         for k in chk.keywords),f'Line {line}: dynamic rack definition.')
                need(len(chk.args)>=2 and safe_expression(chk.args[1],set(self.available)),
                     f'Line {line}: dynamic slot in hardware list.')
                slot=literal_slot(chk.args[1],self.scalar,line)
                need(slot not in self.deck_slots,
                     f'Line {line}: deck slot {slot} is already occupied.')
                self.deck_slots[slot]=key
            self.available[key]='labware_list'
            self.tipracks.add(key)
            self.tip_lists[key]=[LABWARE[rack_name][3]]*len(choices)
            return True
        seq=slice_sequence(expr,self.scalar,self.well_shapes) if isinstance(expr,ast.Subscript) and isinstance(expr.slice,ast.Slice) else None
        if seq is not None:
            # Use the assigned variable when expanding its future loop iterations.
            self.scalar[key]=Sequence(tuple(ast.Subscript(value=ast.Name(id=key,ctx=ast.Load()),slice=ast.Constant(i),ctx=ast.Load()) for i in range(len(seq.items))))
            self.available[key]='well_list'
            return True
        if isinstance(expr, (ast.Constant,ast.UnaryOp,ast.BinOp,ast.List,ast.Tuple)):
            try: self.scalar[key]=literal(expr,self.scalar);self.available[key]='constant';return True
            except Ineligible: pass
        if safe_expression(expr,set(self.available)):
            validate_well_syntax(expr,self.well_shapes,self.scalar,line)
            self.available[key]='target'
            self.target_expressions[key]=copy.deepcopy(expr)
            return True
        raise Ineligible(f'Line {line}: setup has an unresolved expression: {render_expr(expr)[:95]}')
    def _resolve(self,node,bindings):
        node=sub(node,bindings)
        need(safe_expression(node,set(self.available)|set(bindings)|set(self.scalar)),
             f'Line {node.lineno}: unrecognized or dynamic action argument: {render_expr(node)[:90]}')
        validate_well_syntax(node,self.well_shapes,self.scalar,node.lineno)
        for ref in (n for n in ast.walk(node) if isinstance(n,ast.Name) and n.id in self.target_expressions):
            validate_well_syntax(self.target_expressions[ref.id],self.well_shapes,self.scalar,node.lineno)
        return node
    def _record(self,node,kind,label):
        need(len(self.plan)<MAX_STEPS,'Execution expansion exceeds the 3000-statement limit.')
        self.plan.append(Step(node,node.lineno,label,kind))
    def _execute(self,node,bindings):
        if isinstance(node,ast.For) and not node.orelse:
            entries=iterable(sub(node.iter,bindings),self.scalar)
            for value in entries:
                nested=dict(bindings)
                collect_bindings(node.target,value,nested)
                for child in node.body: self._execute(child,nested)
            return
        if isinstance(node,ast.If):
            condition=literal(sub(node.test,bindings),self.scalar)
            need(type(condition) is bool,f'Line {node.lineno}: branch depends on runtime state.')
            for child in (node.body if condition else node.orelse):self._execute(child,bindings)
            return
        if isinstance(node,ast.Expr) and isinstance(node.value,ast.Constant) and type(node.value.value) is str:
            return
        if isinstance(node,ast.Pass): return
        prepared=sub(node,bindings)
        if isinstance(prepared,ast.Assign):
            need(len(prepared.targets)==1 and isinstance(prepared.targets[0],ast.Name) and
                 safe_expression(prepared.value,set(self.available)|set(self.scalar)),
                 f'Line {node.lineno}: stateful or unresolved assignment inside execution.')
            name=prepared.targets[0].id
            need(self.available.get(name) not in ('pipette','labware','labware_list','module','context','constant','metadata'),
                 f'Line {node.lineno}: hardware was rebound during execution.')
            # A local can be computed again when a selected cycle is replayed.
            self.available[name]='target'
            self.target_expressions[name]=copy.deepcopy(prepared.value)
            validate_well_syntax(prepared.value,self.well_shapes,self.scalar,node.lineno)
            self._record(prepared,'binding',f'Update {name}')
            return
        if not isinstance(prepared,ast.Expr):
            raise Ineligible(f'Line {node.lineno}: unsupported statement {type(node).__name__}.')
        expr=prepared.value
        if isinstance(expr,ast.Attribute) and isinstance(expr.value,ast.Name) and self.available.get(expr.value.id)=='pipette':
            # e.g. p300.blow_out is a no-op, not an Opentrons API call.
            warning=f'Line {node.lineno}: .{expr.attr} is referenced without (); it performs no operation.'
            if warning not in self.warnings:self.warnings.append(warning)
            return
        need(isinstance(expr,ast.Call) and isinstance(expr.func,ast.Attribute) and
             isinstance(expr.func.value,ast.Name),
             f'Line {node.lineno}: unrecognized operation cannot be safely replayed.')
        owner=expr.func.value.id;method=expr.func.attr
        kind=self.available.get(owner)
        need(kind in ('pipette','context'),f'Line {node.lineno}: command receiver is not a loaded pipette or context.')
        if kind=='context':
            need(method in _CONTEXT_METHODS,f'Line {node.lineno}: {method}() changes unsupported device or operator state.')
        else:
            need(method in _PIPETTE_METHODS,f'Line {node.lineno}: {method}() is not an eligible basic pipette action.')
        for arg in expr.args: self._resolve(arg,{})
        for kw in expr.keywords:
            need(kw.arg is not None,f'Line {node.lineno}: unpacked call arguments are not supported.')
            self._resolve(kw.value,{})
        if kind=='pipette':
            if method=='pick_up_tip':
                need(owner not in self.attached,f'Line {node.lineno}: pipette already has a tip.')
                self.pipettes[owner]['pickup_count']+=1
                need(self.pipettes[owner]['pickup_count']<=self.pipettes[owner]['nominal_pickup_capacity'],
                     f'Line {node.lineno}: tip pickups exceed declared rack capacity; refill/replace is not modelled.')
                if not expr.args and not expr.keywords:
                    need(self.pipettes[owner]['racks'] and self.tipracks,
                         f'Line {node.lineno}: implicit tip selection lacks known pipette tip racks.')
                    self.pipettes[owner]['implicit']=True
                if expr.args or expr.keywords:
                    tip_arg=(expr.args[0] if expr.args else
                             next((k.value for k in expr.keywords if k.arg=='location'),None))
                    need(tip_arg is not None,f'Line {node.lineno}: cannot identify explicit tip pickup.')
                    tip_expr=render_expr(tip_arg)
                    need(tip_expr not in self.explicit_tips,
                         f'Line {node.lineno}: the same explicit tip target appears twice.')
                    self.explicit_tips.add(tip_expr)
                    root=tip_arg
                    while isinstance(root,ast.Subscript): root=root.value
                    need(isinstance(root,ast.Name) and root.id in self.tipracks,
                         f'Line {node.lineno}: explicit pickup must reference a loaded tip rack.')
                self.pipettes[owner]['at_well']=False
                self.remaining_volume[owner]=0.0
                self.attached.add(owner)
            elif method=='drop_tip':
                need(owner in self.attached,f'Line {node.lineno}: no tip is attached to drop.')
                need(not expr.args and not expr.keywords,
                     f'Line {node.lineno}: recovery requires a standard drop-tip disposal.')
                self.pipettes[owner]['at_well']=False
                self.remaining_volume[owner]=0.0
                self.attached.remove(owner)
            else:
                need(owner in self.attached,f'Line {node.lineno}: {method}() requires an attached tip.')
                # Numeric checks concern nominal pipette capacity, not liquid identity,
                # well remaining volume, surface tension, or physical clearance.
                volume_index={'aspirate':0,'dispense':0,'mix':1,'air_gap':0}.get(method)
                if volume_index is not None:
                    val_node=expr.args[volume_index] if len(expr.args)>volume_index else next((k.value for k in expr.keywords if k.arg in ('volume','volume_ul')),None)
                    need(val_node is not None,f'Line {node.lineno}: missing {method} volume.')
                    amount=literal(val_node,self.scalar)
                    limit=PIPETTES[self.pipette_models[owner]][0]
                    need(type(amount) in _NUM and math.isfinite(amount) and 0<amount<=limit,
                         f'Line {node.lineno}: {method} volume {amount!r} µL outside (0,{limit}] for {self.pipette_models[owner]}.')
                    if method in ('aspirate','air_gap'):
                        self.remaining_volume[owner]+=amount
                        need(self.remaining_volume[owner]<=limit+1e-8,
                             f'Line {node.lineno}: pipette would contain {self.remaining_volume[owner]:g} µL above {limit:g} µL capacity.')
                    elif method=='dispense':
                        need(amount<=self.remaining_volume[owner]+1e-8,
                             f'Line {node.lineno}: dispensing {amount:g} µL exceeds known aspirated/air-gap volume {self.remaining_volume[owner]:g} µL.')
                        self.remaining_volume[owner]=max(0.0,self.remaining_volume[owner]-amount)
                if method=='blow_out':
                    self.remaining_volume[owner]=0.0
                target_index={'aspirate':1,'dispense':1,'mix':2,'move_to':0}.get(method)
                if target_index is not None:
                    loc=next((k.value for k in expr.keywords if k.arg=='location'),
                             expr.args[target_index] if len(expr.args)>target_index else None)
                    need(loc is not None,
                         f'Line {node.lineno}: {method}() needs an explicit location for restart.')
                    self.pipettes[owner]['at_well']=True
                elif method in ('touch_tip','blow_out'):
                    loc=next((k.value for k in expr.keywords if k.arg=='location'),
                             expr.args[0] if expr.args else None)
                    need(loc is not None or self.pipettes[owner]['at_well'],
                         f'Line {node.lineno}: {method}() has no known current well.')
                    if loc is not None: self.pipettes[owner]['at_well']=True
        self._record(prepared,method,f'{owner}.{method} · L{node.lineno}')
        if kind=='pipette' and method=='drop_tip' and not self.attached:
            # Every completed tip cycle is a potential restart boundary.
            self.boundaries.append(len(self.plan))
    def _config_branch(self,node):
        """Allow deterministic if/elif before motion iff branches contain scalar setup.

        Never interpret a robot operation as an installation-time branch.
        """
        if not isinstance(node,ast.If):return False
        leaves=[]
        def visit(n):
            if isinstance(n,ast.If):
                for x in n.body+n.orelse:visit(x)
            else:leaves.append(n)
        visit(node)
        if not leaves or not all(isinstance(x,ast.Assign) and len(x.targets)==1 and isinstance(x.targets[0],ast.Name) for x in leaves):
            return False
        def evaluate(n):
            if isinstance(n,ast.If):
                cond=literal(n.test,self.scalar)
                need(type(cond) is bool,f'Line {n.lineno}: setup condition unresolved.')
                for ch in (n.body if cond else n.orelse):evaluate(ch)
            else:self._setup(n)
        evaluate(node)
        return True
    def build(self):
        for n in self.run.body:
            if not self.started:
                if isinstance(n,ast.If) and self._config_branch(n):
                    continue
                if isinstance(n,(ast.For,ast.If)):
                    self.started=True;self.first_root=n
                elif isinstance(n,ast.Expr) and isinstance(n.value,ast.Call):
                    self.started=True;self.first_root=n
                elif isinstance(n,ast.Expr) and isinstance(n.value,ast.Attribute):
                    self.started=True;self.first_root=n
                else:
                    self._setup(n);continue
            self._execute(n,{})
        need(self.started and self.plan,'No supported execution actions were found.')
        need(not self.attached,'The execution ends with a tip still attached.')
        # Only complete tip cycles are exposed. Do not allow arbitrary line cuts.
        indices=[0]+[i for i in self.boundaries if i>0 and i<len(self.plan)]+[len(self.plan)]
        indices=list(dict.fromkeys(indices))
        need(len(indices)>=2 and any(s.kind=='drop_tip' for s in self.plan),
             'No complete tip-free pipetting cycle was found.')
        labels=[]
        for i in indices:
            item=self.plan[i] if i<len(self.plan) else None
            labels.append({'index':i,'line':item.line if item else self.plan[-1].line+1,
                           'next':item.label if item else 'End of execution'})
        return {'boundaries':labels,'count':len(self.plan),'warnings':self.warnings,
                'validationTier':'catalogue_subset_static_checks',
                'validatedByOfficialOpentronsAPI':False,
                'cycles':len(self.boundaries),'requiresFreshTips':any(x['implicit'] for x in self.pipettes.values()),
                'executionPlan':[
                    {'operation':s.kind,'line':s.line,'preview':s.label} for s in self.plan
                ]}
    def export(self,first,last):
        data=self.build()
        allowed={x['index'] for x in data['boundaries']}
        need(type(first) is int and type(last) is int and first<last and first in allowed and last in allowed,
             'Choose two ordered, complete tip-free boundaries.')
        # A local initialized in an omitted cycle may not be available after
        # truncation. Ensure every selected use is defined in setup or in its
        # own retained execution fragment before the use.
        execution_defined={s.statement.targets[0].id for s in self.plan
                           if isinstance(s.statement,ast.Assign) and len(s.statement.targets)==1
                           and isinstance(s.statement.targets[0],ast.Name)}
        retained_defined=set(self.available) - execution_defined
        for step in self.plan[first:last]:
            reads=[]
            if isinstance(step.statement,ast.Assign):
                reads=list(ast.walk(step.statement.value))
            else:
                reads=list(ast.walk(step.statement))
            for name in (n.id for n in reads if isinstance(n,ast.Name) and isinstance(n.ctx,ast.Load)):
                need(name not in execution_defined or name in retained_defined,
                     f'Line {step.line}: {name} depends on an omitted earlier step; select a larger interval.')
            if isinstance(step.statement,ast.Assign) and isinstance(step.statement.targets[0],ast.Name):
                retained_defined.add(step.statement.targets[0].id)
        lines=self.source.splitlines(keepends=True)
        begin=self.first_root.lineno-1
        finish=self.run.body[-1].end_lineno
        remaining=self.plan[first:last]
        need(remaining and any(step.kind=='drop_tip' for step in remaining),
             'The interval must contain at least one complete tip cycle.')
        # A comment is deliberately added so the new run cannot be mistaken for
        # the original uninterrupted experiment. No robot-state claim is made.
        header=['    # LabFlow GENERATED RECOVERY CANDIDATE: new run, not robot resume.\n',
                '    # Verify deck, sample wells, hardware calibration and unused tip racks.\n']
        commands=[]
        for s in remaining:
            snippet=ast.unparse(s.statement)
            commands.extend('    '+line+'\n' for line in snippet.splitlines())
        output=''.join(lines[:begin]+header+commands+lines[finish:])
        ast.parse(output)
        data.update({'source':output,'skipped':first,'kept':last-first,
                     'sourceSha256':hashlib.sha256(self.source.encode('utf-8')).hexdigest(),
                     'requiresOperatorStateVerification':True,
                     'omitted':len(self.plan)-last,
                     'notice':'Inspect/replenish physical tips and verify all well contents before analysing in the Opentrons App.'})
        return data

def recovery(source,first=None,last=None):
    need(type(source) is str and len(source.encode('utf-8'))<=MAX_SOURCE,
         'Source is too large.')
    planner=Planner(source)
    return planner.build() if first is None else planner.export(first,last)

def recovery_result(source,first=None,last=None,bind=None,parameters=None):
    """Return structured rejection rather than crashing the persistent worker."""
    try:
        if bind is not None:
            return bind_library_values(source,bind)
        if parameters:
            source=bind_library_values(source,parameters)['source']
        return recovery(source,first,last)
    except (Ineligible,ValueError,SyntaxError,RecursionError,OverflowError,TypeError,KeyError) as e:
        return {'ineligible':str(e)[:400]}


def bind_library_values(source, values):
    """Replace bare Library calls with selected literals, not evaluated Python.

    Edits use UTF-8 AST byte offsets and are applied in reverse order. A helper
    already present in the source is not replaced, even if it looks equivalent.
    """
    import math
    need(len(source) <= 250_000, 'Source is too large.')
    tree = ast.parse(source)
    runs = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'run']
    need(len(runs) == 1 and isinstance(values, dict), 'Expected one run function and explicit parameter choices.')
    nodes = list(ast.walk(tree))
    need(not any((isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.arg)) and
                  getattr(n, 'name', getattr(n, 'arg', None)) == 'get_values') or
                 (isinstance(n, ast.Name) and n.id == 'get_values' and not isinstance(n.ctx, ast.Load)) or
                 (isinstance(n, ast.alias) and (n.asname or n.name) in ('get_values', '*')) for n in nodes),
         'A get_values binding is already present or may be imported. Use the source as supplied.')
    calls = [n for n in nodes if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'get_values']
    permitted = {id(n.value) for n in runs[0].body if isinstance(n, ast.Assign)}
    need(calls and all(id(n) in permitted for n in calls),
         'Only direct get_values assignments inside run() can be configured.')
    call_names = {id(n.func) for n in calls}
    need(not any(isinstance(n, ast.Name) and n.id == 'get_values' and id(n) not in call_names for n in nodes),
         'Indirect get_values references cannot be configured.')
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1]+len(line.encode('utf-8')))
    edits = []
    for call in calls:
        need(call.args and not call.keywords and all(isinstance(arg, ast.Constant) and type(arg.value) is str for arg in call.args),
             'The Library parameter names must be literal strings.')
        keys = [arg.value for arg in call.args]
        missing = [key for key in keys if key not in values]
        need(not missing, 'Choose values for: '+', '.join(missing))
        selected = [values[key] for key in keys]
        need(all(type(value) in (str, bool, int, float) and
                 (type(value) is not float or math.isfinite(value)) for value in selected), 'Invalid parameter value.')
        edits.append((offsets[call.lineno-1]+call.col_offset,
                      offsets[call.end_lineno-1]+call.end_col_offset,
                      repr(selected).encode('utf-8')))
    payload = source.encode('utf-8')
    for start, end, replacement in sorted(edits, reverse=True):
        payload = payload[:start]+replacement+payload[end:]
    output = payload.decode('utf-8')
    ast.parse(output)
    return {'source': output}
