// Mock-läge: realistisk simulerad data så att dashboarden fungerar
// innan iSolarCloud-uppgifterna är konfigurerade.

function solarCurve(hour, minute) {
  const t = hour + minute / 60;
  if (t < 4.5 || t > 21.5) return 0;
  const peak = 8500; // W, ~10 kWp-anläggning i juli
  const x = (t - 13) / 5.2;
  return Math.max(0, peak * Math.exp(-x * x) * (0.85 + 0.15 * Math.sin(t * 7)));
}

function loadCurve(hour) {
  const base = 400;
  const morning = hour >= 6 && hour <= 9 ? 1200 : 0;
  const evening = hour >= 17 && hour <= 22 ? 1800 : 0;
  return base + morning + evening + Math.random() * 200;
}

let mockSoc = 62;

export async function getPowerStationList() {
  return [{ ps_id: 999001, ps_name: 'Demo-anläggning (mock)', ps_location: 'Sverige', ps_capacity_kwp: '10.0' }];
}

export async function getDeviceList() {
  return [{ ps_key: '999001_14_0_0', device_sn: 'MOCK123456', device_type: 14, device_name: 'SH10RT (mock)', dev_status: '1', uuid: 424242 }];
}

export async function getRealtime() {
  const now = new Date();
  const pv = solarCurve(now.getHours(), now.getMinutes());
  const load = loadCurve(now.getHours());
  const surplus = pv - load;
  // enkel batterisimulering
  if (surplus > 0 && mockSoc < 95) mockSoc = Math.min(95, mockSoc + 0.05);
  else if (surplus < 0 && mockSoc > 15) mockSoc = Math.max(15, mockSoc - 0.03);

  const batteryFlow = Math.max(-3000, Math.min(3000, surplus * 0.7));
  const grid = surplus - batteryFlow;
  const t = now.getHours() + now.getMinutes() / 60;

  return {
    deviceTime: now.toISOString(),
    pvPowerW: Math.round(pv),
    loadPowerW: Math.round(load),
    batteryPowerW: Math.round(batteryFlow),   // + = laddar
    gridPowerW: Math.round(-grid),            // + = import, - = export
    batterySocPct: Math.round(mockSoc * 10) / 10,
    pvTodayWh: Math.round(t * 2600),
    exportTodayWh: Math.round(Math.max(0, t - 9) * 1800),
    importTodayWh: Math.round(t * 350),
  };
}

export async function getHistory() {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400e3);
    const clouds = 0.5 + 0.5 * Math.abs(Math.sin(i * 2.7));
    days.push({
      date: d.toISOString().slice(0, 10),
      pvKwh: Math.round(52 * clouds * 10) / 10,
      exportKwh: Math.round(30 * clouds * 10) / 10,
      importKwh: Math.round((8 + 6 * (1 - clouds)) * 10) / 10,
    });
  }
  return days;
}

export async function forceCharge() { return { mock: true }; }
export async function forceDischarge() { return { mock: true }; }
export async function stopForced() { return { mock: true }; }
