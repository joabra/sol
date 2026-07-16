// Tibber GraphQL API — riktiga priser (inkl. ditt påslag), förbrukning, kostnad, produktion.
// Token skapas på https://developer.tibber.com/settings/access-token
import { loadSettings } from './config.js';

const GQL_URL = 'https://api.tibber.com/v1-beta/gql';
let cache = { data: null, at: 0 };

async function gql(query) {
  const token = loadSettings().tibber?.token;
  if (!token) throw new Error('NOT_CONFIGURED');
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Tibber: ${json.errors[0].message}`);
  return json.data;
}

export function isConfigured() {
  return Boolean(loadSettings().tibber?.token);
}

export async function test() {
  const data = await gql(`{ viewer { name homes { id appNickname address { address1 city } } } }`);
  return {
    name: data.viewer.name,
    homes: data.viewer.homes.map((h) => ({
      id: h.id,
      label: h.appNickname || [h.address?.address1, h.address?.city].filter(Boolean).join(', '),
    })),
  };
}

const PRICE_FIELDS = 'total energy tax startsAt';

export async function getOverview() {
  if (cache.data && Date.now() - cache.at < 5 * 60 * 1000) return cache.data;

  const data = await gql(`{
    viewer {
      homes {
        id
        appNickname
        currentSubscription {
          priceInfo {
            current { ${PRICE_FIELDS} }
            today { ${PRICE_FIELDS} }
            tomorrow { ${PRICE_FIELDS} }
          }
        }
        hourly: consumption(resolution: HOURLY, last: 48) {
          nodes { from to consumption cost unitPrice }
        }
        daily: consumption(resolution: DAILY, last: 30) {
          nodes { from consumption cost }
        }
        production(resolution: DAILY, last: 30) {
          nodes { from production profit }
        }
      }
    }
  }`);

  const home = data.viewer.homes.find((h) => h.currentSubscription?.priceInfo) || data.viewer.homes[0];
  if (!home) throw new Error('Tibber: inget hem hittades på kontot');

  const pi = home.currentSubscription?.priceInfo || {};
  const prodNodes = home.production?.nodes?.filter((n) => n.production != null) || [];
  const dailyNodes = home.daily?.nodes?.filter((n) => n.consumption != null) || [];

  const days = dailyNodes.map((d) => {
    const prod = prodNodes.find((p) => p.from === d.from);
    return {
      date: d.from.slice(0, 10),
      consumptionKwh: round1(d.consumption),
      costSek: round1(d.cost),
      productionKwh: prod ? round1(prod.production) : null,
      profitSek: prod ? round1(prod.profit) : null,
    };
  });

  const todayCost = round1(
    (home.hourly?.nodes || [])
      .filter((n) => n.cost != null && n.from.slice(0, 10) === new Date().toISOString().slice(0, 10))
      .reduce((a, n) => a + n.cost, 0)
  );

  const result = {
    home: home.appNickname || home.id,
    current: pi.current || null, // { total, energy, tax, startsAt } — ditt riktiga pris inkl. påslag & moms
    today: pi.today || [],
    tomorrow: pi.tomorrow || [],
    todayCostSek: todayCost,
    days,
  };
  cache = { data: result, at: Date.now() };
  return result;
}

export function clearCache() {
  cache = { data: null, at: 0 };
}

const round1 = (v) => (v == null ? null : Math.round(v * 100) / 100);
