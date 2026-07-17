const json = (r) => {
  if (r.status === 401) {
    window.location.reload(); // session utgången -> visa login
    throw new Error('Utloggad');
  }
  if (!r.ok && r.status !== 424) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export const api = {
  status: () => fetch('/api/status').then(json),
  realtime: () => fetch('/api/realtime').then(json),
  history: () => fetch('/api/history').then(json),
  prices: () => fetch('/api/prices').then(json),
  settings: () => fetch('/api/settings').then(json),
  saveSettings: (patch) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(json),
  testConnection: () => fetch('/api/settings/test-connection', { method: 'POST' }).then(json),
  optimizer: () => fetch('/api/optimizer').then(json),
  tibber: () => fetch('/api/tibber').then(json),
  tibberTest: () => fetch('/api/tibber/test', { method: 'POST' }).then(json),
  optimizerRun: () => fetch('/api/optimizer/run', { method: 'POST' }).then(json),
  optimizerToggle: (start) => fetch(`/api/optimizer/${start ? 'start' : 'stop'}`, { method: 'POST' }).then(json),
  modbusTest: () => fetch('/api/modbus/test', { method: 'POST' }).then(json),
  ai: () => fetch('/api/ai').then(json),
  aiAnalyze: () => fetch('/api/ai/analyze', { method: 'POST' }).then(json),
  aiModels: () => fetch('/api/ai/models').then(json),
  aiTest: () => fetch('/api/ai/test', { method: 'POST' }).then(json),
  weather: () => fetch('/api/weather').then(json),
  plan: () => fetch('/api/plan').then(json),
  report: () => fetch('/api/report').then(json),
  notifyTest: () => fetch('/api/notify/test', { method: 'POST' }).then(json),
  control: (cmd, powerW) =>
    fetch(`/api/control/${cmd}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ powerW }),
    }).then(json),
};
