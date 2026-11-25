import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LAYERS, ORDER, PROV_LABEL, type LayerKey, type Provenance } from './layers';
import { BASE, Terrain, buildGeology, buildMark, buildStreetFurniture, buildTrees, buildTunnels, buildUtilities, type SceneData } from './build';
import { Traffic, buildStops, profileNow } from './transport';
import { buildingInfo, roadInfo, utilInfo, tunnelInfo, stopInfo, SIGN, nf, type BInfo, type Info } from './info';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const DATA = import.meta.env.BASE_URL + 'data/';

/* ---------- Renderer, camera, controls ---------- */
const canvas = $<HTMLCanvasElement>('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x07121b);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x07121b, 4200, 9000);
const camera = new THREE.PerspectiveCamera(38, 1, 5, 20000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 40; controls.maxDistance = 6000;
controls.maxPolarAngle = Math.PI * 0.94;
controls.autoRotateSpeed = 0.6;

scene.add(new THREE.HemisphereLight(0xbfdcf2, 0x0b1a24, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(900, 1600, 700); scene.add(sun);
const grid = new THREE.GridHelper(6000, 60, 0x1d4a5c, 0x0f2a3a);
(grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.5; scene.add(grid);

// All layers live in `world`, whose y-scale is the vertical exaggeration.
const world = new THREE.Group(); scene.add(world);
const G = {} as Record<LayerKey, THREE.Group>;
ORDER.forEach(k => { G[k] = new THREE.Group(); G[k].name = k; world.add(G[k]); });

/* ---------- State ---------- */
type Mode = 'on' | 'dim' | 'off';
const state = {
  vex: 1.5, vis: {} as Record<string, boolean>, focus: null as LayerKey | null, openOnly: false, labels: true, rot: false,
  sel: 'hus' as LayerKey, explode: 0.5, ex: 0.5
};
ORDER.forEach(k => state.vis[k] = true);
const mode = (k: LayerKey): Mode => {
  if (!state.vis[k] || (state.openOnly && LAYERS[k].prov === 'simulated')) return 'off';
  return state.focus && state.focus !== k ? 'dim' : 'on';
};

// Dim a layer: make all its materials faint and non-depth-writing.
function applyDim(grp: THREE.Object3D, dim: boolean) {
  grp.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      const u = mat.userData;
      if (!u.orig) u.orig = { transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite };
      const want = dim ? { transparent: true, opacity: u.orig.opacity * 0.1, depthWrite: false } : u.orig;
      if (mat.transparent !== want.transparent) mat.needsUpdate = true;
      Object.assign(mat, want);
    }
  });
}
const dimmed: Record<string, boolean> = {};

/* ---------- Layer list ---------- */
const ul = $('layers'); const rows: Record<string, HTMLLIElement> = {};
ORDER.forEach(k => {
  const L = LAYERS[k], li = document.createElement('li');
  li.innerHTML = `<button type="button" class="sw" style="--c:${L.c}" aria-pressed="true" aria-label="Visa eller släck ${L.name}"></button>` +
    `<button type="button" class="nm">${L.name}</button>` +
    `<span class="badge ${L.prov}">${PROV_LABEL[L.prov]}</span>` +
    `<button type="button" class="solo" aria-pressed="false" aria-label="Fokusera på ${L.name}, tona ned övriga">Fokus</button>`;
  ul.appendChild(li); rows[k] = li;
  const focus = () => { state.focus = state.focus === k ? null : k; state.sel = k; if (state.focus) state.vis[k] = true; sync(); };
  li.querySelector<HTMLButtonElement>('.sw')!.onclick = () => { state.vis[k] = !state.vis[k]; if (!state.vis[k] && state.focus === k) state.focus = null; sync(); };
  li.querySelector<HTMLButtonElement>('.nm')!.onclick = focus;
  li.querySelector<HTMLButtonElement>('.solo')!.onclick = focus;
});
function sync() {
  ORDER.forEach(k => {
    const m = mode(k);
    G[k].visible = m !== 'off';
    const dim = m === 'dim';
    if (dimmed[k] !== dim) { applyDim(G[k], dim); dimmed[k] = dim; }
    rows[k].classList.toggle('sel', state.sel === k);
    rows[k].classList.toggle('hidden-open', state.openOnly && LAYERS[k].prov === 'simulated');
    rows[k].classList.toggle('dim', dim);
    rows[k].querySelector('.sw')!.setAttribute('aria-pressed', String(state.vis[k]));
    rows[k].querySelector('.solo')!.setAttribute('aria-pressed', String(state.focus === k));
  });
  $('focusHint').textContent = state.focus ? `Fokus: ${LAYERS[state.focus].name}. Övriga lager är nedtonade. Tryck igen för att visa alla.` : 'Tryck på ett lagers namn för att fokusera på det. Rutan till vänster släcker lagret.';
  const L = LAYERS[state.sel];
  $('detail').innerHTML = `<h3>${L.name} <span class="badge ${L.prov}">${PROV_LABEL[L.prov]}</span></h3><p>${L.text}</p><div class="src">${L.src}</div>` +
    (L.chips ? '<div class="chips">' + L.chips.map(c => `<span class="chip" style="--c:${c[0]}"><i></i>${c[1]}</span>`).join('') + '</div>' : '');
}

/* ---------- Controls ---------- */
$<HTMLInputElement>('explode').oninput = e => { const v = +(e.target as HTMLInputElement).value; state.explode = v / 100; $('exO').textContent = v + '%'; };
$<HTMLInputElement>('vex').oninput = e => { state.vex = +(e.target as HTMLInputElement).value / 10; $('vexO').textContent = state.vex.toLocaleString('sv-SE') + '×'; };
const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e5);
renderer.clippingPlanes = [clipPlane];
let half = 750;
$<HTMLInputElement>('cut').oninput = e => {
  const v = +(e.target as HTMLInputElement).value / 100;
  clipPlane.constant = v === 0 ? 1e5 : half + 5 - v * (2 * half + 10);
  $('cutO').textContent = v === 0 ? 'av' : Math.round(v * 100) + '%';
};
function toggle(id: string, key: 'openOnly' | 'labels' | 'rot', fn?: () => void) {
  const b = $(id); b.onclick = () => { state[key] = !state[key]; b.setAttribute('aria-pressed', String(state[key])); b.querySelector('.sv')!.textContent = state[key] ? 'på' : 'av'; fn?.(); };
}
toggle('tOpen', 'openOnly', sync);
toggle('tLbl', 'labels');
toggle('tRot', 'rot', () => { controls.autoRotate = state.rot; });

const panel = $('panel'), mq = window.matchMedia('(max-width:760px)');
function setSheet(open: boolean) {
  panel.classList.toggle('closed', !open);
  $('sheetToggle').setAttribute('aria-expanded', String(open));
  $('sheetToggle').textContent = open ? 'Stäng' : 'Lager';
  resize();
}
$('sheetToggle').onclick = () => { $('sheetToggle').dataset.touched = '1'; setSheet(panel.classList.contains('closed')); };
function syncPanelMode() { if (!mq.matches) panel.classList.remove('closed'); else if (!$('sheetToggle').dataset.touched) panel.classList.add('closed'); }
mq.addEventListener('change', () => { syncPanelMode(); resize(); });
syncPanelMode();

/* ---------- Camera presets ---------- */
const CAMS: Record<string, [number[], number[]]> = {
  over: [[1250, 1150, 1650], [0, -20, 0]],
  side: [[0, 60, 2700], [0, -30, 0]],
  top: [[0, 2700, 30], [0, 0, 0]]
};
// Portrait screens need the camera further away to fit the square.
const fit = (p: number[], t: number[]) => {
  const f = Math.max(1, 1.05 / Math.max(0.3, camera.aspect));
  return new THREE.Vector3(t[0] + (p[0] - t[0]) * f, t[1] + (p[1] - t[1]) * f, t[2] + (p[2] - t[2]) * f);
};
let tween: { p: THREE.Vector3; t: THREE.Vector3 } | null = null;
document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach(b => b.onclick = () => {
  const c = CAMS[b.dataset.cam!]; tween = { p: fit(c[0], c[1]), t: new THREE.Vector3(...c[1]) };
});
controls.addEventListener('start', () => { tween = null; });
controls.target.set(0, -20, 0);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  if (mq.matches) { const ph = panel.getBoundingClientRect().height; camera.setViewOffset(w, h, 0, Math.round(ph / 2), w, h); }
  else camera.setViewOffset(w, h, -180, 0, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();
camera.position.copy(fit(CAMS.over[0], CAMS.over[1]));
new ResizeObserver(resize).observe(panel);

/* ---------- Labels with zoom levels ---------- */
// lv 0: overview, 1: block (streets, places, stops), 2: close-up (buildings)
const labelHost = $('labels');
interface Label { t: string; x: number; y: number; z: number; g: LayerKey; k: string; lv: number; el: HTMLDivElement; side?: boolean; prio: number; w?: number; h?: number }
const LABELS: Label[] = [];
const PRIO: Record<string, number> = { Centralstationen: 0, Nordstan: 0, Trädgårdsföreningen: 0, Kungsportsplatsen: 0, 'Göta älv': 1 };
function addLabel(l: Omit<Label, 'el' | 'prio' | 'lv'> & { prio?: number; lv?: number }) {
  const el = document.createElement('div'); el.className = 'lbl ' + l.k; el.textContent = l.t; labelHost.appendChild(el);
  const lv = l.lv ?? 0;
  LABELS.push({ ...l, lv, el, prio: l.prio ?? PRIO[l.t] ?? (lv === 0 ? 2 : 2 + lv) });
}
const LV_DIST = [Infinity, 1300, 520]; // max camera distance (m) at which a level is shown

/* ---------- Picking and info card ---------- */
let bInfo: BInfo[] = []; let rInfo: [number, string | null, string, string | null, string | null, number, number | string][] = [];
let bMesh: THREE.Mesh | null = null, rMesh: THREE.Mesh | null = null;
let terrain: Terrain; let geo: ReturnType<typeof buildGeology>; let sd: SceneData; let traffic: Traffic | null = null;
let highlight: THREE.Object3D | null = null;
const marker = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0x4fd1c5, depthTest: false }));
marker.renderOrder = 10; marker.visible = false; scene.add(marker);

const findIdx = <T,>(arr: T[], f: number, start: (t: T) => number) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (start(arr[mid]) <= f) lo = mid; else hi = mid - 1; } return lo; };
const SOIL: Record<string, string> = { 'Postglacial lera': 'Postglacial lera', Fyllning: 'Fyllning', Urberg: 'Berg i dagen', Vatten: 'Vatten' };
const LC_NAME = ['Hårdgjord yta', 'Park eller grönyta', 'Vatten', 'Järnvägsområde', 'Torg'];

function highlightTris(mesh: THREE.Mesh, start: number, count: number) {
  const src = mesh.geometry; const idx = src.getIndex()!; const pos = src.getAttribute('position'); const p: number[] = [];
  for (let t = start * 3; t < (start + count) * 3; t++) { const v = idx.getX(t); p.push(pos.getX(v), pos.getY(v), pos.getZ(v)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals();
  const h = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x4fd1c5, emissive: 0x0f5a54, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mesh.parent!.add(h); return h;
}

function infoFor(hit: THREE.Intersection, layer: LayerKey): Info | null {
  const o = hit.object; const kind = o.userData.pick as string | undefined;
  const p = G[layer].worldToLocal(hit.point.clone()); const id = hit.instanceId ?? -1;
  if (o === bMesh && hit.faceIndex != null) {
    const b = bInfo[findIdx(bInfo, hit.faceIndex, x => x.triStart)];
    highlight = highlightTris(bMesh!, b.triStart, b.triCount);
    return buildingInfo(b);
  }
  if (o === rMesh && hit.faceIndex != null) {
    const r = rInfo[findIdx(rInfo, hit.faceIndex, x => x[0])];
    const drivable = !['pedestrian', 'footway', 'cycleway', 'path', 'steps', 'square'].includes(r[2]);
    const flow = traffic && mode('trafik') !== 'off' && drivable ? traffic.flowFor(['trunk', 'primary', 'secondary', 'tertiary'].some(h => r[2].startsWith(h)), !!r[5]) : null;
    return roadInfo(r, flow);
  }
  const ground = terrain.at(p.x, p.z);
  switch (kind) {
    case 'stop': return stopInfo(o.userData.items[id]);
    case 'car': {
      const c = (o.userData.traffic as Traffic).carInfo(id);
      return { title: 'Bil', sub: c.street ? 'På ' + c.street : undefined, prov: 'simulated', rows: [['Hastighet', `ca ${c.kmh} km/h`, 'simulated'], ['Hastighetsgräns', `${c.limit} km/h`, 'measured']],
        note: 'Bilen är simulerad. Gatan, riktningen och hastighetsgränsen är verkliga (OpenStreetMap). Antalet bilar följer en typisk dygnsprofil.' };
    }
    case 'util': return utilInfo(o.userData.items[id]);
    case 'tunnel': return tunnelInfo(o.userData.item, o.userData.length, ground - p.y);
    case 'tree': {
      const t = o.userData.items[id] as number[];
      return { title: t[3] ? 'Barrträd' : 'Lövträd', prov: 'measured', rows: [['Läge', 'Inmätt', 'measured'], ['Markhöjd', `+${nf(t[1])} m ö.h.`, 'measured'], ['Storlek i modellen', 'Schablon', 'simulated']],
        note: 'Trädets läge kommer från Göteborgs Stads baskarta. Kronans storlek är inte mätt.' };
    }
    case 'lamp': return { title: 'Belysningsstolpe', prov: 'measured', rows: [['Läge', 'Inmätt', 'measured'], ['Höjd i modellen', 'Schablon 7 m', 'simulated']], note: 'Läge från Göteborgs Stads baskarta.' };
    case 'sign': {
      const s = o.userData.items[id]; return { title: SIGN[s[3]] ?? 'Skylt', prov: 'measured', rows: [['Läge', 'OpenStreetMap', 'measured']], note: 'Signaler och skyltar som är registrerade i OpenStreetMap. Alla skyltar finns inte med.' };
    }
    case 'water': case 'ground': {
      const lc = terrain.lc[Math.round((p.z + half) / terrain.step) * terrain.n + Math.round((p.x + half) / terrain.step)];
      if (kind === 'water' || lc === 2) {
        let best = '', bd = 140; for (const w of sd.waters) for (const q of w.pts) { const dd = Math.hypot(q[0] - p.x, q[1] - p.z); if (dd < bd) { bd = dd; best = w.n; } }
        return { title: best || 'Vatten', sub: 'Vattenyta', prov: 'derived', rows: [['Yta', 'Beräknad ur höjdmodellen', 'derived']], note: 'Vattenytan är beräknad ur höjdmodellen och kontrollerad mot SGU:s kartlagda vatten. Namn från OpenStreetMap.' };
      }
      return { title: LC_NAME[lc] ?? 'Mark', prov: 'measured', rows: [['Markhöjd', `+${nf(ground)} m ö.h.`, 'measured'], ['Djup till berg', `ca ${Math.round(geo.depthAt(p.x, p.z))} m`, 'measured']],
        note: 'Markhöjd från Göteborgs Stads höjdmodell 2022 (laserskanning). Marktyp från OpenStreetMap. Jorddjup från SGU.' };
    }
    case 'soil': {
      const soil = geo.soilAt(p.x, p.z); const depth = geo.depthAt(p.x, p.z);
      return { title: 'Jordlager', sub: soil ? 'I ytan: ' + (SOIL[soil] ?? soil) : undefined, prov: 'measured',
        rows: [['Djup till berg', `ca ${Math.round(depth)} m`, 'measured'], ['Jordart i ytan', soil ? (SOIL[soil] ?? soil) : 'okänd', 'measured']],
        details: [['Bergytan', `${nf(geo.bedrockAt(p.x, p.z))} m ö.h.`, 'derived']],
        note: 'SGU:s jorddjupsmodell och jordartskarta 1:25 000. Under ytan består jordlagret här främst av lera.' };
    }
    case 'rock': {
      return { title: 'Berggrund', sub: sd.sgu.rock.join(', '), prov: 'derived',
        rows: [['Bergytan här', `${nf(geo.bedrockAt(p.x, p.z))} m ö.h.`, 'derived'], ['Bergart', sd.sgu.rock[0] ?? '?', 'measured']],
        details: [['Enhet', sd.sgu.rockUnit ?? '', 'measured']],
        note: 'Bergytan är beräknad som markhöjd minus SGU:s jorddjup. Bergart från SGU:s berggrundskarta 1:50 000.' };
    }
  }
  return null;
}

const DOT: Record<Provenance, string> = { measured: 'Öppen data', derived: 'Beräknad', simulated: 'Simulerad' };
function showInfo(info: Info | null) {
  const el = $('pick');
  if (!info) { el.classList.remove('on'); return; }
  const row = (r: Info['rows'][number]) => `<dt>${r[0]}</dt><dd>${r[1]}</dd>${r[2] ? `<i class="dot ${r[2]}" title="${DOT[r[2]]}"></i>` : '<i></i>'}`;
  el.innerHTML = `<h3><span>${info.title}</span><button class="x" type="button" aria-label="Stäng">Stäng</button></h3>` +
    (info.sub ? `<div class="sub">${info.sub}</div>` : '') +
    `<dl>${info.rows.map(row).join('')}</dl>` +
    (info.details?.length || info.note ? `<button type="button" class="more" aria-expanded="false">Visa detaljer</button><div class="det" hidden>` +
      (info.details?.length ? `<dl>${info.details.map(row).join('')}</dl>` : '') + (info.note ? `<div class="src">${info.note}</div>` : '') + '</div>' : '');
  el.classList.add('on');
  el.querySelector<HTMLButtonElement>('.x')!.onclick = () => { clearPick(); showInfo(null); };
  const more = el.querySelector<HTMLButtonElement>('.more');
  if (more) more.onclick = () => { const d = el.querySelector<HTMLElement>('.det')!; d.hidden = !d.hidden; more.setAttribute('aria-expanded', String(!d.hidden)); more.textContent = d.hidden ? 'Visa detaljer' : 'Dölj detaljer'; };
}
function clearPick() {
  if (highlight) { (highlight as THREE.Mesh).geometry?.dispose(); highlight.removeFromParent(); highlight = null; }
  marker.visible = false;
}

const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down: [number, number] | null = null;
canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6 || !sd) { down = null; return; }
  down = null;
  const r = canvas.getBoundingClientRect();
  // Only layers that are fully on (not dimmed) can be tapped. Try a small ring of offsets so thin
  // objects (pipes, signs, cars) are easy to hit with a finger.
  const active = ORDER.filter(k => mode(k) === 'on').map(k => G[k]);
  clearPick();
  const OFFS = [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8], [14, 14], [-14, 14], [14, -14], [-14, -14], [20, 0], [-20, 0], [0, 20], [0, -20]];
  for (const [ox, oy] of OFFS) {
    ndc.set(((e.clientX + ox - r.left) / r.width) * 2 - 1, -((e.clientY + oy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(active, true)
      .filter(h => clipPlane.distanceToPoint(h.point) >= 0 && !(h.object as THREE.Line).isLine && h.object !== highlight && h.object.visible);
    // Off-centre rays only count for small objects, not for big surfaces behind them.
    const small = (h: THREE.Intersection) => ['util', 'sign', 'lamp', 'car', 'stop', 'tree', 'tunnel'].includes(h.object.userData.pick);
    for (const h of hits) {
      if ((ox || oy) && !small(h)) continue;
      let o: THREE.Object3D | null = h.object; while (o && !ORDER.includes(o.name as LayerKey)) o = o.parent;
      if (!o) continue;
      const info = infoFor(h, o.name as LayerKey);
      if (info) {
        if (!highlight) { marker.position.copy(h.point); marker.visible = true; }
        showInfo(info);
        if (mq.matches && panel.classList.contains('closed')) setSheet(true);
        return;
      }
      if (!(ox || oy)) break;
    }
  }
  showInfo(null);
});

/* ---------- Load data ---------- */
async function load() {
  const gltf = new GLTFLoader();
  const [scn, tbuf, bjson, rjson, bglb, rglb] = await Promise.all([
    fetch(DATA + 'scene.json').then(r => r.json()) as Promise<SceneData>,
    fetch(DATA + 'terrain.bin').then(r => r.arrayBuffer()),
    fetch(DATA + 'buildings.json').then(r => r.json()),
    fetch(DATA + 'roads.json').then(r => r.json()),
    gltf.loadAsync(DATA + 'buildings.glb'),
    gltf.loadAsync(DATA + 'roads.glb')
  ]);
  sd = scn;
  terrain = new Terrain(tbuf, sd.terrain.n, sd.terrain.step);
  half = terrain.half;

  bMesh = bglb.scene.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
  bMesh.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  G.hus.add(bglb.scene);
  bInfo = (bjson.rows as unknown[][]).map(r => Object.fromEntries((bjson.fields as string[]).map((f, i) => [f, r[i]])) as unknown as BInfo);
  rInfo = rjson;

  rMesh = rglb.scene.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
  rMesh.material = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  G.vagar.add(rglb.scene, buildStreetFurniture(sd));

  G.mark.add(buildMark(terrain), buildTrees(sd));
  G.ledn.add(buildUtilities(sd));
  G.tunnlar.add(buildTunnels(sd));
  geo = buildGeology(sd, terrain);
  G.jord.add(geo.jord); G.berg.add(geo.berg);
  G.kollektiv.add(buildStops(sd));
  traffic = new Traffic(sd);
  G.trafik.add(traffic.group);

  sd.labels.forEach(l => addLabel({ ...l, g: l.g as LayerKey }));
  // Strata labels at the corner with the deepest soil.
  const corners = [[half, half], [half, -half], [-half, half], [-half, -half]];
  const depthC = (c: number[]) => terrain.at(c[0], c[1]) - geo.bedrockAt(c[0], c[1]);
  const [cx, cz] = corners.reduce((b, c) => (depthC(c) > depthC(b) ? c : b));
  const gT = terrain.at(cx, cz), gR = geo.bedrockAt(cx, cz), lx = cx + Math.sign(cx) * 4, lz = cz + Math.sign(cz) * 4;
  addLabel({ t: 'Fyllning (schematisk)', x: lx, y: gT - 1.5, z: lz, g: 'mark', k: 'strata', side: true, prio: 1 });
  addLabel({ t: `Lera, ${Math.round(gT - gR)} m till berg`, x: lx, y: (gT + gR) / 2, z: lz, g: 'jord', k: 'strata', side: true, prio: 1 });
  addLabel({ t: 'Berg (' + (sd.sgu.rock[0] ?? 'berggrund').split('-')[0].toLowerCase() + ')', x: lx, y: (gR + BASE) / 2, z: lz, g: 'berg', k: 'strata', side: true, prio: 1 });
  LABELS.sort((a, b) => a.prio - b.prio);

  $('sB').textContent = String(sd.stats.buildings);
  $('sC').textContent = String(traffic.cars.length);
  $('sH').textContent = String(sd.stops.length);
  const h = sd.stats.heights;
  $('foot').innerHTML = `Område 1,5 × 1,5 km, SWEREF 99 12 00. ${h.baskarta} hus har höjd ur uppmätta tak, ${h.osmHeight ?? 0} har höjd från OSM, ${h.osmLevels} är beräknade från våningsantal och ${h.fallback} saknar mätning (grå). ` +
    `Biltrafiken är simulerad (${Math.round(profileNow() * 100)} % av rusningstrafik just nu). ` +
    `Data: Göteborgs Stads baskarta ${sd.sources.baskarta.date} och höjdmodell 2022 (CC0), SGU (CC0, hämtat ${sd.sources.sgu.date}), © OpenStreetMaps bidragsgivare, ODbL (hämtat ${sd.sources.osm.date}).`;
  sync();
  $('loader').classList.add('done');
}
sync();
load().catch(err => { console.error(err); $('loader').textContent = 'Kunde inte ladda data: ' + err.message; });

/* ---------- Loop ---------- */
const v3 = new THREE.Vector3();
let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
// Test hook: lets automated checks project scene positions to the screen.
(window as unknown as { __twin: unknown }).__twin = { camera, G, get sd() { return sd; } };
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  state.ex += (state.explode - state.ex) * Math.min(1, dt * 6);
  ORDER.forEach(k => { G[k].position.y = LAYERS[k].off * state.ex; });
  world.scale.y += (state.vex - world.scale.y) * Math.min(1, dt * 6);
  grid.position.y = (BASE + LAYERS.berg.off * state.ex) * world.scale.y - 60;
  if (tween) {
    camera.position.lerp(tween.p, Math.min(1, dt * 3)); controls.target.lerp(tween.t, Math.min(1, dt * 3));
    if (camera.position.distanceTo(tween.p) < 1) tween = null;
  }
  if (traffic && G.trafik.visible) traffic.update(dt);
  controls.update();
  renderer.render(scene, camera);

  const w = window.innerWidth, h = window.innerHeight;
  const placed: number[][] = []; const phone = mq.matches; const seen = new Map<string, [number, number][]>();
  for (const L of LABELS) {
    const grp = G[L.g];
    v3.set(L.x, L.y, L.z); grp.localToWorld(v3);
    const dist = camera.position.distanceTo(v3);
    const cut = clipPlane.distanceToPoint(v3) < 0;
    const focused = state.focus === L.g && L.lv <= 1;
    let show = state.labels && grp.visible && !dimmed[L.g] && !cut && (focused || dist < LV_DIST[L.lv] * (phone ? 0.8 : 1));
    if (show) { v3.project(camera); show = v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05 && !(phone && L.lv === 0 && L.prio >= 2 && !L.side && dist > 1500); }
    const px = (v3.x * 0.5 + 0.5) * w, py = (-v3.y * 0.5 + 0.5) * h;
    if (show) {
      if (L.w == null || L.w === 0) { L.el.style.display = 'block'; L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      const x0 = L.side ? px + 8 : px - L.w! / 2, y0 = L.side ? py - L.h! / 2 : py - L.h! * 1.2;
      const r = [x0 - 3, y0 - 2, x0 + L.w! + 3, y0 + L.h! + 2];
      const same = seen.get(L.t);
      if (placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) || same?.some(([sx, sy]) => Math.hypot(sx - px, sy - py) < 260)) show = false;
      else { placed.push(r); (same ?? seen.set(L.t, []).get(L.t)!).push([px, py]); }
    }
    if (show) {
      L.el.style.display = 'block';
      L.el.style.transform = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px) ` + (L.side ? 'translate(8px,-50%)' : 'translate(-50%,-120%)');
    } else if (L.el.style.display !== 'none') L.el.style.display = 'none';
  }
}
requestAnimationFrame(frame);
// Test hook: lets automated checks project scene positions to the screen.
(window as unknown as { __twin: unknown }).__twin = { camera, G, get sd() { return sd; } };
