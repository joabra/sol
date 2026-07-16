// Spotpriser från elprisetjustnu.se (gratis, ingen nyckel, 15-min upplösning)
const cache = new Map(); // key: `${date}_${zone}` -> array

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { url: `${y}/${m}-${day}`, key: `${y}-${m}-${day}` };
}

export async function getPrices(zone, date = new Date()) {
  const { url, key } = fmtDate(date);
  const cacheKey = `${key}_${zone}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const res = await fetch(`https://www.elprisetjustnu.se/api/v1/prices/${url}_${zone}.json`);
  if (!res.ok) return null; // morgondagens priser publiceras ~13:00
  const data = await res.json();
  const mapped = data.map((p) => ({
    start: p.time_start,
    end: p.time_end,
    sekPerKwh: p.SEK_per_kWh,
  }));
  cache.set(cacheKey, mapped);
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  return mapped;
}

export async function getTodayAndTomorrow(zone) {
  const today = await getPrices(zone, new Date());
  const tomorrow = await getPrices(zone, new Date(Date.now() + 86400e3)).catch(() => null);
  return { today: today || [], tomorrow: tomorrow || [] };
}

export function currentPrice(prices) {
  const now = Date.now();
  return prices.find((p) => now >= Date.parse(p.start) && now < Date.parse(p.end)) || null;
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
