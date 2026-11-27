# Datakällor

Verifierat 2026-11-25. Alla källor laddas ner och förprocessas med skripten i `scripts/` till filer i `public/data/`. Webbläsaren gör inga anrop till källorna, så CORS spelar ingen roll i etapp 1.

| Källa | Används till | Format, CRS | Licens | Uppdatering | Åtkomst |
|---|---|---|---|---|---|
| Göteborgs Stad, **baskarta** ([produktbeskrivning](https://opengeodata.goteborg.se/files/baskarta/baskarta_dwg_v2_sv.pdf)) | Takhöjder (takkonturer i 3D), kantsten, spårvagnsspår, perronger, träd (2 136 st), belysningsstolpar | SHP (PolyLineZ/PointZ), EPSG:3007 SWEREF 99 12 00, RH 2000 | CC0 | Dagligen | `https://opengeodata.goteborg.se/downloads/baskarta/baskarta_shp_v2.zip`, 700 MB, hela kommunen. DWG-länken i produktbeskrivningen ger 404, SHP-versionen fungerar. |
| Göteborgs Stad, **höjdmodell 2022** ([produktbeskrivning](https://opengeodata.goteborg.se/files/hojdmodell/2022/hojdmodell_2022_sv.pdf)) | Markyta, husens markhöjd, vattenytor | GeoTIFF 0,5 m, Float32, 1×1 km-rutor, EPSG:3007, RH 2000 | CC0 | Laserskanning maj 2022 | `https://opengeodata.goteborg.se/downloads/hojdmodell/2022/hojdmodell_2022_639_14.zip` (10×10 km-paket) |
| **OpenStreetMap** | Husens fotavtryck, namn, adresser och byggår, gatunät med namn, hastighet och riktning, hållplatser och linjer (route-relationer), parker, torg, trafiksignaler och skyltar, tunnlarnas sträckning, namn och lägen för etiketter | OSM XML, WGS84 | ODbL, kräver "© OpenStreetMaps bidragsgivare" | Löpande | OSM API 0.6 `/map` i 8 rutor. Overpass och Geofabrik gick inte att nå från byggmiljön. |
| **SGU jordartskarta 1:25 000–1:100 000** | Jordart i markytan (fyllning, postglacial lera, urberg, vatten), kontroll av vattenytor | Polygoner, EPSG:3006 | CC0 ([SGU:s licensvillkor](https://www.sgu.se/en/products/geological-data/about-sgus-geological-data/license-terms-for-sgus-geological-data/)) | Vid revidering | WMS GetFeatureInfo (GeoJSON) på `maps3.sgu.se/geoserver`, samplat i 60 m-rutnät |
| **SGU jorddjupsmodell** ([beskrivning](https://resource.sgu.se/dokument/produkter/jorddjupsmodell-beskrivning.pdf)) | Djup till berg, 0–115 m i området | Raster 10 m | CC0 | Vid revidering | WMS GetFeatureInfo, samplat var 50:e m (31×31 punkter). Celler utan värde (255, mest under vatten) fylls med avståndsviktad interpolation. |
| **SGU berggrundskarta 1:50 000** | Bergart (tonalit-granodiorit) | Polygoner, EPSG:3006 | CC0 | Vid revidering | WMS GetFeatureInfo |

## Väder (etapp 2), hämtas direkt i webbläsaren

| Källa | Används till | Format | Licens | Uppdatering | CORS |
|---|---|---|---|---|---|
| SMHI nederbördsradar, sammansatt bild för Sverige | Radarkarta 40 × 40 km runt staden. Regn eller snö över modellen, med intensitet från de radarpixlar som täcker området. | GeoTIFF, 2 × 2 km, SWEREF 99 TM. Värde × 0,4 − 30 = dBZ. Intensiteten är beräknad med Marshall–Palmer (Z = 200 R^1,6). | CC BY 4.0 | Var femte minut | `Access-Control-Allow-Origin: *` |
| SMHI meteorologiska observationer, station Göteborg A (71420) | Temperatur, vind, vindriktning och nederbörd senaste timmen | JSON, `latest-hour` | CC BY 4.0 | En gång per timme | Öppen |
| SMHI snödjup (parameter 8) | Snödjup vid stationer inom 40 km | JSON, `latest-day` | CC BY 4.0 | En gång per dygn (kl. 06) | Öppen |

Ingen API-nyckel och ingen mellanserver behövs. Radarns pixlar är större än hela modellområdet. Regnet över modellen visar därför områdets intensitet och inte variationer inom staden. Med adressparametern `?radar=YYMMDDHHMM` (UTC) visas en arkiverad radarbild i stället för den senaste. Den märks då tydligt som arkiverad.

## Trafik (etapp 3), hämtas via mellanserver

API-nycklarna ligger som hemligheter i en Cloudflare Worker (`proxy/worker.js`). Webbläsaren anropar bara workern och ser aldrig nycklarna.

| Källa | Används till | Format | Licens | Uppdatering | Status |
|---|---|---|---|---|---|
| Trafikverkets öppna API, `TrafficFlow` 1.4 | Uppmätt trafikflöde (fordon per timme och medelhastighet per körfält) vid 26 mätstationer i området, i lagret Gator. Den närmaste mätningen visas också i panelen för Kungsportsplatsen. | JSON (`/v2/data.json`, POST med XML-fråga), WGS84 och SWEREF 99 TM | CC0 | Varje minut. Appen hämtar varannan minut. | Verifierat 2026-11-27. Trafikverket mäter bara på statliga vägar, i området E45 genom Götatunneln och längs älven. Det finns ingen mätning i Kungsportsplatsen. |
| Västtrafik Planera Resa v4 | Spårvagnar och bussar i realtid, avgångar vid Kungsportsplatsen | JSON, OAuth2 (client credentials) | Västtrafiks villkor | Realtid | Inloggningen fungerar, men API:et svarar "Resource forbidden". Applikationen behöver prenumerera på Planera Resa v4 i Västtrafiks utvecklarportal. Inte inkopplat än. |

## Det som inte är öppna data

| Lager | Hur det visas | Märkning |
|---|---|---|
| Ledningar (VA, fjärrvärme, el, fiber) | Simulerade längs OSM:s gatunät med påhittade djup och sidoförskjutning | Simulerad |
| Tunnlarnas djup | Sträckningen i plan är OSM (verklig). Djupet är en schablon: 10 m för väg, 22 m för järnväg, med ramper vid mynningarna | Simulerad (hela lagret) |
| Fyllnadslagrets tjocklek | Schematiskt 3 m | Står i lagertexten och på etiketten |
| Kungsportsplatsen, korsningspanel | Fordon, spårvagnar och gående per timme enligt typiska dygnsprofiler. Spårvagnar: antal linjer i OSM × typisk turtäthet (6 per timme och riktning dagtid). Gående: högst 3 200 per timme. | Simulerad, med den närmaste verkliga mätningen från Trafikverket som jämförelse |
| Biltrafik | Bilar på OSM:s gatunät. Antal enligt en schablonmässig dygnsprofil (rusningstrafik 900 fordon/h per riktning på huvudgator, 180 på lokalgator). | Simulerad |
| Ledningsdimensioner och djup | Schabloner per ledningstyp | Simulerad |
| Hus utan uppmätt tak | 118 hus saknar takkonturer i baskartan och höjd i OSM, och får 6 m. De ritas mörkare grå. | Simulerad i husets infopanel |

## Bearbetningssteg

- **Koordinater:** Göteborgs data ligger i EPSG:3007 (inte 3006 som handoveren antog). Modellen räknar i EPSG:3007 med origo mitt i området. OSM (WGS84) och SGU (EPSG:3006) räknas om med proj4.
- **Hushöjd:** För varje OSM-fotavtryck hämtas baskartans takkonturhörn som ligger inom eller högst 1 m från fotavtrycket. Takhöjden sätts till 85:e percentilen, eller 60:e för hus över 3 000 m² så att enstaka torn inte drar upp hela kvarteret. Markhöjden är 10:e percentilen av höjdmodellen längs fasaden. Annars används OSM:s `height`, sedan `building:levels` × 3,2 m + 1 m, och sist schablonen.
- **Vatten:** Rutor där höjdmodellen ligger under +0,45 m och som bildar sammanhängande ytor över cirka 1 000 m². De behålls bara om de överlappar SGU:s karterade vatten. Det tar bort Västlänkens byggrop vid Centralen, som är låg i höjdmodellen från 2022.
- **Bergyta:** markhöjd (utjämnad över 12 m) minus SGU:s jorddjup.

## Kommande etapper (inte verifierat än)

Västtrafik i realtid (väntar på prenumeration) och NVDB för vägmärken. Vägmärken och signaler kommer i dag från OpenStreetMap.
