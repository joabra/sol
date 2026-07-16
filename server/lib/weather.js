// Väderprognos via Open-Meteo (gratis, ingen API-nyckel).
// Ger molnighet, solinstrålning och temperatur — underlag för AI:ns produktionsprognos.
import { loadSettings, saveSettings } from './config.js';
import * as sungrow from './sungrow.js';

let cache = { key: null, data: null, at: 0 };
const TTL = 30 * 60 * 1000;

// Koordinater: inställning om satt, annars auto-detektera från anläggningen (sparas)
async function getCoords() {
  const s = loadSettings();
  if (s.weather?.lat && s.weather?.lon) return { lat: s.weather.lat, lon: s.weather.lon };
  if (sungrow.isConfigured()) {
    try {
      const plant = (await sungrow.getPowerStationList())[0];
      if (plant?.latitude && plant?.longitude) {
        const lat = +(+plant.latitude).toFixed(4);
        const lon = +(+plant.longitude).toFixed(4);
        saveSettings({ weather: { lat, lon } });
        return { lat, lon };
      }
    } catch {}
  }
  return null;
}

export async function getForecast() {
  const coords = await getCoords();
  if (!coords) return null;
  const key = `${coords.lat},${coords.lon}`;
  if (cache.key === key && Date.now() - cache.at < TTL) return cache.data;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
    `&hourly=temperature_2m,cloud_cover,shortwave_radiation,precipitation` +
    `&forecast_days=3&timezone=Europe%2FStockholm`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const raw = await res.json();

  const h = raw.hourly;
  const nowMs = Date.now() - 3600e3;
  const hours = [];
  for (let i = 0; i < h.time.length; i++) {
    const t = new Date(h.time[i]);
    if (t.getTime() < nowMs) continue;
    hours.push({
      time: h.time[i],
      tempC: h.temperature_2m[i],
      cloudPct: h.cloud_cover[i],
      radiationWm2: h.shortwave_radiation[i],
      precipMm: h.precipitation[i],
    });
  }

  // Dagssummering: total instrålning (Wh/m2) som grov produktionsindikator
  const days = {};
  for (const x of hours) {
    const d = x.time.slice(0, 10);
    (days[d] ||= { date: d, radiationWhm2: 0, cloudSum: 0, n: 0 });
    days[d].radiationWhm2 += x.radiationWm2;
    days[d].cloudSum += x.cloudPct;
    days[d].n++;
  }
  const daily = Object.values(days).map((d) => ({
    date: d.date,
    radiationWhm2: Math.round(d.radiationWhm2),
    avgCloudPct: Math.round(d.cloudSum / d.n),
  }));

  const data = { coords, hours: hours.slice(0, 48), daily };
  cache = { key, data, at: Date.now() };
  return data;
}
