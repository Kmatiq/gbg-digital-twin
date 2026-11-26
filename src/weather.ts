// Weather layer (etapp 2): SMHI open data fetched directly by the browser (CORS is open, no key).
//  - Radar composite (2 km pixels, every 5 min) shown as a translucent map around the city and as
//    rain or snow falling over the model with intensity from the radar pixels at the city.
//  - Observations from SMHI station Göteborg A (temperature, wind, precipitation).
//  - Snow depth at stations within 40 km (measured once a day at 06).
import * as THREE from 'three';
import proj4 from 'proj4';

proj4.defs('EPSG:3007', '+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +units=m +no_defs');
proj4.defs('EPSG:3006', '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs');

const RADAR = 'https://opendata-download-radar.smhi.se/api/version/latest/area/sweden/product/comp';
const OBS = 'https://opendata-download-metobs.smhi.se/api/version/1.0';
const STATION = 71420; // Göteborg A
export const REGION = 40000; // side of the regional radar map in metres
const STATION_RADIUS = 40000;

export interface Station { id: number; name: string; x: number; z: number; dist: number; snow?: number | null; snowTime?: number; obs?: Record<string, { v: number; t: number }> }
export interface WeatherState {
  radarTime: string | null; radarHistoric: boolean; radarMmH: number | null; radarDbz: number | null; radarOk: boolean;
  obs: Record<string, { v: number; t: number }>; snow: Station[]; main: Station | null; error: string | null; fetched: number;
}

// dBZ = value * 0.4 - 30 (SMHI composite); rain rate via Marshall–Palmer Z = 200 R^1.6
const toDbz = (v: number) => v * 0.4 - 30;
const toMmH = (dbz: number) => Math.pow(Math.pow(10, dbz / 10) / 200, 1 / 1.6);
function radarColor(dbz: number): [number, number, number, number] {
  if (dbz < 8) return [0, 0, 0, 0];
  const stops: [number, number[]][] = [[8, [120, 190, 255, 90]], [18, [60, 150, 255, 150]], [26, [60, 220, 140, 175]], [34, [250, 230, 80, 195]], [42, [255, 150, 50, 210]], [50, [240, 60, 60, 225]], [60, [220, 80, 220, 235]]];
  for (let i = stops.length - 1; i >= 0; i--) if (dbz >= stops[i][0]) {
    const [a, ca] = stops[i], next = stops[i + 1]; if (!next) return ca as [number, number, number, number];
    const t = (dbz - a) / (next[0] - a); return ca.map((c, k) => Math.round(c + (next[1][k] - c) * t)) as [number, number, number, number];
  }
  return [0, 0, 0, 0];
}

export const fmtTime = (ms: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)).replace(':', '.');
export const fmtDay = (ms: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'long' }).format(new Date(ms));

export class Weather {
  group = new THREE.Group();
  state: WeatherState = { radarTime: null, radarHistoric: false, radarMmH: null, radarDbz: null, radarOk: false, obs: {}, snow: [], main: null, error: null, fetched: 0 };
  onUpdate: () => void = () => {};
  private origin: number[]; private half: number;
  private radarMesh: THREE.Mesh; private radarTex: THREE.CanvasTexture; private canvas: HTMLCanvasElement;
  private rain: THREE.Points; private rainVel: Float32Array; private rainTop = 380;
  private stationGroup = new THREE.Group();
  stationLabels: { t: string; x: number; y: number; z: number; k: string }[] = [];

  constructor(origin: number[], half: number) {
    this.origin = origin; this.half = half;
    // Regional radar map at sea level, with a hole where the model block is.
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = 20;
    this.radarTex = new THREE.CanvasTexture(this.canvas); this.radarTex.magFilter = THREE.LinearFilter; this.radarTex.colorSpace = THREE.SRGBColorSpace;
    const shape = new THREE.Shape([new THREE.Vector2(-REGION / 2, -REGION / 2), new THREE.Vector2(REGION / 2, -REGION / 2), new THREE.Vector2(REGION / 2, REGION / 2), new THREE.Vector2(-REGION / 2, REGION / 2)]);
    const h = half + 30; shape.holes.push(new THREE.Path([new THREE.Vector2(-h, -h), new THREE.Vector2(-h, h), new THREE.Vector2(h, h), new THREE.Vector2(h, -h)]));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    // UVs from position so the texture spans the full region
    const pos = g.getAttribute('position'); const uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / REGION + 0.5, 0.5 - pos.getZ(i) / REGION);
    this.radarMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.radarTex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.radarMesh.position.y = 1; this.radarMesh.renderOrder = 3; this.radarMesh.userData.pick = 'radar';
    this.group.add(this.radarMesh);
    // Distance rings for orientation
    for (const r of [5000, 10000, 20000]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 25, r + 25, 128), new THREE.MeshBasicMaterial({ color: 0x4a7a90, transparent: true, opacity: 0.45, fog: false, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.5; this.group.add(ring);
      this.stationLabels.push({ t: `${r / 1000} km`, x: r * 0.7071, y: 20, z: r * 0.7071, k: 'ring' });
    }
    // Precipitation particles over the model block
    const N = 6000; const p = new Float32Array(N * 3); this.rainVel = new Float32Array(N);
    for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() * 2 - 1) * half; p[i * 3 + 1] = Math.random() * this.rainTop; p[i * 3 + 2] = (Math.random() * 2 - 1) * half; this.rainVel[i] = 0.8 + Math.random() * 0.4; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0x9fd2ff, size: 2.5, transparent: true, opacity: 0.7, depthWrite: false, sizeAttenuation: false, fog: false }));
    this.rain.geometry.setDrawRange(0, 0); this.rain.frustumCulled = false; this.rain.userData.pick = 'rain';
    this.group.add(this.rain, this.stationGroup);
  }

  private localWgs(lon: number, lat: number) { const [x, y] = proj4('EPSG:4326', 'EPSG:3007', [lon, lat]); return [x - this.origin[0], -(y - this.origin[1])]; }

  async refresh() {
    const errors: string[] = [];
    await Promise.all([
      this.loadRadar().catch(e => errors.push('radar: ' + e.message)),
      this.loadObs().catch(e => errors.push('observationer: ' + e.message)),
      this.loadSnow().catch(e => errors.push('snödjup: ' + e.message))
    ]);
    this.state.error = errors.length ? errors.join('; ') : null; this.state.fetched = Date.now();
    this.buildStations(); this.updateRain();
    this.onUpdate();
  }

  private async loadRadar() {
    // ?radar=YYMMDDHHMM (UTC) shows an archived radar image instead of the latest, clearly marked.
    const hist = new URLSearchParams(location.search).get('radar');
    const h = hist && /^\d{10}$/.test(hist) ? hist : null;
    const url = h ? `${RADAR}/20${h.slice(0, 2)}/${h.slice(2, 4)}/${h.slice(4, 6)}/radar_${h}.tif` : RADAR + '/latest.tif';
    const [{ fromArrayBuffer }, list, buf] = await Promise.all([
      import('geotiff'),
      h ? Promise.resolve(null) : fetch(RADAR).then(r => r.json()),
      fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    ]);
    this.state.radarHistoric = !!h;
    if (h) this.state.radarTime = `20${h.slice(0, 2)}-${h.slice(2, 4)}-${h.slice(4, 6)}T${h.slice(6, 8)}:${h.slice(8, 10)}:00Z`;
    else { const last = list.lastFiles?.[list.lastFiles.length - 1]; this.state.radarTime = last?.valid ? last.valid.replace(' ', 'T') + ':00Z' : null; }
    const img = await (await fromArrayBuffer(buf)).getImage();
    const [ox, oy] = img.getOrigin(); const [rx, ry] = img.getResolution(); const w = img.getWidth();
    const ras = (await img.readRasters())[0] as Uint8Array;
    const [cE, cN] = proj4('EPSG:3007', 'EPSG:3006', this.origin);
    const px = (e: number, n: number) => [Math.floor((e - ox) / rx), Math.floor((n - oy) / ry)];
    // Regional texture: REGION/2000 pixels around the centre
    const n = this.canvas.width; const ctx = this.canvas.getContext('2d')!; const id = ctx.createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const e = cE - REGION / 2 + (i + 0.5) * (REGION / n), nn = cN + REGION / 2 - (j + 0.5) * (REGION / n);
      const [c, r] = px(e, nn); const v = ras[r * w + c];
      const col = v === 0 || v === 255 || v == null ? [0, 0, 0, 0] : radarColor(toDbz(v));
      id.data.set(col, (j * n + i) * 4);
    }
    ctx.putImageData(id, 0, 0); this.radarTex.needsUpdate = true;
    // Intensity over the city: strongest of the 2x2 pixels around the centre
    const [c0, r0] = px(cE - 1000, cN + 1000); let best = 0, ok = false;
    for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) { const v = ras[(r0 + dr) * w + c0 + dc]; if (v !== 255) { ok = true; best = Math.max(best, v); } }
    this.state.radarOk = ok;
    this.state.radarDbz = best > 0 ? toDbz(best) : null;
    this.state.radarMmH = best > 0 ? toMmH(toDbz(best)) : 0;
  }

  private async loadObs() {
    const P: Record<string, number> = { temp: 1, windDir: 3, wind: 4, precip: 7 };
    const res = await Promise.all(Object.entries(P).map(async ([k, p]) => {
      const j = await fetch(`${OBS}/parameter/${p}/station/${STATION}/period/latest-hour/data.json`).then(r => r.ok ? r.json() : null);
      const v = j?.value?.[j.value.length - 1];
      if (k === 'temp' && j?.position) { const pos = j.position[j.position.length - 1]; const [x, z] = this.localWgs(pos.longitude, pos.latitude); this.state.main = { id: STATION, name: j.station.name, x, z, dist: Math.hypot(x, z) }; }
      return [k, v ? { v: parseFloat(v.value), t: v.date } : null] as const;
    }));
    this.state.obs = Object.fromEntries(res.filter(([, v]) => v)) as Record<string, { v: number; t: number }>;
    if (this.state.main) this.state.main.obs = this.state.obs;
  }

  private async loadSnow() {
    const list = await fetch(`${OBS}/parameter/8.json`).then(r => r.json());
    const near: Station[] = [];
    for (const s of list.station) {
      if (!s.active) continue;
      const [x, z] = this.localWgs(s.longitude, s.latitude); const dist = Math.hypot(x, z);
      if (dist < STATION_RADIUS) near.push({ id: s.id, name: s.name, x, z, dist });
    }
    near.sort((a, b) => a.dist - b.dist);
    await Promise.all(near.slice(0, 8).map(async s => {
      const j = await fetch(`${OBS}/parameter/8/station/${s.id}/period/latest-day/data.json`).then(r => r.ok ? r.json() : null).catch(() => null);
      const v = j?.value?.[j.value.length - 1];
      s.snow = v ? Math.round(parseFloat(v.value) * 100) : null; s.snowTime = v?.date;
    }));
    this.state.snow = near.slice(0, 8).filter(s => s.snow != null);
  }

  private buildStations() {
    this.stationGroup.clear();
    this.stationLabels = this.stationLabels.filter(l => l.k === 'ring');
    const mk = (s: Station, color: number, kind: string, text: string) => {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(25, 25, 400, 8), new THREE.MeshBasicMaterial({ color, fog: false }));
      pin.position.set(s.x, 200, s.z);
      const head = new THREE.Mesh(new THREE.SphereGeometry(90, 16, 12), new THREE.MeshBasicMaterial({ color, fog: false }));
      head.position.set(s.x, 420, s.z);
      pin.userData = head.userData = { pick: kind, station: s };
      this.stationGroup.add(pin, head);
      this.stationLabels.push({ t: text, x: s.x, y: 520, z: s.z, k: 'station' });
    };
    const o = this.state.obs;
    if (this.state.main) mk(this.state.main, 0x4fd1c5, 'station', `${this.state.main.name}${o.temp ? ': ' + o.temp.v.toLocaleString('sv-SE') + ' °C' : ''}`);
    for (const s of this.state.snow) mk(s, 0xe8f2f8, 'snow', `${s.name}: ${s.snow} cm snö`);
  }

  private updateRain() {
    const r = this.state.radarMmH ?? 0; const snow = (this.state.obs.temp?.v ?? 5) <= 0.5;
    const n = r < 0.1 ? 0 : Math.min(6000, Math.round(600 + r * 1200));
    this.rain.geometry.setDrawRange(0, n);
    const m = this.rain.material as THREE.PointsMaterial;
    m.color.set(snow ? 0xffffff : 0x9fd2ff); m.size = snow ? 3.5 : 2.5; this.snowing = snow;
  }
  private snowing = false;

  // Radar map is faint when the weather layer is not in focus, so it does not compete with the city.
  setEmphasis(on: boolean) {
    const m = this.radarMesh.material as THREE.MeshBasicMaterial;
    const target = on ? 0.85 : 0.35;
    if (m.userData.orig) m.userData.orig.opacity = target; else m.opacity = target;
    if (!m.userData.orig || m.opacity > 0.2) m.opacity = target;
  }

  update(dt: number) {
    const count = this.rain.geometry.drawRange.count; if (!count) return;
    const p = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute; const a = p.array as Float32Array;
    const speed = this.snowing ? 25 : 160; const t = performance.now() / 1000;
    for (let i = 0; i < count; i++) {
      a[i * 3 + 1] -= speed * this.rainVel[i] * dt;
      if (this.snowing) a[i * 3] += Math.sin(t + i) * 4 * dt;
      if (a[i * 3 + 1] < 0) { a[i * 3 + 1] = this.rainTop; a[i * 3] = (Math.random() * 2 - 1) * this.half; a[i * 3 + 2] = (Math.random() * 2 - 1) * this.half; }
    }
    p.needsUpdate = true;
  }
}
