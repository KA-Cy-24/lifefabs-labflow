"""Conservative Opentrons source reader. Never imports or executes the input.

The AST is interpreted as data by a small allowlist. Unknown flow terminates
tracing at the first unresolved branch, so mutually exclusive steps are never
shown as a single run. Unknown locations remain unknown, not default wells.
"""
import ast
import json
import operator
import sys
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class Unknown:
    reason: str


@dataclass(frozen=True)
class Handle:
    kind: str
    id: str


@dataclass(frozen=True)
class Target:
    lab: str
    well: str
    reference: str = 'default'
    z: float = 0
    offset: bool = False
    point: tuple | None = None


class Stop(Exception):
    pass


ACTIONS = {
    'aspirate': (1, 'location'), 'dispense': (1, 'location'),
    'mix': (2, 'location'), 'move_to': (0, 'location'),
    'touch_tip': (0, 'location'), 'blow_out': (0, 'location'),
    'pick_up_tip': (0, 'location'), 'drop_tip': (0, 'location'),
    'return_tip': (0, 'home_after'), 'air_gap': (9, 'location'),
}
MODULE = set('open_labware_latch close_labware_latch set_and_wait_for_temperature set_target_temperature wait_for_temperature set_and_wait_for_shake_speed deactivate_shaker deactivate_heater set_temperature deactivate open_lid close_lid set_lid_temperature set_block_temperature execute_profile deactivate_lid deactivate_block engage disengage'.split())
OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
       ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod,
       ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt,
       ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge}


class Reader:
    def __init__(self, definitions):
        self.defs = definitions
        self.env = {}
        self.hardware = []
        self.events = []
        self.warnings = []
        self.budget = 30000

    def tick(self):
        self.budget -= 1
        if self.budget < 0:
            raise Stop('Static expansion limit reached.')

    def warn(self, node, message):
        entry = {'line': getattr(node, 'lineno', None), 'message': message}
        if len(self.warnings) < 80 and entry not in self.warnings:
            self.warnings.append(entry)

    def geometry(self, handle):
        lab = next(x for x in self.hardware if x['id'] == handle.id)
        return self.defs.get(lab['name'], []) if lab['catalogue'] else []

    def assign(self, node, value):
        if isinstance(node, ast.Name):
            self.env[node.id] = value
        elif isinstance(node, (ast.List, ast.Tuple)):
            if isinstance(value, Unknown):
                for target in node.elts:
                    self.assign(target, value)
            elif isinstance(value, (list, tuple)) and len(value) == len(node.elts):
                for target, part in zip(node.elts, value):
                    self.assign(target, part)
            else:
                raise Stop('Unresolved unpacking assignment.')
        else:
            raise Stop('Unsupported assignment target.')

    def statements(self, body):
        for node in body:
            self.tick()
            try:
                if isinstance(node, ast.Assign):
                    value = self.expr(node.value)
                    for target in node.targets:
                        self.assign(target, value)
                elif isinstance(node, ast.AnnAssign) and node.value is not None:
                    self.assign(node.target, self.expr(node.value))
                elif isinstance(node, ast.Expr):
                    value = self.expr(node.value)
                    if isinstance(value, Unknown) and not isinstance(node.value, ast.Constant):
                        self.warn(node, value.reason)
                elif isinstance(node, ast.For) and not node.orelse:
                    for value in self.iterable(self.expr(node.iter)):
                        self.assign(node.target, value)
                        self.statements(node.body)
                elif isinstance(node, ast.If):
                    value = self.expr(node.test)
                    if isinstance(value, Unknown):
                        raise Stop('Runtime-dependent branch: ' + value.reason)
                    self.statements(node.body if value else node.orelse)
                elif not isinstance(node, (ast.Pass, ast.Global)):
                    raise Stop('Unsupported statement: ' + type(node).__name__)
            except Stop as exc:
                raise Stop(f'line {node.lineno}: {exc}') from None

    @staticmethod
    def iterable(value):
        if not isinstance(value, (list, tuple, range)) or len(value) > 384:
            raise Stop('Iteration is unresolved or exceeds 384 items.')
        return value

    def expr(self, node):
        self.tick()
        try:
            return self.value(node)
        except (ArithmeticError, ValueError, TypeError, LookupError) as exc:
            return Unknown(f'Cannot resolve {type(node).__name__} ({type(exc).__name__}).')

    def value(self, n):
        if isinstance(n, ast.Constant):
            return n.value if type(n.value) in (int, float, str, bool, type(None)) else Unknown('Unsupported literal.')
        if isinstance(n, ast.Name):
            return self.env.get(n.id, Unknown('Unresolved name: ' + n.id))
        if isinstance(n, (ast.Tuple, ast.List)):
            return [self.expr(x) for x in n.elts]
        if isinstance(n, ast.Slice):
            return slice(*(self.expr(x) if x else None for x in (n.lower, n.upper, n.step)))
        if isinstance(n, ast.Subscript):
            base, index = self.expr(n.value), self.expr(n.slice)
            if isinstance(base, Handle) and base.kind == 'labware' and isinstance(index, str):
                return Target(base.id, index)
            if isinstance(base, (list, tuple, range, dict, str)):
                return base[index]
        if isinstance(n, ast.UnaryOp):
            value = self.expr(n.operand)
            if not isinstance(value, Unknown):
                if isinstance(n.op, ast.Not):
                    return not value
                if isinstance(n.op, ast.USub) and type(value) in (int, float):
                    return -value
        if isinstance(n, ast.BinOp) and type(n.op) in OPS:
            a, b = self.expr(n.left), self.expr(n.right)
            if type(a) in (int, float) and type(b) in (int, float) and abs(a) < 1e12 and abs(b) < 1e12:
                return OPS[type(n.op)](a, b)
        if isinstance(n, ast.Compare) and len(n.ops) == 1 and type(n.ops[0]) in OPS:
            a, b = self.expr(n.left), self.expr(n.comparators[0])
            if not isinstance(a, Unknown) and not isinstance(b, Unknown):
                return OPS[type(n.ops[0])](a, b)
        if isinstance(n, ast.ListComp) and len(n.generators) == 1:
            g = n.generators[0]
            if not g.ifs and not g.is_async:
                saved = self.env.copy()
                try:
                    out = []
                    for item in self.iterable(self.expr(g.iter)):
                        self.assign(g.target, item)
                        out.append(self.expr(n.elt))
                    return out
                finally:
                    self.env = saved
        if isinstance(n, ast.Call):
            return self.call(n)
        if isinstance(n, ast.Attribute) and isinstance(self.expr(n.value), Handle):
            return Unknown(f'.{n.attr} is referenced without parentheses; no robot action was recorded.')
        return Unknown(f'Unsupported expression: {type(n).__name__}.')

    def call(self, n):
        if any(k.arg is None for k in n.keywords) or any(isinstance(a, ast.Starred) for a in n.args):
            raise Stop('Dynamic argument unpacking is unsupported.')
        args = [self.expr(x) for x in n.args]
        kw = {k.arg: self.expr(k.value) for k in n.keywords}

        def arg(i, name, default=None):
            return kw.get(name, args[i] if i < len(args) else default)

        if isinstance(n.func, ast.Name):
            name = n.func.id
            # Do not treat a shadowed name as a Python built-in.
            if name not in self.env and name == 'range' and not kw and all(type(x) is int for x in args):
                return self.iterable(range(*args))
            if name not in self.env and name in ('zip', 'enumerate') and not kw:
                if name == 'zip':
                    return list(zip(*(self.iterable(x) for x in args)))
                return list(enumerate(self.iterable(args[0]), *args[1:]))
            if name == 'Point':
                axes = ('x', 'y', 'z')
                if len(args) <= 3 and set(kw) <= set(axes) and not set(axes[:len(args)]) & set(kw):
                    point = tuple(arg(i, axis, 0) for i, axis in enumerate(axes))
                    if all(type(value) in (int, float) and abs(value) < 1e6 for value in point):
                        return {'point': point}
                return Unknown('Point depends on an unresolved coordinate.')
            # Override only an absent Library helper with user-selected data.
            # Never execute a get_values function supplied in Python source.
            if name == 'get_values' and name not in self.env and not kw and args:
                if all(type(key) is str and key in self.parameters and
                       type(self.parameters[key]) in (str, int, float, bool) for key in args):
                    return [self.parameters[key] for key in args]
                self.warn(n, 'Library parameters not supplied. Select values on the Library card.')
                return Unknown('Library runtime values are not supplied.')
            self.warn(n, f'{name}() not evaluated; effects are not modelled.')
            if name == 'get_values':
                return Unknown('A Python-defined Library helper was not executed.')
            raise Stop(f'Unmodelled function {name}() may change protocol state.')
        if not isinstance(n.func, ast.Attribute):
            raise Stop('Indirect calls are unsupported.')
        obj, method = self.expr(n.func.value), n.func.attr
        if isinstance(obj, Target):
            if method in ('top', 'bottom', 'center'):
                z = arg(0, 'z', 0)
                return replace(obj, reference=method, z=z if type(z) in (int, float) else 0,
                               offset=obj.offset or type(z) not in (int, float))
            if method == 'move':
                point = args[0].get('point') if len(args) == 1 and not kw and isinstance(args[0], dict) else None
                # Record one literal relative move. Chained/dynamic moves stay unknown.
                return replace(obj, offset=True, point=point if not obj.offset else None)
        if not isinstance(obj, Handle):
            raise Stop('Unresolved receiver for .' + method + '().')
        kind = obj.kind
        if kind == 'context':
            if method in ('load_labware', 'load_instrument', 'load_module'):
                return self.load(n, method[5:], arg(0, 'load_name' if method != 'load_instrument' else 'instrument_name'),
                                 arg(1, 'mount' if method == 'load_instrument' else 'location'), arg(2, 'label'), catalogue=method != 'load_labware' or self.catalogue_args(n, args, kw, 3))
            if method in ('pause', 'delay', 'comment', 'home'):
                self.event(n, obj, method, [], args, kw)
                return None
        if kind in ('module', 'adapter') and method in ('load_labware', 'load_adapter'):
            return self.load(n, method[5:], arg(0, 'load_name'), None, arg(1, 'label'), parent=obj.id, catalogue=self.catalogue_args(n, args, kw, 2))
        if kind == 'labware' and method in ('wells', 'wells_by_name', 'rows', 'columns', 'rows_by_name', 'columns_by_name'):
            columns = self.geometry(obj)
            if not columns:
                return Unknown('Well ordering unavailable for ' + obj.id)
            targets = [[Target(obj.id, w) for w in col] for col in columns]
            flat = [x for col in targets for x in col]
            if method == 'wells':
                return flat
            if method == 'wells_by_name':
                return {x.well: x for x in flat}
            if method in ('rows', 'rows_by_name'):
                labels = list(dict.fromkeys(x.well.rstrip('0123456789') for x in flat))
                groups = [[x for x in flat if x.well.rstrip('0123456789') == label] for label in labels]
            else:
                labels = [col[0].well.lstrip('ABCDEFGHIJKLMNOPQRSTUVWXYZ') for col in targets]
                groups = targets
            return dict(zip(labels, groups)) if method.endswith('_by_name') else groups
        if kind == 'instrument' and method in ACTIONS:
            index, key = ACTIONS[method]
            target = arg(index, key)
            self.event(n, obj, method, [target] if target is not None else [], args, kw)
            return None
        if kind == 'instrument' and method in ('transfer', 'distribute', 'consolidate'):
            sources = arg(1, 'source')
            dests = arg(2, 'dest')
            # Preserve groups and direction. Do not invent the API's internal tip/refill sequence.
            self.event(n, obj, method, (sources, dests), args, kw)
            return None
        if kind == 'module' and method in MODULE:
            self.event(n, obj, method, [], args, kw)
            return None
        raise Stop(f'Unsupported {kind} call .{method}().')

    def catalogue_args(self, node, args, kw, start):
        """Do not substitute default geometry for explicit definition identities."""
        if len(args) > start or 'namespace' in kw or 'version' in kw:
            self.warn(node, 'Explicit labware identity: geometry not resolved by this reader.')
            return False
        return True

    def load(self, node, kind, name, location, label, parent=None, catalogue=True):
        if not isinstance(name, str):
            raise Stop('Hardware load name is unresolved.')
        if isinstance(location, Unknown) or (location is not None and type(location) not in (int, str)):
            self.warn(node, f'{name}: placement or mount unresolved.')
            location = None
        row = dict(id=f'h{len(self.hardware)+1}', kind=kind, name=name, location=location,
                   label=label if isinstance(label, str) else name, parent=parent, line=node.lineno, catalogue=catalogue)
        self.hardware.append(row)
        return Handle(kind, row['id'])

    def event(self, n, obj, method, target_groups, args, kw):
        if len(self.events) >= 500:
            raise Stop('500-operation preview limit reached.')

        def target(x):
            if isinstance(x, Target):
                if x.offset:
                    if x.point is not None:
                        self.warn(n, f'Constant offset {x.point} mm retained relative to {x.reference} (Z={x.z} mm). Deck preview highlights the well, not the offset point.')
                    else:
                        self.warn(n, 'Dynamic or unsupported offset; exact position unresolved.')
                return dict(lab=x.lab, well=x.well, reference=x.reference, z=x.z, offset=x.offset, point=x.point)
            if isinstance(x, (list, tuple)):
                return [target(v) for v in x]
            self.warn(n, 'A command target could not be resolved.')
            return None

        pos = 1 if method == 'mix' else 0
        volume = kw.get('volume', args[pos] if len(args) > pos else None)
        self.events.append(dict(line=n.lineno, owner=obj.id, method=method,
                                targets=[target(x) for x in target_groups],
                                message=(kw.get('msg', args[0] if args else '') if method == 'comment' and type(kw.get('msg', args[0] if args else '')) is str else None),
                                volume=volume if method in ('aspirate', 'dispense', 'mix', 'air_gap', 'transfer', 'distribute', 'consolidate') and type(volume) in (int, float) else None))


def analyse(source, definitions=None, parameters=None):
    """Return a JSON-compatible preview, including the reason any trace stopped."""
    reader = Reader(definitions or {})
    reader.parameters = parameters or {}
    result = dict(robot=None, api=None, name=None, parameter=None, hardware=reader.hardware,
                  events=reader.events, warnings=reader.warnings, status='partial')
    if len(source) > 250_000:
        result['warnings'].append(dict(line=None, message='Source exceeds 250,000 characters.'))
        return result
    try:
        tree = ast.parse(source)
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run']
        # Module initializers are never interpreted. Restrict global bindings to literals.
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Import, ast.ImportFrom, ast.ClassDef)):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    reader.env[node.name] = Unknown('User-defined name.')
                continue
            if isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value:
                try:
                    value = ast.literal_eval(node.value)
                except (ValueError, TypeError):
                    value = Unknown('Nonliteral global assignment.')
                    reader.warn(node, value.reason)
                for dest in node.targets if isinstance(node, ast.Assign) else [node.target]:
                    reader.assign(dest, value)
            elif not (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)):
                reader.warn(node, 'Module-level statement not modelled.')
        for key in ('metadata', 'requirements'):
            meta = reader.env.get(key)
            if isinstance(meta, dict):
                for a, b in [('robotType', 'robot'), ('apiLevel', 'api'), ('protocolName', 'name')]:
                    if isinstance(meta.get(a), str):
                        result[b] = meta[a]
        if len(functions) != 1 or functions[0].decorator_list:
            raise Stop('Expected one undecorated top-level run(context) function.')
        run = functions[0]
        parameters = run.args.posonlyargs + run.args.args
        if len(parameters) != 1 or run.args.kwonlyargs or run.args.vararg or run.args.kwarg:
            raise Stop('Expected one positional parameter in run().')
        result['parameter'] = parameters[0].arg
        if result['robot'] not in (None, 'OT-2'):
            result['status'] = 'source-only'
            reader.warn(run, f"{result['robot']} source only: cannot map onto the OT-2 deck.")
            return result
        reader.env[result['parameter']] = Handle('context', 'context')
        reader.statements(run.body)
        result['status'] = 'partial' if reader.warnings else 'mapped-subset'
    except (Stop, SyntaxError, RecursionError, OverflowError) as exc:
        reader.warnings.append(dict(line=getattr(exc, 'lineno', None), message=str(exc)[:400]))
    return result

