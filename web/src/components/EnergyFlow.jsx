import { fmtW } from '../hooks.js';

// Energiflödesdiagram: animerade partiklar längs böjda banor mellan Sol/Batteri/Hus/Nät.
// Teckenkonventioner från API:t: batteryPowerW + = laddar, gridPowerW + = import.
const ACTIVE_W = 25; // under detta ses flödet som 0

export default function EnergyFlow({ rt }) {
  if (!rt) return null;
  const pv = rt.pvPowerW ?? 0;
  const load = rt.loadPowerW ?? 0;
  const batt = rt.batteryPowerW ?? 0;
  const grid = rt.gridPowerW ?? 0;
  const soc = rt.batterySocPct;

  const HUB = { x: 230, y: 150 };
  const nodes = {
    sun: { x: 80, y: 60, color: '#fbbf24', label: 'Sol', icon: SunIcon },
    batt: { x: 80, y: 240, color: '#34d399', label: 'Batteri', icon: BattIcon },
    home: { x: 230, y: 150, color: '#38bdf8', label: 'Hus', icon: HomeIcon },
    grid: { x: 380, y: 150, color: '#a78bfa', label: 'Elnät', icon: GridIcon },
  };

  // Böjd bana mellan nod och hubben (huset)
  const path = (n) => {
    const a = nodes[n];
    const mx = (a.x + HUB.x) / 2;
    const my = (a.y + HUB.y) / 2;
    const bend = n === 'grid' ? 0 : (a.y < HUB.y ? 28 : -28);
    return `M ${a.x} ${a.y} Q ${mx + bend} ${my} ${HUB.x} ${HUB.y}`;
  };

  const flows = [
    { id: 'sun', d: path('sun'), watts: pv, toHub: true, color: '#fbbf24' },
    { id: 'batt', d: path('batt'), watts: Math.abs(batt), toHub: batt < 0, color: '#34d399' },
    { id: 'grid', d: path('grid'), watts: Math.abs(grid), toHub: grid > 0, color: '#a78bfa' },
  ];

  const battState = batt > ACTIVE_W ? 'Laddar' : batt < -ACTIVE_W ? 'Urladdar' : 'Vilar';
  const gridState = grid > ACTIVE_W ? 'Import' : grid < -ACTIVE_W ? 'Export' : '—';

  return (
    <svg viewBox="0 0 460 310" className="w-full max-w-lg mx-auto select-none">
      <defs>
        <filter id="ef-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Banor */}
      {flows.map((f) => {
        const active = f.watts > ACTIVE_W;
        return (
          <g key={f.id}>
            <path d={f.d} fill="none" stroke="#1c2942" strokeWidth="4" strokeLinecap="round" />
            {active && (
              <>
                <path d={f.d} fill="none" stroke={f.color} strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
                {[0, 1, 2].map((i) => (
                  <circle key={i} r="3.4" fill={f.color} filter="url(#ef-glow)">
                    <animateMotion
                      dur={`${dur(f.watts)}s`}
                      begin={`${(i * dur(f.watts)) / 3}s`}
                      repeatCount="indefinite"
                      keyPoints={f.toHub ? '0;1' : '1;0'}
                      keyTimes="0;1"
                      path={f.d}
                    />
                  </circle>
                ))}
              </>
            )}
          </g>
        );
      })}

      {/* Flödesetiketter på banorna */}
      <FlowLabel x={148} y={78} watts={pv} color="#fbbf24" />
      <FlowLabel x={148} y={228} watts={Math.abs(batt)} color="#34d399" />
      <FlowLabel x={305} y={136} watts={Math.abs(grid)} color="#a78bfa" />

      {/* Noder */}
      <Node n={nodes.sun} value={fmtW(pv)} active={pv > ACTIVE_W} />
      <Node n={nodes.batt} value={fmtW(Math.abs(batt))} active={Math.abs(batt) > ACTIVE_W} sub={battState} ring={soc} />
      <Node n={nodes.home} value={fmtW(load)} active hub />
      <Node n={nodes.grid} value={fmtW(Math.abs(grid))} active={Math.abs(grid) > ACTIVE_W} sub={gridState} />
    </svg>
  );
}

// Partikelhastighet: snabbare vid högre effekt (2.8s vid ~0 -> 0.9s vid 10kW+)
const dur = (w) => Math.max(0.9, 2.8 - Math.min(w, 10000) / 5000);

function FlowLabel({ x, y, watts, color }) {
  if (watts <= ACTIVE_W) return null;
  return (
    <g>
      <rect x={x - 26} y={y - 9} width="52" height="18" rx="9" fill="#0b1120" stroke="#1c2942" />
      <text x={x} y={y + 3.5} textAnchor="middle" fill={color} fontSize="10" fontWeight="700">
        {fmtW(watts)}
      </text>
    </g>
  );
}

function Node({ n, value, sub, active, ring, hub }) {
  const r = hub ? 42 : 36;
  const Icon = n.icon;
  return (
    <g opacity={active ? 1 : 0.55}>
      {active && <circle cx={n.x} cy={n.y} r={r} fill={n.color} opacity="0.12" filter="url(#ef-glow)" />}
      <circle cx={n.x} cy={n.y} r={r} fill="#0f172a" stroke={active ? n.color : '#2a3a5c'} strokeWidth="2" />
      {/* SOC-ring för batteriet */}
      {ring != null && <SocRing x={n.x} y={n.y} r={r + 5} pct={ring} color={n.color} />}
      <Icon x={n.x} y={n.y - 13} color={active ? n.color : '#64748b'} />
      <text x={n.x} y={n.y + 12} textAnchor="middle" fill="#f1f5f9" fontSize="12" fontWeight="800">
        {value}
      </text>
      {ring != null && (
        <text x={n.x} y={n.y + 25} textAnchor="middle" fill={n.color} fontSize="10" fontWeight="700">
          {ring.toFixed(0)} %
        </text>
      )}
      <text x={n.x} y={n.y + r + 16} textAnchor="middle" fill="#94a3b8" fontSize="11" fontWeight="600">
        {n.label}{sub ? ` · ${sub}` : ''}
      </text>
    </g>
  );
}

function SocRing({ x, y, r, pct, color }) {
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <g transform={`rotate(-90 ${x} ${y})`}>
      <circle cx={x} cy={y} r={r} fill="none" stroke="#1c2942" strokeWidth="3" />
      <circle
        cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${filled} ${c - filled}`} opacity="0.9"
      />
    </g>
  );
}

/* Ikoner */
function SunIcon({ x, y, color }) {
  return (
    <g stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round">
      <circle cx={x} cy={y} r="5" fill={color} stroke="none" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const rad = (a * Math.PI) / 180;
        return <line key={a} x1={x + Math.cos(rad) * 8} y1={y + Math.sin(rad) * 8} x2={x + Math.cos(rad) * 11} y2={y + Math.sin(rad) * 11} />;
      })}
    </g>
  );
}
function BattIcon({ x, y, color }) {
  return (
    <g>
      <rect x={x - 8} y={y - 6} width="16" height="12" rx="2" fill="none" stroke={color} strokeWidth="1.8" />
      <rect x={x + 8} y={y - 3} width="3" height="6" rx="1" fill={color} />
      <rect x={x - 5.5} y={y - 3.5} width="7" height="7" rx="1" fill={color} />
    </g>
  );
}
function HomeIcon({ x, y, color }) {
  return (
    <g fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <path d={`M ${x - 9} ${y + 1} L ${x} ${y - 8} L ${x + 9} ${y + 1}`} />
      <path d={`M ${x - 6.5} ${y - 1} V ${y + 7} H ${x + 6.5} V ${y - 1}`} />
    </g>
  );
}
function GridIcon({ x, y, color }) {
  return (
    <g fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${x - 7} ${y + 8} L ${x - 2} ${y - 8} H ${x + 2} L ${x + 7} ${y + 8}`} />
      <line x1={x - 5} y1={y + 2} x2={x + 5} y2={y + 2} />
      <line x1={x - 3.5} y1={y - 3} x2={x + 3.5} y2={y - 3} />
    </g>
  );
}
