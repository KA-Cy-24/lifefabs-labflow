/* Run only the bundled AST reader, never the imported protocol. */
const base = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let runtime, recoveryRuntime;
async function start() {
  importScripts(base + 'pyodide.js');
  const py = await loadPyodide({indexURL: base});
  const response = await fetch('../parsers/opentrons_ast.py');
  if (!response.ok) throw Error('Bundled AST reader unavailable');
  py.runPython(await response.text(), {globals: py.globals});
  return py;
}
async function loadRecovery(py) {
  const crop = await fetch('../parsers/recovery.py');
  if (!crop.ok) throw Error('Bundled recovery reader unavailable');
  py.runPython(await crop.text(), {globals: py.globals});
}
self.onmessage = async ({data}) => {
  try {
    const py = await (runtime ||= start());
    if (data.crop) await (recoveryRuntime ||= loadRecovery(py));
    py.globals.set('lf_source', data.source);
    py.globals.set('lf_ordering', JSON.stringify(data.ordering));
    py.globals.set('lf_parameters', JSON.stringify(data.parameters || {}));
    py.globals.set('lf_crop', JSON.stringify(data.crop ?? null));
    const result = py.runPython(data.crop
      ? 'json.dumps(recovery_result(lf_source, **json.loads(lf_crop)), allow_nan=False)'
      : 'json.dumps(analyse(lf_source, json.loads(lf_ordering), json.loads(lf_parameters)), allow_nan=False)');
    self.postMessage({id:data.id, result:JSON.parse(result)});
  } catch (error) {
    self.postMessage({id:data.id, error:String(error.message || error).slice(0, 400)});
  }
};
