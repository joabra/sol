import { usePoll, fmtSek } from '../hooks.js';
import { api } from '../api.js';

const fmtDate = (d) =>
  new Date(d + 'T00:00').toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });

export default function Report() {
  const { data: report } = usePoll(api.report, 60000);

  const days = report?.days || [];
  const monthly = report?.monthly || [];
  const totalNet = monthly.reduce((s, m) => s + m.netSek, 0);
  const curMonth = new Date().toISOString().slice(0, 7);
  const peaks = report?.peaks?.[curMonth] || {};
  const peakList = Object.entries(peaks).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const maxAbs = Math.max(...days.slice(0, 30).map((d) => Math.abs(d.netSek)), 0.1);

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card">
          <p className="stat-label">Totalt netto (batteristyrning)</p>
          <p className={`text-3xl font-extrabold ${totalNet >= 0 ? 'text-batt' : 'text-red-400'}`}>
            {totalNet >= 0 ? '+' : ''}{totalNet.toFixed(2)} kr
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Urladdningsvärde − laddkostnad − batterislitage, sedan loggningen startade
          </p>
        </div>
        <div className="card">
          <p className="stat-label">Denna månad</p>
          <p className="text-3xl font-extrabold">
            {monthly[0]?.month === curMonth ? `${monthly[0].netSek >= 0 ? '+' : ''}${monthly[0].netSek.toFixed(2)} kr` : '—'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {monthly[0]?.month === curMonth ? `${monthly[0].cycles} batticykler · ${monthly[0].dischargeKwh} kWh urladdat` : 'ingen data ännu'}
          </p>
        </div>
        <div className="card">
          <p className="stat-label">Månadens effekttoppar (import)</p>
          {peakList.length ? (
            <div className="space-y-1 mt-1">
              {peakList.map(([hour, w]) => (
                <p key={hour} className="text-sm">
                  <span className="font-bold text-grid">{(w / 1000).toFixed(1)} kW</span>{' '}
                  <span className="text-slate-500 text-xs">
                    {new Date(hour + ':00').toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit' })}
                  </span>
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 mt-1">Inga toppar loggade ännu</p>
          )}
          <p className="text-xs text-slate-500 mt-2">Underlag för effektavgiften — aktivera toppkapning i Inställningar</p>
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold mb-1">Nettoresultat per dag</h2>
        <p className="text-xs text-slate-500 mb-4">
          Vad batteristyrningen tjänat/kostat per dag: värdet av urladdning (ersatt import + export) minus
          laddkostnad och slitage.
        </p>
        {days.length ? (
          <div className="flex items-end gap-1 h-32">
            {days.slice(0, 30).reverse().map((d) => (
              <div key={d.date} className="flex-1 flex flex-col justify-end h-full" title={`${d.date}: ${d.netSek} kr`}>
                <div
                  className={`rounded-t-sm ${d.netSek >= 0 ? 'bg-batt' : 'bg-red-500/70'}`}
                  style={{ height: `${Math.max(4, (Math.abs(d.netSek) / maxAbs) * 100)}%` }}
                />
                <p className="text-[9px] text-slate-600 text-center mt-1">{d.date.slice(8)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Ingen data ännu — liggaren fylls på varje gång optimeringen kör.</p>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-bold mb-3">Per månad</h2>
          {monthly.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase tracking-wide">
                  <th className="py-2 pr-4">Månad</th>
                  <th className="py-2 pr-4">Netto</th>
                  <th className="py-2 pr-4">Cykler</th>
                  <th className="py-2">Urladdat</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.month} className="border-t border-edge/50">
                    <td className="py-2 pr-4">{m.month}</td>
                    <td className={`py-2 pr-4 font-bold ${m.netSek >= 0 ? 'text-batt' : 'text-red-400'}`}>
                      {m.netSek >= 0 ? '+' : ''}{m.netSek.toFixed(2)} kr
                    </td>
                    <td className="py-2 pr-4">{m.cycles}</td>
                    <td className="py-2">{m.dischargeKwh} kWh</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-500">Ingen data ännu.</p>
          )}
        </div>

        <div className="card">
          <h2 className="font-bold mb-3">Senaste dagarna</h2>
          {days.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase tracking-wide">
                  <th className="py-2 pr-4">Dag</th>
                  <th className="py-2 pr-4">Laddat</th>
                  <th className="py-2 pr-4">Urladdat</th>
                  <th className="py-2">Netto</th>
                </tr>
              </thead>
              <tbody>
                {days.slice(0, 10).map((d) => (
                  <tr key={d.date} className="border-t border-edge/50">
                    <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(d.date)}</td>
                    <td className="py-2 pr-4">{d.chargeKwh} kWh</td>
                    <td className="py-2 pr-4">{d.dischargeKwh} kWh</td>
                    <td className={`py-2 font-bold ${d.netSek >= 0 ? 'text-batt' : 'text-red-400'}`}>
                      {d.netSek >= 0 ? '+' : ''}{d.netSek.toFixed(2)} kr
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-500">Ingen data ännu.</p>
          )}
        </div>
      </div>
    </div>
  );
}
