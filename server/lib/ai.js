// AI-rådgivare: analyserar priser, historik och batteristatus via lokal Ollama-server
import fs from 'fs';
import path from 'path';
import { loadSettings, DATA_DIR } from './config.js';
import { getTodayAndTomorrow, currentPrice } from './prices.js';
import { buyPrice, sellPrice } from './optimizer.js';
import * as sungrow from './sungrow.js';
import * as mock from './mock.js';
import * as weather from './weather.js';

const ANALYSIS_FILE = path.join(DATA_DIR, 'ai-analysis.json');

export function isConfigured() {
  return Boolean(loadSettings().ai?.ollamaUrl);
}

function baseUrl() {
  return (loadSettings().ai?.ollamaUrl || '').replace(/\/+$/, '');
}

export async function listModels() {
  const res = await fetch(`${baseUrl()}/api/tags`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return (data.models || []).map((m) => ({ name: m.name, size: m.details?.parameter_size || '' }));
}

export async function test() {
  const models = await listModels();
  const s = loadSettings().ai;
  return {
    ok: true,
    models: models.map((m) => m.name),
    modelAvailable: models.some((m) => m.name === s.model),
  };
}

// Samla allt beslutsunderlag till prompten
async function gatherContext() {
  const settings = loadSettings();
  const useMock = !sungrow.isConfigured();
  const api = useMock ? mock : sungrow;
  const psId = settings.sungrow.psId || (await api.getPowerStationList())[0]?.ps_id;

  const [rt, priceData, history, forecast] = await Promise.all([
    api.getRealtime(psId),
    getTodayAndTomorrow(settings.price.zone),
    getRecentHistory(api, psId, useMock),
    weather.getForecast().catch(() => null),
  ]);

  const now = currentPrice([...priceData.today, ...priceData.tomorrow]);

  // Timvisa priser framåt (nu -> slut på känd data), max 36 h
  const nowMs = Date.now();
  const hourly = {};
  for (const p of [...priceData.today, ...priceData.tomorrow]) {
    const t = new Date(p.start);
    if (t.getTime() < nowMs - 3600e3) continue;
    const key = t.toISOString().slice(0, 13);
    (hourly[key] ||= []).push(p.sekPerKwh);
  }
  const futurePrices = Object.entries(hourly)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 36)
    .map(([key, vals]) => {
      const spot = vals.reduce((s, v) => s + v, 0) / vals.length;
      const hour = new Date(key + ':00:00Z').toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit' });
      return { hour, spot: +spot.toFixed(2), buy: +buyPrice(spot, settings.price).toFixed(2), sell: +sellPrice(spot, settings.price).toFixed(2) };
    });

  return { settings, rt, now, futurePrices, history, forecast, energyForecast: await getEnergyForecast() };
}

// Kalibrerade prognoser i kWh (sol per dag + förbrukning per timme) — mycket
// mer användbart för AI:n än rå instrålning.
async function getEnergyForecast() {
  try {
    const fc = await import('./forecast.js');
    const [solar, profile] = await Promise.all([fc.getSolarForecast(), fc.getLoadProfile()]);
    const loadNext24 = [];
    for (let i = 0; i < 24; i += 3) {
      const d = new Date(Date.now() + i * 3600e3);
      loadNext24.push({ hour: d.toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit' }), kwh: fc.loadForHour(profile, d) });
    }
    return { solarDaily: solar.daily, calibrated: solar.calibrated, loadNext24, loadSource: profile.source };
  } catch {
    return null;
  }
}

// Kompakt vädertext för prompterna: dagssummor + dagtimmar (06–21) i 3h-steg
function weatherSection(forecast) {
  if (!forecast) return '(ingen väderdata)';
  const daily = forecast.daily
    .map((d) => `${d.date}: instrålning ${(d.radiationWhm2 / 1000).toFixed(1)} kWh/m², moln ${d.avgCloudPct} %`)
    .join('\n');
  const hours = forecast.hours
    .filter((h, i) => {
      const hr = new Date(h.time).getHours();
      return hr >= 6 && hr <= 21 && i % 3 === 0;
    })
    .slice(0, 12)
    .map((h) => {
      const t = new Date(h.time).toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit' });
      return `${t}: sol ${h.radiationWm2} W/m², moln ${h.cloudPct} %, ${h.tempC}°C${h.precipMm > 0 ? `, regn ${h.precipMm} mm` : ''}`;
    })
    .join('\n');
  return `Per dag:\n${daily}\nDagtimmar framåt:\n${hours}`;
}

function energyForecastSection(ef) {
  if (!ef) return '(inga prognoser tillgängliga)';
  const solar = Object.entries(ef.solarDaily || {})
    .map(([d, kwh]) => `${d}: ~${kwh} kWh solproduktion${ef.calibrated ? '' : ' (okalibrerad)'}`)
    .join('\n');
  const load = (ef.loadNext24 || []).map((x) => `${x.hour}: ~${x.kwh} kWh/h`).join(', ');
  return `${solar}\nFörbrukningsprognos (källa: ${ef.loadSource}): ${load}`;
}

async function getRecentHistory(api, psId, useMock) {
  try {
    if (useMock) {
      const days = await mock.getHistory();
      return days.slice(-7);
    }
    const end = new Date();
    const start = new Date(end.getTime() - 6 * 86400e3);
    const fmt = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
    const raw = await sungrow.getHistory(psId, { queryType: '1', start: fmt(start), end: fmt(end) });
    const series = Object.values(raw || {})[0] || {};
    const byDate = {};
    const put = (k, f) => {
      for (const row of series[k] || []) {
        const wh = Number(row['2']);
        if (!Number.isFinite(wh)) continue;
        const ts = row.time_stamp;
        (byDate[ts] ||= { date: `${ts.slice(4, 6)}-${ts.slice(6, 8)}` })[f] = +(wh / 1000).toFixed(1);
      }
    };
    put('p83022', 'pvKwh');
    put('p83072', 'exportKwh');
    put('p83102', 'importKwh');
    return Object.keys(byDate).sort().map((k) => byDate[k]);
  } catch {
    return [];
  }
}

function buildPrompt(ctx) {
  const { settings, rt, now, futurePrices, history, forecast, energyForecast } = ctx;
  const o = settings.optimizer;
  const priceTable = futurePrices.map((p) => `${p.hour}: spot ${p.spot} | köp ${p.buy} | sälj ${p.sell}`).join('\n');
  const histTable = history.map((d) => `${d.date}: sol ${d.pvKwh ?? '?'} kWh, import ${d.importKwh ?? '?'} kWh, export ${d.exportKwh ?? '?'} kWh`).join('\n');

  return `Du är energirådgivare för ett svenskt hushåll med solceller och batteri (Sungrow SH10RT + SBR-batteri).
Ge en konkret rekommendation för de kommande 24 timmarna: när ska batteriet LADDAS från nätet, URLADDAS/exporteras, eller köras i SJÄLVKONSUMTION.

NULÄGE (${new Date().toLocaleString('sv-SE')}):
- Batteri: ${rt.batterySocPct?.toFixed(0) ?? '?'} % SOC${rt.batteryPowerW != null ? `, effekt ${rt.batteryPowerW > 0 ? '+' : ''}${rt.batteryPowerW} W (+ = laddar)` : ''}
- Solproduktion: ${rt.pvPowerW ?? '?'} W (idag ${((rt.pvTodayWh ?? 0) / 1000).toFixed(1)} kWh)
- Husets last: ${rt.loadPowerW ?? '?'} W
- Nät: ${rt.gridPowerW != null ? `${rt.gridPowerW > 0 ? 'import' : 'export'} ${Math.abs(rt.gridPowerW)} W` : '?'}
- Spotpris nu: ${now ? (now.sekPerKwh).toFixed(2) : '?'} kr/kWh

PRISER FRAMÅT (kr/kWh — köp inkl. skatter/avgifter, sälj = spot + nätnytta):
${priceTable}

SENASTE 7 DAGARNA:
${histTable || '(ingen historik)'}

VÄDERPROGNOS (påverkar solproduktionen — hög instrålning & lite moln = mycket sol):
${weatherSection(forecast)}

PROGNOSER (kalibrerade mot anläggningens historik):
${energyForecastSection(energyForecast)}

FÖRUTSÄTTNINGAR:
- Batterislitage (cykelkostnad): ${o.cycleCostSekPerKwh} kr/kWh — batteriet ska bara cyklas om pris-skillnaden överstiger detta + ${o.minArbitrageMarginSek} kr marginal
- SOC-gränser: ${o.minSocPercent}–${o.maxSocPercent} %
- Ladd/urladdningseffekt: ${o.chargePowerW / 1000} kW

SVARA PÅ SVENSKA i exakt detta format:
REKOMMENDATION NU: [LADDA/URLADDA/SJÄLVKONSUMTION] — en mening varför.
PLAN 24H:
- [tidsintervall]: [åtgärd] — [kort motivering]
LÖNSAMHET: förväntad vinst/besparing i kr, kort.
RISKER: max 2 punkter.
Var kortfattad och konkret. Hitta inte på data som saknas.`;
}

export async function analyze() {
  const s = loadSettings().ai;
  if (!s?.ollamaUrl) throw new Error('NOT_CONFIGURED');
  const ctx = await gatherContext();
  const prompt = buildPrompt(ctx);

  const started = Date.now();
  const res = await fetch(`${baseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: s.model,
      stream: false,
      think: false,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0.3, num_predict: 700 },
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.message?.content || '').trim();
  if (!text) throw new Error('Tomt svar från modellen');

  const analysis = {
    text,
    model: s.model,
    tookSec: +((Date.now() - started) / 1000).toFixed(1),
    time: new Date().toISOString(),
    context: {
      socPct: ctx.rt.batterySocPct,
      spotNow: ctx.now?.sekPerKwh ?? null,
      hoursAhead: ctx.futurePrices.length,
    },
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ANALYSIS_FILE, JSON.stringify(analysis, null, 2));
  } catch {}
  return analysis;
}

export function getLastAnalysis() {
  try {
    return JSON.parse(fs.readFileSync(ANALYSIS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// --- Automatiskt styrbeslut (strikt JSON) ---
function buildDecisionPrompt(ctx) {
  const { settings, rt, now, futurePrices, history, forecast, energyForecast } = ctx;
  const o = settings.optimizer;
  const priceTable = futurePrices.map((p) => `${p.hour}: spot ${p.spot} | köp ${p.buy} | sälj ${p.sell}`).join('\n');
  const histTable = history.map((d) => `${d.date}: sol ${d.pvKwh ?? '?'} kWh, import ${d.importKwh ?? '?'} kWh, export ${d.exportKwh ?? '?'} kWh`).join('\n');

  return `Du styr ett hembatteri (Sungrow, ${o.chargePowerW / 1000} kW max) i Sverige. Fatta beslutet för NÄSTA ${o.intervalMinutes} MINUTER.

NULÄGE (${new Date().toLocaleString('sv-SE')}):
- Batteri: ${rt.batterySocPct?.toFixed(0) ?? '?'} % SOC (tillåtet ${o.minSocPercent}–${o.maxSocPercent} %)
- Sol: ${rt.pvPowerW ?? '?'} W | Hus: ${rt.loadPowerW ?? '?'} W | Spot nu: ${now ? now.sekPerKwh.toFixed(2) : '?'} kr/kWh

PRISER FRAMÅT (kr/kWh):
${priceTable}

SENASTE 7 DAGARNA:
${histTable || '(ingen historik)'}

VÄDERPROGNOS (mycket sol imorgon = ladda inte fullt från nätet inatt; mulet = större behov av nattladdning):
${weatherSection(forecast)}

PROGNOSER (kWh, kalibrerade):
${energyForecastSection(energyForecast)}

REGLER:
- "charge" = ladda batteriet från nätet (köp), "discharge" = urladda/exportera (sälj), "idle" = självkonsumtion (standard)
- Cykla ENDAST batteriet om prisskillnaden överstiger cykelkostnad ${o.cycleCostSekPerKwh} kr/kWh + marginal ${o.minArbitrageMarginSek} kr/kWh
- Ladda inte över ${o.maxSocPercent} %, urladda inte under ${o.minSocPercent} %
- Vid osäkerhet: välj "idle"

Svara ENDAST med JSON: {"action":"charge"|"discharge"|"idle","powerW":<antal watt>,"reason":"<kort motivering på svenska, max 20 ord>"}`;
}

export async function decide() {
  const s = loadSettings();
  if (!s.ai?.ollamaUrl) throw new Error('NOT_CONFIGURED');
  const ctx = await gatherContext();

  const res = await fetch(`${baseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: s.ai.model,
      stream: false,
      think: false,
      format: 'json',
      messages: [{ role: 'user', content: buildDecisionPrompt(ctx) }],
      options: { temperature: 0.1, num_predict: 250 },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  let parsed;
  try {
    parsed = JSON.parse(data.message?.content || '');
  } catch {
    throw new Error('Ogiltigt JSON-svar från modellen');
  }
  const action = ['charge', 'discharge', 'idle'].includes(parsed.action) ? parsed.action : null;
  if (!action) throw new Error(`Ogiltig action från modellen: ${JSON.stringify(parsed.action)}`);

  const o = s.optimizer;
  const maxW = action === 'charge' ? o.chargePowerW : o.dischargePowerW;
  const powerW = action === 'idle' ? 0 : Math.min(Math.max(Number(parsed.powerW) || maxW, 1000), maxW);

  return {
    action,
    powerW,
    reason: String(parsed.reason || 'AI-beslut').slice(0, 200),
    socPct: ctx.rt.batterySocPct,
    spot: ctx.now?.sekPerKwh ?? null,
  };
}
