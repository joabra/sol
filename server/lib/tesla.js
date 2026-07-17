// Tesla-integration (inofficiella Owner API med refresh token).
// Fungerar även HELT utan API: optimeraren känner igen elbilsladdning på husets
// last (> tröskel) och skyddar hembatteriet ändå.
import { loadSettings } from './config.js';

const AUTH_URL = 'https://auth.tesla.com/oauth2/v3/token';
const API_BASE = 'https://owner-api.teslamotors.com/api/1';

let tokenCache = { accessToken: null, expiresAt: 0 };
let statusCache = { data: null, at: 0 };

export function isConfigured() {
  return !!loadSettings().ev?.teslaRefreshToken;
}

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60e3) return tokenCache.accessToken;
  const s = loadSettings();
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: 'ownerapi',
      refresh_token: s.ev.teslaRefreshToken,
      scope: 'openid email offline_access',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Tesla-inloggning misslyckades (HTTP ${res.status}) — kontrollera refresh token`);
  const j = await res.json();
  tokenCache = { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.accessToken;
}

async function apiGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 408) return null; // bilen sover — väck den inte
  if (!res.ok) throw new Error(`Tesla API HTTP ${res.status}`);
  return (await res.json()).response;
}

// Bilstatus utan att väcka bilen (5 min cache). Returnerar { asleep: true } om den sover.
export async function getStatus({ force = false } = {}) {
  if (!isConfigured()) return null;
  if (!force && statusCache.data && Date.now() - statusCache.at < 5 * 60e3) return statusCache.data;

  const vehicles = await apiGet('/vehicles');
  const v = vehicles?.[0];
  if (!v) throw new Error('Ingen Tesla hittades på kontot');

  let data;
  if (v.state !== 'online') {
    data = { name: v.display_name, asleep: true, state: v.state };
  } else {
    const vd = await apiGet(`/vehicles/${v.id}/vehicle_data?endpoints=charge_state`);
    const c = vd?.charge_state;
    data = c
      ? {
          name: v.display_name,
          asleep: false,
          socPct: c.battery_level,
          targetSocPct: c.charge_limit_soc,
          charging: c.charging_state === 'Charging',
          chargingState: c.charging_state,
          chargePowerKw: c.charger_power || 0,
          rangeKm: Math.round((c.battery_range || 0) * 1.609),
          minutesToFull: c.minutes_to_full_charge || 0,
          pluggedIn: !['Disconnected', 'Invalid'].includes(c.charging_state),
        }
      : { name: v.display_name, asleep: true, state: 'okänt' };
  }
  statusCache = { data, at: Date.now() };
  return data;
}

// Laddar bilen just nu? API om möjligt, annars last-heuristik.
// rt = realtidsdata från växelriktaren (loadPowerW).
export async function isChargingNow(rt) {
  const ev = loadSettings().ev || {};
  if (isConfigured()) {
    try {
      const st = await getStatus();
      if (st && !st.asleep) return { charging: !!st.charging, source: 'api', st };
    } catch {}
  }
  if (ev.guardEnabled && rt?.loadPowerW > (ev.chargeThresholdW || 5000)) {
    return { charging: true, source: 'heuristik' };
  }
  return { charging: false, source: isConfigured() ? 'api' : 'heuristik' };
}

export function clearCache() {
  tokenCache = { accessToken: null, expiresAt: 0 };
  statusCache = { data: null, at: 0 };
}
