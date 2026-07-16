// Väderkort: solprognos kommande dagar (Open-Meteo)
const icon = (cloudPct, precipMm) => (precipMm > 0.4 ? '🌧' : cloudPct > 75 ? '☁️' : cloudPct > 35 ? '⛅' : '☀️');

export default function WeatherCard({ weather }) {
  if (!weather?.daily?.length) return null;

  const dayName = (d) => {
    const today = new Date().toISOString().slice(0, 10);
    if (d === today) return 'Idag';
    return new Date(d).toLocaleDateString('sv-SE', { weekday: 'long' });
  };

  // Genomsnittligt regn + molnighet per dag från timserien
  const byDay = {};
  for (const h of weather.hours || []) {
    const d = h.time.slice(0, 10);
    (byDay[d] ||= { precip: 0 }).precip += h.precipMm || 0;
  }

  return (
    <div className="card">
      <h2 className="font-bold mb-3">
        Solprognos <span className="text-xs font-normal text-slate-500">— används av AI:n för köp/sälj-beslut</span>
      </h2>
      <div className="grid grid-cols-3 gap-4">
        {weather.daily.slice(0, 3).map((d) => (
          <div key={d.date} className="text-center rounded-xl bg-slate-800/40 py-3">
            <p className="text-xs text-slate-400 capitalize">{dayName(d.date)}</p>
            <p className="text-3xl my-1">{icon(d.avgCloudPct, (byDay[d.date]?.precip || 0) / 8)}</p>
            <p className="text-sm font-bold text-solar">{(d.radiationWhm2 / 1000).toFixed(1)} kWh/m²</p>
            <p className="text-xs text-slate-500">moln {d.avgCloudPct} %</p>
          </div>
        ))}
      </div>
    </div>
  );
}
