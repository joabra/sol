// Elbilsstatus. Primärt via Tessie (api.tessie.com, enkel token — fungerar 2026).
// Teslas gamla Owner API är nedstängt sedan 2026; refresh token stöds som
// fallback endast för äldre bilar. Fungerar även HELT utan API: optimeraren
// känner igen laddning på husets last (> tröskel) och skyddar hembatteriet ändå.
import { loadSettings } from './config.js';

const AUTH_URL = 'https://auth.tesla.com/oauth2/v3/token';
const API_BASE = 'https://owner-api.teslamotors.com/api/1';

let tokenCache = { accessToken: null, expiresAt: 0 };
let statusCache = { data: null, at: 0 };

export function isConfigured() {
  const ev = loadSettings().ev || {};
  return !!(ev.tessieToken || ev.teslaRefreshToken);
}

// --- Tessie (rekommenderas) ---
async function tessieStatus() {
  const token = loadSettings().ev.tessieToken.trim();
  const res = await fetch('https://api.tessie.com/vehicles', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Tessie avvisade token — kontrollera API-nyckeln (tessie.com → Settings → API)');
  if (!res.ok) throw new Error(`Tessie API HTTP ${res.status}`);
  const j = await res.json();
  const v = j.results?.[0];
  if (!v) throw new Error('Ingen bil hittades på Tessie-kontot');
  const s = v.last_state || {};
  const c = s.charge_state || {};
  return {
    name: s.display_name || s.vehicle_state?.vehicle_name || 'Tesla',
    asleep: false, // Tessie cachar senaste kända läge — bilen väcks aldrig
    socPct: c.battery_level ?? null,
    targetSocPct: c.charge_limit_soc ?? null,
    charging: c.charging_state === 'Charging',
    chargingState: c.charging_state || 'okänt',
    chargePowerKw: c.charger_power || 0,
    rangeKm: Math.round((c.battery_range || 0) * 1.609),
    minutesToFull: c.minutes_to_full_charge || 0,
    pluggedIn: !['Disconnected', 'Invalid', undefined].includes(c.charging_state),
    via: 'tessie',
  };
}

// --- Gamla Owner API (fallback, fungerar bara för äldre bilar) ---
async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60e3) return tokenCache.accessToken;
  const s = loadSettings();
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: 'ownerapi',
      refresh_token: s.ev.teslaRefreshToken.trim(),
      scope: 'openid email offline_access',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Tesla-inloggning misslyckades (HTTP ${res.status}). Obs: Tesla har stängt gamla API:t för de flesta bilar — använd en Tessie-token istället`);
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
  if (res.status === 401 || res.status === 403) throw new Error('Teslas gamla API avvisade anropet — det är nedstängt för de flesta bilar. Använd en Tessie-token istället');
  if (!res.ok) throw new Error(`Tesla API HTTP ${res.status}`);
  return (await res.json()).response;
}

async function ownerApiStatus() {
  const vehicles = await apiGet('/vehicles');
  const v = vehicles?.[0];
  if (!v) throw new Error('Ingen Tesla hittades på kontot');
  if (v.state !== 'online') return { name: v.display_name, asleep: true, state: v.state, via: 'owner-api' };
  const vd = await apiGet(`/vehicles/${v.id}/vehicle_data?endpoints=charge_state`);
  const c = vd?.charge_state;
  if (!c) return { name: v.display_name, asleep: true, state: 'okänt', via: 'owner-api' };
  return {
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
    via: 'owner-api',
  };
}

// Bilstatus utan att väcka bilen (5 min cache).
export async function getStatus({ force = false } = {}) {
  const ev = loadSettings().ev || {};
  if (!isConfigured()) return null;
  if (!force && statusCache.data && Date.now() - statusCache.at < 5 * 60e3) return statusCache.data;

  const data = ev.tessieToken ? await tessieStatus() : await ownerApiStatus();
  statusCache = { data, at: Date.now() };
  return data;
}

// Laddar bilen just nu? API om möjligt, annars last-heuristik.
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
