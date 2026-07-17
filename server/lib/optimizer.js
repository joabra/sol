// Export-optimering likt CheckWatt, fast lokalt.
//
// Ekonomi (Sverige 2026, skattereduktionen borttagen):
//   köppris  = (spot + påslag) * 1.25 + elöverföring + energiskatt
//   säljpris = spot + nätnytta
// Beslut per intervall:
//   - spot <= P25 och det finns dyrare timmar senare som täcker cykelkostnad -> LADDA
//   - spot >= P75 och SOC > golv och marginal täcker cykelkostnad          -> URLADDA/EXPORTERA
//   - annars -> SJÄLVKONSUMTION (växelriktarens standardläge)
import fs from 'fs';
import path from 'path';
import { loadSettings, DATA_DIR } from './config.js';
import { getTodayAndTomorrow, currentPrice, percentile } from './prices.js';
import * as sungrow from './sungrow.js';
import * as mock from './mock.js';
import * as control from './control.js';

const LOG_FILE = path.join(DATA_DIR, 'optimizer-log.json');
const STATE_FILE = path.join(DATA_DIR, 'optimizer-state.json');
const state = {
  running: false,
  lastRun: null,
  lastDecision: null,
  lastError: null,
  currentMode: 'self-consumption', // self-consumption | charging | discharging
  timer: null,
};
// Kom ihåg växelriktarens läge över omstarter
try { state.currentMode = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).currentMode || state.currentMode; } catch {}

function persistMode() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ currentMode: state.currentMode }));
}

function log(entry) {
  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}
  entries.push(entry);
  if (entries.length > 500) entries = entries.slice(-500);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
}

export function getLog() {
  try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch { return []; }
}

export function buyPrice(spot, p) {
  return (spot + p.supplierMarkupSekPerKwh) * p.vatFactor + p.gridFeeSekPerKwh + p.energyTaxSekPerKwh;
}
export function sellPrice(spot, p) {
  return spot + p.natnyttaSekPerKwh;
}

export function decide({ spot, allPrices, futurePrices, socPct, settings }) {
  const o = settings.optimizer;
  const p = settings.price;
  const values = allPrices.map((x) => x.sekPerKwh);
  const cheap = percentile(values, o.cheapPercentile);
  const expensive = percentile(values, o.expensivePercentile);
  const maxFuture = futurePrices.length ? Math.max(...futurePrices.map((x) => x.sekPerKwh)) : null;

  const info = { spot, cheapThreshold: cheap, expensiveThreshold: expensive, maxFuture, socPct };

  if (spot <= cheap && socPct < o.maxSocPercent) {
    // Ladda bara om det finns en dyrare period senare som täcker cykelkostnad + marginal
    if (maxFuture !== null && sellPrice(maxFuture, p) - buyPrice(spot, p) > o.cycleCostSekPerKwh + o.minArbitrageMarginSek) {
      return { action: 'charge', reason: `Billig period (${spot.toFixed(2)} ≤ P${o.cheapPercentile} ${cheap.toFixed(2)}) och lönsam arbitrage senare (max ${maxFuture.toFixed(2)} kr/kWh)`, ...info };
    }
    return { action: 'idle', reason: 'Billigt nu men ingen lönsam försäljningsperiod senare (arbitrage täcker inte cykelkostnaden)', ...info };
  }

  if (spot >= expensive && socPct > o.minSocPercent) {
    // Urladdning: exporterat/självförbrukat under dyr timme.
    // Vi kräver att spot-nivån i sig ger tillräcklig marginal mot cykelkostnaden.
    const margin = sellPrice(spot, p) - o.cycleCostSekPerKwh;
    if (margin > o.minArbitrageMarginSek) {
      return { action: 'discharge', reason: `Dyr period (${spot.toFixed(2)} ≥ P${o.expensivePercentile} ${expensive.toFixed(2)}), marginal ${margin.toFixed(2)} kr/kWh efter cykelkostnad`, ...info };
    }
    return { action: 'idle', reason: 'Dyr period men marginalen täcker inte batterislitaget', ...info };
  }

  return { action: 'idle', reason: 'Normalpris — självkonsumtion', ...info };
}

async function applyAction(action, settings, powerW) {
  const o = settings.optimizer;
  if (o.dryRun) return 'dry-run';
  const r = action === 'charge'
    ? await control.charge(powerW || o.chargePowerW)
    : action === 'discharge'
      ? await control.discharge(powerW || o.dischargePowerW)
      : await control.stop();
  return `applied (${r.via})`;
}

export async function runOnce() {
  const settings = loadSettings();
  const o = settings.optimizer;
  const api = sungrow.isConfigured() ? sungrow : mock;
  state.lastRun = new Date().toISOString();
  state.lastError = null;

  try {
    const { today, tomorrow } = await getTodayAndTomorrow(settings.price.zone);
    const all = [...today, ...tomorrow];
    const now = currentPrice(all);
    if (!now) throw new Error('Inget aktuellt spotpris hittades');

    const psId = settings.sungrow.psId || (await api.getPowerStationList())[0]?.ps_id;
    const rt = await api.getRealtime(psId);
    const socPct = rt.batterySocPct ?? 50;
    const future = all.filter((x) => Date.parse(x.start) > Date.now());

    const decision = await makeDecision({ now, today, future, socPct, settings, rt });

    // Avkastningsliggare: logga batteriflöden med aktuella priser
    try {
      const ledger = await import('./ledger.js');
      ledger.record({
        batteryPowerW: rt.batteryPowerW,
        gridPowerW: rt.gridPowerW,
        spot: now.sekPerKwh,
        intervalMin: o.intervalMinutes,
      });
    } catch {}

    // Skicka bara kommandon vid lägesändring
    const targetMode = decision.action === 'charge' ? 'charging' : decision.action === 'discharge' ? 'discharging' : 'self-consumption';
    let applied = 'no-change';
    if (targetMode !== state.currentMode) {
      applied = await applyAction(decision.action, settings, decision.powerW);
      // I torrkörning styrs inget — lägesminnet ska spegla växelriktarens verkliga läge
      if (applied !== 'dry-run') {
        state.currentMode = targetMode;
        persistMode();
      }
    }

    state.lastDecision = { ...decision, applied, mode: targetMode, dryRun: o.dryRun, mock: api === mock, time: state.lastRun };
    log(state.lastDecision);
    notifyDecision(state.lastDecision).catch(() => {});
    return state.lastDecision;
  } catch (err) {
    state.lastError = err.message;
    log({ time: state.lastRun, error: err.message });
    notifyError(err.message).catch(() => {});
    throw err;
  }
}

async function notifyDecision(d) {
  const notify = await import('./notify.js');
  if (!notify.isConfigured()) return;
  if (d.applied !== 'no-change' && d.applied !== 'dry-run' && d.action !== 'idle') {
    const label = d.action === 'charge' ? '🔋 Laddar batteriet' : '⚡ Urladdar batteriet';
    await notify.send(label, `${d.reason}\nSpot: ${d.spot?.toFixed(2)} kr/kWh · SOC: ${d.socPct?.toFixed(0)} % · via ${d.via}`, { key: `mode-${d.action}`, minIntervalMin: 30 });
  }
  if (d.spot != null && d.spot < 0) {
    await notify.send('💰 Negativt elpris', `Spotpriset är ${d.spot.toFixed(2)} kr/kWh — export stoppad, batteriet laddas.`, { key: 'negative-price', minIntervalMin: 180 });
  }
}

async function notifyError(msg) {
  const notify = await import('./notify.js');
  if (!notify.isConfigured()) return;
  await notify.send('⚠️ Solvakt-fel', msg, { key: 'error', minIntervalMin: 60 });
}

// Beslutskedja: hårda överstyrningar (storm, negativa priser, effekttoppar) →
// vald strategi (dygnsplan / AI / regler) med säkerhetsspärrar och fallback.
async function makeDecision({ now, today, future, socPct, settings, rt }) {
  const o = settings.optimizer;
  const spot = now.sekPerKwh;

  // 1. Vädervarning: storm/snöoväder inom 36 h → ladda fullt och håll som reserv
  if (o.stormPrepare) {
    try {
      const weather = await import('./weather.js');
      const risk = weather.stormRisk(await weather.getForecast());
      if (risk) {
        const desc = `${risk.type === 'vind' ? 'storm' : 'snöoväder'} (${risk.value}) väntas ${new Date(risk.at).toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
        if (socPct < o.maxSocPercent) {
          return { action: 'charge', reason: `⛈ Beredskapsläge: ${desc} — laddar batteriet som reserv`, spot, socPct, via: 'override' };
        }
        return { action: 'idle', reason: `⛈ Beredskapsläge: ${desc} — batteriet hålls fulladdat som reserv`, spot, socPct, via: 'override' };
      }
    } catch {}
  }

  // 2. Negativa spotpriser: stoppa export, ladda "gratis"
  if (o.negativePriceGuard && spot < 0) {
    if (socPct < o.maxSocPercent) {
      return { action: 'charge', reason: `Negativt spotpris (${spot.toFixed(2)} kr/kWh) — laddar istället för att exportera med förlust`, spot, socPct, via: 'override' };
    }
    return { action: 'idle', reason: `Negativt spotpris (${spot.toFixed(2)} kr/kWh) men batteriet är fullt — självkonsumtion`, spot, socPct, via: 'override' };
  }

  // 3. Effekttoppskapning: husets last över tröskel → täck med batteriet
  const ps = settings.peakShave || {};
  if (ps.enabled && rt?.loadPowerW > ps.thresholdW && socPct > o.minSocPercent) {
    const powerW = Math.min(o.dischargePowerW, Math.round(rt.loadPowerW - ps.thresholdW + 500));
    return { action: 'discharge', powerW, reason: `Effekttopp: husets last ${(rt.loadPowerW / 1000).toFixed(1)} kW > tröskel ${(ps.thresholdW / 1000).toFixed(1)} kW — batteriet kapar toppen`, spot, socPct, via: 'override' };
  }

  // 4. Vald strategi
  const strategy = o.strategy || 'plan';
  if (strategy === 'plan') {
    try {
      const planner = await import('./planner.js');
      const d = await planner.decideNow(socPct);
      if (d.action === 'charge' && socPct >= o.maxSocPercent) { d.action = 'idle'; d.reason += ' [spärr: SOC vid maxgräns]'; }
      if (d.action === 'discharge' && socPct <= o.minSocPercent) { d.action = 'idle'; d.reason += ' [spärr: SOC vid golv]'; }
      return { ...d, spot, socPct };
    } catch (err) {
      const fallback = decide({ spot, allPrices: today, futurePrices: future, socPct, settings });
      fallback.via = 'rules';
      fallback.reason += ` (planerare otillgänglig: ${err.message})`;
      return fallback;
    }
  }

  if (strategy === 'ai' && settings.ai?.autoControl && settings.ai?.ollamaUrl) {
    try {
      const ai = await import('./ai.js');
      const d = await ai.decide();
      // Säkerhetsspärrar — AI:n får aldrig bryta SOC-gränserna
      if (d.action === 'charge' && socPct >= o.maxSocPercent) {
        d.action = 'idle';
        d.reason += ` [spärr: SOC ${socPct.toFixed(0)} % ≥ maxgräns ${o.maxSocPercent} %]`;
      }
      if (d.action === 'discharge' && socPct <= o.minSocPercent) {
        d.action = 'idle';
        d.reason += ` [spärr: SOC ${socPct.toFixed(0)} % ≤ golv ${o.minSocPercent} %]`;
      }
      return { ...d, spot, socPct, via: 'ai' };
    } catch (err) {
      const fallback = decide({ spot, allPrices: today, futurePrices: future, socPct, settings });
      fallback.via = 'rules';
      fallback.reason += ` (AI otillgänglig: ${err.message} — regelmotorn tog beslutet)`;
      return fallback;
    }
  }

  return { ...decide({ spot, allPrices: today, futurePrices: future, socPct, settings }), via: 'rules' };
}

export function start() {
  const settings = loadSettings();
  stop();
  state.running = true;
  const ms = Math.max(5, settings.optimizer.intervalMinutes) * 60 * 1000;
  state.timer = setInterval(() => runOnce().catch(() => {}), ms);
  runOnce().catch(() => {});
}

export function stop() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
  // Säkerhet: lämna aldrig växelriktaren i forcerat läge när optimeringen stängs av
  if (state.currentMode !== 'self-consumption') {
    revertToSelfConsumption().catch((err) =>
      log({ time: new Date().toISOString(), error: `Kunde inte återställa självkonsumtion: ${err.message}` })
    );
  }
}

async function revertToSelfConsumption() {
  const settings = loadSettings();
  if (!settings.optimizer.dryRun) {
    await control.stop();
  }
  state.currentMode = 'self-consumption';
  persistMode();
  log({ time: new Date().toISOString(), action: 'idle', reason: 'Optimering stoppad — växelriktaren återställd till självkonsumtion', applied: 'applied' });
}

export function getState() {
  const { timer, ...rest } = state;
  return rest;
}

// Håll lägesminnet i synk när användaren styr manuellt
export function setCurrentMode(mode) {
  state.currentMode = mode;
  persistMode();
}
