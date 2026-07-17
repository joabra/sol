// Laddplanering för elbilen: hitta billigaste sammanhängande laddfönstret
// bland kommande spotpriser (bilen laddas bäst i ett svep).
import { loadSettings } from './config.js';
import { getTodayAndTomorrow } from './prices.js';
import { buyPrice } from './optimizer.js';
import * as tesla from './tesla.js';

export async function getChargePlan() {
  const settings = loadSettings();
  const ev = settings.ev || {};
  const p = settings.price;

  const { today, tomorrow } = await getTodayAndTomorrow(p.zone);
  const future = [...today, ...tomorrow].filter((x) => Date.parse(x.end ?? x.start) > Date.now());
  if (!future.length) return null;

  // Hur mycket behöver bilen? API om möjligt, annars anta 30 % -> mål
  let carSocPct = null;
  let car = null;
  if (tesla.isConfigured()) {
    try {
      car = await tesla.getStatus();
      if (car && !car.asleep) carSocPct = car.socPct;
    } catch {}
  }
  const fromSoc = carSocPct ?? 30;
  const neededKwh = Math.max(0, ((ev.targetSocPct ?? 80) - fromSoc) / 100) * (ev.batteryKwh || 75);
  const chargeKw = (ev.chargerPowerW || 11000) / 1000;
  const hoursNeeded = Math.max(1, Math.ceil(neededKwh / chargeKw));

  // Timpriser (köp) framåt
  const hourly = {};
  for (const x of future) {
    const key = x.start.slice(0, 13);
    (hourly[key] ||= []).push(x.sekPerKwh);
  }
  const hours = Object.entries(hourly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, vals]) => {
      const spot = vals.reduce((s, v) => s + v, 0) / vals.length;
      return { start: key, spot, buy: buyPrice(spot, p) };
    });
  if (hours.length < hoursNeeded) return null;

  // Billigaste sammanhängande fönstret
  let best = null;
  for (let i = 0; i + hoursNeeded <= hours.length; i++) {
    const win = hours.slice(i, i + hoursNeeded);
    const avg = win.reduce((s, h) => s + h.buy, 0) / win.length;
    if (!best || avg < best.avgBuy) best = { from: win[0].start, hours: hoursNeeded, avgBuy: avg };
  }

  const now = hours[0];
  const costAtBest = +(neededKwh * best.avgBuy).toFixed(0);
  const costNow = +(neededKwh * now.buy).toFixed(0);

  return {
    car,
    fromSocPct: fromSoc,
    assumedSoc: carSocPct == null,
    targetSocPct: ev.targetSocPct ?? 80,
    neededKwh: +neededKwh.toFixed(1),
    hoursNeeded,
    window: {
      from: best.from + ':00',
      to: hours[hours.findIndex((h) => h.start === best.from) + hoursNeeded - 1].start + ':59',
      avgBuySek: +best.avgBuy.toFixed(2),
    },
    costAtBestSek: costAtBest,
    costNowSek: costNow,
    savingSek: Math.max(0, costNow - costAtBest),
  };
}
