// Layer metadata: names, colour, icon, provenance and source texts shown in the interface.
// Interface texts follow plain Swedish (klarspråk) in a neutral public-sector tone.
export type Provenance = 'measured' | 'derived' | 'simulated';

export interface LayerDef {
  name: string;   // full name
  short: string;  // name on the layer button
  c: string;
  icon: string;   // inline SVG path data (24x24, stroke)
  prov: Provenance;
  off: number;    // vertical offset in metres at full explode
  text: string;
  src: string;
  chips?: [string, string][];
}

export const PROV_LABEL: Record<Provenance, string> = {
  measured: 'Öppna data',
  derived: 'Beräknad',
  simulated: 'Simulerad'
};
export const PROV_TEXT: Record<Provenance, string> = {
  measured: 'Uppmätt eller kartlagt, från öppna data',
  derived: 'Framräknad ur öppna data',
  simulated: 'Uppskattad för att visa principen, inte uppmätt'
};

export const LAYERS: Record<string, LayerDef> = {
  vader: {
    name: 'Väder', short: 'Väder', c: '#9fd2ff', prov: 'measured', off: 0,
    icon: 'M7 15a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 7.5a3.5 3.5 0 0 1 .5 7M8 18l-1 2M12 18l-1 2M16 18l-1 2',
    text: 'Aktuellt väder från SMHI. Nederbördsradarn visas som en karta runt staden och som regn eller snö över modellen. Temperatur, vind och nederbörd kommer från SMHI:s station Göteborg A. Snödjup mäts en gång per dygn vid stationer i omgivningen.',
    src: 'SMHI:s öppna data: nederbördsradar (uppdateras var femte minut, 2 × 2 km), meteorologiska observationer och snödjup. Licens CC BY 4.0, källa SMHI.',
    chips: [['#78beff', 'Svag nederbörd'], ['#3cdc8c', 'Måttlig'], ['#fae650', 'Kraftig'], ['#f03c3c', 'Mycket kraftig']]
  },
  kollektiv: {
    name: 'Kollektivtrafik', short: 'Kollektivtrafik', c: '#6ec0ff', prov: 'measured', off: 180,
    icon: 'M6 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 11h16M8 17l-2 3M16 17l2 3M8 14h.01M16 14h.01',
    text: 'Hållplatser för spårvagn och buss med de linjer som stannar där. Tryck på en hållplats för att se linjerna. Avgångar i realtid läggs till i ett senare skede.',
    src: 'Hållplatser och linjer: OpenStreetMap (ODbL).',
    chips: [['#6ec0ff', 'Spårvagn'], ['#3ddc97', 'Buss'], ['#c9b8ff', 'Båt']]
  },
  trafik: {
    name: 'Biltrafik', short: 'Biltrafik', c: '#ff8fd0', prov: 'simulated', off: 180,
    icon: 'M5 16V11l2-5h10l2 5v5M3 16h18v2H3zM7 16v2M17 16v2M5 11h14M8 13.5h.01M16 13.5h.01',
    text: 'Visar hur biltrafiken kan se ut på stadens gatunät. Bilarna och antalet fordon är simulerade utifrån en typisk dygnsprofil, eftersom det saknas öppna mätningar för området. Gatunätet, körriktningarna och hastighetsgränserna är verkliga.',
    src: 'Gatunät, körriktning och hastighetsgräns: OpenStreetMap (ODbL). Fordonen och trafikmängderna är simulerade.'
  },
  hus: {
    name: 'Byggnader', short: 'Byggnader', c: '#a9c1d2', prov: 'measured', off: 260,
    icon: 'M4 21V8l6-4v17M10 21V10h10v11M3 21h18M13 13h1M17 13h1M13 17h1M17 17h1M6.5 11h1M6.5 15h1',
    text: 'Byggnadernas utbredning och höjd. Höjden är beräknad som uppmätt takhöjd minus markhöjd. Tryck på en byggnad för att se uppgifter om den.',
    src: 'Utbredning: OpenStreetMap (ODbL). Takhöjd: Göteborgs Stads baskarta (CC0). Markhöjd: Göteborgs Stads höjdmodell 2022 (CC0).',
    chips: [['#d6be84', 'Landmärke'], ['#aabece', 'Höjd beräknad'], ['#8c96a2', 'Höjd saknas']]
  },
  vagar: {
    name: 'Gator och trafikanordningar', short: 'Gator', c: '#7e93a6', prov: 'measured', off: 180,
    icon: 'M8 3L5 21M16 3l3 18M12 4v2M12 10v3M12 17v3',
    text: 'Gatunätet med kantsten, spårvagnsspår, trafiksignaler, vägmärken och gatubelysning. Tryck på en gata för att se namn och hastighetsgräns.',
    src: 'Gator, signaler och vägmärken: OpenStreetMap (ODbL). Kantsten, spår, plattformar och belysningsstolpar: Göteborgs Stads baskarta (CC0).',
    chips: [['#e6edf2', 'Kantsten'], ['#6ec0ff', 'Spår'], ['#3ddc97', 'Signal'], ['#d8362f', 'Stopp och väjning'], ['#ffd27a', 'Belysning']]
  },
  mark: {
    name: 'Mark, parker och vatten', short: 'Mark och vatten', c: '#4a9a80', prov: 'measured', off: 100,
    icon: 'M12 3l4 6h-2.5l3 5H7.5l3-5H8zM12 14v3M3 20c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0',
    text: 'Markytan med parker, träd och vatten. Vattenytorna är beräknade ur höjdmodellen och kontrollerade mot SGU:s karta. Plattans översta del visar fyllnadslagret, där ledningar normalt ligger. Lagrets tjocklek är schematisk.',
    src: 'Markhöjd: Göteborgs Stads höjdmodell 2022, laserskanning (CC0). Träd: baskartan (CC0). Parker och torg: OpenStreetMap (ODbL).'
  },
  ledn: {
    name: 'Ledningar', short: 'Ledningar', c: '#3aa0ff', prov: 'simulated', off: 40,
    icon: 'M3 8h7a3 3 0 0 1 3 3v2a3 3 0 0 0 3 3h5M3 16h4M17 8h4',
    text: 'Vatten och avlopp, fjärrvärme, el och fiber. Uppgifter om ledningsnät är inte öppna data. Ledningarna är därför simulerade längs gatorna och visar endast principen.',
    src: 'Simulerade längs gatunätet i OpenStreetMap. Läge, djup och dimension är uppskattade.',
    chips: [['#3aa0ff', 'Vatten och avlopp'], ['#ff5a4d', 'Fjärrvärme'], ['#ffd23f', 'El'], ['#3ddc97', 'Fiber']]
  },
  tunnlar: {
    name: 'Tunnlar', short: 'Tunnlar', c: '#b69cff', prov: 'simulated', off: -30,
    icon: 'M3 20V12a9 9 0 0 1 18 0v8M7 20v-7a5 5 0 0 1 10 0v7M3 20h18',
    text: 'Götatunneln och Västlänken. Tunnlarnas sträckning är hämtad från OpenStreetMap. Djupet finns inte i öppna data och är därför simulerat.',
    src: 'Sträckning: OpenStreetMap (ODbL). Djup: uppskattat, cirka 10 meter för väg och 22 meter för järnväg, med ramper vid mynningarna.',
    chips: [['#b69cff', 'Järnväg (Västlänken)'], ['#ffb454', 'Väg (Götatunneln)']]
  },
  jord: {
    name: 'Jordlager', short: 'Jordlager', c: '#8fa3b6', prov: 'measured', off: -110,
    icon: 'M3 7h18M3 12h18M3 17h18M6 9.5h.01M12 9.5h.01M18 9.5h.01M9 14.5h.01M15 14.5h.01',
    text: 'Lösa jordlager ovanpå berget. Vid Centralen är det mer än 100 meter till berg, och jorden består nästan helt av lera. Ovansidan är färgad efter SGU:s jordartskarta.',
    src: 'Jorddjup: SGU:s jorddjupsmodell. Jordart: SGU:s jordartskarta 1:25 000. Båda CC0.',
    chips: [['#7d91a3', 'Lera'], ['#8a7560', 'Fyllning'], ['#9a8f8a', 'Berg i dagen'], ['#1d7fb4', 'Vatten']]
  },
  berg: {
    name: 'Berggrund', short: 'Berggrund', c: '#6e7488', prov: 'derived', off: -200,
    icon: 'M3 20l6-10 4 6 3-4 5 8zM9 10l1.5 3',
    text: 'Bergytans nivå är beräknad som markhöjd minus jorddjup. Berggrunden i området består av tonalit–granodiorit, som är cirka 1,6 miljarder år gammal.',
    src: 'Bergyta: beräknad ur höjdmodellen och SGU:s jorddjupsmodell. Bergart: SGU:s berggrundskarta 1:50 000 (CC0).'
  }
};

export const ORDER = ['vader', 'kollektiv', 'trafik', 'hus', 'vagar', 'mark', 'ledn', 'tunnlar', 'jord', 'berg'] as const;
export type LayerKey = typeof ORDER[number];

export const icon = (k: string, size = 20) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${LAYERS[k].icon}"/></svg>`;
