// Turns a pick (what the user tapped) into a short info card with provenance per value.
import type { Provenance } from './layers';

export type Row = [label: string, value: string, prov?: Provenance];
export interface Info { title: string; sub?: string; prov: Provenance; rows: Row[]; details?: Row[]; note?: string }

export interface BInfo {
  id: string; name: string | null; height: number; ground: number; src: string; triStart: number; triCount: number;
  x: number; z: number; kind: string; area: number; addr: string | null; year: string | null; levels: number | null; top: number;
}

const nf = (v: number, d = 1) => v.toLocaleString('sv-SE', { maximumFractionDigits: d, minimumFractionDigits: d });

export const KIND: Record<string, string> = {
  yes: 'Byggnad', retail: 'Handel', office: 'Kontor', apartments: 'Bostäder', residential: 'Bostäder', civic: 'Offentlig byggnad', commercial: 'Kommersiell',
  hotel: 'Hotell', train_station: 'Station', government: 'Offentlig förvaltning', church: 'Kyrka', cathedral: 'Kyrka', greenhouse: 'Växthus', parking: 'Parkeringshus',
  school: 'Skola', university: 'Universitet', roof: 'Tak', industrial: 'Industri', public: 'Offentlig byggnad', sports_hall: 'Idrottshall', kiosk: 'Kiosk',
  stadium: 'Arena', transportation: 'Trafikbyggnad', service: 'Teknisk byggnad', warehouse: 'Lager', theatre: 'Teater', museum: 'Museum', house: 'Hus', construction: 'Under byggnad'
};

const HEIGHT_SRC: Record<string, [string, Provenance]> = {
  baskarta: ['Takhöjd uppmätt i Göteborgs Stads baskarta minus markhöjd ur höjdmodellen', 'derived'],
  'osm-height': ['Höjd angiven i OpenStreetMap', 'measured'],
  'osm-levels': ['Uppskattad ur antal våningar i OpenStreetMap', 'derived'],
  fallback: ['Uppgift saknas, byggnaden visas med en schablonhöjd på 6 meter', 'simulated']
};

export function buildingInfo(b: BInfo): Info {
  const [srcText, hProv] = HEIGHT_SRC[b.src] ?? [b.src, 'derived'];
  const floors = b.levels ?? Math.max(1, Math.round((b.height - 1) / 3.2));
  const kind = KIND[b.kind] ?? 'Byggnad';
  const heightText = b.src === 'fallback' ? 'Uppgift saknas' : `cirka ${Math.round(b.height)} meter (${b.levels ? '' : 'cirka '}${floors} våningar)`;
  const rows: Row[] = [['Höjd', heightText, hProv]];
  if (b.year) rows.push(['Byggår', b.year, 'measured']);
  return {
    title: b.name ?? b.addr ?? kind,
    sub: (b.name ?? b.addr) ? [kind, b.name && b.addr ? b.addr : null].filter(Boolean).join(' · ') : undefined,
    prov: hProv, rows,
    details: [
      ['Höjd', `${nf(b.height)} m`, hProv],
      ['Takhöjd', `+${nf(b.top)} m ö.h.`, b.src === 'baskarta' ? 'measured' : hProv],
      ['Markhöjd', `+${nf(b.ground)} m ö.h.`, 'measured'],
      ['Fotavtryck', `${b.area.toLocaleString('sv-SE')} m²`, 'measured']
    ],
    note: `Höjd: ${srcText}. Byggnadens utbredning kommer från OpenStreetMap (${b.id}). Höjder anges i höjdsystemet RH 2000.`
  };
}

const HW: Record<string, string> = {
  trunk: 'Huvudled', trunk_link: 'Påfart/avfart', primary: 'Huvudgata', primary_link: 'Påfart/avfart', secondary: 'Huvudgata', secondary_link: 'Påfart/avfart',
  tertiary: 'Lokal huvudgata', tertiary_link: 'Påfart/avfart', residential: 'Lokalgata', unclassified: 'Lokalgata', living_street: 'Gångfartsgata', service: 'Servicegata',
  pedestrian: 'Gågata', footway: 'Gångväg', cycleway: 'Cykelväg', path: 'Stig', steps: 'Trappa', square: 'Torg'
};
export function roadInfo(r: [number, string | null, string, string | null, string | null, number, number | string], flow: number | null): Info {
  const [, name, hw, maxspeed, lanes, oneway, bridge] = r;
  const rows: Row[] = [['Typ', HW[hw] ?? hw, 'measured']];
  if (maxspeed) rows.push(['Hastighetsgräns', `${maxspeed} km/h`, 'measured']);
  if (oneway) rows.push(['Riktning', 'Enkelriktad', 'measured']);
  if (flow != null) rows.push(['Trafik just nu', `cirka ${flow.toLocaleString('sv-SE')} fordon per timme`, 'simulated']);
  const details: Row[] = [];
  if (lanes) details.push(['Körfält', lanes, 'measured']);
  if (bridge) details.push(['Bro', typeof bridge === 'string' ? bridge : 'Ja', 'measured']);
  return {
    title: name ?? (hw === 'square' ? 'Torg' : 'Gata utan namn'), sub: bridge ? 'Bro' : undefined, prov: 'measured', rows, details,
    note: 'Gatunamn, gatutyp, hastighetsgräns och körriktning kommer från OpenStreetMap.' + (flow != null ? ' Trafikmängden är simulerad utifrån en typisk dygnsprofil och är inte uppmätt.' : '')
  };
}

const UTIL: Record<string, [string, string, string]> = {
  va: ['Vatten och avlopp', 'cirka 2,2 meter', 'Ø 300 mm självfall + Ø 160 mm tryck'],
  fjv: ['Fjärrvärme', 'cirka 1,4 meter', '2 × Ø 200 mm (fram och retur)'],
  el: ['Elkabel', 'cirka 0,9 meter', '10 kV kabel'],
  fiber: ['Fiber', 'cirka 0,6 meter', 'Kanalisation 4 × 40 mm']
};
export function utilInfo(u: { type: string; n: string }): Info {
  const [name, depth, dim] = UTIL[u.type] ?? [u.type, '?', '?'];
  return {
    title: name, sub: u.n ? 'Under ' + u.n : undefined, prov: 'simulated',
    rows: [['Djup', depth, 'simulated'], ['Dimension', dim, 'simulated']],
    note: 'Uppgifter om ledningsnät är inte öppna data. Ledningen är simulerad längs gatan för att visa principen och behöver inte finnas på just den här platsen.'
  };
}

export function tunnelInfo(t: { kind: string; name: string; construction: boolean }, length: number, depth: number): Info {
  return {
    title: t.name || (t.kind === 'rail' ? 'Järnvägstunnel' : 'Vägtunnel'), sub: t.construction ? 'Under byggnad' : (t.kind === 'rail' ? 'Järnväg' : 'Väg'), prov: 'simulated',
    rows: [['Sträckning', 'Verklig, enligt OpenStreetMap', 'measured'], ['Djup på platsen', `cirka ${Math.round(depth)} meter under mark`, 'simulated']],
    details: [['Längd i modellen', `${Math.round(length)} m`, 'measured']],
    note: 'Tunnelns sträckning kommer från OpenStreetMap. Djupet finns inte i öppna data och är därför uppskattat.'
  };
}

export const SIGN: Record<string, string> = { signal: 'Trafiksignal', stop: 'Stoppskylt', giveway: 'Väjningsplikt', crossing: 'Övergångsställe', sign: 'Vägmärke' };

export function stopInfo(s: { name: string; lines: Record<string, string[]>; tram: boolean; bus: boolean }): Info {
  const rows: Row[] = [];
  if (s.lines.tram?.length) rows.push(['Spårvagn', s.lines.tram.join(', '), 'measured']);
  if (s.lines.bus?.length) rows.push(['Buss', s.lines.bus.join(', '), 'measured']);
  if (s.lines.ferry?.length) rows.push(['Båt', s.lines.ferry.join(', '), 'measured']);
  if (s.lines.train?.length) rows.push(['Tåg', s.lines.train.join(', '), 'measured']);
  if (!rows.length) rows.push(['Linjer', 'Inga linjer registrerade', 'measured']);
  return { title: s.name, sub: s.tram && s.bus ? 'Hållplats för spårvagn och buss' : s.tram ? 'Spårvagnshållplats' : s.bus ? 'Busshållplats' : 'Hållplats', prov: 'measured', rows,
    note: 'Hållplatser och linjer kommer från OpenStreetMap. Avgångar i realtid från Västtrafik läggs till i ett senare skede.' };
}

export { nf };
