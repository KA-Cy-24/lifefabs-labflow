/* Run only the bundled AST reader, never the imported protocol. */
const base = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let runtime;
async function start() {
  importScripts(base + 'pyodide.js');
  const py = await loadPyodide({indexURL: base});
  const response = await fetch('../parsers/opentrons_ast.py');
  if (!response.ok) throw Error('Bundled AST reader unavailable');
  py.runPython(await response.text(), {globals: py.globals});
  return py;
}
self.onmessage = async ({data}) => {
  try {
    const py = await (runtime ||= start());
    py.globals.set('lf_source', data.source);
    py.globals.set('lf_ordering', JSON.stringify(data.ordering));
    const result = py.runPython('json.dumps(analyse(lf_source, json.loads(lf_ordering)), allow_nan=False)');
    self.postMessage({id:data.id, result:JSON.parse(result)});
  } catch (error) {
    self.postMessage({id:data.id, error:String(error.message || error).slice(0, 400)});
  }
};
