import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import Optimizer from './pages/Optimizer.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import { usePoll } from './hooks.js';
import { api } from './api.js';

const TABS = [
  { id: 'dashboard', label: 'Översikt', icon: '☀️' },
  { id: 'optimizer', label: 'Optimering', icon: '⚡' },
  { id: 'settings', label: 'Inställningar', icon: '⚙️' },
];

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [authState, setAuthState] = useState(null); // null=laddar, {setup, authenticated}

  const checkAuth = () =>
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then(setAuthState)
      .catch(() => setAuthState({ setup: false, authenticated: false }));

  useEffect(() => {
    checkAuth();
  }, []);

  if (!authState) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Laddar…</div>;
  }
  if (!authState.authenticated) {
    return <Login setup={authState.setup} onSuccess={checkAuth} />;
  }

  return <MainApp tab={tab} setTab={setTab} onLogout={checkAuth} needsSetup={authState.setup} />;
}

function MainApp({ tab, setTab, onLogout, needsSetup }) {
  const { data: status } = usePoll(api.status, 15000);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    onLogout();
  };

  return (
    <div className="min-h-screen max-w-7xl mx-auto px-4 pb-16">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-solar to-amber-600 flex items-center justify-center text-night text-xl font-extrabold shadow-lg shadow-solar/20">
            ☀
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Solvakt</h1>
            <p className="text-xs text-slate-400 -mt-0.5">Solenergi · Spotpris · Export-optimering</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {status?.mock && (
            <span className="text-xs px-3 py-1 rounded-full border border-amber-500/40 text-amber-300 bg-amber-500/10">
              Demo-läge — anslut Sungrow i Inställningar
            </span>
          )}
          {status?.optimizer?.running && (
            <span className="text-xs px-3 py-1 rounded-full border border-batt/40 text-batt bg-batt/10 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-batt animate-pulse" />
              Optimering aktiv
            </span>
          )}
          {!needsSetup && (
            <button onClick={logout} className="text-xs text-slate-500 hover:text-slate-300 transition-colors" title="Logga ut">
              Logga ut
            </button>
          )}
        </div>
      </header>

      <nav className="flex gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              tab === t.id
                ? 'bg-solar text-night shadow-lg shadow-solar/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-panel'
            }`}
          >
            <span className="mr-1.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'dashboard' && <Dashboard />}
      {tab === 'optimizer' && <Optimizer />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}
