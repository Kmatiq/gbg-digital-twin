# Göteborg Digital Tvilling

## Syfte
Demo för ledningen på Stadsmiljöförvaltningen som visar styrkan i att data hanteras gemensamt och på ett bra sätt. En interaktiv 3D-modell av centrala Göteborg som digital tvilling, på en fyrkantig platta där man även ser jordlager, berg, tunnlar, ledningar, hus i 3D, vägar och trafikskyltar. Lagren ska kunna dras isär.

Målet är att allt som går att visa baseras på verklig data från öppna och fria databaser. Där data saknas simuleras den, och simuleringen ska alltid märkas tydligt.

## Bärande princip: ursprung på all data
Varje lager och varje siffra har ett ursprung: `measured` (mätt), `derived` (beräknad av verklig data) eller `simulated` (simulerad).
- Visa det som en liten märkning i gränssnittet (Öppen data / Beräknad / Simulerad).
- Det ska finnas ett läge "Visa endast öppen data" som döljer simulerade lager.
- Presentera aldrig simulerad data som mätt. Visa källa och uppdateringstid där de finns.

## Referensprototyp
En första stiliserad prototyp (HTML + Three.js) ligger i `prototype/index.html`. Den använder genererade hus och placeringar och är alltså **inte** geografiskt korrekt. Ta över dess gränssnittskoncept, men ersätt geometrin med riktig data:
- Panel med lagerlista, där varje lager har en synlighetsknapp, "Solo" och märkning Öppen/Simulerad
- Reglage "Dra isär lager" och "Snitt genom staden"
- Kameraförval: Överblick, Sida, Uppifrån
- Etiketter för landmärken och jordlager, mörkt tema, svenskt gränssnitt
- Lager: berggrund, jordlager, tunnlar, ledningar, mark/parker/vatten, vägar och skyltar, byggnader, live (trafik och sensorer)

## Teknikval (förslag, ifrågasätt gärna)
- Statisk webbapp med Vite + TypeScript, ska gå att hosta på GitHub Pages så att Kristian kan titta på telefonen.
- Kartmotor: **CesiumJS** (stöd för 3D Tiles och för att se under markytan via genomskinlig terräng). Alternativ: MapLibre GL + deck.gl. Välj det som fungerar bäst för "dra isär lager" och underjordsvy, och motivera valet kort i README.
- Källdata ligger i SWEREF 99 TM (EPSG:3006) och ska konverteras till WGS84 (till exempel med proj4).
- Förprocessa tunga data till filer i repot med skript (GeoJSON, glTF eller 3D Tiles). Bygg inte husen i webbläsaren varje gång.
- Inga API-nycklar i klientkod eller repo. Live-data i etapp 3 går via en liten proxy om CORS stoppar direktanrop.

## Datakällor
Verifiera format, licens, uppdateringsfrekvens och CORS för varje källa innan implementation, och dokumentera i `docs/datakallor.md`.

| Behov | Tänkt källa | Status |
|---|---|---|
| Byggnader, höjdkurvor, vägkanter, kantsten, träd | Göteborgs Stads öppna geodata (opengeodata.goteborg.se), baskartan | Finns som öppen data, verifiera format och licens |
| Byggnadspolygoner (alternativ) | Lantmäteriet, öppna sedan februari 2025, CC-BY 4.0 | Finns, verifiera nedladdning |
| Höjdmodell | Göteborgs Stads öppna höjdmodell | Finns, verifiera |
| Husens höjd | Räkna ur höjdmodellen (yta minus terräng) eller attribut i baskartan | Att verifiera, takformer kan bli förenklade |
| Jordlager och berg | SGU (jordartskartor, jorddjup, berggrund) | Att verifiera |
| Nederbörd, radar, snödjup | SMHI öppna data, ingen nyckel. Radar uppdateras ungefär var 5:e minut, snödjup mäts bara vid stationer | Finns |
| Trafikflöde | Trafikverkets öppna API (gratis nyckel), TrafficFlow | Etapp 3, täckning i Göteborg att verifiera |
| Kollektivtrafik live | Trafiklab/Västtrafik (gratis nyckel) | Etapp 3, att verifiera |
| Vägnät och trafikskyltar | NVDB (Trafikverket) och/eller OpenStreetMap | Att verifiera |
| Ledningar (VA, fjärrvärme, el, fiber) | Inte öppna | **Simulera** längs vägnätet, märk tydligt |
| Tunnlar (Västlänken, vägtunnlar) | Kontrollera om geometrier är öppna | Annars simulera och märk |
| Trafik i en specifik korsning | Ingen intern data finns | **Simulera** från tidsprofil, märk tydligt |
| Besökare i Trädgårdsföreningen | Ingen öppen källa | **Simulera** (tid på dygnet, väder), märk tydligt |

## Etapper
Arbeta i små körbara steg och committa ofta. Varje etapp ska kunna visas på en telefon.

1. **Riktig stad.** Riktiga hus, vägar, terräng och träd i ett avgränsat område runt Centralstationen, Nordstan, Trädgårdsföreningen och Kungsportsplatsen (ungefär 1,5 × 1,5 km). Platta med jordlager och berg (SGU om möjligt, annars schematiskt och märkt som simulerat). Lagerlista, dra isär, snitt, kameraförval. *Acceptans:* jämför minst fem kända byggnader eller hörn mot baskartan eller en satellitkarta och visa att de ligger rätt.
2. **Väder.** SMHI:s radar som regn över staden i realtid, plus observationer. Snödjup som punkter vid stationer.
3. **Trafik.** Zoom in på Kungsportsplatsen med panel över antal fordon, spårvagnar och gående. Siffrorna är simulerade om ingen mätning finns, och märks så. Trafikskyltar från NVDB/OpenStreetMap. Trafikverket och Trafiklab om det går att få verklig data.
4. **Simulerade flöden.** Besökare i Trädgårdsföreningen, ledningar med flöden, tunneltrafik. Allt tydligt märkt som simulerat.

## Zoomnivåer
Överblick över hela området, sedan kvarter, sedan korsning eller park. På närmaste nivå visas en panel med siffror, varje siffra med sin märkning och källa.

## Arbetssätt
- Kristian arbetar från mobilen: håll sammanfattningar korta och lägg ut en förhandsvisning (till exempel GitHub Pages) så att han kan titta direkt.
- Om nedladdning av data blockeras av nätverksbegränsningar, berätta vilka domäner som behöver tillåtas eller be om att filen laddas upp. Gå inte runt blockeringen.
- Skriv README med datakällor, licenser och attribution (CC-BY kräver angivande av källa).
- Gränssnittet är på svenska. Kod, kommentarer och commit-meddelanden på engelska.
- Inga hemligheter i repot.
- Kontrollera resultatet visuellt (till exempel med en headless-skärmbild) innan du säger att något är klart.

## Redan bestämt
Mörkt tema, svenskt gränssnitt, demokorsning Kungsportsplatsen, demopark Trädgårdsföreningen, lager enligt prototypen, tydlig märkning av simulerad data.
