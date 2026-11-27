import { requestRecovery } from './labflow-ast-client.js';

/*
 * This panel controls the *existing* Source Code panel. It never replaces the
 * hardware, deck, or block interfaces. Uploaded source is only parsed as AST.
 * Nothing here controls a robot or reads its current physical state.
 */
const $ = id => document.getElementById(id);
const editor = $('codeEditor');
const start = $('lfRecoveryStart'), end = $('lfRecoveryEnd');
const status = $('lfRecoveryStatus'), controls = $('lfRecoveryControls');
const confirmed = $('lfRecoveryConfirm'), download = $('lfRecoveryDownload');
let snapshot = null, boundaries = null, info = null, ticket = 0;

function libraryParameters(source) {
  // Values are stored by the existing Protocol Library inspection handoff.
  // A stale selection may never change a different uploaded source.
  const selected = editor.lfLibraryValues;
  return selected?.source === source ? {...selected.values} : {};
}
function signature(value) { return JSON.stringify(value); }
function reset() {
  ++ticket;
  snapshot = boundaries = info = null;
  controls.hidden = true;
  confirmed.checked = false;
  download.disabled = true;
}
function describe() {
  if (!boundaries) return;
  const a = boundaries[Number(start.value)], b = boundaries[Number(end.value)];
  $('lfRecoveryFrom').textContent = `Before line ${a.line}: ${a.next}`;
  $('lfRecoveryTo').textContent = b.next === 'End of execution'
    ? 'Through end of execution'
    : `Stop before line ${b.line}: ${b.next}`;
  const eligible = a.index < b.index;
  const summary = eligible
    ? `${a.index} expanded statements skipped · ${b.index - a.index} retained · ${boundaries.at(-1).index - b.index} omitted. `
    : 'End must be after start. ';
  const fresh = info?.requiresFreshTips
    ? 'Implicit tip pickup: start with replenished/verified full compatible tip racks. '
    : 'Verify the physical tip positions required by the selected code. ';
  const noops = info?.warnings?.length
    ? `${info.warnings.length} source warning(s); review the console/inspection before use.` : '';
  status.textContent = summary + fresh + noops;
  download.disabled = !confirmed.checked || !eligible;
}
function changeSource() { reset(); status.textContent = ''; }
editor.addEventListener('input', changeSource);
window.addEventListener('lifefabs:source-generated', () => {
  if (snapshot && snapshot.source !== editor.value) changeSource();
});
for (const id of ['modeBuild', 'modeInspect', 'loadExample', 'pythonFile']) {
  const element = $(id);
  element?.addEventListener(id === 'pythonFile' ? 'change' : 'click', changeSource);
}
$('lfRecoveryScan').onclick = async () => {
  reset();
  const current = ticket;
  const source = editor.value;
  const parameters = libraryParameters(source);
  status.textContent = 'Resolving bounded Python loops and identifying complete tip cycles…';
  try {
    const result = await requestRecovery(source, null, null, parameters);
    if (current !== ticket) return;
    if (editor.value !== source || signature(parameters) !== signature(libraryParameters(source)))
      throw Error('Source or selected Library parameters changed. Scan again.');
    if (!result.boundaries?.length || result.boundaries.length < 2)
      throw Error('No eligible tip-free interval was found.');
    snapshot = {source, parameters, signature: signature(parameters)};
    info = result;
    boundaries = result.boundaries;
    start.max = end.max = String(boundaries.length - 1);
    start.value = '0'; end.value = end.max;
    controls.hidden = false;
    describe();
  } catch (error) {
    if (current === ticket) status.textContent = `Not eligible: ${error.message}`;
  }
};
for (const slider of [start, end]) {
  slider.oninput = () => { confirmed.checked = false; describe(); };
}
confirmed.onchange = describe;
download.onclick = async () => {
  if (!snapshot || !boundaries || !confirmed.checked ||
      snapshot.source !== editor.value ||
      snapshot.signature !== signature(libraryParameters(editor.value))) {
    reset(); status.textContent = 'Source, inputs, or confirmation changed. Scan again.'; return;
  }
  const current = ticket;
  const a = Number(start.value), b = Number(end.value);
  const first = boundaries[a].index, last = boundaries[b].index;
  const {source, parameters} = snapshot;
  download.disabled = true;
  try {
    const result = await requestRecovery(source, first, last, parameters);
    if (current !== ticket || editor.value !== source || !confirmed.checked ||
        a !== Number(start.value) || b !== Number(end.value) ||
        snapshot.signature !== signature(libraryParameters(source))) return;
    const url = URL.createObjectURL(new Blob([result.source], {type:'text/x-python;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'labflow-recovery-candidate.py';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    status.textContent = 'Generated a new-run recovery candidate. Review source warnings, verify physical state, and analyze it in the official Opentrons App before running.';
  } catch (error) {
    if (current === ticket) status.textContent = `Export blocked: ${error.message}`;
  } finally {
    if (current === ticket && boundaries) {
      download.disabled = !confirmed.checked || Number(start.value) >= Number(end.value);
    }
  }
};
