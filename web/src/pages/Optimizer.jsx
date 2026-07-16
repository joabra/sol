import { useState } from 'react';
import { usePoll, fmtSek } from '../hooks.js';
import { api } from '../api.js';

const ACTION_STYLE = {
  charge: 'text-batt border-batt/40 bg-batt/10',
  discharge: 'text-solar border-solar/40 bg-solar/10',
  idle: 'text-slate-400 border-edge bg-panel',
};
const ACTION_LABEL = { charge: 'LADDA', discharge: 'EXPORTERA', idle: 'SJÄLVKONSUMTION' };

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
            Laddar batteriet när spotpriset är lågt och exporterar/urladdar när det är högt — men bara när
            marginalen täcker batterislitaget. Beslut fattas var {status?.optimizer ? '15:e' : '…'} minut baserat
            på dagens prisprofil (P25/P75-trösklar).
          </p>

          {last ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold px-3 py-1.5 rounded-full border ${ACTION_STYLE[last.action]}`}>
                  {ACTION_LABEL[last.action] || last.action}
                </span>
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
                    <td className="py-2 text-slate-400 text-xs">{e.error || e.reason}</td>
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
