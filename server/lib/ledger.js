// Avkastningsliggare: loggar batteriets energiflöden med aktuella priser varje
// optimizer-körning och aggregerar per dag. Ger underlag för "Vad har Solvakt tjänat?"
import fs from 'fs';
import path from 'path';
import { DATA_DIR, loadSettings } from './config.js';
import { buyPrice, sellPrice } from './optimizer.js';

const FILE = path.join(DATA_DIR, 'ledger.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { days: {} };
  }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// Anropas varje optimizer-tick med realtidsdata + aktuellt spotpris.
// intervalMin = tid sedan förra sampeln (energi = effekt × tid).
export function record({ batteryPowerW, gridPowerW, spot, intervalMin = 15 }) {
  if (spot == null || batteryPowerW == null) return;
  const settings = loadSettings();
  const p = settings.price;
  const buy = buyPrice(spot, p);
  const sell = sellPrice(spot, p);
  const h = intervalMin / 60;

  const chargeKwh = Math.max(0, batteryPowerW) / 1000 * h;
  const dischargeKwh = Math.max(0, -batteryPowerW) / 1000 * h;
  const importKwh = Math.max(0, gridPowerW ?? 0) / 1000 * h;
  const exportKwh = Math.max(0, -(gridPowerW ?? 0)) / 1000 * h;

  // Urladdning ersätter import (värde = buy) upp till importbehovet; resten exporteras (värde = sell)
  const dischargeAvoidedImport = Math.min(dischargeKwh, Math.max(0, dischargeKwh - exportKwh));
  const dischargeExported = dischargeKwh - dischargeAvoidedImport;
  // Laddning från nätet kostar buy; laddning från sol "kostar" utebliven export (sell)
  const chargeFromGrid = Math.min(chargeKwh, importKwh);
  const chargeFromSolar = chargeKwh - chargeFromGrid;

  const day = new Date().toISOString().slice(0, 10);
  const data = load();
  const d = (data.days[day] ||= {
    chargeKwh: 0, dischargeKwh: 0, chargeCostSek: 0, dischargeValueSek: 0, cycleCostSek: 0, samples: 0,
  });
  d.chargeKwh += chargeKwh;
  d.dischargeKwh += dischargeKwh;
  d.chargeCostSek += chargeFromGrid * buy + chargeFromSolar * sell;
  d.dischargeValueSek += dischargeAvoidedImport * buy + dischargeExported * sell;
  d.cycleCostSek += (chargeKwh + dischargeKwh) * 0.5 * settings.optimizer.cycleCostSekPerKwh;
  d.samples += 1;

  // Effekttoppar (för peak shaving-uppföljning): månadens högsta timimport
  if (gridPowerW > 0) {
    const month = day.slice(0, 7);
    const peaks = (data.peaks ||= {});
    const m = (peaks[month] ||= {});
    const hourKey = new Date().toISOString().slice(0, 13);
    m[hourKey] = Math.max(m[hourKey] || 0, Math.round(gridPowerW));
    // behåll bara topp-10 timmar per månad
    const entries = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10);
    peaks[month] = Object.fromEntries(entries);
  }

  save(data);
}

export function getReport() {
  const data = load();
  const days = Object.entries(data.days)
    .map(([date, d]) => ({
      date,
      chargeKwh: +d.chargeKwh.toFixed(2),
      dischargeKwh: +d.dischargeKwh.toFixed(2),
      chargeCostSek: +d.chargeCostSek.toFixed(2),
      dischargeValueSek: +d.dischargeValueSek.toFixed(2),
      cycleCostSek: +d.cycleCostSek.toFixed(2),
      netSek: +(d.dischargeValueSek - d.chargeCostSek - d.cycleCostSek).toFixed(2),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const months = {};
  for (const d of days) {
    const m = (months[d.date.slice(0, 7)] ||= { chargeKwh: 0, dischargeKwh: 0, netSek: 0, days: 0 });
    m.chargeKwh += d.chargeKwh;
    m.dischargeKwh += d.dischargeKwh;
    m.netSek += d.netSek;
    m.days += 1;
  }
  const monthly = Object.entries(months)
    .map(([month, m]) => ({
      month,
      chargeKwh: +m.chargeKwh.toFixed(1),
      dischargeKwh: +m.dischargeKwh.toFixed(1),
      netSek: +m.netSek.toFixed(2),
      cycles: +((m.dischargeKwh) / (loadSettings().battery.capacityKwh || 12.8)).toFixed(1),
      days: m.days,
    }))
    .sort((a, b) => b.month.localeCompare(a.month));

  return { days: days.slice(0, 90), monthly, peaks: data.peaks || {} };
}
