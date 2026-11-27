// Stage 3: live traffic measurements from Trafikverket (via our proxy, no keys in the client)
// and the intersection panel for Kungsportsplatsen.
import * as THREE from 'three';
import proj4 from 'proj4';
import type { SceneData, Terrain } from './build';
import type { Info, Row } from './info';
import { Traffic, stockholmHour } from './transport';

// Public address of the Cloudflare Worker that holds the API keys (see proxy/README.md). Not a secret.
export const PROXY = 'https://gbg-twin-proxy.kristian-matiqsson.workers.dev';

const SIDE: Record<string, string> = {
  northBound: 'norrut', southBound: 'söderut', eastBound: 'österut', westBound: 'västerut',
  northEastBound: 'mot nordost', northWestBound: 'mot nordväst', southEastBound: 'mot sydost', southWestBound: 'mot sydväst'
};

export interface FlowDir { side: string; flow: number; speed: number | null; lanes: number }
export interface FlowSite { x: number; z: number; y: number; street: string; tunnel: string | null; dirs: FlowDir[]; flow: number; time: number }

const nfi = (v: number) => Math.round(v).toLocaleString('sv-SE');
const hhmm = (t: number) => new Date(t).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });

export class LiveFlow {
  group = new THREE.Group();
  sites: FlowSite[] = [];
  error: string | null = null;
  fetched = 0;
  onUpdate: () => void = () => {};
  private bars: THREE.InstancedMesh | null = null;

  constructor(private sd: SceneData, private terrain: Terrain) {}

  async refresh() {
    try {
      const [[w0, s0], [w1, s1]] = this.sd.wgs84;
      const cx = (w0 + w1) / 2, cy = (s0 + s1) / 2;
      const q = `<QUERY objecttype="TrafficFlow" schemaversion="1.4" limit="1000"><FILTER><WITHIN name="Geometry.WGS84" shape="center" value="${cx.toFixed(5)} ${cy.toFixed(5)}" radius="1200m"/></FILTER></QUERY>`;
      const r = await fetch(PROXY + '/tv', { method: 'POST', body: q });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const rows = (j.RESPONSE?.RESULT?.[0]?.TrafficFlow ?? []) as Record<string, any>[];
      this.sites = this.group_(rows);
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.fetched = Date.now();
    this.build();
    this.onUpdate();
  }

  // Group lane detectors into sites (within 30 m) and directions; sum the flow over lanes.
  private group_(rows: Record<string, any>[]): FlowSite[] {
    const [e0, n0, e1, n1] = this.sd.bbox, [oe, on] = this.sd.origin;
    const pts: { x: number; z: number; side: string; flow: number; speed: number | null; t: number }[] = [];
    for (const r of rows) {
      if (r.Deleted || r.VehicleFlowRate == null) continue;
      const m = String(r.Geometry?.WGS84 ?? '').match(/[-\d.]+/g); if (!m) continue;
      const [e, n] = proj4('EPSG:4326', 'EPSG:3007', [+m[0], +m[1]]);
      if (e < e0 || e > e1 || n < n0 || n > n1) continue;
      pts.push({ x: e - oe, z: -(n - on), side: r.MeasurementSide ?? '', flow: r.VehicleFlowRate, speed: r.AverageVehicleSpeed ?? null, t: Date.parse(r.MeasurementTime) });
    }
    const sites: (FlowSite & { _p: typeof pts })[] = [];
    for (const p of pts) {
      let s = sites.find(s => Math.hypot(s.x - p.x, s.z - p.z) < 30);
      if (!s) { s = { x: p.x, z: p.z, y: 0, street: '', tunnel: null, dirs: [], flow: 0, time: 0, _p: [] }; sites.push(s); }
      s._p.push(p);
    }
    for (const s of sites) {
      s.x = s._p.reduce((a, p) => a + p.x, 0) / s._p.length; s.z = s._p.reduce((a, p) => a + p.z, 0) / s._p.length;
      s.y = this.terrain.at(s.x, s.z);
      const by = new Map<string, FlowDir & { sv: number }>();
      for (const p of s._p) {
        const d = by.get(p.side) ?? { side: p.side, flow: 0, speed: null, lanes: 0, sv: 0 };
        d.flow += p.flow; d.lanes++; if (p.speed != null && p.flow > 0) { d.sv += p.speed * p.flow; }
        by.set(p.side, d);
      }
      s.dirs = [...by.values()].map(d => ({ side: d.side, flow: d.flow, lanes: d.lanes, speed: d.flow > 0 && d.sv ? d.sv / d.flow : null }));
      s.flow = s.dirs.reduce((a, d) => a + d.flow, 0);
      s.time = Math.max(...s._p.map(p => p.t));
      s.tunnel = this.inTunnel(s.x, s.z);
      s.street = s.tunnel ?? this.nearestStreet(s.x, s.z);
    }
    return sites.map(({ _p, ...s }) => s);
  }

  // Detectors sit on main roads: prefer the nearest named main road, then any named street.
  private nearestStreet(x: number, z: number) {
    for (const major of [true, false]) {
      let best = '', bd = 45;
      for (const st of this.sd.streets) {
        if (!st.n || (major && st.c !== 1)) continue;
        for (let i = 1; i < st.pts.length; i++) { const d = segDist(x, z, st.pts[i - 1], st.pts[i]); if (d < bd) { bd = d; best = st.n; } }
      }
      if (best) return best;
    }
    return '';
  }
  private inTunnel(x: number, z: number) {
    for (const t of this.sd.tunnels) if (t.kind === 'road') for (const p of t.pts) if (Math.hypot(p[0] - x, p[2] - z) < 45) return t.name || 'Tunnel';
    return null;
  }

  // One column per site; the height shows the measured flow (vehicles per hour, all directions).
  private build() {
    if (this.bars) { this.group.remove(this.bars); this.bars.geometry.dispose(); }
    if (!this.sites.length) { this.bars = null; return; }
    const geo = new THREE.CylinderGeometry(2.2, 2.2, 1, 12); geo.translate(0, 0.5, 0);
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x4fd1c5, emissive: 0x0d4a45 }), this.sites.length);
    const d = new THREE.Object3D();
    this.sites.forEach((s, i) => { d.position.set(s.x, s.y, s.z); d.scale.set(1, 4 + s.flow / 50, 1); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
    m.userData = { pick: 'flow', items: this.sites };
    this.bars = m; this.group.add(m);
  }

  info(s: FlowSite): Info {
    const rows: Row[] = [['Flöde, alla riktningar', `${nfi(s.flow)} fordon/timme`, 'measured']];
    for (const d of s.dirs) rows.push([`Riktning ${SIDE[d.side] ?? d.side}`, `${nfi(d.flow)} fordon/h${d.speed ? `, ${Math.round(d.speed)} km/h` : ''}`, 'measured']);
    return {
      title: 'Trafikmätning', sub: s.tunnel ? `${s.tunnel === 'Tunnel' ? 'I tunnel' : s.tunnel}, under markytan` : s.street ? `Vid ${s.street}` : undefined, prov: 'measured', rows,
      details: [['Mättid', `kl. ${hhmm(s.time)}`, 'measured'], ['Mätpunkter (körfält)', String(s.dirs.reduce((a, d) => a + d.lanes, 0)), 'measured']],
      note: 'Trafikverket mäter bara på statliga vägar, i området E45 genom Götatunneln och längs älven. Mätstationerna räknar fordon per körfält. Flödet är omräknat till fordon per timme från den senaste minuten. Uppdateras varannan minut. Källa: Trafikverket, öppna data (CC0).'
    };
  }
}

function segDist(x: number, z: number, a: number[], b: number[]) {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L)) : 0;
  return Math.hypot(a[0] + t * dx - x, a[2] + t * dz - z);
}

/* ---------- Kungsportsplatsen intersection ---------- */
export const JUNCTION = { name: 'Kungsportsplatsen', x: 5, z: 505, r: 70 };

// Typical share of the peak hour for pedestrians (city centre) and tram frequency per line and direction.
// SIMULATED, not measured: there are no open counts for the intersection.
const PED_PROFILE = [0.05, 0.03, 0.02, 0.02, 0.03, 0.08, 0.2, 0.45, 0.6, 0.5, 0.55, 0.7, 0.85, 0.8, 0.75, 0.85, 1, 0.95, 0.75, 0.6, 0.5, 0.4, 0.25, 0.12];
const PED_PEAK = 3200;
const TRAM_PER_H = [1, 0, 0, 0, 0, 2, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 4, 4, 4, 3, 2];
const lerp = (arr: number[], h: number) => { const a = Math.floor(h) % 24, b = (a + 1) % 24, t = h - Math.floor(h); return arr[a] * (1 - t) + arr[b] * t; };

export function junctionInfo(sd: SceneData, traffic: Traffic | null, live: LiveFlow | null): Info {
  const h = stockholmHour();
  const stop = sd.stops.find(s => s.name === JUNCTION.name);
  const regular = (stop?.lines.tram ?? []).filter(l => /^\d+$/.test(l));
  const trams = Math.round(regular.length * 2 * lerp(TRAM_PER_H, h));
  const peds = Math.round(PED_PEAK * lerp(PED_PROFILE, h) / 50) * 50;
  const cars = traffic ? traffic.junction(JUNCTION.x, JUNCTION.z, JUNCTION.r) : null;
  const rows: Row[] = [];
  if (cars) rows.push(['Fordon genom korsningen', `cirka ${nfi(Math.round(cars.flow / 10) * 10)} per timme`, 'simulated']);
  rows.push(['Spårvagnar', `cirka ${trams} per timme`, 'simulated']);
  rows.push(['Gående', `cirka ${nfi(peds)} per timme`, 'simulated']);
  if (stop) rows.push(['Spårvagnslinjer', regular.join(', ') || '–', 'measured'], ['Busslinjer', stop.lines.bus.join(', ') || '–', 'measured']);
  // Nearest real measurement, for comparison.
  const near = live?.sites.length ? [...live.sites].sort((a, b) => Math.hypot(a.x - JUNCTION.x, a.z - JUNCTION.z) - Math.hypot(b.x - JUNCTION.x, b.z - JUNCTION.z))[0] : null;
  if (near) rows.push([`Närmaste mätning (${Math.round(Math.hypot(near.x - JUNCTION.x, near.z - JUNCTION.z) / 10) * 10} m bort)`, `${nfi(near.flow)} fordon/h${near.street ? ', ' + near.street : ''}`, 'measured']);
  return {
    title: JUNCTION.name, sub: `Korsningen just nu, kl. ${hhmm(Date.now())}`, prov: 'simulated', rows,
    details: [['Biltrafik', 'Dygnsprofil på OSM:s gatunät', 'simulated'], ['Spårvagnar', 'Linjer från OSM, typisk turtäthet', 'simulated'], ['Gående', 'Typisk dygnsprofil för innerstaden', 'simulated']],
    note: 'Det finns inga öppna mätningar av trafiken i korsningen. Antalet fordon, spårvagnar och gående är därför simulerade utifrån typiska dygnsprofiler. Linjerna kommer från OpenStreetMap. Den närmaste verkliga mätningen kommer från Trafikverket och visas som jämförelse. Spårvagnar i realtid från Västtrafik läggs till när åtkomsten till Västtrafiks API är klar.'
  };
}
