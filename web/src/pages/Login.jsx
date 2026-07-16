import { useState } from 'react';

export default function Login({ setup, onSuccess }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (setup && password !== confirm) {
      setError('Lösenorden matchar inte');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-solar to-amber-600 flex items-center justify-center text-night text-xl font-extrabold">
            ☀
          </div>
          <div>
            <h1 className="text-lg font-extrabold">Solvakt</h1>
            <p className="text-xs text-slate-400">
              {setup ? 'Välj ett lösenord för att skydda sidan' : 'Logga in'}
            </p>
          </div>
        </div>

        <input
          className="input"
          type="password"
          placeholder={setup ? 'Nytt lösenord (minst 8 tecken)' : 'Lösenord'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {setup && (
          <input
            className="input"
            type="password"
            placeholder="Upprepa lösenordet"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button className="btn-primary w-full" disabled={busy || !password}>
          {setup ? 'Sätt lösenord' : 'Logga in'}
        </button>
      </form>
    </div>
  );
}
