import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';

export default function HistoryChart({ history }) {
  const days = history?.days;
  if (!days?.length) {
    return (
      <p className="text-sm text-slate-500 py-10 text-center">
        {history ? 'Historikdata visas när Sungrow-API:t är anslutet.' : 'Laddar historik…'}
      </p>
    );
  }

  const data = days.map((d) => ({
    ...d,
    label: d.date.slice(5),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
        <CartesianGrid stroke="#22304f" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} interval={2} />
        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit=" kWh" />
        <Tooltip
          contentStyle={{ background: '#131a2e', border: '1px solid #22304f', borderRadius: 12, fontSize: 12 }}
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="pvKwh" name="Produktion" fill="#fbbf24" radius={[3, 3, 0, 0]} />
        <Bar dataKey="exportKwh" name="Export" fill="#818cf8" radius={[3, 3, 0, 0]} />
        <Bar dataKey="importKwh" name="Import" fill="#f472b6" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
