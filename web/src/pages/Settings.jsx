import { useEffect, useState } from 'react';
import { api } from '../api.js';

function Field({ label, hint, ...props }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      {hint && <span className="block text-xs text-slate-500 mb-1">{hint}</span>}
      <input className="input mt-1" {...props} />
    </label>
  );
}

export default function Settings() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [tibberResult, setTibberResult] = useState(null);
  const [modbusResult, setModbusResult] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings().then(setS);
  }, []);

  if (!s) return <p className="text-slate-500">Laddar…</p>;

  const set = (section, key, value) =>
    setS({ ...s, [section]: { ...s[section], [key]: value } });

  const num = (section, key) => (e) => set(section, key, Number(e.target.value));
  const str = (section, key) => (e) => set(section, key, e.target.value);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await api.saveSettings(s);
      setS(saved);
      setMsg('✓ Sparat');
    } catch (e) {
      setMsg(`Fel: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setTestResult(null);
    try {
      await api.saveSettings(s);
      const r = await api.testConnection();
      setTestResult(
        r.ok
          ? `✓ Ansluten! Hittade: ${r.plants.map((p) => `${p.ps_name} (${p.ps_id})`).join(', ')}`
          : `✗ ${r.error}`
      );
    } catch (e) {
      setTestResult(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const testTibber = async () => {
    setBusy(true);
    setTibberResult(null);
    try {
      await api.saveSettings(s);
      const r = await api.tibberTest();
      setTibberResult(r.ok ? `✓ Ansluten som ${r.name}: ${r.homes.map((h) => h.label).join(', ')}` : `✗ ${r.error}`);
    } catch (e) {
      setTibberResult(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const testModbus = async () => {
    setBusy(true);
    setModbusResult(null);
    try {
      await api.saveSettings(s);
      const r = await api.modbusTest();
      setModbusResult(r.ok ? `✓ Ansluten! Batteri-SOC via Modbus: ${r.batterySocPct} %` : `✗ ${r.error}`);
    } catch (e) {
      setModbusResult(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const testAi = async () => {
    setBusy(true);
    setAiResult(null);
    try {
      await api.saveSettings(s);
      const r = await api.aiTest();
      setAiResult(
        r.ok
          ? `✓ Ansluten! ${r.modelAvailable ? 'Modellen finns' : `⚠ modellen saknas — installerade: ${r.models.join(', ')}`}`
          : `✗ ${r.error}`
      );
    } catch (e) {
      setAiResult(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="card">
        <h2 className="font-bold mb-1">Sungrow iSolarCloud</h2>
        <p className="text-xs text-slate-500 mb-4">
          Skapa ett utvecklarkonto på{' '}
          <a href="https://developer-api.isolarcloud.com" target="_blank" rel="noreferrer" className="text-solar underline">
            developer-api.isolarcloud.com
          </a>{' '}
          för att få AppKey och Secret Key. Styrning (paramSetting) kan kräva att du begär skrivbehörighet från
          Sungrows support.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="AppKey" value={s.sungrow.appkey} onChange={str('sungrow', 'appkey')} placeholder="32 tecken" />
          <Field label="Secret Key" hint="Skickas som x-access-key" type="password" value={s.sungrow.secretKey} onChange={str('sungrow', 'secretKey')} />
          <Field label="Användarnamn (e-post)" value={s.sungrow.username} onChange={str('sungrow', 'username')} />
          <Field label="Lösenord" type="password" value={s.sungrow.password} onChange={str('sungrow', 'password')} />
          <Field label="Gateway" hint="EU-servern för svenska konton" value={s.sungrow.gateway} onChange={str('sungrow', 'gateway')} />
          <Field label="Anläggnings-ID (ps_id)" hint="Lämna tomt för auto-detektering" value={s.sungrow.psId} onChange={str('sungrow', 'psId')} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn-ghost" onClick={test} disabled={busy}>Testa anslutning</button>
          {testResult && <span className="text-sm text-slate-300">{testResult}</span>}
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold mb-1">Tibber (elleverantör)</h2>
        <p className="text-xs text-slate-500 mb-4">
          Hämtar ditt riktiga elpris (inkl. Tibbers påslag och moms), timförbrukning, kostnad och såld
          produktion. Skapa en personlig token på{' '}
          <a href="https://developer.tibber.com/settings/access-token" target="_blank" rel="noreferrer" className="text-solar underline">
            developer.tibber.com
          </a>
          .
        </p>
        <Field label="Access-token" type="password" value={s.tibber?.token || ''} onChange={str('tibber', 'token')} />
        <div className="mt-4 flex items-center gap-3">
          <button className="btn-ghost" onClick={testTibber} disabled={busy}>Testa Tibber</button>
          {tibberResult && <span className="text-sm text-slate-300">{tibberResult}</span>}
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold mb-1">Lokal styrning — Modbus TCP (WiNet-S)</h2>
        <p className="text-xs text-slate-500 mb-4">
          Valfritt: styr växelriktaren direkt över hemnätverket via WiNet-S-dongeln. OBS: många
          WiNet-S-firmware tillåter <strong>endast läsning</strong> — skrivningar verifieras med återläsning
          och faller tillbaka med tydligt fel. Fungerar inte skrivning: låt kryssrutan nedan vara av så
          används molnstyrning (fungerar bevisat på din anläggning).
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="IP-adress" hint="t.ex. 192.168.1.50" value={s.modbus?.host || ''} onChange={str('modbus', 'host')} />
          <Field label="Port" type="number" value={s.modbus?.port ?? 502} onChange={num('modbus', 'port')} />
          <Field label="Unit ID" type="number" value={s.modbus?.unitId ?? 1} onChange={num('modbus', 'unitId')} />
        </div>
        <label className="flex items-center gap-3 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={s.modbus?.preferForControl !== false}
            onChange={(e) => set('modbus', 'preferForControl', e.target.checked)}
            className="w-4 h-4 accent-amber-400"
          />
          <span className="text-sm">Använd Modbus för styrning när IP är angiven (moln-API:t används fortfarande för visualisering)</span>
        </label>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn-ghost" onClick={testModbus} disabled={busy}>Testa Modbus</button>
          {modbusResult && <span className="text-sm text-slate-300">{modbusResult}</span>}
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold mb-1">AI-rådgivare (Ollama)</h2>
        <p className="text-xs text-slate-500 mb-4">
          Lokal AI som analyserar priser, historik och batteristatus och ger en 24-timmarsplan för köp/sälj.
          Kräver en <a className="underline" href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a>-server på nätverket.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Ollama-URL" hint="t.ex. http://192.168.1.9:11434" value={s.ai?.ollamaUrl || ''} onChange={str('ai', 'ollamaUrl')} />
          <Field label="Modell" hint="qwen3.5:4b rekommenderas — snabb och bra på svenska" value={s.ai?.model || ''} onChange={str('ai', 'model')} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn-ghost" onClick={testAi} disabled={busy}>Testa Ollama</button>
          {aiResult && <span className="text-sm text-slate-300">{aiResult}</span>}
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold mb-4">Elpris & ersättningar</h2>
        <p className="text-xs text-slate-500 mb-4 -mt-2">
          Vattenfall Eldistribution saknar publikt API — ange elöverföring och nätnytta (energiersättning)
          från din nätfaktura här. Vattenfalls energiersättning 2026 är 10,4 öre/kWh (exkl. moms).
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-300">Elområde</span>
            <select className="input mt-1" value={s.price.zone} onChange={str('price', 'zone')}>
              <option value="SE1">SE1 — Luleå</option>
              <option value="SE2">SE2 — Sundsvall</option>
              <option value="SE3">SE3 — Stockholm</option>
              <option value="SE4">SE4 — Malmö</option>
            </select>
          </label>
          <Field label="Nätnytta (kr/kWh)" hint="Ersättning från nätbolaget vid export, se din faktura" type="number" step="0.01" value={s.price.natnyttaSekPerKwh} onChange={num('price', 'natnyttaSekPerKwh')} />
          <Field label="Elhandlarens påslag (kr/kWh)" type="number" step="0.01" value={s.price.supplierMarkupSekPerKwh} onChange={num('price', 'supplierMarkupSekPerKwh')} />
          <Field label="Elöverföring (kr/kWh)" type="number" step="0.01" value={s.price.gridFeeSekPerKwh} onChange={num('price', 'gridFeeSekPerKwh')} />
          <Field label="Energiskatt (kr/kWh)" type="number" step="0.01" value={s.price.energyTaxSekPerKwh} onChange={num('price', 'energyTaxSekPerKwh')} />
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold mb-4">Optimering</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Billig-tröskel (percentil)" hint="Ladda när spot ≤ denna percentil av dagens priser" type="number" min="5" max="45" value={s.optimizer.cheapPercentile} onChange={num('optimizer', 'cheapPercentile')} />
          <Field label="Dyr-tröskel (percentil)" hint="Urladda när spot ≥ denna percentil" type="number" min="55" max="95" value={s.optimizer.expensivePercentile} onChange={num('optimizer', 'expensivePercentile')} />
          <Field label="Batterislitage (kr/kWh)" hint="Batterikostnad / (cykler × kapacitet)" type="number" step="0.05" value={s.optimizer.cycleCostSekPerKwh} onChange={num('optimizer', 'cycleCostSekPerKwh')} />
          <Field label="Minsta arbitragemarginal (kr/kWh)" type="number" step="0.05" value={s.optimizer.minArbitrageMarginSek} onChange={num('optimizer', 'minArbitrageMarginSek')} />
          <Field label="Laddeffekt (W)" type="number" step="100" value={s.optimizer.chargePowerW} onChange={num('optimizer', 'chargePowerW')} />
          <Field label="Urladdningseffekt (W)" type="number" step="100" value={s.optimizer.dischargePowerW} onChange={num('optimizer', 'dischargePowerW')} />
          <Field label="Lägsta SOC (%)" hint="Batteriet urladdas aldrig under denna nivå" type="number" min="5" max="50" value={s.optimizer.minSocPercent} onChange={num('optimizer', 'minSocPercent')} />
          <Field label="Högsta SOC (%)" type="number" min="50" max="100" value={s.optimizer.maxSocPercent} onChange={num('optimizer', 'maxSocPercent')} />
          <Field label="Intervall (minuter)" type="number" min="5" max="60" value={s.optimizer.intervalMinutes} onChange={num('optimizer', 'intervalMinutes')} />
        </div>
        <label className="flex items-center gap-3 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={s.optimizer.dryRun}
            onChange={(e) => set('optimizer', 'dryRun', e.target.checked)}
            className="w-4 h-4 accent-amber-400"
          />
          <span className="text-sm">
            <strong>Torrkörning</strong> — logga beslut men styr inte växelriktaren (rekommenderas tills du
            verifierat besluten)
          </span>
        </label>
      </div>

      <div className="card">
        <h2 className="font-bold mb-4">Byt lösenord</h2>
        <ChangePassword />
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={busy}>Spara inställningar</button>
        {msg && <span className="text-sm text-slate-300">{msg}</span>}
      </div>
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const change = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMsg('✓ Lösenordet är bytt');
      setCurrent('');
      setNext('');
    } catch (e) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid sm:grid-cols-2 gap-4 items-end">
      <Field label="Nuvarande lösenord" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Field label="Nytt lösenord (minst 8 tecken)" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
      <div className="flex items-center gap-3">
        <button className="btn-ghost" onClick={change} disabled={busy || !next}>Byt lösenord</button>
        {msg && <span className="text-sm text-slate-300">{msg}</span>}
      </div>
    </div>
  );
}
