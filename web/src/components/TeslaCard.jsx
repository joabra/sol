import { usePoll } from '../hooks.js';
import { api } from '../api.js';

const fmtT = (iso) => new Date(iso).toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export default function TeslaCard() {
  const { data } = usePoll(api.ev, 5 * 60000);
  if (!data?.plan) return null;

  const { plan, configured } = data;
  const car = plan.car;

  return (
    <div className="card">
      <h2 className="font-bold mb-3 flex items-center gap-2">🚗 Elbil</h2>

      {configured && car && !car.asleep ? (
        <div className="mb-3">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-slate-400">{car.name}</span>
            <span className="font-bold">{car.socPct} %</span>
          </div>
          <div className="h-2 bg-panel rounded-full overflow-hidden">
            <div className="h-full bg-red-500 rounded-full" style={{ width: `${car.socPct}%` }} />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {car.charging
              ? `Laddar nu (${car.chargePowerKw} kW) · klar om ${Math.round(car.minutesToFull / 60)} h`
              : car.pluggedIn
                ? 'Inkopplad, laddar inte'
                : `Räckvidd ~${car.rangeKm} km`}
          </p>
        </div>
      ) : configured && car?.asleep ? (
        <p className="text-xs text-slate-500 mb-3">Bilen sover — status hämtas när den vaknar 😴</p>
      ) : null}

      <div className="rounded-xl bg-panel border border-edge p-3">
        <p className="stat-label mb-1">Billigaste laddfönster</p>
        <p className="font-bold text-batt">
          {fmtT(plan.window.from)} – {new Date(plan.window.to).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {plan.hoursNeeded} h à {plan.window.avgBuySek} kr/kWh · ~{plan.neededKwh} kWh
          {plan.assumedSoc && ' (antar 30 % SOC)'}
        </p>
        {plan.savingSek > 5 && (
          <p className="text-xs text-batt mt-1">Sparar ~{plan.savingSek} kr jämfört med att ladda nu</p>
        )}
      </div>
      <p className="text-xs text-slate-600 mt-2">
        Ställ in schemalagd laddning i Tesla-appen till fönstret ovan.
      </p>
    </div>
  );
}
