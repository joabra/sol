# ☀ Solvakt

Självhostad dashboard för Sungrow-solceller med spotprisstyrd export-optimering — som CheckWatt, fast du äger logiken själv.

## Funktioner

- **Live-dashboard** — solproduktion, förbrukning, batteri-SOC, import/export med animerat energiflödesdiagram
- **Spotpriser** — dagens & morgondagens priser (15-min upplösning) för SE1–SE4 via elprisetjustnu.se, med ditt verkliga köp- och säljpris
- **Historik** — produktion/export/import senaste 30 dagarna
- **Export-optimering** — laddar batteriet billiga timmar, exporterar dyra timmar. Percentilbaserade trösklar (P25/P75), batterislitage och arbitragemarginal vägs in. Torrkörningsläge så du kan granska besluten innan de skickas skarpt.
- **Tibber-integration** — ditt riktiga elpris (inkl. påslag & moms), timförbrukning, kostnad och såld produktion via Tibbers GraphQL-API
- **Lokal Modbus-styrning (WiNet-S)** — valfri direktstyrning över hemnätverket (~50 ms, internetoberoende); moln-API:t används för visualisering
- **Manuell styrning** — tvinga ladda/urladda/stoppa direkt från webben
- **Inställningar via webben** — API-nycklar, elområde, nätnytta, skatter, optimeringsparametrar
- **Lösenordsskydd** — första besöket väljer du ett lösenord; sessioner varar 30 dagar, byt lösenord under Inställningar
- **Demo-läge** — allt fungerar med simulerad data tills du anslutit Sungrow

## Kom igång

```bash
npm install          # installerar även web/
npm run build:web    # bygger frontend
npm start            # http://localhost:3000
```

Utveckling med hot-reload: `npm start` i en terminal + `cd web && npm run dev` i en annan (Vite proxar /api).

## Anslut din Sungrow-anläggning

1. Skapa utvecklarkonto på [developer-api.isolarcloud.com](https://developer-api.isolarcloud.com) → du får **AppKey** och **Secret Key**.
2. Gå till **Inställningar** i Solvakt, fyll i AppKey, Secret Key samt ditt iSolarCloud-användarnamn/lösenord (EU-gateway `gateway.isolarcloud.eu` är förvald).
3. Klicka **Testa anslutning**.
4. För styrning (paramSetting) kan skrivbehörighet behöva begäras från Sungrows utvecklarsupport.

Uppgifterna sparas lokalt i `data/settings.json` — dela aldrig den filen.

## Anslut Tibber (valfritt)

Skapa en access-token på [developer.tibber.com/settings/access-token](https://developer.tibber.com/settings/access-token) och klistra in under **Inställningar → Tibber**. Då används ditt riktiga elpris i optimeringen och förbrukning/kostnad visas på dashboarden.

## Lokal Modbus via WiNet-S (valfritt, rekommenderas för styrning)

Ange WiNet-S-donglens IP under **Inställningar → Lokal styrning**. Styrkommandon går då direkt över hemnätverket (register 13049–13051: EMS-läge, kommando 0xAA/0xBB/0xCC, effekt). Kräver aktuell WiNet-S-firmware. Ge dongeln statisk IP i routern.

## Så fungerar optimeringen

Ekonomi (Sverige, 2026 — 60-öres skattereduktionen är borttagen):

```
köppris  = (spot + påslag) × 1,25 moms + elöverföring + energiskatt   ≈ spot + ~0,9 kr
säljpris = spot + nätnytta (~0,20 kr/kWh, varierar per nätbolag)
```

Beslut var 15:e minut:

| Villkor | Åtgärd |
|---|---|
| Spot ≤ P25 **och** dyrare period senare täcker cykelkostnad + marginal | Ladda batteriet |
| Spot ≥ P75 **och** SOC > golv **och** marginal > batterislitage | Urladda/exportera |
| Annars | Självkonsumtion (växelriktarens standardläge) |

Batterislitaget (standard 0,90 kr/kWh = batterikostnad / (cykler × kapacitet)) gör att batteriet aldrig cyklas med förlust.

**Starta alltid i torrkörningsläge** och granska beslutsloggen några dagar innan du stänger av det.

## Arkitektur

```
server/               Node/Express-backend
  lib/sungrow.js      iSolarCloud OpenAPI-klient (login, realtid, historik, paramSetting)
  lib/tibber.js       Tibber GraphQL-klient (priser, förbrukning, kostnad, produktion)
  lib/modbus.js       Lokal Modbus TCP-styrning via WiNet-S
  lib/control.js      Väljer styrväg: Modbus om konfigurerad, annars moln
  lib/prices.js       Spotpriser från elprisetjustnu.se (cache)
  lib/optimizer.js    Beslutslogik + schemaläggare + logg
  lib/mock.js         Simulerad data för demo-läge
  lib/config.js       Inställningar (data/settings.json)
web/                  React + Vite + Tailwind + Recharts
data/                 Inställningar & beslutslogg (skapas vid körning)
```

## Bra att veta

- **Styrning via molnet** har 5–30 s latens. För snabbare/robustare styrning kan lokal Modbus TCP via WiNet-S-dongeln användas (register 13049–13051) — se t.ex. `mkaiser/Sungrow-SHx-Inverter-Modbus-Home-Assistant`.
- Morgondagens spotpriser publiceras ~13:00.
- paramSetting-kommandon har 30 min utgångstid (`expire_second`) som säkerhetsnät.

## Driftsättning (deployment)

**Solvakt är byggd för att köras hemma**, på samma nätverk som växelriktaren — t.ex. på en Raspberry Pi, NAS eller alltid-på-dator. Serverlösa plattformar som **Vercel/Netlify fungerar inte**: appen kräver en långkörande process (optimizern), beständig disk (`data/`) och åtkomst till hemnätverket (Modbus).

### Nå sidan utifrån — rekommenderade sätt

**Tailscale (enklast, privat):**
1. Installera [Tailscale](https://tailscale.com) på servern och din mobil/dator
2. Öppna `http://<tailscale-ip>:3000` — klart. Ingenting exponeras publikt.

**Cloudflare Tunnel (publik HTTPS-adress):**
```bash
brew install cloudflared        # eller apt install cloudflared
cloudflared tunnel login
cloudflared tunnel create solvakt
cloudflared tunnel route dns solvakt solvakt.dindomän.se
cloudflared tunnel run --url http://localhost:3000 solvakt
```
Ger `https://solvakt.dindomän.se` utan portöppning i routern. Lösenordsskyddet i appen krävs fortfarande för inloggning.

### Autostart (macOS-exempel med launchd)
```bash
npm install && npm run build:web
# skapa ~/Library/LaunchAgents/se.solvakt.plist som kör: node server/index.js
```
På Linux: skapa en systemd-tjänst med `ExecStart=node server/index.js` och `Restart=always`.
