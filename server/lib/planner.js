// Dygnsplanerare: optimerar batteriets ladd/urladdningsschema över hela pris-horisonten
// (upp till 36 h, 15-minuterssteg) med dynamisk programmering, istället för giriga
// beslut per kvart. Tar hänsyn till prognoser för sol & förbrukning, batterislitage,
// verkningsgrad och (adaptivt) SOC-fönster.
import { loadSettings } from './config.js';
import { getTodayAndTomorrow, percentile } from './prices.js';
import { buyPrice, sellPrice } from './optimizer.js';
import * as forecast from './forecast.js';

let planCache = { plan: null, at: 0, key: null };

// Adaptivt SOC-fönster: liten prisspread -> skona batteriet med snävare fönster
export function effectiveSocWindow(settings, spots) {
  const o = settings.optimizer;
  let min = o.minSocPercent;
  let max = o.maxSocPercent;
  if (o.adaptiveSoc && spots.length) {
    const spread = percentile(spots, 90) - percentile(spots, 10);
    const needed = o.cycleCostSekPerKwh + o.minArbitrageMarginSek;
    if (spread < needed) {
      min = Math.max(min, 30);
      max = Math.min(max, 80);
    }
  }
  return { min, max };
}

export async function getPlan({ force = false } = {}) {
  const settings = loadSettings();
  const key = new Date().toISOString().slice(0, 13); // ny plan varje timme
  if (!force && planCache.plan && planCache.key === key) return planCache.plan;

  const { today, tomorrow } = await getTodayAndTomorrow(settings.price.zone);
  const all = [...today, ...tomorrow].filter((p) => Date.parse(p.end ?? p.start) > Date.now());
  if (!all.length) throw new Error('Inga priser att planera mot');

  const [solar, profile] = await Promise.all([
    forecast.getSolarForecast().catch(() => null),
    forecast.getLoadProfile().catch(() => ({ source: 'flat', hours: {} })),
  ]);
  const solarByHour = {};
  for (const h of solar?.hours || []) solarByHour[h.time.slice(0, 13)] = h.kwh;

  const o = settings.optimizer;
  const b = settings.battery;
  const p = settings.price;
  const capacity = b.capacityKwh;
  const eff = Math.sqrt((b.efficiencyPct || 92) / 100); // per riktning
  const { min: minSoc, max: maxSoc } = effectiveSocWindow(settings, all.map((x) => x.sekPerKwh));

  // Slots (15 min eller vad prisdatat ger)
  const slots = all.map((x) => {
    const start = new Date(x.start);
    const dtH = ((Date.parse(x.end) || Date.parse(x.start) + 900e3) - Date.parse(x.start)) / 3600e3;
    const hourKey = x.start.slice(0, 13);
    const pvKwh = (solarByHour[hourKey] ?? 0) * dtH;
    const loadKwh = forecast.loadForHour(profile, start) * dtH;
    return { start: x.start, dtH, spot: x.sekPerKwh, buy: buyPrice(x.sekPerKwh, p), sell: sellPrice(x.sekPerKwh, p), pvKwh, loadKwh };
  });

  // DP över diskretiserad SOC
  const STEPS = 32; // SOC-nivåer
  const socToIdx = (soc) => Math.round(((soc - minSoc) / (maxSoc - minSoc)) * (STEPS - 1));
  const idxToKwh = (i) => ((minSoc + (i * (maxSoc - minSoc)) / (STEPS - 1)) / 100) * capacity;
  const N = slots.length;
  const INF = 1e9;

  // cost[i][s] = minsta kostnad från slot i med SOC-index s till horisontens slut
  const cost = Array.from({ length: N + 1 }, () => new Float64Array(STEPS).fill(0));
  const choice = Array.from({ length: N }, () => new Int8Array(STEPS)); // -1 urladda, 0 idle, 1 ladda

  // Terminalvärde: kvarvarande energi värderas till horisontens medel-säljpris (undviker tömning i slutet)
  const endValue = slots.reduce((s, x) => s + x.sell, 0) / N;
  for (let s = 0; s < STEPS; s++) cost[N][s] = -idxToKwh(s) * endValue * 0.8;

  for (let i = N - 1; i >= 0; i--) {
    const sl = slots[i];
    const chargeKwh = (o.chargePowerW / 1000) * sl.dtH;
    const dischargeKwh = (o.dischargePowerW / 1000) * sl.dtH;

    for (let s = 0; s < STEPS; s++) {
      const soc = idxToKwh(s);
      let best = INF;
      let bestA = 0;

      for (const a of [0, 1, -1]) {
        let battIn = 0; // kWh in i batteriet (före förluster)
        let battOut = 0;
        if (a === 1) battIn = Math.min(chargeKwh, ((maxSoc / 100) * capacity - soc) / eff);
        if (a === -1) battOut = Math.min(dischargeKwh, (soc - (minSoc / 100) * capacity) * eff);
        if (a !== 0 && battIn <= 0.01 && battOut <= 0.01) continue;

        const newSoc = soc + battIn * eff - battOut / eff;
        const sIdx = Math.max(0, Math.min(STEPS - 1, socToIdx((newSoc / capacity) * 100)));

        // Nettoenergi mot nätet: last - sol - urladdning + laddning
        const net = sl.loadKwh - sl.pvKwh - battOut + battIn;
        const gridCost = net >= 0 ? net * sl.buy : net * sl.sell; // negativ = intäkt
        const wear = (battIn + battOut) * 0.5 * o.cycleCostSekPerKwh;

        const total = gridCost + wear + cost[i + 1][sIdx];
        if (total < best) {
          best = total;
          bestA = a;
        }
      }
      cost[i][s] = best;
      choice[i][s] = bestA;
    }
  }

  const model = { slots, choice, socToIdx, idxToKwh, minSoc, maxSoc, capacity, eff, settings, key };
  planCache = { plan: model, at: Date.now(), key };
  return model;
}

// Kör fram planen från aktuell SOC -> lista av åtgärder per slot
export async function getSchedule(currentSocPct) {
  const model = await getPlan();
  const { slots, choice, socToIdx, idxToKwh, minSoc, maxSoc, capacity, eff } = model;
  const o = model.settings.optimizer;

  let s = Math.max(0, Math.min(31, socToIdx(Math.max(minSoc, Math.min(maxSoc, currentSocPct ?? 50)))));
  const schedule = [];
  for (let i = 0; i < slots.length; i++) {
    const a = choice[i][s];
    const soc = idxToKwh(s);
    const chargeKwh = (o.chargePowerW / 1000) * slots[i].dtH;
    const dischargeKwh = (o.dischargePowerW / 1000) * slots[i].dtH;
    let battIn = 0;
    let battOut = 0;
    if (a === 1) battIn = Math.min(chargeKwh, ((maxSoc / 100) * capacity - soc) / eff);
    if (a === -1) battOut = Math.min(dischargeKwh, (soc - (minSoc / 100) * capacity) * eff);
    const newSoc = soc + battIn * eff - battOut / eff;
    s = Math.max(0, Math.min(31, socToIdx((newSoc / capacity) * 100)));

    schedule.push({
      start: slots[i].start,
      action: a === 1 ? 'charge' : a === -1 ? 'discharge' : 'idle',
      spot: slots[i].spot,
      socPct: +((newSoc / capacity) * 100).toFixed(1),
      pvKwh: slots[i].pvKwh,
      loadKwh: slots[i].loadKwh,
    });
  }
  return { schedule, minSoc, maxSoc, generatedAt: new Date().toISOString() };
}

// Vad säger planen att vi ska göra just nu?
export async function decideNow(currentSocPct) {
  const { schedule, minSoc, maxSoc } = await getSchedule(currentSocPct);
  const now = Date.now();
  const cur = schedule.find((x, i) => {
    const t0 = Date.parse(x.start);
    const t1 = i + 1 < schedule.length ? Date.parse(schedule[i + 1].start) : t0 + 900e3;
    return now >= t0 && now < t1;
  }) || schedule[0];

  // Kort sammanfattning av kommande block för loggen
  const blocks = [];
  for (const x of schedule.slice(0, 96)) {
    const last = blocks[blocks.length - 1];
    if (last && last.action === x.action) last.until = x.start;
    else blocks.push({ action: x.action, from: x.start, until: x.start });
  }
  const nextActive = blocks.find((bl) => bl.action !== 'idle' && Date.parse(bl.from) > now);
  const fmtT = (iso) => new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

  return {
    action: cur.action,
    reason:
      `Dygnsplan: ${cur.action === 'charge' ? 'laddning' : cur.action === 'discharge' ? 'urladdning' : 'självkonsumtion'} nu (spot ${cur.spot.toFixed(2)} kr)` +
      (nextActive ? `, nästa ${nextActive.action === 'charge' ? 'laddning' : 'urladdning'} ${fmtT(nextActive.from)}` : '') +
      ` [SOC-fönster ${minSoc}–${maxSoc} %]`,
    via: 'plan',
  };
}

export function clearCache() {
  planCache = { plan: null, at: 0, key: null };
}
