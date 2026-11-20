import { requestRecovery } from './labflow-ast-client.js';

// This panel is shared by Build and Inspect. It works on a frozen copy of
// the Python editor text and never changes the saved draft or imports a script.
const $ = id => document.getElementById(id);
const editor = $('codeEditor');
const start = $('lfRecoveryStart'), end = $('lfRecoveryEnd');
const status = $('lfRecoveryStatus'), controls = $('lfRecoveryControls');
const confirmState = $('lfRecoveryConfirm'), download = $('lfRecoveryDownload');
let snapshot, boundaries, ticket = 0;

function reset() {
  ++ticket;
  snapshot = boundaries = null;
  controls.hidden = true;
  confirmState.checked = false;
  download.disabled = true;
}
function describe() {
  const a = boundaries[Number(start.value)], b = boundaries[Number(end.value)];
  $('lfRecoveryFrom').textContent = `From line ${a.line}: ${a.next}`;
  $('lfRecoveryTo').textContent = b.next === 'End of execution' ? 'Through end of execution' : `Stop before line ${b.line}: ${b.next}`;
  status.textContent = a.index < b.index ? `${a.index} earlier commands skipped · ${b.index - a.index} retained · ${boundaries.at(-1).index - b.index} later commands omitted.` : 'End must be after start.';
  download.disabled = !confirmState.checked || a.index >= b.index;
}
$('lfRecoveryScan').onclick = async () => {
  reset();
  const current = ticket, source = editor.value;
  status.textContent = 'Checking the current Python for supported restart boundaries…';
  try {
    const result = await requestRecovery(source);
    if (current !== ticket) return;
    if (editor.value !== source) throw Error('Source changed. Check it again.');
    if (result.boundaries.length < 2) throw Error('No eligible interval.');
    snapshot = source; boundaries = result.boundaries;
    start.max = end.max = boundaries.length - 1;
    start.value = 0; end.value = end.max;
    controls.hidden = false;
    describe();
  } catch (error) {
    if (current === ticket) status.textContent = `Not eligible: ${error.message}`;
  }
};
for (const slider of [start, end]) slider.oninput = () => { confirmState.checked = false; describe(); };
confirmState.onchange = describe;
function changeSource() { reset(); status.textContent = ''; }
editor.addEventListener('input', changeSource);
window.addEventListener('lifefabs:source-generated', () => {
  if (snapshot !== editor.value) changeSource();
});
for (const id of ['modeBuild','modeInspect','loadExample','pythonFile']) $(id).addEventListener(id==='pythonFile'?'change':'click', changeSource);
download.onclick = async () => {
  if (!boundaries || !confirmState.checked || editor.value !== snapshot) {
    reset(); status.textContent = 'Source or confirmation changed. Check the current Python again.'; return;
  }
  const current = ticket, source = snapshot, a = Number(start.value), b = Number(end.value);
  download.disabled = true;
  try {
    const result = await requestRecovery(source, boundaries[a].index, boundaries[b].index);
    if (current !== ticket || editor.value !== source || !confirmState.checked ||
        Number(start.value) !== a || Number(end.value) !== b) return;
    const url = URL.createObjectURL(new Blob([result.source], {type:'text/x-python;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = 'labflow-recovery.py';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
    status.textContent = 'Recovery copy downloaded. Analyse it in the Opentrons App before starting a new run.';
  } catch (error) {
    if (current === ticket) status.textContent = error.message;
  } finally {
    if (current === ticket && boundaries) download.disabled = !confirmState.checked || Number(start.value) >= Number(end.value);
  }
};
