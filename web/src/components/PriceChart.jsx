import {
  ResponsiveContainer, ComposedChart, Area, XAxis, YAxis, Tooltip,
  ReferenceLine, CartesianGrid,
} from 'recharts';

export default function PriceChart({ prices }) {
  if (!prices?.today?.length) return <p className="text-sm text-slate-500 py-10 text-center">Laddar priser…</p>;

  const all = [...prices.today, ...(prices.tomorrow || [])];
  const data = all.map((p) => ({
    time: p.start,
    label: new Date(p.start).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }),
    ore: Math.round(p.sekPerKwh * 100),
  }));
  const nowIdx = data.findIndex((d) => Date.parse(d.time) > Date.now()) - 1;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#818cf8" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#818cf8" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#22304f" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} interval={Math.floor(data.length / 8)} />
        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit=" öre" />
        <Tooltip
          contentStyle={{ background: '#131a2e', border: '1px solid #22304f', borderRadius: 12, fontSize: 12 }}
          formatter={(v) => [`${v} öre/kWh`, 'Spotpris']}
        />
        {nowIdx >= 0 && (
          <ReferenceLine x={data[nowIdx].label} stroke="#fbbf24" strokeWidth={2} label={{ value: 'Nu', fill: '#fbbf24', fontSize: 11, position: 'top' }} />
        )}
        <Area type="stepAfter" dataKey="ore" stroke="#818cf8" strokeWidth={2} fill="url(#priceGrad)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
