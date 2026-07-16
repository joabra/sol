import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  // iSolarCloud
  sungrow: {
    gateway: 'https://gateway.isolarcloud.eu',
    appkey: '',
    secretKey: '',        // skickas som x-access-key-header
    username: '',
    password: '',
    psId: '',             // lämna tomt = auto-detektera första anläggningen
  },
  // Tibber (elleverantör) — riktiga priser & förbrukning
  tibber: {
    token: '',
  },
  // Lokal Modbus TCP via WiNet-S (valfritt — snabbare styrning än molnet)
  modbus: {
    host: '',        // WiNet-S IP-adress på hemnätverket
    port: 502,
    unitId: 1,
    preferForControl: true,  // använd Modbus för styrning när host är angiven
  },
  // Elpris
  price: {
    zone: 'SE3',                 // SE1-SE4
    natnyttaSekPerKwh: 0.20,     // ersättning från nätbolaget vid export
    supplierMarkupSekPerKwh: 0.08,
    gridFeeSekPerKwh: 0.26,      // elöverföring
    energyTaxSekPerKwh: 0.36,    // energiskatt
    vatFactor: 1.25,
  },
  // AI-rådgivare via lokal Ollama-server
  ai: {
    ollamaUrl: '',               // t.ex. http://192.168.1.9:11434
    model: 'qwen3.5:4b',
  },
  // Optimering
  optimizer: {
    enabled: false,
    dryRun: true,                // logga beslut utan att styra växelriktaren
    cheapPercentile: 25,         // ladda under denna percentil
    expensivePercentile: 75,     // urladda/exportera över denna
    cycleCostSekPerKwh: 0.90,    // batterislitage per kWh
    minArbitrageMarginSek: 0.20, // minsta vinst för att cykla batteriet
    chargePowerW: 5000,
    dischargePowerW: 5000,
    minSocPercent: 15,
    maxSocPercent: 95,
    intervalMinutes: 15,
  },
};

function deepMerge(base, override) {
  const out = { ...base };
  for (const k of Object.keys(override || {})) {
    if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k])) {
      out[k] = deepMerge(base[k] || {}, override[k]);
    } else if (override[k] !== undefined) {
      out[k] = override[k];
    }
  }
  return out;
}

export function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(patch) {
  const merged = deepMerge(loadSettings(), patch);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

export function redactSettings(s) {
  const clone = structuredClone(s);
  if (clone.sungrow.password) clone.sungrow.password = '••••••••';
  if (clone.sungrow.secretKey) clone.sungrow.secretKey = clone.sungrow.secretKey.slice(0, 4) + '••••';
  if (clone.tibber?.token) clone.tibber.token = clone.tibber.token.slice(0, 4) + '••••';
  return clone;
}
