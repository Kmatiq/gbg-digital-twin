// Public transport stops (real, OSM) and simulated car traffic on the real street network.
import * as THREE from 'three';
import type { SceneData } from './build';

export function buildStops(d: SceneData): THREE.Group {
  const grp = new THREE.Group();
  const dummy = new THREE.Object3D();
  const n = d.stops.length;
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.35, 8, 6), new THREE.MeshLambertMaterial({ color: 0xc9d6e0 }), n);
  const signs = new THREE.InstancedMesh(new THREE.CylinderGeometry(3.5, 3.5, 0.6, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
  const rings = new THREE.InstancedMesh(new THREE.RingGeometry(5, 6.5, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }), n);
  d.stops.forEach((s, k) => {
    const col = new THREE.Color(s.tram ? 0x6ec0ff : s.bus ? 0x3ddc97 : 0xc9b8ff);
    dummy.rotation.set(0, 0, 0); dummy.position.set(s.x, s.y + 3.5, s.z); dummy.updateMatrix(); poles.setMatrixAt(k, dummy.matrix);
    dummy.rotation.set(Math.PI / 2, 0, 0); dummy.position.set(s.x, s.y + 7.5, s.z); dummy.updateMatrix(); signs.setMatrixAt(k, dummy.matrix); signs.setColorAt(k, col);
    dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.position.set(s.x, s.y + 0.5, s.z); dummy.updateMatrix(); rings.setMatrixAt(k, dummy.matrix); rings.setColorAt(k, col);
  });
  signs.instanceColor!.needsUpdate = true; rings.instanceColor!.needsUpdate = true;
  poles.userData = signs.userData = rings.userData = { pick: 'stop', items: d.stops };
  grp.add(poles, signs, rings);
  return grp;
}

// Typical weekday profile for urban car traffic, share of peak hour. SIMULATED, not measured.
export const HOUR_PROFILE = [0.12, 0.08, 0.06, 0.06, 0.1, 0.28, 0.6, 0.95, 1, 0.78, 0.68, 0.72, 0.78, 0.75, 0.78, 0.9, 1, 0.95, 0.72, 0.52, 0.42, 0.33, 0.25, 0.17];
// Peak-hour flow per direction used for the simulation (vehicles/hour), by road class.
export const PEAK_FLOW = { major: 900, minor: 180 };

export function stockholmHour(): number {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date());
  const h = +(parts.find(p => p.type === 'hour')?.value ?? 12), m = +(parts.find(p => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}
export function profileNow(): number {
  const h = stockholmHour(); const a = Math.floor(h) % 24, b = (a + 1) % 24, t = h - Math.floor(h);
  return HOUR_PROFILE[a] * (1 - t) + HOUR_PROFILE[b] * t;
}

interface Street { n: string; major: boolean; oneway: number; v: number; pts: THREE.Vector3[]; cum: number[]; len: number; startLinks: number[]; endLinks: number[] }
interface Car { s: number; d: number; dir: 1 | -1; v: number; }

export class Traffic {
  group = new THREE.Group();
  streets: Street[] = [];
  cars: Car[] = [];
  mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private rnd: () => number;

  constructor(d: SceneData) {
    let seed = 20261125; this.rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (const st of d.streets) {
      if (st.pts.length < 2) continue;
      const pts = st.pts.map(p => new THREE.Vector3(p[0], p[1] + 0.9, p[2]));
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      if (cum[cum.length - 1] < 8) continue;
      this.streets.push({ n: st.n, major: st.c === 1, oneway: st.o, v: st.v, pts, cum, len: cum[cum.length - 1], startLinks: [], endLinks: [] });
    }
    // Connect street ends that meet (within 3 m).
    const key = (p: THREE.Vector3) => Math.round(p.x / 3) + ',' + Math.round(p.z / 3);
    const at = new Map<string, number[]>();
    this.streets.forEach((s, i) => { for (const p of [s.pts[0], s.pts[s.pts.length - 1]]) { const k = key(p); (at.get(k) ?? at.set(k, []).get(k)!).push(i); } });
    this.streets.forEach((s, i) => {
      s.startLinks = (at.get(key(s.pts[0])) ?? []).filter(j => j !== i);
      s.endLinks = (at.get(key(s.pts[s.pts.length - 1])) ?? []).filter(j => j !== i);
    });
    // Number of cars from road length and the simulated time-of-day profile.
    const f = profileNow();
    for (let i = 0; i < this.streets.length; i++) {
      const s = this.streets[i];
      const per = s.major ? 38 : 110; const n = Math.floor((s.len / per) * (0.25 + f) + this.rnd());
      for (let k = 0; k < n; k++) {
        const dir: 1 | -1 = s.oneway === 1 ? 1 : s.oneway === -1 ? -1 : (this.rnd() < 0.5 ? 1 : -1);
        this.cars.push({ s: i, d: this.rnd() * s.len, dir, v: (s.v / 3.6) * (0.55 + this.rnd() * 0.35) });
      }
    }
    const geo = new THREE.BoxGeometry(4.4, 1.5, 1.9);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, this.cars.length));
    this.mesh.count = this.cars.length;
    const cols = [0xff8fd0, 0xffe7b0, 0xffffff, 0x9fe6ff, 0xff8fd0, 0xd0d6dc].map(c => new THREE.Color(c));
    this.cars.forEach((_, k) => this.mesh.setColorAt(k, cols[k % cols.length]));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.frustumCulled = false;
    this.mesh.userData = { pick: 'car', traffic: this };
    this.group.add(this.mesh);
    this.update(0);
  }

  // Simulated flow on a street right now (vehicles/hour, both directions).
  flowFor(major: boolean, oneway: boolean): number {
    return Math.round(PEAK_FLOW[major ? 'major' : 'minor'] * profileNow() * (oneway ? 1 : 2) / 10) * 10;
  }

  private next(car: Car) {
    const s = this.streets[car.s];
    const links = car.dir === 1 ? s.endLinks : s.startLinks;
    const end = car.dir === 1 ? s.pts[s.pts.length - 1] : s.pts[0];
    const opts: [number, 1 | -1][] = [];
    for (const j of links) {
      const t = this.streets[j];
      if (t.pts[0].distanceTo(end) < 4.5 && t.oneway !== -1) opts.push([j, 1]);
      else if (t.pts[t.pts.length - 1].distanceTo(end) < 4.5 && t.oneway !== 1) opts.push([j, -1]);
    }
    if (opts.length) {
      const [j, dir] = opts[Math.floor(this.rnd() * opts.length)];
      car.s = j; car.dir = dir; car.d = dir === 1 ? 0 : this.streets[j].len;
      car.v = (this.streets[j].v / 3.6) * (0.55 + this.rnd() * 0.35);
    } else if (s.oneway === 0) { car.dir = car.dir === 1 ? -1 : 1; }
    else { car.s = Math.floor(this.rnd() * this.streets.length); const t = this.streets[car.s]; car.dir = t.oneway === -1 ? -1 : 1; car.d = car.dir === 1 ? 0 : t.len; }
  }

  update(dt: number) {
    const m = this.mesh, dummy = this.dummy;
    for (let k = 0; k < this.cars.length; k++) {
      const c = this.cars[k];
      c.d += c.dir * c.v * dt;
      let s = this.streets[c.s];
      if (c.d > s.len || c.d < 0) { this.next(c); s = this.streets[c.s]; c.d = Math.max(0, Math.min(s.len, c.d)); }
      let i = 1; while (i < s.cum.length - 1 && s.cum[i] < c.d) i++;
      const a = s.pts[i - 1], b = s.pts[i], t = (c.d - s.cum[i - 1]) / ((s.cum[i] - s.cum[i - 1]) || 1);
      const dx = (b.x - a.x) * c.dir, dz = (b.z - a.z) * c.dir, L = Math.hypot(dx, dz) || 1;
      const off = s.oneway ? 0 : 2; // keep right on two-way streets
      dummy.position.set(a.x + (b.x - a.x) * t - (dz / L) * off, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t + (dx / L) * off);
      dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
      dummy.updateMatrix(); m.setMatrixAt(k, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }

  carInfo(k: number) { const c = this.cars[k]; const s = this.streets[c.s]; return { street: s.n, kmh: Math.round(c.v * 3.6), limit: s.v, major: s.major, oneway: !!s.oneway }; }
}
