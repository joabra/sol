import { fmtW } from '../hooks.js';

// Animerat energiflödesdiagram: Sol -> Hus, Batteri <-> Hus, Nät <-> Hus
export default function EnergyFlow({ rt }) {
  if (!rt) return null;
  const pv = rt.pvPowerW ?? 0;
  const load = rt.loadPowerW ?? 0;
  const batt = rt.batteryPowerW ?? 0; // + laddar
  const grid = rt.gridPowerW ?? 0; // + import

  const nodes = {
    sun: { x: 60, y: 50, color: '#fbbf24', label: 'Sol', value: pv, icon: '☀' },
    home: { x: 210, y: 130, color: '#f472b6', label: 'Hus', value: load, icon: '⌂' },
    batt: { x: 60, y: 210, color: '#34d399', label: 'Batteri', value: Math.abs(batt), icon: '▮', sub: rt.batterySocPct != null ? `${rt.batterySocPct.toFixed(0)} %` : null },
    grid: { x: 360, y: 130, color: '#818cf8', label: 'Elnät', value: Math.abs(grid), icon: '⚡' },
  };

  const Line = ({ from, to, active, color, reverse }) => {
    const a = nodes[from], b = nodes[to];
    const [x1, y1, x2, y2] = reverse ? [b.x, b.y, a.x, a.y] : [a.x, a.y, b.x, b.y];
    return (
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={active ? color : '#22304f'}
        strokeWidth={active ? 2.5 : 1.5}
        className={active ? 'flow-line' : ''}
      />
    );
  };

  const Node = ({ n }) => (
    <g>
      <circle cx={n.x} cy={n.y} r="34" fill="#131a2e" stroke={n.color} strokeWidth="2" />
      <text x={n.x} y={n.y - 8} textAnchor="middle" fill={n.color} fontSize="16">{n.icon}</text>
      <text x={n.x} y={n.y + 8} textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="700">
        {fmtW(n.value)}
      </text>
      {n.sub && (
        <text x={n.x} y={n.y + 20} textAnchor="middle" fill="#94a3b8" fontSize="9">{n.sub}</text>
      )}
      <text x={n.x} y={n.y + 50} textAnchor="middle" fill="#94a3b8" fontSize="11" fontWeight="600">
        {n.label}
      </text>
    </g>
  );

  return (
    <svg viewBox="0 0 420 280" className="w-full max-w-md mx-auto">
      <Line from="sun" to="home" active={pv > 50} color="#fbbf24" />
      <Line from="batt" to="home" active={Math.abs(batt) > 50} color="#34d399" reverse={batt > 0} />
      <Line from="home" to="grid" active={Math.abs(grid) > 50} color="#818cf8" reverse={grid > 0} />
      {Object.values(nodes).map((n) => (
        <Node key={n.label} n={n} />
      ))}
    </svg>
  );
}
