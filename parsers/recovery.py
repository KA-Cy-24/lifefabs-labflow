"""Conservative source-to-source OT-2 recovery. Never evaluates uploaded Python.

Only straight-line protocols with reproducible setup and explicit, complete tip
cycles qualify. AST spans identify statements; the output retains original text.
"""
import ast


class Ineligible(ValueError):
    pass


def need(condition, message):
    if not condition:
        raise Ineligible(message)


def passive(expr, names):
    """Recognize literals, setup handles and simple containers, not arbitrary code."""
    if isinstance(expr, ast.Constant):
        return type(expr.value) in (int, float, str, bool, type(None))
    if isinstance(expr, ast.Name):
        return expr.id in names
    if isinstance(expr, (ast.List, ast.Tuple)):
        return all(passive(x, names) for x in expr.elts)
    if isinstance(expr, ast.Dict):
        return all(k is not None and passive(k, names) and passive(v, names)
                   for k, v in zip(expr.keys, expr.values))
    if isinstance(expr, ast.UnaryOp) and isinstance(expr.op, (ast.USub, ast.UAdd)):
        return isinstance(expr.operand, ast.Constant) and type(expr.operand.value) in (int, float)
    return False


def target(expr, kinds):
    """Allow a literal well address, optionally with a nominal vertical reference."""
    if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Attribute):
        if (expr.func.attr in {'top', 'bottom', 'center'} and
                all(passive(a, {}) for a in expr.args) and
                all(k.arg == 'z' and passive(k.value, {}) for k in expr.keywords)):
            return target(expr.func.value, kinds)
    if (isinstance(expr, ast.Subscript) and isinstance(expr.value, ast.Name) and
            kinds.get(expr.value.id) == 'labware' and isinstance(expr.slice, ast.Constant)
            and isinstance(expr.slice.value, str)):
        return (expr.value.id, expr.slice.value)
    return None


def recovery(source, first=None, last=None):
    """Return tip-free boundaries, or a cropped copy for an eligible interval."""
    need(len(source) <= 250_000, 'Source is too large.')
    tree = ast.parse(source)
    runs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run']
    need(len(runs) == 1, 'Expected one top-level run(context).')
    run = runs[0]
    args = run.args
    params = args.posonlyargs + args.args
    need(len(params) == 1 and not (run.decorator_list or args.kwonlyargs or
         args.defaults or args.vararg or args.kwarg), 'Unsupported run signature.')
    ctx = params[0].arg
    # Module-level definitions are retained verbatim, but reject executable
    # initializers, imports from other packages, decorators and helper code.
    names, meta = {}, {}
    for n in tree.body:
        if n is run:
            continue
        if isinstance(n, ast.ImportFrom) and n.module == 'opentrons' and not n.level:
            need(all(x.name == 'protocol_api' and x.asname is None for x in n.names),
                 'Unsupported module-level import.')
        elif isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
            name = n.targets[0].id
            need(name not in names and passive(n.value, {}), 'Unsupported global initializer or rebinding.')
            names[name] = 'literal'
            if name in ('metadata', 'requirements'):
                value = ast.literal_eval(n.value)
                need(isinstance(value, dict), 'Invalid robot metadata.')
                need(value.get('robotType', 'OT-2') == 'OT-2', 'Recovery is available only for OT-2.')
                meta.update(value)
        elif not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)):
            raise Ineligible('Unsupported module-level code; recovery is unavailable.')
    need(meta.get('robotType', 'OT-2') == 'OT-2' and isinstance(meta.get('apiLevel'), str),
         'Recovery requires an OT-2 protocol with an API level.')
    names[ctx] = 'context'
    statements, boundaries, attached, used = [], [], set(), set()
    previous_end = run.lineno
    for node in run.body:
        line = node.lineno
        need(line > previous_end, f'Line {line}: put statements on separate lines.')
        previous_end = node.end_lineno
        if isinstance(node, ast.Assign) and not statements:
            need(len(node.targets) == 1 and isinstance(node.targets[0], ast.Name), f'Line {line}: unsupported setup binding.')
            name, expr = node.targets[0].id, node.value
            need(name not in names, f'Line {line}: setup rebinding is not supported.')
            if (isinstance(expr, ast.Call) and isinstance(expr.func, ast.Attribute)
                    and isinstance(expr.func.value, ast.Name)):
                owner, method = names.get(expr.func.value.id), expr.func.attr
                loads = {'load_labware':'labware', 'load_module':'module', 'load_instrument':'pipette'}
                kind = loads.get(method) if owner == 'context' else 'labware' if owner == 'module' and method == 'load_labware' else None
                need(kind and all(passive(a, names) for a in expr.args) and
                     all(k.arg and passive(k.value, names) for k in expr.keywords), f'Line {line}: unresolved hardware setup.')
                names[name] = kind
            else:
                need(passive(expr, {}) or target(expr, names), f'Line {line}: unsupported setup expression.')
                names[name] = 'value'
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str) and not statements:
            continue  # run() docstring
        call = node.value if isinstance(node, ast.Expr) else None
        need(isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and
             isinstance(call.func.value, ast.Name), f'Line {line}: loops, branches, assignments and indirect calls are not crop-safe.')
        owner, action = call.func.value.id, call.func.attr
        need(all(passive(a, names) or target(a, names) for a in call.args) and
             all(k.arg and (passive(k.value, names) or target(k.value, names)) for k in call.keywords),
             f'Line {line}: unresolved command argument.')
        if not attached:
            preview = ' '.join((ast.get_source_segment(source, call) or action).split())[:100]
            boundaries.append(dict(index=len(statements), line=line, next=preview))
        if names.get(owner) == 'pipette':
            if action == 'pick_up_tip':
                loc = call.args[0] if call.args else next((k.value for k in call.keywords if k.arg == 'location'), None)
                tip = target(loc, names)
                need(isinstance(loc, ast.Subscript) and tip and owner not in attached and tip not in used,
                     f'Line {line}: use explicit, unique tip locations and complete tip cycles.')
                attached.add(owner)
                used.add(tip)
            elif action == 'drop_tip':
                need(owner in attached and not call.args and not call.keywords, f'Line {line}: expected drop to fixed trash with a tip attached.')
                attached.remove(owner)
            elif action in {'aspirate', 'dispense', 'air_gap', 'blow_out', 'touch_tip', 'mix', 'move_to'}:
                need(owner in attached, f'Line {line}: operation requires an attached tip.')
                # Do not rely on a target remembered from the removed prefix.
                # Air gaps are relative to the tip's current position within its cycle.
                where = {'aspirate':1,'dispense':1,'mix':2,'move_to':0,'blow_out':0,'touch_tip':0}.get(action)
                if where is not None:
                    loc = next((k.value for k in call.keywords if k.arg == 'location'),
                               call.args[where] if len(call.args) > where else None)
                    need(target(loc, names), f'Line {line}: specify a literal well target for {action}.')
            else:
                raise Ineligible(f'Line {line}: {action} is not supported for recovery.')
        else:
            need(owner == ctx and action in {'delay', 'comment'},
                 f'Line {line}: {action} may change module or operator state; recovery is unavailable.')
        statements.append(node)
    need(statements and not attached, 'There must be execution steps and no attached tips at the end.')
    boundaries.append(dict(index=len(statements), line=statements[-1].end_lineno + 1, next='End of execution'))
    result = dict(boundaries=boundaries, count=len(statements))
    if first is not None:
        allowed = {b['index'] for b in boundaries}
        need(type(first) is int and type(last) is int and first in allowed and last in allowed and first < last,
             'Choose two ordered tip-free boundaries.')
        lines = source.splitlines(keepends=True)
        start = statements[0].lineno - 1
        end = statements[-1].end_lineno
        selected_begin = statements[first].lineno - 1
        selected_end = statements[last-1].end_lineno
        output = ''.join(lines[:start] + lines[selected_begin:selected_end] + lines[end:])
        # Parsing again guards the transformation; this is not API validation.
        ast.parse(output)
        result.update(source=output, skipped=first, kept=last-first, omitted=len(statements)-last)
    return result


def recovery_result(source, first=None, last=None):
    """An expected rejection is data, so the browser worker can stay warm."""
    try:
        return recovery(source, first, last)
    except (ValueError, SyntaxError, RecursionError, OverflowError) as exc:
        return {'ineligible': str(exc)[:350]}
