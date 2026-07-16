import { usePoll, fmtW, fmtKwh } from '../hooks.js';
import { api } from '../api.js';
import EnergyFlow from '../components/EnergyFlow.jsx';
import PriceChart from '../components/PriceChart.jsx';
import HistoryChart from '../components/HistoryChart.jsx';
import TibberCard from '../components/TibberCard.jsx';

function Stat({ label, value, sub, color }) {
  return (
    <div className="card">
      <p className="stat-label">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 ${color || 'text-slate-100'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { data: rt, error } = usePoll(api.realtime, 10000);
  const { data: prices } = usePoll(api.prices, 60000);
  const { data: history } = usePoll(api.history, 300000);
  const { data: tibber } = usePoll(api.tibber, 300000);

  const selfUse =
    rt?.pvTodayWh > 0 ? Math.max(0, 100 - ((rt.exportTodayWh || 0) / rt.pvTodayWh) * 100) : null;

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500/40 text-red-300 text-sm">Kunde inte hämta data: {error}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Solproduktion nu" value={fmtW(rt?.pvPowerW)} color="text-solar" sub={`Idag: ${fmtKwh(rt?.pvTodayWh)}`} />
        <Stat label="Förbrukning nu" value={fmtW(rt?.loadPowerW)} color="text-loadc" sub={selfUse != null ? `Egenanvändning: ${selfUse.toFixed(0)} %` : null} />
        <Stat
          label={rt?.gridPowerW > 0 ? 'Import från nät' : 'Export till nät'}
          value={fmtW(Math.abs(rt?.gridPowerW ?? 0))}
          color="text-grid"
          sub={`Export idag: ${fmtKwh(rt?.exportTodayWh)} · Import: ${fmtKwh(rt?.importTodayWh)}`}
        />
        <Stat
          label="Batteri"
          value={rt?.batterySocPct != null ? `${rt.batterySocPct.toFixed(0)} %` : '—'}
          color="text-batt"
          sub={rt?.batteryPowerW != null ? (rt.batteryPowerW > 50 ? `Laddar ${fmtW(rt.batteryPowerW)}` : rt.batteryPowerW < -50 ? `Urladdar ${fmtW(-rt.batteryPowerW)}` : 'Vilar') : null}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-bold mb-2">Energiflöde just nu</h2>
          <EnergyFlow rt={rt} />
        </div>
        <div className="card">
          <h2 className="font-bold mb-2">
            Spotpris {prices?.zone}{' '}
            <span className="text-xs font-normal text-slate-400">
              {prices?.current ? `· nu ${(prices.current.sekPerKwh * 100).toFixed(0)} öre/kWh` : ''}
            </span>
          </h2>
          <PriceChart prices={prices} />
        </div>
      </div>

      <TibberCard tibber={tibber} />

      <div className="card">
        <h2 className="font-bold mb-2">Produktion & förbrukning — senaste 30 dagarna</h2>
        <HistoryChart history={history} />
      </div>
    </div>
  );
}
