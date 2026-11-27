// Stage 3: Västtrafik in real time (via our proxy, no keys in the client).
// Vehicle positions in the area and departures at stops.
import * as THREE from 'three';
import proj4 from 'proj4';
import type { SceneData, Terrain } from './build';
import type { Info, Row } from './info';
import { PROXY } from './live';

const VT = PROXY + '/vt/v4';
export const POLL_S = 10;
const MODE: Record<string, string> = { tram: 'Spårvagn', bus: 'Buss', train: 'Tåg', ferry: 'Båt' };
// Length, width, height in metres and colour per mode.
const SHAPE: Record<string, [number, number, number, number]> = {
  tram: [30, 2.65, 3.6, 0x6ec0ff], bus: [12, 2.55, 3.2, 0x3ddc97], train: [75, 3.1, 4.2, 0xc9b8ff], ferry: [20, 6, 3, 0xc9b8ff]
};

export interface Vehicle {
  ref: string; mode: string; line: string; dir: string; color: string;
  x: number; z: number; fx: number; fz: number; tx: number; tz: number; t: number; head: number; seen: number;
}
export interface Departure { mode: string; line: string; dir: string; planned: number; est: number | null; cancelled: boolean; platform: string }

const hhmm = (t: number, s = false) => new Date(t).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', ...(s ? { second: '2-digit' } : {}) });

export class LiveTransit {
  group = new THREE.Group();
  vehicles = new Map<string, Vehicle>();
  list: Vehicle[] = [];
  error: string | null = null;
  fetched = 0;
  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private gids = new Map<string, Promise<string | null>>();
  private deps = new Map<string, { t: number; p: Promise<Departure[]> }>();

  constructor(private sd: SceneData, private terrain: Terrain) {
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x1a2a38 }), 300);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.userData = { pick: 'vehicle', items: this.list };
    this.group.add(this.mesh);
  }

  async refresh() {
    try {
      const [[w0, s0], [w1, s1]] = this.sd.wgs84;
      const r = await fetch(`${VT}/positions?lowerLeftLat=${s0}&lowerLeftLong=${w0}&upperRightLat=${s1}&upperRightLong=${w1}&limit=200`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rows = await r.json() as Record<string, any>[];
      if (!Array.isArray(rows)) throw new Error('unexpected answer');
      const now = Date.now(), half = this.sd.size / 2;
      for (const p of rows) {
        const mode = p.line?.transportMode; if (!SHAPE[mode]) continue;
        const [e, n] = proj4('EPSG:4326', 'EPSG:3007', [p.longitude, p.latitude]);
        const x = e - this.sd.origin[0], z = -(n - this.sd.origin[1]);
        if (Math.abs(x) > half || Math.abs(z) > half) continue;
        let v = this.vehicles.get(p.detailsReference);
        if (!v) {
          v = { ref: p.detailsReference, mode, line: p.line.name, dir: p.directionDetails?.shortDirection ?? p.direction ?? '', color: p.line.backgroundColor,
            x, z, fx: x, fz: z, tx: x, tz: z, t: 1, head: this.streetHeading(x, z), seen: now };
          this.vehicles.set(v.ref, v);
        } else {
          const jump = Math.hypot(x - v.x, z - v.z);
          if (jump > 2) v.head = Math.atan2(x - v.x, z - v.z);
          if (jump > 400) { v.x = x; v.z = z; }
          v.fx = v.x; v.fz = v.z; v.tx = x; v.tz = z; v.t = 0; v.seen = now;
        }
      }
      for (const [k, v] of this.vehicles) if (v.seen !== now) this.vehicles.delete(k);
      this.list.length = 0; this.list.push(...this.vehicles.values());
      this.error = null;
    } catch (e) { this.error = (e as Error).message; }
    this.fetched = Date.now();
  }

  // Direction of the nearest street or track, used until the vehicle has moved.
  private streetHeading(x: number, z: number) {
    let best = 0, bd = 40;
    for (const st of this.sd.streets) for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i], dx = b[0] - a[0], dz = b[2] - a[2], L = dx * dx + dz * dz;
      const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L)) : 0;
      const d = Math.hypot(a[0] + t * dx - x, a[2] + t * dz - z);
      if (d < bd) { bd = d; best = Math.atan2(dx, dz); }
    }
    return best;
  }

  // Glide each vehicle from its last to its new reported position over one poll interval.
  update(dt: number) {
    const m = this.mesh, d = this.dummy, c = new THREE.Color();
    this.list.forEach((v, i) => {
      v.t = Math.min(1, v.t + dt / POLL_S);
      v.x = v.fx + (v.tx - v.fx) * v.t; v.z = v.fz + (v.tz - v.fz) * v.t;
      const [L, W, H, col] = SHAPE[v.mode];
      d.position.set(v.x, this.terrain.at(v.x, v.z) + 0.3, v.z); d.rotation.set(0, v.head, 0); d.scale.set(W, H, L); d.updateMatrix();
      m.setMatrixAt(i, d.matrix); m.setColorAt(i, c.set(col));
    });
    m.count = this.list.length;
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.boundingSphere = null; m.boundingBox = null; // recomputed lazily when tapped
  }

  near(x: number, z: number, r: number) { return this.list.filter(v => Math.hypot(v.x - x, v.z - z) < r); }

  info(v: Vehicle): Info {
    return {
      title: `${MODE[v.mode]} ${v.line}`, sub: v.dir ? `Mot ${v.dir}` : undefined, prov: 'measured',
      rows: [['Linje', v.line, 'measured'], ['Mot', v.dir || '–', 'measured'], ['Position uppdaterad', `kl. ${hhmm(v.seen, true)}`, 'measured']],
      note: 'Fordonets position kommer från Västtrafik och hämtas var tionde sekund. Mellan uppdateringarna glider fordonet mjukt i bilden, och riktningen räknas fram ur rörelsen. Fordonets storlek är schematisk. Källa: Västtrafik.'
    };
  }

  /* ---------- Departures ---------- */
  private gid(name: string) {
    let p = this.gids.get(name);
    if (!p) {
      p = fetch(`${VT}/locations/by-text?q=${encodeURIComponent(name + ', Göteborg')}&types=stoparea&limit=3`).then(r => r.json())
        .then(j => (j.results ?? []).find((l: any) => l.locationType === 'stoparea')?.gid ?? null).catch(() => null);
      this.gids.set(name, p);
    }
    return p;
  }

  departures(name: string, span = 60): Promise<Departure[]> {
    const key = name + '|' + span, hit = this.deps.get(key);
    if (hit && Date.now() - hit.t < 30_000) return hit.p;
    const p = this.gid(name).then(async gid => {
      if (!gid) throw new Error('no stop');
      const r = await fetch(`${VT}/stop-areas/${gid}/departures?timeSpan=${span}&limit=100`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return (j.results ?? []).map((d: any): Departure => ({
        mode: d.serviceJourney?.line?.transportMode ?? '', line: d.serviceJourney?.line?.shortName ?? '',
        dir: d.serviceJourney?.directionDetails?.shortDirection ?? d.serviceJourney?.direction ?? '',
        planned: Date.parse(d.plannedTime), est: d.estimatedTime ? Date.parse(d.estimatedTime) : null,
        cancelled: !!d.isCancelled, platform: d.stopPoint?.platform ?? ''
      }));
    });
    this.deps.set(key, { t: Date.now(), p });
    p.catch(() => this.deps.delete(key));
    return p;
  }
}

// Rows for the next departures, for the stop card.
export function departureRows(deps: Departure[], n = 8): Row[] {
  const now = Date.now();
  return deps.filter(d => (d.est ?? d.planned) > now - 30_000).slice(0, n).map(d => {
    const t = d.est ?? d.planned, min = Math.max(0, Math.round((t - now) / 60000));
    const late = d.est != null ? Math.round((d.est - d.planned) / 60000) : 0;
    const when = d.cancelled ? 'Inställd' : `${min === 0 ? 'Nu' : min + ' min'}${late >= 2 ? ` (${late} min sen)` : ''}`;
    return [`${MODE[d.mode] ?? ''} ${d.line} mot ${d.dir}`.trim(), when, 'measured'] as Row;
  });
}
export { hhmm as clock };
