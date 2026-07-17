import { useState } from 'react';
import { usePoll, fmtSek } from '../hooks.js';
import { api } from '../api.js';

function AiAdvisor() {
  const { data: ai, refetch } = usePoll(api.ai, 60000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const analyze = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.aiAnalyze();
      refetch?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (ai && !ai.configured) return null; // ingen Ollama konfigurerad -> göm kortet

  const last = ai?.last;
  return (
    <div className="card border border-violet-500/20">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold flex items-center gap-2">
          <span className="text-violet-400">✦</span> AI-rådgivare
          {last && <span className="text-xs font-normal text-slate-500">({last.model})</span>}
        </h2>
        <button className="btn-primary" disabled={busy} onClick={analyze}>
          {busy ? 'Analyserar…' : 'Analysera nu'}
        </button>
      </div>
      {busy && (
        <p className="text-sm text-slate-400 animate-pulse">
          AI:n analyserar priser, historik och batteristatus — tar oftast 5–30 sekunder…
        </p>
      )}
      {err && <p className="text-sm text-red-400">Fel: {err}</p>}
      {!busy && last && (
        <div>
          <pre className="text-sm text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">{last.text}</pre>
          <p className="text-xs text-slate-500 mt-3">
            {new Date(last.time).toLocaleString('sv-SE')} · {last.tookSec}s ·
            SOC {last.context?.socPct?.toFixed(0)} % · spot {last.context?.spotNow?.toFixed(2)} kr/kWh
          </p>
        </div>
      )}
      {!busy && !last && !err && (
        <p className="text-sm text-slate-500">
          Klicka på ”Analysera nu” så tar AI:n fram en 24-timmarsplan för köp/sälj baserat på priser,
          din förbrukningshistorik och batteriets status.
        </p>
      )}
    </div>
  );
}

const ACTION_STYLE = {
  charge: 'text-batt border-batt/40 bg-batt/10',
  discharge: 'text-solar border-solar/40 bg-solar/10',
  idle: 'text-slate-400 border-edge bg-panel',
};
const ACTION_LABEL = { charge: 'LADDA', discharge: 'EXPORTERA', idle: 'SJÄLVKONSUMTION' };
const VIA_BADGE = {
  ai: ['✦ AI-beslut', 'text-violet-400'],
  plan: ['◫ Dygnsplan', 'text-sky-400'],
  override: ['⚡ Överstyrning', 'text-amber-400'],
};

const BAR_COLOR = { charge: 'bg-batt', discharge: 'bg-solar', idle: 'bg-slate-700/60' };

function PlanTimeline() {
  const { data: plan, error } = usePoll(api.plan, 5 * 60000);
  if (error || !plan?.schedule?.length) return null;

  const slots = plan.schedule.slice(0, 96); // 24 h
  const maxSpot = Math.max(...slots.map((s) => s.spot), 0.01);
  const nowIdx = slots.findIndex((s, i) => {
    const t0 = Date.parse(s.start);
    const t1 = i + 1 < slots.length ? Date.parse(slots[i + 1].start) : t0 + 900e3;
    return Date.now() >= t0 && Date.now() < t1;
  });

  // Blocksammanfattning
  const blocks = [];
  for (const s of slots) {
    const last = blocks[blocks.length - 1];
    if (last && last.action === s.action) { last.to = s.start; last.n += 1; }
    else blocks.push({ action: s.action, from: s.start, to: s.start, n: 1 });
  }
  const fmtT = (iso) => new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  const active = blocks.filter((b) => b.action !== 'idle');

  return (
    <div className="card border border-sky-500/20">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-bold flex items-center gap-2">
          <span className="text-sky-400">◫</span> Dygnsplan
          <span className="text-xs font-normal text-slate-500">
            SOC-fönster {plan.minSoc}–{plan.maxSoc} %
          </span>
        </h2>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Optimerat schema för kommande dygn — staplarna visar spotpriset, färgen visar planerad åtgärd.
      </p>

      <div className="flex items-end gap-px h-24 mb-1">
        {slots.map((s, i) => (
          <div
            key={s.start}
            title={`${fmtT(s.start)} · ${ACTION_LABEL[s.action]} · ${(s.spot * 100).toFixed(0)} öre · SOC ${s.socPct} %`}
            className={`flex-1 rounded-t-sm ${BAR_COLOR[s.action]} ${i === nowIdx ? 'ring-2 ring-white/70' : ''}`}
            style={{ height: `${Math.max(6, (s.spot / maxSpot) * 100)}%`, opacity: s.action === 'idle' ? 0.55 : 1 }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-500 mb-4">
        <span>{fmtT(slots[0].start)}</span>
        <span>{fmtT(slots[Math.floor(slots.length / 2)].start)}</span>
        <span>{fmtT(slots[slots.length - 1].start)}</span>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-slate-400"><span className="w-2.5 h-2.5 rounded-sm bg-batt inline-block" /> Ladda</span>
        <span className="flex items-center gap-1.5 text-slate-400"><span className="w-2.5 h-2.5 rounded-sm bg-solar inline-block" /> Urladda</span>
        <span className="flex items-center gap-1.5 text-slate-400"><span className="w-2.5 h-2.5 rounded-sm bg-slate-700/60 inline-block" /> Självkonsumtion</span>
      </div>

      {active.length > 0 && (
        <div className="mt-3 space-y-1">
          {active.slice(0, 6).map((b) => (
            <p key={b.from} className="text-sm text-slate-300">
              <span className={`font-bold ${b.action === 'charge' ? 'text-batt' : 'text-solar'}`}>
                {b.action === 'charge' ? '▲ Ladda' : '▼ Urladda'}
              </span>{' '}
              {fmtT(b.from)}–{fmtT(new Date(Date.parse(b.to) + 900e3).toISOString())}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Optimizer() {
  const { data: opt } = usePoll(api.optimizer, 10000);
  const { data: prices } = usePoll(api.prices, 60000);
  const { data: status } = usePoll(api.status, 10000);
  const [busy, setBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState(null);

  const running = status?.optimizer?.running;
  const last = opt?.lastDecision;

  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setManualMsg(`Fel: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const manual = (cmd) =>
    act(async () => {
      const r = await api.control(cmd);
      setManualMsg(
        r.mock
          ? `${cmd} skickat (demo-läge, ingen riktig växelriktare)`
          : `${cmd} skickat till växelriktaren (${r.powerW} W)`
      );
    });

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold">Automatisk export-optimering</h2>
            <button
              className={running ? 'btn-ghost' : 'btn-primary'}
              disabled={busy}
              onClick={() => act(() => api.optimizerToggle(!running))}
            >
              {running ? 'Stoppa' : 'Starta'}
            </button>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            Styr batteriet enligt vald strategi (dygnsplan, AI eller regler) med automatiska överstyrningar
            för storm, negativa priser och effekttoppar. Beslut fattas var 15:e minut.
          </p>

          {last ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold px-3 py-1.5 rounded-full border ${ACTION_STYLE[last.action]}`}>
                  {ACTION_LABEL[last.action] || last.action}
                </span>
                {VIA_BADGE[last.via] && (
                  <span className={`text-xs font-bold ${VIA_BADGE[last.via][1]}`}>{VIA_BADGE[last.via][0]}</span>
                )}
                {last.dryRun && (
                  <span className="text-xs text-amber-300">torrkörning — styr inte växelriktaren</span>
                )}
                {last.mock && <span className="text-xs text-slate-500">demo-data</span>}
              </div>
              <p className="text-sm text-slate-300">{last.reason}</p>
              <p className="text-xs text-slate-500">
                Spot {(last.spot * 100).toFixed(0)} öre · trösklar {(last.cheapThreshold * 100).toFixed(0)} /{' '}
                {(last.expensiveThreshold * 100).toFixed(0)} öre · SOC {last.socPct?.toFixed(0)} % ·{' '}
                {new Date(last.time).toLocaleTimeString('sv-SE')}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Inga beslut ännu — starta optimeringen eller kör en analys.</p>
          )}

          <div className="mt-4 flex gap-2">
            <button className="btn-ghost" disabled={busy} onClick={() => act(api.optimizerRun)}>
              Kör analys nu
            </button>
          </div>
        </div>

        <div className="card">
          <h2 className="font-bold mb-3">Just nu ({prices?.zone})</h2>
          <div className="space-y-3 text-sm">
            <div>
              <p className="stat-label">Spotpris</p>
              <p className="text-xl font-extrabold text-grid">
                {prices?.current ? `${(prices.current.sekPerKwh * 100).toFixed(0)} öre/kWh` : '—'}
              </p>
            </div>
            <div>
              <p className="stat-label">Ditt köppris (inkl. skatt & avgifter)</p>
              <p className="font-bold">{fmtSek(prices?.currentBuy)}/kWh</p>
            </div>
            <div>
              <p className="stat-label">Ditt säljpris (spot + nätnytta)</p>
              <p className="font-bold text-batt">{fmtSek(prices?.currentSell)}/kWh</p>
            </div>
          </div>

          <h3 className="font-bold mt-5 mb-2 text-sm">Manuell styrning</h3>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost text-batt" disabled={busy} onClick={() => manual('charge')}>Ladda</button>
            <button className="btn-ghost text-solar" disabled={busy} onClick={() => manual('discharge')}>Urladda</button>
            <button className="btn-ghost" disabled={busy} onClick={() => manual('stop')}>Stopp</button>
          </div>
          {manualMsg && <p className="text-xs text-slate-400 mt-2">{manualMsg}</p>}
        </div>
      </div>

      <PlanTimeline />

      <AiAdvisor />

      <div className="card">
        <h2 className="font-bold mb-3">Beslutslogg</h2>
        {opt?.log?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase tracking-wide">
                  <th className="py-2 pr-4">Tid</th>
                  <th className="py-2 pr-4">Beslut</th>
                  <th className="py-2 pr-4">Spot</th>
                  <th className="py-2 pr-4">SOC</th>
                  <th className="py-2">Motivering</th>
                </tr>
              </thead>
              <tbody>
                {opt.log.map((e, i) => (
                  <tr key={i} className="border-t border-edge/50">
                    <td className="py-2 pr-4 text-slate-400 whitespace-nowrap">
                      {e.time ? new Date(e.time).toLocaleString('sv-SE', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="py-2 pr-4">
                      {e.error ? (
                        <span className="text-red-400 text-xs">FEL</span>
                      ) : (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${ACTION_STYLE[e.action] || ''}`}>
                          {ACTION_LABEL[e.action] || e.action}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">{e.spot != null ? `${(e.spot * 100).toFixed(0)} öre` : '—'}</td>
                    <td className="py-2 pr-4">{e.socPct != null ? `${e.socPct.toFixed(0)} %` : '—'}</td>
                    <td className="py-2 text-slate-400 text-xs">{VIA_BADGE[e.via] && <span className={`font-bold ${VIA_BADGE[e.via][1]}`}>{VIA_BADGE[e.via][0].slice(0, 1)} </span>}{e.error || e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Loggen är tom.</p>
        )}
      </div>
    </div>
  );
}
