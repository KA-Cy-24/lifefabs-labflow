(() => {
  const byId = id => document.getElementById(id);
  const endpoint = () => (byId('simServiceUrl')?.value || 'http://127.0.0.1:8010').trim().replace(/\/+$/, '');
  const status = (message, state = 'idle') => {
    const node = byId('officialSimStatus'); if (!node) return;
    node.dataset.state = state; node.textContent = message;
  };
  const pretty = value => JSON.stringify(value, null, 2);
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70000);
    try {
      const response = await fetch(`${endpoint()}${path}`, {...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }});
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || body.error || `Service returned HTTP ${response.status}`);
      return body;
    } finally { clearTimeout(timer); }
  }
  function output(text) {
    const node = byId('officialSimOutput');
    node.textContent = text; node.classList.toggle('hidden', !text);
  }
  async function probe() {
    status('Checking local simulator service…', 'busy');
    try {
      const result = await request('/health', {method:'GET', headers:{}});
      status(`Connected · ${result.simulator || 'Opentrons simulator'} · API package ${result.version || 'version reported by service'} · ${result.image_ready ? 'sandbox image ready' : 'sandbox image not built yet'}`, result.image_ready ? 'success' : 'error');
      return result;
    } catch (error) {
      status(`Could not connect: ${error.message}. Make sure the service is running, the sandbox image is built, and the page origin is allowed by CORS.`, 'error');
      return null;
    }
  }
  async function runSimulation() {
    const code = byId('codeEditor')?.value || '';
    if (!code.trim()) { status('The protocol editor is empty.', 'error'); return; }
    byId('runOfficialSim').disabled = true;
    status('Running official API simulation in the sandbox…', 'busy');
    output('Simulation running. The server is executing protocol code inside an isolated container.');
    try {
      const result = await request('/api/simulate', {method:'POST', body:JSON.stringify({protocol: code, robot_type:'OT-2'})});
      const lines = [];
      lines.push(`Official API simulation: ${result.ok ? 'PASSED' : 'FAILED'}`);
      if (result.version) lines.push(`Opentrons package: ${result.version}`);
      if (result.robot_type) lines.push(`Robot type: ${result.robot_type}`);
      if (result.event_count != null) lines.push(`Run-log events: ${result.event_count}`);
      lines.push('');
      (result.events || []).forEach((event, index) => {
        const depth = Math.max(0, Math.min(8, Number(event.depth || 0)));
        lines.push(`${String(index + 1).padStart(3,'0')} ${'  '.repeat(depth)}${event.text || event.name || 'Command'}`);
      });
      if (result.error) lines.push('', `Error: ${result.error}`);
      output(lines.join('\n'));
      status(result.ok ? 'Official API simulation completed successfully. Review the log and still run official App analysis with the intended robot software version.' : `Simulation failed: ${result.error || 'See run log.'}`, result.ok ? 'success' : 'error');
    } catch (error) {
      output('No official simulation result was returned.\n\n' + error.message);
      status(`Simulation request failed: ${error.message}`, 'error');
    } finally { byId('runOfficialSim').disabled = false; }
  }
  document.addEventListener('DOMContentLoaded', () => {
    if (!byId('officialSimStatus')) return;
    byId('probeSimService')?.addEventListener('click', probe);
    byId('runOfficialSim')?.addEventListener('click', runSimulation);
    byId('clearOfficialSim')?.addEventListener('click', () => { output(''); status('Log cleared.'); });
  });
})();
