import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';

export default function TibberCard({ tibber }) {
  if (!tibber) return null;
  if (tibber.error) {
    return (
      <div className="card">
        <h2 className="font-bold mb-2">Tibber</h2>
        <p className="text-sm text-slate-500">
          {tibber.error === 'NOT_CONFIGURED'
            ? 'Lägg in din Tibber-token under Inställningar för riktiga priser, förbrukning och kostnad.'
            : `Fel: ${tibber.error}`}
        </p>
      </div>
    );
  }

  const data = (tibber.days || []).map((d) => ({
    label: d.date.slice(5),
    kwh: d.consumptionKwh,
    cost: d.costSek,
    prod: d.productionKwh,
  }));

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h2 className="font-bold">Tibber — förbrukning & kostnad</h2>
        <div className="flex gap-4 text-sm">
          {tibber.current && (
            <span>
              Ditt elpris nu:{' '}
              <strong className="text-grid">{(tibber.current.total * 100).toFixed(0)} öre/kWh</strong>
            </span>
          )}
          {tibber.todayCostSek != null && (
            <span>
              Kostnad idag: <strong className="text-loadc">{tibber.todayCostSek.toFixed(0)} kr</strong>
            </span>
          )}
        </div>
      </div>
      {data.length ? (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ top: 5, right: -10, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="#22304f" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} interval={2} />
            <YAxis yAxisId="kwh" tick={{ fill: '#64748b', fontSize: 10 }} unit=" kWh" />
            <YAxis yAxisId="sek" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} unit=" kr" />
            <Tooltip
              contentStyle={{ background: '#131a2e', border: '1px solid #22304f', borderRadius: 12, fontSize: 12 }}
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="kwh" dataKey="kwh" name="Köpt el (kWh)" fill="#f472b6" radius={[3, 3, 0, 0]} />
            {data.some((d) => d.prod != null) && (
              <Bar yAxisId="kwh" dataKey="prod" name="Såld el (kWh)" fill="#fbbf24" radius={[3, 3, 0, 0]} />
            )}
            <Line yAxisId="sek" dataKey="cost" name="Kostnad (kr)" stroke="#818cf8" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-sm text-slate-500 py-8 text-center">Ingen förbrukningsdata ännu.</p>
      )}
    </div>
  );
}
