// iSolarCloud OpenAPI-klient (EU-gateway).
// Auth: appkey i body, SecretKey i "x-access-key"-headern, token från /openapi/login.
import { loadSettings } from './config.js';

let session = { token: null, expiresAt: 0 };

function headers(secretKey, token) {
  const h = {
    'Content-Type': 'application/json;charset=UTF-8',
    'sys_code': '901',
    'x-access-key': secretKey,
  };
  if (token) h.token = token;
  return h;
}

async function call(endpoint, body, { retry = true } = {}) {
  const s = loadSettings().sungrow;
  if (!s.appkey || !s.secretKey) throw new Error('NOT_CONFIGURED');

  if (endpoint !== '/openapi/login' && (!session.token || Date.now() > session.expiresAt)) {
    await login();
  }

  const payload = {
    appkey: s.appkey,
    lang: '_en_US',
    ...(endpoint !== '/openapi/login' ? { token: session.token } : {}),
    ...body,
  };

  const res = await fetch(s.gateway + endpoint, {
    method: 'POST',
    headers: headers(s.secretKey, session.token),
    body: JSON.stringify(payload),
  });
  const json = await res.json();

  // 30001 = token har gått ut -> logga in igen och försök en gång till
  if (json.result_code === '30001' && retry) {
    session = { token: null, expiresAt: 0 };
    await login();
    return call(endpoint, body, { retry: false });
  }
  if (json.result_code !== '1') {
    throw new Error(`iSolarCloud ${endpoint} fel ${json.result_code}: ${json.result_msg || 'okänt'}`);
  }
  return json.result_data;
}

export async function login() {
  const s = loadSettings().sungrow;
  if (!s.username || !s.password) throw new Error('NOT_CONFIGURED');
  const res = await fetch(s.gateway + '/openapi/login', {
    method: 'POST',
    headers: headers(s.secretKey),
    body: JSON.stringify({
      appkey: s.appkey,
      user_account: s.username,
      user_password: s.password,
      lang: '_en_US',
    }),
  });
  const json = await res.json();
  if (json.result_code !== '1' || !json.result_data?.token) {
    throw new Error(`Inloggning misslyckades: ${json.result_code} ${json.result_msg || ''}`);
  }
  session = { token: json.result_data.token, expiresAt: Date.now() + 23 * 3600 * 1000 };
  return session.token;
}

export async function getPowerStationList() {
  const data = await call('/openapi/getPowerStationList', { curPage: 1, size: 100 });
  return data.pageList || [];
}

export async function getDeviceList(psId) {
  const data = await call('/openapi/getDeviceList', { ps_id: String(psId), curPage: 1, size: 200 });
  return data.pageList || [];
}

// Realtidsvärden på anläggningsnivå (device_type 11)
const PLANT_POINTS = {
  '83033': 'pvPowerW',
  '83106': 'loadPowerW',
  '83022': 'pvTodayWh',
  '83072': 'exportTodayWh',
  '83102': 'importTodayWh',
  '83252': 'batterySocPct',
};

export async function getRealtime(psId) {
  const psKey = `${psId}_11_0_0`;
  const data = await call('/openapi/getDeviceRealTimeData', {
    device_type: 11,
    ps_key_list: [psKey],
    point_id_list: Object.keys(PLANT_POINTS),
  });
  const point = data.device_point_list?.[0]?.device_point || {};
  const out = { deviceTime: point.device_time || null };
  for (const [id, name] of Object.entries(PLANT_POINTS)) {
    const v = point['p' + id];
    out[name] = v !== undefined && v !== null && v !== '--' ? Number(v) : null;
  }
  // Punkt 83252 returnerar SOC som andel (0–1) -> konvertera till procent
  if (out.batterySocPct !== null && out.batterySocPct <= 1) out.batterySocPct *= 100;
  else if (out.batterySocPct !== null && out.batterySocPct > 100) out.batterySocPct /= 100;
  return out;
}

// Historik dag/månad/år för anläggningen
export async function getHistory(psId, { queryType = '1', start, end, points = ['83022', '83072', '83102'] }) {
  const psKey = `${psId}_11_0_0`;
  const data = await call('/openapi/getDevicePointsDayMonthYearDataList', {
    ps_key_list: [psKey],
    device_type: 11,
    data_point: points.map((p) => 'p' + p).join(','),
    query_type: queryType,
    data_type: '2',
    order: '0',
    start_time: start,
    end_time: end,
  });
  return data;
}

// Styrning via paramSetting. Kräver skrivbehörighet på utvecklarkontot.
// param_codes: 10003 EMS-läge (0=självkonsumtion, 2=forcerat),
// 10004 kommando (170=ladda, 187=urladda, 204=stopp), 10005 effekt (W), 10001 SOC-tak (x10)
async function paramSetting(uuid, taskName, paramList) {
  return call('/openapi/paramSetting', {
    set_type: 0,
    uuid: String(uuid),
    task_name: taskName,
    expire_second: 1800,
    param_list: paramList,
  });
}

export async function forceCharge(uuid, powerW, maxSocPct = 95) {
  return paramSetting(uuid, `Solvakt force charge ${new Date().toISOString()}`, [
    { param_code: 10001, set_value: Math.round(maxSocPct * 10) },
    { param_code: 10003, set_value: 2 },
    { param_code: 10004, set_value: 170 },
    { param_code: 10005, set_value: Math.round(powerW) },
  ]);
}

export async function forceDischarge(uuid, powerW) {
  return paramSetting(uuid, `Solvakt force discharge ${new Date().toISOString()}`, [
    { param_code: 10003, set_value: 2 },
    { param_code: 10004, set_value: 187 },
    { param_code: 10005, set_value: Math.round(powerW) },
  ]);
}

export async function stopForced(uuid) {
  return paramSetting(uuid, `Solvakt stop ${new Date().toISOString()}`, [
    { param_code: 10001, set_value: 1000 },
    { param_code: 10003, set_value: 0 },
    { param_code: 10004, set_value: 204 },
    { param_code: 10005, set_value: 0 },
  ]);
}

export function isConfigured() {
  const s = loadSettings().sungrow;
  return Boolean(s.appkey && s.secretKey && s.username && s.password);
}
