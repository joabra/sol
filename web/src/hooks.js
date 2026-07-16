import { useEffect, useState } from 'react';

export function usePoll(fetcher, intervalMs) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetcher()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e.message));
    tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return { data, error };
}

export const fmtW = (w) =>
  w == null ? '—' : Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;

export const fmtKwh = (wh) => (wh == null ? '—' : `${(wh / 1000).toFixed(1)} kWh`);

export const fmtSek = (v) => (v == null ? '—' : `${v.toFixed(2)} kr`);
