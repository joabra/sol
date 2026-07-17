import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSettings, saveSettings, redactSettings } from './lib/config.js';
import { getTodayAndTomorrow, currentPrice } from './lib/prices.js';
import * as sungrow from './lib/sungrow.js';
import * as mock from './lib/mock.js';
import * as tibber from './lib/tibber.js';
import * as modbus from './lib/modbus.js';
import * as control from './lib/control.js';
import * as auth from './lib/auth.js';
import * as optimizer from './lib/optimizer.js';
import * as ai from './lib/ai.js';
import * as weather from './lib/weather.js';
import * as planner from './lib/planner.js';
import * as ledger from './lib/ledger.js';
import * as notify from './lib/notify.js';
import * as forecast from './lib/forecast.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(auth.middleware);

// --- Autentisering ---
app.get('/api/auth/status', (req, res) => {
  const setup = !auth.hasPassword();
  res.json({
    setup,
    authenticated: setup ? true : auth.isAuthenticated(req),
  });
});

app.post('/api/auth/setup', (req, res) => {
  if (auth.hasPassword()) return res.status(403).json({ error: 'Lösenord är redan satt' });
  try {
    auth.setPassword(req.body?.password);
    const token = auth.createSession();
    res.setHeader('Set-Cookie', auth.sessionCookie(token));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  if (!auth.verifyPassword(req.body?.password || '')) {
    return res.status(401).json({ error: 'Fel lösenord' });
  }
  const token = auth.createSession();
  res.setHeader('Set-Cookie', auth.sessionCookie(token));
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  auth.destroySession(auth.currentToken(req));
  res.setHeader('Set-Cookie', auth.sessionCookie('', { clear: true }));
  res.json({ ok: true });
});

app.post('/api/auth/change-password', (req, res) => {
  if (auth.hasPassword() && !auth.verifyPassword(req.body?.currentPassword || '')) {
    return res.status(401).json({ error: 'Fel nuvarande lösenord' });
  }
  try {
    auth.setPassword(req.body?.newPassword);
    const token = auth.createSession();
    res.setHeader('Set-Cookie', auth.sessionCookie(token));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const api = () => (sungrow.isConfigured() ? sungrow : mock);
const usingMock = () => !sungrow.isConfigured();

function wrap(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    const code = err.message === 'NOT_CONFIGURED' ? 424 : 500;
    res.status(code).json({ error: err.message });
  });
}

// --- Status & data ---
app.get('/api/status', wrap(async (req, res) => {
  res.json({
    configured: sungrow.isConfigured(),
    mock: usingMock(),
    optimizer: optimizer.getState(),
  });
}));

app.get('/api/plants', wrap(async (req, res) => {
  res.json(await api().getPowerStationList());
}));

app.get('/api/realtime', wrap(async (req, res) => {
  const settings = loadSettings();
  const psId = settings.sungrow.psId || (await api().getPowerStationList())[0]?.ps_id;
  const rt = await api().getRealtime(psId);

  // Härled saknade flöden (moln-API:t på anläggningsnivå ger inte alltid alla)
  if (rt.gridPowerW == null && rt.pvPowerW != null && rt.loadPowerW != null) {
    const surplus = rt.pvPowerW - rt.loadPowerW - (rt.batteryPowerW || 0);
    rt.gridPowerW = Math.round(-surplus);
  }
  res.json({ ...rt, mock: usingMock() });
}));

app.get('/api/history', wrap(async (req, res) => {
  const settings = loadSettings();
  if (usingMock()) return res.json({ days: await mock.getHistory(), mock: true });

  const psId = settings.sungrow.psId || (await sungrow.getPowerStationList())[0]?.ps_id;
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 86400e3);
  const fmt = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
  const raw = await sungrow.getHistory(psId, {
    queryType: '1',
    start: fmt(start),
    end: fmt(end),
  });

  // Mappa API-svaret {psKey: {p83022:[{2:"wh",time_stamp:"YYYYMMDD"}...]}} till dagsserier
  const series = Object.values(raw || {})[0] || {};
  const byDate = {};
  const put = (pointKey, field) => {
    for (const row of series[pointKey] || []) {
      const ts = row.time_stamp;
      const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
      const wh = Number(row['2']);
      if (!Number.isFinite(wh)) continue;
      (byDate[date] ||= { date })[field] = Math.round(wh / 100) / 10; // Wh -> kWh, 1 decimal
    }
  };
  put('p83022', 'pvKwh');
  put('p83072', 'exportKwh');
  put('p83102', 'importKwh');
  const days = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  res.json({ days, mock: false });
}));

app.get('/api/prices', wrap(async (req, res) => {
  const settings = loadSettings();
  const { today, tomorrow } = await getTodayAndTomorrow(settings.price.zone);
  const now = currentPrice([...today, ...tomorrow]);

  // Med Tibber anslutet: använd ditt riktiga köppris (inkl. påslag & moms) + elöverföring & energiskatt
  let currentBuy = now ? optimizer.buyPrice(now.sekPerKwh, settings.price) : null;
  let tibberCurrent = null;
  if (tibber.isConfigured()) {
    try {
      const t = await tibber.getOverview();
      if (t.current?.total != null) {
        tibberCurrent = t.current;
        currentBuy = t.current.total + settings.price.gridFeeSekPerKwh + settings.price.energyTaxSekPerKwh;
      }
    } catch {}
  }

  res.json({
    zone: settings.price.zone,
    current: now,
    currentBuy,
    currentSell: now ? optimizer.sellPrice(now.sekPerKwh, settings.price) : null,
    tibber: tibberCurrent,
    today,
    tomorrow,
  });
}));

// --- Tibber ---
app.get('/api/tibber', wrap(async (req, res) => {
  if (!tibber.isConfigured()) return res.status(424).json({ error: 'NOT_CONFIGURED' });
  res.json(await tibber.getOverview());
}));

app.post('/api/tibber/test', wrap(async (req, res) => {
  if (!tibber.isConfigured()) return res.status(400).json({ ok: false, error: 'Tibber-token saknas' });
  const r = await tibber.test();
  res.json({ ok: true, ...r });
}));

// --- Inställningar ---
app.get('/api/settings', (req, res) => {
  res.json(redactSettings(loadSettings()));
});

app.put('/api/settings', (req, res) => {
  const patch = req.body || {};
  // Skriv inte över hemligheter med redakterade platshållare
  if (patch.sungrow?.password?.includes('•')) delete patch.sungrow.password;
  if (patch.sungrow?.secretKey?.includes('•')) delete patch.sungrow.secretKey;
  if (patch.tibber?.token?.includes('•')) delete patch.tibber.token;
  if (patch.notify?.telegramBotToken?.includes('•')) delete patch.notify.telegramBotToken;
  if (patch.tibber?.token !== undefined) tibber.clearCache();
  const merged = saveSettings(patch);
  if (merged.optimizer.enabled && !optimizer.getState().running) optimizer.start();
  if (!merged.optimizer.enabled && optimizer.getState().running) optimizer.stop();
  res.json(redactSettings(merged));
});

app.post('/api/settings/test-connection', wrap(async (req, res) => {
  if (!sungrow.isConfigured()) return res.status(400).json({ ok: false, error: 'API-uppgifter saknas' });
  await sungrow.login();
  const plants = await sungrow.getPowerStationList();
  res.json({ ok: true, plants: plants.map((p) => ({ ps_id: p.ps_id, ps_name: p.ps_name })) });
}));

// --- Optimizer ---
app.get('/api/optimizer', (req, res) => {
  res.json({ ...optimizer.getState(), log: optimizer.getLog().slice(-50).reverse() });
});

app.post('/api/optimizer/run', wrap(async (req, res) => {
  res.json(await optimizer.runOnce());
}));

app.post('/api/optimizer/:action(start|stop)', (req, res) => {
  const enabled = req.params.action === 'start';
  saveSettings({ optimizer: { enabled } });
  enabled ? optimizer.start() : optimizer.stop();
  res.json(optimizer.getState());
});

// --- Manuell styrning (lokal Modbus om konfigurerad, annars moln) ---
app.post('/api/control/:cmd(charge|discharge|stop)', wrap(async (req, res) => {
  const settings = loadSettings();
  const powerW = Number(req.body?.powerW) || settings.optimizer.chargePowerW;
  const { cmd } = req.params;
  const r = cmd === 'charge' ? await control.charge(powerW) : cmd === 'discharge' ? await control.discharge(powerW) : await control.stop();
  optimizer.setCurrentMode(cmd === 'charge' ? 'charging' : cmd === 'discharge' ? 'discharging' : 'self-consumption');
  res.json({ ok: true, cmd, powerW, via: r.via, mock: r.via === 'mock', result: r.result });
}));

// --- Väderprognos ---
app.get('/api/weather', wrap(async (req, res) => {
  const f = await weather.getForecast();
  if (!f) return res.status(424).json({ error: 'NOT_CONFIGURED' });
  res.json(f);
}));

// --- AI-rådgivare (lokal Ollama) ---
app.get('/api/ai', (req, res) => {
  res.json({ configured: ai.isConfigured(), last: ai.getLastAnalysis() });
});

app.post('/api/ai/analyze', wrap(async (req, res) => {
  res.json(await ai.analyze());
}));

app.get('/api/ai/models', wrap(async (req, res) => {
  res.json(await ai.listModels());
}));

app.post('/api/ai/test', wrap(async (req, res) => {
  if (!ai.isConfigured()) return res.status(400).json({ ok: false, error: 'Ollama-URL saknas' });
  res.json(await ai.test());
}));

// --- Dygnsplan ---
app.get('/api/plan', wrap(async (req, res) => {
  const api = sungrow.isConfigured() ? sungrow : mock;
  const settings = loadSettings();
  const psId = settings.sungrow.psId || (await api.getPowerStationList())[0]?.ps_id;
  const rt = await api.getRealtime(psId).catch(() => ({}));
  res.json(await planner.getSchedule(rt.batterySocPct ?? 50));
}));

// --- Avkastningsrapport ---
app.get('/api/report', (req, res) => {
  res.json(ledger.getReport());
});

// --- Prognoser (sol i kWh + lastprofil) ---
app.get('/api/forecast', wrap(async (req, res) => {
  const [solar, profile] = await Promise.all([
    forecast.getSolarForecast().catch(() => null),
    forecast.getLoadProfile().catch(() => null),
  ]);
  res.json({ solar, profile });
}));

// --- Notiser ---
app.post('/api/notify/test', wrap(async (req, res) => {
  if (!notify.isConfigured()) return res.status(400).json({ ok: false, error: 'Ingen notiskanal konfigurerad' });
  const r = await notify.send('Solvakt', 'Testnotis — notiserna fungerar! ✅');
  res.json({ ok: true, result: r });
}));

// --- Modbus (WiNet-S) ---
app.post('/api/modbus/test', wrap(async (req, res) => {
  if (!modbus.isConfigured()) return res.status(400).json({ ok: false, error: 'Modbus-host saknas' });
  res.json(await modbus.test());
}));

// --- Statisk frontend (efter build) ---
const dist = path.resolve(__dirname, '../web/dist');
app.use(express.static(dist));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Solvakt körs på http://localhost:${PORT}${usingMock() ? '  (mock-läge — konfigurera Sungrow under Inställningar)' : ''}`);
  if (loadSettings().optimizer.enabled) optimizer.start();
});
