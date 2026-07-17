// Prognoser: husets förbrukning per timme (Tibber-profil) och solproduktion i kWh
// (väderns instrålning kalibrerad mot anläggningens faktiska produktion).
import { loadSettings } from './config.js';
import * as tibber from './tibber.js';
import * as sungrow from './sungrow.js';
import * as weather from './weather.js';

// --- Förbrukningsprognos ---
// Profil: medel per (vardag/helg, timme-på-dygnet) från senaste 7 dygnens Tibber-data.
// Utan Tibber: platt profil från senaste dygnets import+egenanvändning, annars 1 kW.
let profileCache = { data: null, at: 0 };

export async function getLoadProfile() {
  if (profileCache.data && Date.now() - profileCache.at < 60 * 60 * 1000) return profileCache.data;

  let profile = null;
  if (tibber.isConfigured()) {
    try {
      const nodes = await tibber.getHourlyConsumption();
      if (nodes.length >= 24) {
        const buckets = {}; // "wd-7" / "we-7" -> [kWh...]
        for (const n of nodes) {
          const d = new Date(n.from);
          const key = `${d.getDay() === 0 || d.getDay() === 6 ? 'we' : 'wd'}-${d.getHours()}`;
          (buckets[key] ||= []).push(n.consumption);
        }
        // Median istället för medel — elbilsladdning (~11 kW enstaka nätter)
        // ska inte förvränga profilen för normala dygn.
        const median = (a) => {
          const s = [...a].sort((x, y) => x - y);
          const m = Math.floor(s.length / 2);
          return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };
        profile = { source: 'tibber', hours: {} };
        for (const [key, vals] of Object.entries(buckets)) profile.hours[key] = +median(vals).toFixed(2);

        // Tibber mäter bara nätimport — dagtid täcker solen lasten och timvärdena blir ~0.
        // Skala upp profilen så dygnssumman matchar husets verkliga last (sol − export + import).
        const realDaily = await getAvgDailyLoadKwh();
        if (realDaily) {
          const wdSum = [...Array(24).keys()].reduce((s, h) => s + (profile.hours[`wd-${h}`] || 0), 0);
          const deficit = realDaily - wdSum;
          if (deficit > 1) {
            // Lägg underskottet på dagtimmarna (07–19) då solen maskerar förbrukningen
            const dayHours = [...Array(13).keys()].map((i) => i + 7);
            for (const kind of ['wd', 'we']) {
              for (const h of dayHours) {
                const key = `${kind}-${h}`;
                profile.hours[key] = +((profile.hours[key] || 0) + deficit / dayHours.length).toFixed(2);
              }
            }
          }
        }
      }
    } catch {}
  }
  if (!profile) profile = { source: 'flat', hours: {} };

  profileCache = { data: profile, at: Date.now() };
  return profile;
}

// Husets genomsnittliga dygnslast (kWh) = sol − export + import, senaste 7 dagarna
async function getAvgDailyLoadKwh() {
  try {
    if (!sungrow.isConfigured()) return null;
    const settings = loadSettings();
    const psId = settings.sungrow.psId || (await sungrow.getPowerStationList())[0]?.ps_id;
    const end = new Date(Date.now() - 86400e3);
    const start = new Date(end.getTime() - 6 * 86400e3);
    const fmt = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
    const raw = await sungrow.getHistory(psId, { queryType: '1', start: fmt(start), end: fmt(end) });
    const series = Object.values(raw || {})[0] || {};
    const sum = (k) => (series[k] || []).reduce((s, r) => s + (Number(r['2']) || 0), 0) / 1000;
    const pv = sum('p83022');
    const exp = sum('p83072');
    const imp = sum('p83102');
    const n = (series['p83022'] || []).length || 7;
    const daily = (pv - exp + imp) / n;
    return daily > 2 && daily < 100 ? +daily.toFixed(1) : null;
  } catch {
    return null;
  }
}

// Prognostiserad last (kWh) för en given timme
export function loadForHour(profile, date) {
  const key = `${date.getDay() === 0 || date.getDay() === 6 ? 'we' : 'wd'}-${date.getHours()}`;
  const v = profile.hours[key];
  if (v != null) return v;
  // fallback: platt 1.0 kWh/h
  const all = Object.values(profile.hours);
  return all.length ? +(all.reduce((s, x) => s + x, 0) / all.length).toFixed(2) : 1.0;
}

// --- Solprognos i kWh ---
// Kalibrering: anläggningsfaktor = producerade kWh / instrålade kWh/m² (senaste dagarna).
let calibCache = { data: null, at: 0 };

export async function getPlantFactor() {
  if (calibCache.data && Date.now() - calibCache.at < 6 * 60 * 60 * 1000) return calibCache.data;

  let factor = null;
  try {
    const forecast = await weather.getForecast();
    if (forecast?.pastHours?.length && sungrow.isConfigured()) {
      // Instrålning per dag (kWh/m²) bakåt
      const radByDay = {};
      for (const h of forecast.pastHours) {
        const d = h.time.slice(0, 10);
        radByDay[d] = (radByDay[d] || 0) + (h.radiationWm2 || 0) / 1000;
      }
      // Produktion per dag från anläggningen
      const settings = loadSettings();
      const psId = settings.sungrow.psId || (await sungrow.getPowerStationList())[0]?.ps_id;
      const days = Object.keys(radByDay).sort();
      const fmt = (d) => d.replaceAll('-', '');
      const raw = await sungrow.getHistory(psId, { queryType: '1', start: fmt(days[0]), end: fmt(days[days.length - 1]) });
      const series = Object.values(raw || {})[0] || {};
      let sumPv = 0;
      let sumRad = 0;
      for (const row of series['p83022'] || []) {
        const ts = row.time_stamp;
        const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
        const wh = Number(row['2']);
        if (!Number.isFinite(wh) || !radByDay[date] || radByDay[date] < 0.5) continue;
        sumPv += wh / 1000;
        sumRad += radByDay[date];
      }
      if (sumRad > 2 && sumPv > 0) factor = +(sumPv / sumRad).toFixed(2); // kWh producerat per kWh/m²
    }
  } catch {}

  calibCache = { data: factor, at: Date.now() };
  return factor; // null = okalibrerad
}

// Solprognos per timme (kWh) och per dag
export async function getSolarForecast() {
  const forecast = await weather.getForecast();
  if (!forecast) return null;
  const factor = await getPlantFactor();
  const f = factor ?? 5.0; // rimlig default för ~10 kW-anläggning tills kalibrerad

  const hours = forecast.hours.map((h) => ({
    time: h.time,
    kwh: +(((h.radiationWm2 || 0) / 1000) * f).toFixed(2),
  }));
  const daily = {};
  for (const h of hours) daily[h.time.slice(0, 10)] = +((daily[h.time.slice(0, 10)] || 0) + h.kwh).toFixed(1);

  return { factor, calibrated: factor != null, hours, daily };
}
