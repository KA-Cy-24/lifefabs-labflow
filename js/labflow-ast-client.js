/* Browser transport and catalogue geometry. No uploaded source is run or sent to a server. */
let worker, nextId = 0;
const pending = new Map();
function reset(error) {
  worker?.terminate(); worker = null;
  for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); }
  pending.clear();
}
function analyse(source, ordering, parameters={}, crop=null) {
  if (!worker) {
    worker = new Worker(new URL('./labflow-ast-worker.js', import.meta.url));
    worker.onmessage = ({data}) => {
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id); clearTimeout(job.timer);
      if (data.error) { job.reject(Error(data.error)); reset(Error(data.error)); }
      else job.resolve(data.result);
    };
    worker.onerror = () => reset(Error('Python worker failed to start. Check network access to the Pyodide CDN.'));
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reset(Error('Python analysis timed out.')), 45000);
    pending.set(id, {resolve,reject,timer});
    worker.postMessage({id,source,ordering,parameters,crop});
  });
}

function orderOf(definition) {
  if (definition?.ordering?.length) return definition.ordering;
  const g = definition?.wellGeometry;
  if (!g) return null;
  return Array.from({length:g.columns}, (_,c) => Array.from({length:g.rows}, (_,r) => `${'ABCDEFGH'[r]}${c+1}`));
}

async function fetchOfficial(name) {
  if (!/^[a-z0-9_]{1,100}$/.test(name)) return null;
  try {
    const url = `https://raw.githubusercontent.com/Opentrons/opentrons/v9.0.0/shared-data/labware/definitions/2/${name}/1.json`;
    const response = await fetch(url, {signal:AbortSignal.timeout(4500)});
    if (!response.ok) return null;
    const d = await response.json();
    if (d.namespace !== 'opentrons' || d.version !== 1 || d.parameters?.loadName !== name) return null;
    return {loadName:name, displayName:d.metadata.displayName, dimensions:{x:d.dimensions.xDimension,y:d.dimensions.yDimension,z:d.dimensions.zDimension},
      ordering:d.ordering, wellMap:d.wells, cornerOffsetFromSlot:d.cornerOffsetFromSlot, tipRack:!!d.parameters.isTiprack};
  } catch { return null; }
}

export async function requestRecovery(source, first=null, last=null) {
  const result=await analyse(source, {}, {}, {first,last});
  if(result.ineligible) throw Error(result.ineligible);
  return result;
}

export async function inspectPython(source, bundled, report, input) {
  const parameters = input?.source === source ? input.values : {};
  const definitions = new Map(bundled.map(d => [d.loadName,d]));
  const ordering = Object.create(null);
  for (const d of definitions.values()) { const order = orderOf(d); if (order) ordering[d.loadName] = order; }
  let model = await analyse(source, ordering, parameters);
  // A first pass discovers literal loads even if unknown well ordering prevents tracing the rest.
  for (let pass=0, requested=new Set(); pass<3 && model.status!=='source-only'; pass++) {
    const names = [...new Set(model.hardware.filter(h => h.kind==='labware' && h.catalogue && !definitions.has(h.name) && !requested.has(h.name)).map(h => h.name))].slice(0,16);
    if (!names.length) break;
    report('Looking up missing standard labware geometry…');
    let changed = false;
    await Promise.all(names.map(async name => {
      requested.add(name);
      const def = await fetchOfficial(name);
      if (!def) return;
      definitions.set(name,def); ordering[name]=def.ordering; changed=true;
    }));
    if (!changed) break;
    model = await analyse(source,ordering,parameters);
  }
  return {model,definitions};
}
