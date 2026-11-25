import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LAYERS, ORDER, PROV_LABEL, type LayerKey } from './layers';
import { BASE, Terrain, buildGeology, buildMark, buildStreetFurniture, buildTrees, buildTunnels, buildUtilities, type SceneData } from './build';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const DATA = import.meta.env.BASE_URL + 'data/';

/* ---------- Renderer, camera, controls ---------- */
const canvas = $<HTMLCanvasElement>('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x07121b);
renderer.localClippingEnabled = false;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x07121b, 4200, 9000);
const camera = new THREE.PerspectiveCamera(38, 1, 5, 20000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 60; controls.maxDistance = 6000;
controls.maxPolarAngle = Math.PI * 0.94;
controls.autoRotateSpeed = 0.6;

scene.add(new THREE.HemisphereLight(0xbfdcf2, 0x0b1a24, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(900, 1600, 700); scene.add(sun);
const grid = new THREE.GridHelper(6000, 60, 0x1d4a5c, 0x0f2a3a); grid.position.y = BASE - 160;
(grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.5; scene.add(grid);

// All layers live in `world`, whose y-scale is the vertical exaggeration.
const world = new THREE.Group(); scene.add(world);
const G = {} as Record<LayerKey, THREE.Group>;
ORDER.forEach(k => { G[k] = new THREE.Group(); G[k].name = k; world.add(G[k]); });

/* ---------- State ---------- */
const state = { vex: 1.5, vis: {} as Record<string, boolean>, solo: null as string | null, openOnly: false, labels: true, rot: false, sel: 'hus' as LayerKey, explode: 0.5, ex: 0.5 };
ORDER.forEach(k => state.vis[k] = true);

/* ---------- Layer list ---------- */
const ul = $('layers'); const rows: Record<string, HTMLLIElement> = {};
ORDER.forEach(k => {
  const L = LAYERS[k], li = document.createElement('li');
  li.innerHTML = `<button type="button" class="sw" style="--c:${L.c}" aria-pressed="true" aria-label="Visa eller dölj ${L.name}"></button>` +
    `<button type="button" class="nm">${L.name}</button>` +
    `<span class="badge ${L.prov}">${PROV_LABEL[L.prov]}</span>` +
    `<button type="button" class="solo" aria-pressed="false" aria-label="Visa bara ${L.name}">Solo</button>`;
  ul.appendChild(li); rows[k] = li;
  li.querySelector<HTMLButtonElement>('.sw')!.onclick = () => { state.vis[k] = !state.vis[k]; sync(); };
  li.querySelector<HTMLButtonElement>('.nm')!.onclick = () => { state.sel = k; sync(); };
  li.querySelector<HTMLButtonElement>('.solo')!.onclick = () => { state.solo = state.solo === k ? null : k; state.sel = k; sync(); };
});
function sync() {
  ORDER.forEach(k => {
    const L = LAYERS[k];
    const hiddenByOpen = state.openOnly && L.prov === 'simulated';
    G[k].visible = state.vis[k] && !hiddenByOpen && (!state.solo || state.solo === k);
    rows[k].classList.toggle('sel', state.sel === k);
    rows[k].classList.toggle('hidden-open', hiddenByOpen);
    rows[k].querySelector('.sw')!.setAttribute('aria-pressed', String(state.vis[k]));
    rows[k].querySelector('.solo')!.setAttribute('aria-pressed', String(state.solo === k));
  });
  const L = LAYERS[state.sel];
  $('detail').innerHTML = `<h3>${L.name} <span class="badge ${L.prov}">${PROV_LABEL[L.prov]}</span></h3><p>${L.text}</p><div class="src">${L.src}</div>` +
    (L.chips ? '<div class="chips">' + L.chips.map(c => `<span class="chip" style="--c:${c[0]}"><i></i>${c[1]}</span>`).join('') + '</div>' : '');
}
sync();

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
$('sheetToggle').onclick = () => {
  $('sheetToggle').dataset.touched = '1';
  const closed = panel.classList.toggle('closed');
  $('sheetToggle').setAttribute('aria-expanded', String(!closed));
  $('sheetToggle').textContent = closed ? 'Lager' : 'Stäng';
  resize();
};
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
camera.position.set(...(CAMS.over[0] as [number, number, number])); controls.target.set(...(CAMS.over[1] as [number, number, number]));

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

/* ---------- Labels ---------- */
const labelHost = $('labels');
interface Label { t: string; x: number; y: number; z: number; g: LayerKey; k: string; el: HTMLDivElement; side?: boolean; prio: number; w?: number; h?: number }
const LABELS: Label[] = [];
// Lower prio = placed first. Landmarks of the demo come first; minor ones are hidden on phones.
const PRIO: Record<string, number> = { Centralstationen: 0, Nordstan: 0, Trädgårdsföreningen: 0, Kungsportsplatsen: 0, 'Göta älv': 1 };
function addLabel(l: Omit<Label, 'el' | 'prio'> & { prio?: number }) {
  const el = document.createElement('div'); el.className = 'lbl ' + l.k; el.textContent = l.t; labelHost.appendChild(el);
  LABELS.push({ ...l, el, prio: l.prio ?? PRIO[l.t] ?? 2 }); LABELS.sort((a, b) => a.prio - b.prio);
}

/* ---------- Building picking ---------- */
interface BInfo { id: string; name: string | null; height: number; ground: number; src: string; triStart: number; triCount: number; x: number; z: number; kind: string; area: number }
let bInfo: BInfo[] = []; let bMesh: THREE.Mesh | null = null; let highlight: THREE.Mesh | null = null;
const SRC_TEXT: Record<string, [string, string]> = {
  baskarta: ['Uppmätt takhöjd (baskartan) minus markhöjd (höjdmodellen)', 'derived'],
  'osm-height': ['Höjd angiven i OpenStreetMap', 'measured'],
  'osm-levels': ['Uppskattad ur antal våningar i OpenStreetMap', 'derived'],
  fallback: ['Saknar mätning, schablon 6 m', 'simulated']
};
const KIND: Record<string, string> = { yes: 'Byggnad', retail: 'Handel', office: 'Kontor', apartments: 'Bostäder', residential: 'Bostäder', civic: 'Offentlig', commercial: 'Kommersiell', hotel: 'Hotell', train_station: 'Station', government: 'Offentlig förvaltning', church: 'Kyrka', greenhouse: 'Växthus', parking: 'Parkering', school: 'Skola', university: 'Universitet', roof: 'Tak', industrial: 'Industri', public: 'Offentlig', sports_hall: 'Idrottshall', kiosk: 'Kiosk' };
function showBuilding(b: BInfo | null) {
  const el = $('pick');
  if (highlight) { highlight.geometry.dispose(); highlight.removeFromParent(); highlight = null; }
  if (!b || !bMesh) { el.classList.remove('on'); return; }
  const [srcText, prov] = SRC_TEXT[b.src] ?? [b.src, 'derived'];
  el.innerHTML = `<h3><span>${b.name ?? KIND[b.kind] ?? 'Byggnad'}</span><button class="x" type="button" aria-label="Stäng">Stäng</button></h3>` +
    `<dl><dt>Höjd</dt><dd>${b.height.toFixed(1)} m</dd><span class="badge ${prov}">${PROV_LABEL[prov as keyof typeof PROV_LABEL]}</span>` +
    `<dt>Markhöjd</dt><dd>+${b.ground.toFixed(1)} m</dd><span class="badge measured">Öppen data</span>` +
    `<dt>Yta</dt><dd>${b.area.toLocaleString('sv-SE')} m²</dd><span class="badge measured">Öppen data</span>` +
    `<dt>Typ</dt><dd>${KIND[b.kind] ?? b.kind}</dd><span></span></dl>` +
    `<div class="src">Höjd: ${srcText}. Fotavtryck: OpenStreetMap ${b.id}. Markhöjd i RH 2000 från höjdmodell 2022.</div>`;
  el.classList.add('on');
  el.querySelector<HTMLButtonElement>('.x')!.onclick = () => showBuilding(null);
  // Highlight copy of the building's triangles
  const src = bMesh.geometry; const idx = src.getIndex()!; const pos = src.getAttribute('position');
  const p: number[] = [];
  for (let t = b.triStart * 3; t < (b.triStart + b.triCount) * 3; t++) { const v = idx.getX(t); p.push(pos.getX(v), pos.getY(v), pos.getZ(v)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals();
  highlight = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x4fd1c5, emissive: 0x0f5a54, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  bMesh.parent!.add(highlight);
}
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down: [number, number] | null = null;
canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6 || !bMesh || !G.hus.visible) { down = null; return; }
  down = null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(bMesh, false).find(h => clipPlane.distanceToPoint(h.point) >= 0);
  if (!hit || hit.faceIndex == null) { showBuilding(null); return; }
  const f = hit.faceIndex; let lo = 0, hi = bInfo.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bInfo[mid].triStart <= f) lo = mid; else hi = mid - 1; }
  showBuilding(bInfo[lo]);
  if (mq.matches && panel.classList.contains('closed')) $('sheetToggle').click();
});

/* ---------- Load data ---------- */
async function load() {
  const gltf = new GLTFLoader();
  const [sd, tbuf, bjson, bglb, rglb] = await Promise.all([
    fetch(DATA + 'scene.json').then(r => r.json()) as Promise<SceneData>,
    fetch(DATA + 'terrain.bin').then(r => r.arrayBuffer()),
    fetch(DATA + 'buildings.json').then(r => r.json()),
    gltf.loadAsync(DATA + 'buildings.glb'),
    gltf.loadAsync(DATA + 'roads.glb')
  ]);
  const terrain = new Terrain(tbuf, sd.terrain.n, sd.terrain.step);
  half = terrain.half;

  // Buildings
  bMesh = bglb.scene.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
  bMesh.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  G.hus.add(bglb.scene);
  bInfo = (bjson.rows as unknown[][]).map(r => Object.fromEntries((bjson.fields as string[]).map((f, i) => [f, r[i]])) as unknown as BInfo);

  // Roads and street furniture
  rglb.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }); });
  G.vagar.add(rglb.scene, buildStreetFurniture(sd));

  // Ground, water, trees
  G.mark.add(buildMark(terrain), buildTrees(sd));
  // Underground
  G.ledn.add(buildUtilities(sd));
  G.tunnlar.add(buildTunnels(sd));
  const geo = buildGeology(sd, terrain);
  G.jord.add(geo.jord); G.berg.add(geo.berg);

  // Labels
  sd.labels.forEach(l => addLabel({ ...l, g: l.g as LayerKey }));
  // Strata labels at the corner with the deepest soil (most telling profile).
  const corners = [[half, half], [half, -half], [-half, half], [-half, -half]];
  const [cx, cz] = corners.reduce((b, c) => (terrain.at(c[0], c[1]) - geo.bedrockAt(c[0], c[1]) > terrain.at(b[0], b[1]) - geo.bedrockAt(b[0], b[1]) ? c : b));
  const gT = terrain.at(cx, cz), gR = geo.bedrockAt(cx, cz), lx = cx + Math.sign(cx) * 4, lz = cz + Math.sign(cz) * 4;
  addLabel({ t: 'Fyllning (schematisk)', x: lx, y: gT - 1.5, z: lz, g: 'mark', k: 'strata', side: true, prio: 1 });
  addLabel({ t: `Lera, ${Math.round(gT - gR)} m till berg`, x: lx, y: (gT + gR) / 2, z: lz, g: 'jord', k: 'strata', side: true, prio: 1 });
  addLabel({ t: 'Berg (' + (sd.sgu.rock[0] ?? 'berggrund').split('-')[0].toLowerCase() + ')', x: lx, y: (gR + BASE) / 2, z: lz, g: 'berg', k: 'strata', side: true, prio: 1 });

  // Stats and footer
  $('sB').textContent = String(sd.stats.buildings);
  $('sTr').textContent = String(sd.stats.trees);
  $('sS').textContent = String(sd.stats.signs);
  const h = sd.stats.heights;
  $('foot').innerHTML = `Område 1,5 × 1,5 km, SWEREF 99 12 00. ${h.baskarta} hus har uppmätt höjd, ${h['osm-height'] ?? h.osmHeight ?? 0} har höjd från OSM, ${h.osmLevels} är beräknade från våningsantal och ${h.fallback} saknar mätning (grå, schablon 6 m). ` +
    `Data: Göteborgs Stads baskarta ${sd.sources.baskarta.date} och höjdmodell 2022 (CC0), SGU (hämtat ${sd.sources.sgu.date}), © OpenStreetMaps bidragsgivare, ODbL (hämtat ${sd.sources.osm.date}). Höjdskalan kan överdrivas med reglaget.`;
  $('loader').classList.add('done');
}
load().catch(err => { console.error(err); $('loader').textContent = 'Kunde inte ladda data: ' + err.message; });

/* ---------- Loop ---------- */
const v3 = new THREE.Vector3();
let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  state.ex += (state.explode - state.ex) * Math.min(1, dt * 6);
  ORDER.forEach(k => { G[k].position.y = LAYERS[k].off * state.ex; });
  world.scale.y += (state.vex - world.scale.y) * Math.min(1, dt * 6);
  grid.position.y = (BASE + LAYERS.berg.off * state.ex) * world.scale.y - 60;
  if (tween) {
    camera.position.lerp(tween.p, Math.min(1, dt * 3)); controls.target.lerp(tween.t, Math.min(1, dt * 3));
    if (camera.position.distanceTo(tween.p) < 1) tween = null;
  }
  controls.update();
  renderer.render(scene, camera);

  const w = window.innerWidth, h = window.innerHeight;
  const placed: number[][] = []; const phone = mq.matches;
  for (const L of LABELS) {
    const grp = G[L.g];
    v3.set(L.x, L.y, L.z); grp.localToWorld(v3);
    const cut = clipPlane.distanceToPoint(v3) < 0;
    v3.project(camera);
    let show = state.labels && grp.visible && !cut && v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05 && !(phone && L.prio >= 2 && !L.side);
    const px = (v3.x * 0.5 + 0.5) * w, py = (-v3.y * 0.5 + 0.5) * h;
    if (show) {
      if (L.w == null) { L.el.style.display = 'block'; L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      const x0 = L.side ? px + 8 : px - L.w! / 2, y0 = L.side ? py - L.h! / 2 : py - L.h! * 1.2;
      const r = [x0 - 3, y0 - 2, x0 + L.w! + 3, y0 + L.h! + 2];
      if (placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) show = false; else placed.push(r);
    }
    if (show) {
      L.el.style.display = 'block';
      L.el.style.transform = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px) ` + (L.side ? 'translate(8px,-50%)' : 'translate(-50%,-120%)');
    } else if (L.el.style.display !== 'none') L.el.style.display = 'none';
  }
}
requestAnimationFrame(frame);
