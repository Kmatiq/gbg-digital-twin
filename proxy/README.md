# Mellanserver för live-trafik (etapp 3)

`worker.js` är en liten Cloudflare Worker. Den håller API-nycklarna för Västtrafik och Trafikverket, så att de aldrig hamnar i appen eller i repot. Den släpper bara igenom läsanrop till utvalda delar av API:erna.

## Installera (cirka 5 minuter, gratis)

1. Logga in på dash.cloudflare.com.
2. Välj **Compute (Workers) → Workers & Pages → Create → Start with Hello World**. Döp den till `gbg-twin-proxy` och välj **Deploy**.
3. Välj **Edit code**, ersätt allt med innehållet i `worker.js` och välj **Deploy**.
4. Gå till **Settings → Variables and Secrets** och lägg till tre hemligheter av typen **Secret**:
   - `VT_ID`: klient-id från Västtrafiks utvecklarportal
   - `VT_SECRET`: hemligheten från Västtrafiks utvecklarportal
   - `TV_KEY`: nyckeln från Trafikverkets API-portal
5. Öppna adressen `https://gbg-twin-proxy.<ditt-konto>.workers.dev/`. Den ska visa `"vasttrafik":true,"trafikverket":true`.

Adressen till workern är inte hemlig. Den läggs in i appen.

## Vad som släpps igenom

- `GET /vt/v4/...` går till Västtrafik Planera Resa v4.
- `POST /tv` tar Trafikverket-frågor av typerna TrafficFlow, Situation, TravelTimeRoute, WeatherMeasurepoint, RoadCondition och Camera.
- Svar mellanlagras 10–30 sekunder så att gratisnivån räcker (100 000 anrop per dygn).
