// Layer metadata: name, colour, provenance and sources. Shown in the panel.
export type Provenance = 'measured' | 'derived' | 'simulated';

export interface LayerDef {
  name: string;
  c: string;
  prov: Provenance;
  off: number; // vertical offset in metres at full explode
  text: string;
  src: string;
  chips?: [string, string][];
}

export const PROV_LABEL: Record<Provenance, string> = {
  measured: 'Öppen data',
  derived: 'Beräknad',
  simulated: 'Simulerad'
};

export const LAYERS: Record<string, LayerDef> = {
  kollektiv: {
    name: 'Kollektivtrafik', c: '#6ec0ff', prov: 'measured', off: 180,
    text: 'Hållplatser för spårvagn och buss med linjer. Tryck på en hållplats för att se vilka linjer som stannar där. Realtidsavgångar kommer i etapp 3.',
    src: '<b>Hållplatser och linjer:</b> OpenStreetMap (ODbL).',
    chips: [['#6ec0ff', 'Spårvagn'], ['#3ddc97', 'Buss'], ['#c9b8ff', 'Båt']]
  },
  trafik: {
    name: 'Biltrafik', c: '#ff8fd0', prov: 'simulated', off: 180,
    text: 'Bilar som kör på det verkliga gatunätet. Antalet följer en typisk dygnsprofil och är simulerat, eftersom ingen öppen mätning finns här ännu. Verkliga flöden från Trafikverket prövas i etapp 3.',
    src: 'Simulerat på OpenStreetMaps gatunät (riktning och hastighetsgräns från OSM). Antal och rörelser är påhittade.'
  },
  hus: {
    name: 'Byggnader', c: '#a9c1d2', prov: 'measured', off: 260,
    text: 'Husens fotavtryck med höjd. Höjden är uppmätt takhöjd i baskartan minus markhöjden i höjdmodellen. Tryck på ett hus för att se dess siffror och källa.',
    src: '<b>Fotavtryck:</b> OpenStreetMap (ODbL). <b>Takhöjd:</b> Göteborgs Stads baskarta, fotogrammetriskt uppmätta takkonturer (CC0). <b>Mark:</b> Göteborgs Stads höjdmodell 2022 (CC0).',
    chips: [['#d6be84', 'Landmärke'], ['#aabece', 'Uppmätt höjd'], ['#8c96a2', 'Höjd uppskattad']]
  },
  vagar: {
    name: 'Vägar och skyltar', c: '#7e93a6', prov: 'measured', off: 180,
    text: 'Gatunät, kantsten, spårvagnsspår, trafiksignaler, skyltar och gatubelysning.',
    src: '<b>Gator, signaler, skyltar:</b> OpenStreetMap (ODbL). <b>Kantsten, spår, perronger, belysningsstolpar:</b> Göteborgs Stads baskarta (CC0), inmätta i 3D.',
    chips: [['#e6edf2', 'Kantsten'], ['#6ec0ff', 'Spår'], ['#3ddc97', 'Signal'], ['#d8362f', 'Stopp/väjning'], ['#ffd27a', 'Belysning']]
  },
  mark: {
    name: 'Mark, parker och vatten', c: '#4a9a80', prov: 'measured', off: 100,
    text: 'Markytan i 4 m rutnät, parker, träd och vatten. Vattenytor är beräknade ur höjdmodellen (sammanhängande ytor nära havsnivå) och kontrollerade mot SGU:s kartlagda vatten. Plattan visar fyllnadslagret (schematiskt 3 m) där ledningar ligger.',
    src: '<b>Markhöjd:</b> Göteborgs Stads höjdmodell 2022, laserskanning 0,5 m (CC0). <b>Träd:</b> baskartan (CC0). <b>Parker och torg:</b> OpenStreetMap (ODbL).'
  },
  ledn: {
    name: 'Ledningar', c: '#3aa0ff', prov: 'simulated', off: 40,
    text: 'Vatten och avlopp, fjärrvärme, el och fiber. Ledningsnäten är inte öppna data, så de är simulerade längs gatorna och visar bara principen.',
    src: 'Simulerat längs OpenStreetMaps gatunät. Läge, djup och dimension är påhittade.',
    chips: [['#3aa0ff', 'Vatten och avlopp'], ['#ff5a4d', 'Fjärrvärme'], ['#ffd23f', 'El'], ['#3ddc97', 'Fiber']]
  },
  tunnlar: {
    name: 'Tunnlar', c: '#b69cff', prov: 'simulated', off: -30,
    text: 'Götatunneln och Västlänken. Sträckningen i plan kommer från OpenStreetMap och är verklig, men djupet är simulerat eftersom det inte finns i öppna data.',
    src: '<b>Sträckning:</b> OpenStreetMap (ODbL). <b>Djup:</b> simulerat (schablon 10 m för väg, 22 m för järnväg, ramper vid mynningar).',
    chips: [['#b69cff', 'Järnväg (Västlänken)'], ['#ffb454', 'Väg (Götatunneln)']]
  },
  jord: {
    name: 'Jordlager', c: '#8fa3b6', prov: 'measured', off: -110,
    text: 'Lösa jordlager ovanpå berget. Vid Centralen är det över 100 m till berg, nästan bara lera. Ovansidan är färgad efter SGU:s jordartskarta.',
    src: '<b>Jorddjup:</b> SGU jorddjupsmodell (10 m raster, samplat var 50:e m). <b>Jordart:</b> SGU jordartskarta 1:25 000. Hämtat via SGU:s öppna WMS.',
    chips: [['#7d91a3', 'Lera'], ['#8a7560', 'Fyllning'], ['#9a8f8a', 'Urberg i dagen'], ['#1d7fb4', 'Vatten']]
  },
  berg: {
    name: 'Berggrund', c: '#6e7488', prov: 'derived', off: -200,
    text: 'Bergytan är beräknad som markhöjd minus jorddjup. Berget under området är tonalit-granodiorit, cirka 1,6 miljarder år gammal.',
    src: '<b>Bergyta:</b> beräknad ur höjdmodellen och SGU:s jorddjupsmodell. <b>Bergart:</b> SGU berggrundskarta 1:50 000.'
  }
};

export const ORDER = ['kollektiv', 'trafik', 'hus', 'vagar', 'mark', 'ledn', 'tunnlar', 'jord', 'berg'] as const;
export type LayerKey = typeof ORDER[number];
