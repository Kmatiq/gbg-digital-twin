import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LAYERS, ORDER, PROV_LABEL, PROV_TEXT, icon, type LayerKey, type Provenance } from './layers';
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

/* ---------- Layer rail ---------- */
const EYE_ON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const ul = $('layers'); const rows: Record<string, HTMLLIElement> = {};
ORDER.forEach(k => {
  const L = LAYERS[k], li = document.createElement('li');
  li.className = 'lay' + (L.prov === 'simulated' ? ' sim' : ''); li.style.setProperty('--c', L.c);
  li.innerHTML = `<button type="button" class="pick" aria-pressed="false"><span class="ic">${icon(k)}</span>` +
    `<span class="tx"><span class="nm">${L.short}</span><span class="pv ${L.prov}">${PROV_LABEL[L.prov]}</span></span></button>` +
    `<button type="button" class="eye" aria-pressed="true" aria-label="Visa eller dölj ${L.name}" title="Visa eller dölj lagret">${EYE_ON}</button>`;
  ul.appendChild(li); rows[k] = li;
  li.querySelector<HTMLButtonElement>('.pick')!.onclick = () => setFocus(k);
  li.querySelector<HTMLButtonElement>('.eye')!.onclick = () => { state.vis[k] = !state.vis[k]; if (!state.vis[k] && state.focus === k) state.focus = null; sync(); };
});
function setFocus(k: LayerKey) {
  state.focus = state.focus === k ? null : k;
  if (state.focus) state.vis[k] = true;
  clearPick(); current = null; sync();
}
function sync() {
  ORDER.forEach(k => {
    const m = mode(k);
    G[k].visible = m !== 'off';
    const dim = m === 'dim';
    if (dimmed[k] !== dim) { applyDim(G[k], dim); dimmed[k] = dim; }
    const r = rows[k];
    r.classList.toggle('focus', state.focus === k);
    r.classList.toggle('dim', dim);
    r.classList.toggle('off', !state.vis[k]);
    r.classList.toggle('blocked', state.openOnly && LAYERS[k].prov === 'simulated');
    r.querySelector('.pick')!.setAttribute('aria-pressed', String(state.focus === k));
    const eye = r.querySelector('.eye')!; eye.setAttribute('aria-pressed', String(state.vis[k])); eye.innerHTML = state.vis[k] ? EYE_ON : EYE_OFF;
  });
  renderInfo();
}

/* ---------- Settings ---------- */
$<HTMLInputElement>('explode').oninput = e => { const v = +(e.target as HTMLInputElement).value; state.explode = v / 100; $('exO').textContent = v + ' %'; };
$<HTMLInputElement>('vex').oninput = e => { state.vex = +(e.target as HTMLInputElement).value / 10; $('vexO').textContent = state.vex.toLocaleString('sv-SE') + ' ×'; };
const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e5);
renderer.clippingPlanes = [clipPlane];
let half = 750;
$<HTMLInputElement>('cut').oninput = e => {
  const v = +(e.target as HTMLInputElement).value / 100;
  clipPlane.constant = v === 0 ? 1e5 : half + 5 - v * (2 * half + 10);
  $('cutO').textContent = v === 0 ? 'Av' : Math.round(v * 100) + ' %';
};
function toggle(id: string, key: 'openOnly' | 'labels' | 'rot', fn?: () => void) {
  const b = $(id); b.onclick = () => { state[key] = !state[key]; b.setAttribute('aria-pressed', String(state[key])); b.querySelector('.sv')!.textContent = state[key] ? 'På' : 'Av'; fn?.(); };
}
toggle('tOpen', 'openOnly', () => { if (state.focus && LAYERS[state.focus].prov === 'simulated' && state.openOnly) state.focus = null; sync(); });
toggle('tLbl', 'labels');
toggle('tRot', 'rot', () => { controls.autoRotate = state.rot; });
const mq = window.matchMedia('(max-width:760px)');
function setSettings(open: boolean) {
  $('settings').hidden = !open; $('setBtn').setAttribute('aria-expanded', String(open));
  $('info').style.visibility = open ? 'hidden' : '';
}
$('setBtn').onclick = () => setSettings($('settings').hidden);
$('setClose').onclick = () => setSettings(false);

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
  if (mq.matches) setSettings(false);
});
controls.addEventListener('start', () => { tween = null; });
controls.target.set(0, -20, 0);

// Keep the model centred in the free area between the panels.
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  if (mq.matches) {
    $('rail').style.top = '';
    const rail = $('rail').getBoundingClientRect().height, info = $('info').getBoundingClientRect();
    const bottom = rail + (info.height ? info.height + 8 : 0);
    camera.setViewOffset(w, h, 0, Math.round((bottom - 52) / 2), w, h);
  } else {
    $('rail').style.top = ($('top').querySelector('.brand')!.getBoundingClientRect().bottom + 8) + 'px';
    const railW = $('rail').getBoundingClientRect().width + 12, infoW = $('info').getBoundingClientRect().width + 12;
    camera.setViewOffset(w, h, Math.round((infoW - railW) / 2), 0, w, h);
  }
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
mq.addEventListener('change', resize);
resize();
camera.position.copy(fit(CAMS.over[0], CAMS.over[1]));
new ResizeObserver(resize).observe($('info'));

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
const SIGNS: { k: LayerKey; x: number; y: number; z: number; el: HTMLButtonElement; w?: number; h?: number }[] = [];
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
      return { title: 'Personbil', sub: c.street ? 'På ' + c.street : undefined, prov: 'simulated', rows: [['Hastighet', `cirka ${c.kmh} km/h`, 'simulated'], ['Hastighetsgräns', `${c.limit} km/h`, 'measured']],
        note: 'Fordonet är simulerat. Gatan, körriktningen och hastighetsgränsen är verkliga och kommer från OpenStreetMap. Antalet fordon följer en typisk dygnsprofil.' };
    }
    case 'util': return utilInfo(o.userData.items[id]);
    case 'tunnel': return tunnelInfo(o.userData.item, o.userData.length, ground - p.y);
    case 'tree': {
      const t = o.userData.items[id] as number[];
      return { title: t[3] ? 'Barrträd' : 'Lövträd', prov: 'measured', rows: [['Läge', 'Inmätt', 'measured'], ['Markhöjd', `+${nf(t[1])} m ö.h.`, 'measured'], ['Storlek i modellen', 'Schablon', 'simulated']],
        note: 'Trädets läge kommer från Göteborgs Stads baskarta. Trädets storlek i modellen är en schablon.' };
    }
    case 'lamp': return { title: 'Belysningsstolpe', prov: 'measured', rows: [['Läge', 'Inmätt', 'measured'], ['Höjd i modellen', 'Schablon 7 m', 'simulated']], note: 'Stolpens läge kommer från Göteborgs Stads baskarta.' };
    case 'sign': {
      const s = o.userData.items[id]; return { title: SIGN[s[3]] ?? 'Skylt', prov: 'measured', rows: [['Läge', 'OpenStreetMap', 'measured']], note: 'Signaler och vägmärken som är registrerade i OpenStreetMap. Alla vägmärken i området är inte registrerade.' };
    }
    case 'water': case 'ground': {
      const lc = terrain.lc[Math.round((p.z + half) / terrain.step) * terrain.n + Math.round((p.x + half) / terrain.step)];
      if (kind === 'water' || lc === 2) {
        let best = '', bd = 140; for (const w of sd.waters) for (const q of w.pts) { const dd = Math.hypot(q[0] - p.x, q[1] - p.z); if (dd < bd) { bd = dd; best = w.n; } }
        return { title: best || 'Vatten', sub: 'Vattenyta', prov: 'derived', rows: [['Yta', 'Beräknad ur höjdmodellen', 'derived']], note: 'Vattenytan är beräknad ur höjdmodellen och kontrollerad mot SGU:s karta. Namnet kommer från OpenStreetMap.' };
      }
      return { title: LC_NAME[lc] ?? 'Mark', prov: 'measured', rows: [['Markhöjd', `+${nf(ground)} m ö.h.`, 'measured'], ['Djup till berg', `cirka ${Math.round(geo.depthAt(p.x, p.z))} meter`, 'measured']],
        note: 'Markhöjden kommer från Göteborgs Stads höjdmodell 2022, som bygger på laserskanning. Marktypen kommer från OpenStreetMap och jorddjupet från SGU.' };
    }
    case 'soil': {
      const soil = geo.soilAt(p.x, p.z); const depth = geo.depthAt(p.x, p.z);
      return { title: 'Jordlager', sub: soil ? 'I ytan: ' + (SOIL[soil] ?? soil) : undefined, prov: 'measured',
        rows: [['Djup till berg', `cirka ${Math.round(depth)} meter`, 'measured'], ['Jordart i ytan', soil ? (SOIL[soil] ?? soil) : 'okänd', 'measured']],
        details: [['Bergytan', `${nf(geo.bedrockAt(p.x, p.z))} m ö.h.`, 'derived']],
        note: 'Uppgifterna kommer från SGU:s jorddjupsmodell och jordartskarta 1:25 000. Under markytan består jordlagret här främst av lera.' };
    }
    case 'rock': {
      return { title: 'Berggrund', sub: sd.sgu.rock.join(', '), prov: 'derived',
        rows: [['Bergytan här', `${nf(geo.bedrockAt(p.x, p.z))} m ö.h.`, 'derived'], ['Bergart', sd.sgu.rock[0] ?? '?', 'measured']],
        details: [['Enhet', sd.sgu.rockUnit ?? '', 'measured']],
        note: 'Bergytan är beräknad som markhöjd minus jorddjup enligt SGU. Bergarten kommer från SGU:s berggrundskarta 1:50 000.' };
    }
  }
  return null;
}

// Info card: shows what the user tapped, otherwise the focused layer, otherwise an introduction.
let current: Info | null = null; let currentLayer: LayerKey | null = null; let infoMin = false;
const row = (r: Info['rows'][number]) => `<dt>${r[0]}</dt><dd>${r[1]}</dd>${r[2] ? `<i class="dot ${r[2]}" title="${PROV_LABEL[r[2] as Provenance]}: ${PROV_TEXT[r[2] as Provenance]}"></i>` : '<i></i>'}`;
const provTag = (p: Provenance) => `<span class="prov ${p}">${PROV_LABEL[p]}</span>`;
function renderInfo() {
  const el = $('info'); let html = '';
  const ICON_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const ICON_MIN = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${infoMin ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg>`;
  const head = (eyebrow: string, title: string, sub: string | undefined, prov: Provenance | null, close: string) =>
    `<div class="card-head"><div class="eyebrow">${eyebrow}</div><div class="actions">` +
    `<button type="button" class="ib collapse" data-act="min" aria-label="${infoMin ? 'Visa kortet' : 'Minimera kortet'}">${ICON_MIN}</button>` +
    (close ? `<button type="button" class="ib" data-act="${close}" aria-label="Stäng">${ICON_X}</button>` : '') + `</div></div>` +
    `<div class="ttl"><h3>${title}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}${prov ? `<div class="pt">${provTag(prov)}</div>` : ''}</div>`;
  if (current) {
    const i = current;
    html = head(currentLayer ? LAYERS[currentLayer].name : 'Uppgifter', i.title, i.sub, i.prov, 'close') +
      `<div class="body"><dl>${i.rows.map(row).join('')}</dl>` +
      (i.details?.length || i.note ? `<button type="button" class="more" aria-expanded="false">Visa detaljer</button><div class="det" hidden>` +
        (i.details?.length ? `<dl>${i.details.map(row).join('')}</dl>` : '') + (i.note ? `<div class="src">${i.note}</div>` : '') + '</div>' : '') + '</div>';
  } else if (state.focus) {
    const L = LAYERS[state.focus];
    html = head('Lager i fokus', L.name, undefined, L.prov, 'unfocus') +
      `<div class="body"><p>${L.text}</p>` +
      (L.chips ? '<div class="chips">' + L.chips.map(c => `<span class="chip" style="--c:${c[0]}"><i></i>${c[1]}</span>`).join('') + '</div>' : '') +
      `<div class="src"><b>Källa:</b> ${L.src}</div><div class="src">Övriga lager är nedtonade. Välj lagret igen för att visa alla lager.</div></div>`;
  } else {
    html = head('Om modellen', 'Centrala Göteborg i 3D', undefined, null, '') +
      `<div class="body"><p>Modellen bygger på öppna data från Göteborgs Stad, SGU och OpenStreetMap. Välj ett lager för att framhäva det, eller tryck på en byggnad, gata eller hållplats för att få mer information.</p>` +
      `<div class="legend"><span><i class="dot measured"></i>${PROV_LABEL.measured}: ${PROV_TEXT.measured.toLowerCase()}</span>` +
      `<span><i class="dot derived"></i>${PROV_LABEL.derived}: ${PROV_TEXT.derived.toLowerCase()}</span>` +
      `<span><i class="dot simulated"></i>${PROV_LABEL.simulated}: ${PROV_TEXT.simulated.toLowerCase()}</span></div></div>`;
  }
  el.innerHTML = html;
  el.classList.toggle('min', infoMin);
  el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'close') { clearPick(); current = null; renderInfo(); }
    if (a === 'unfocus') { state.focus = null; sync(); }
    if (a === 'min') { infoMin = !infoMin; renderInfo(); }
  });
  const more = el.querySelector<HTMLButtonElement>('.more');
  if (more) more.onclick = () => { const d = el.querySelector<HTMLElement>('.det')!; d.hidden = !d.hidden; more.setAttribute('aria-expanded', String(!d.hidden)); more.textContent = d.hidden ? 'Visa detaljer' : 'Dölj detaljer'; };
  resize();
}
function showInfo(info: Info | null, layer: LayerKey | null = null) { current = info; currentLayer = layer; if (info) infoMin = false; renderInfo(); }
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
        showInfo(info, o.name as LayerKey);
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
  // Layer signs at the south-west corner of each slab, outside the city. Tapping one focuses the layer.
  const g0 = terrain.at(-half, half), r0 = geo.bedrockAt(-half, half);
  const signY: Partial<Record<LayerKey, number>> = { hus: g0 + 12, vagar: g0 + 1, mark: g0 - 1.5, ledn: g0 - 1.6, tunnlar: g0 - 14, jord: (g0 - 3 + r0) / 2, berg: (r0 + BASE) / 2 };
  for (const [k, y] of Object.entries(signY) as [LayerKey, number][]) {
    const L = LAYERS[k]; const el = document.createElement('button');
    el.type = 'button'; el.className = 'lsign' + (L.prov === 'simulated' ? ' sim' : ''); el.style.setProperty('--c', L.c);
    el.innerHTML = `<i></i><span>${L.name}<small>${PROV_LABEL[L.prov]}</small></span>`;
    el.setAttribute('aria-label', `Fokusera på lagret ${L.name}`);
    el.onclick = () => setFocus(k);
    labelHost.appendChild(el);
    SIGNS.push({ k, x: -half - 6, y, z: half + 6, el });
  }
  LABELS.sort((a, b) => a.prio - b.prio);

  $('sB').textContent = String(sd.stats.buildings);
  $('sC').textContent = String(traffic.cars.length);
  $('sH').textContent = String(sd.stops.length);
  const h = sd.stats.heights;
  $('foot').innerHTML = `<b>Om datan.</b> Området omfattar 1,5 × 1,5 kilometer i koordinatsystemet SWEREF 99 12 00. Av byggnaderna har ${h.baskarta} en höjd som är beräknad ur uppmätta tak, ${h.osmHeight ?? 0} har en höjd angiven i OpenStreetMap och ${h.osmLevels} har en höjd som är uppskattad ur antalet våningar. För ${h.fallback} byggnader saknas uppgift; de visas i grått. ` +
    `Biltrafiken är simulerad och motsvarar just nu ${Math.round(profileNow() * 100)} procent av trafiken under rusningstid. ` +
    `Källor: Göteborgs Stads baskarta (${sd.sources.baskarta.date}) och höjdmodell 2022, CC0. Sveriges geologiska undersökning (SGU), CC0, hämtat ${sd.sources.sgu.date}. © OpenStreetMaps bidragsgivare, ODbL, hämtat ${sd.sources.osm.date}.`;
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
  // Layer signs: beside the corner of each slab that is furthest to the right on screen,
  // kept inside the free area between the panels.
  const railR = mq.matches ? 0 : $('rail').getBoundingClientRect().right + 8;
  const infoEl = $('info'), infoL = mq.matches || infoEl.style.visibility === 'hidden' ? w : infoEl.getBoundingClientRect().left - 8;
  const freeBottom = mq.matches ? Math.min(infoEl.getBoundingClientRect().top || h, $('rail').getBoundingClientRect().top) - 6 : h;
  for (const S of SIGNS) {
    const grp = G[S.k];
    let best: [number, number] | null = null;
    for (const [cx, cz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
      v3.set(cx, S.y, cz); grp.localToWorld(v3); v3.project(camera);
      if (v3.z >= 1) continue;
      const px = (v3.x * 0.5 + 0.5) * w, py = (-v3.y * 0.5 + 0.5) * h;
      if (!best || px > best[0]) best = [px, py];
    }
    let show = !!best && grp.visible && state.ex > 0.22;
    if (show) {
      if (!S.w) { S.el.style.display = 'flex'; S.w = S.el.offsetWidth; S.h = S.el.offsetHeight; }
      let x0 = best![0] + 14; const y0 = best![1] - S.h! / 2;
      if (x0 + S.w! > infoL) x0 = infoL - S.w!;
      if (x0 < railR) x0 = railR;
      const r = [x0, y0, x0 + S.w!, y0 + S.h!];
      if (y0 < 56 || r[3] > freeBottom || placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) show = false;
      else { placed.push([r[0] - 2, r[1] - 3, r[2] + 2, r[3] + 3]); S.el.style.transform = `translate(${x0.toFixed(1)}px,${y0.toFixed(1)}px)`; }
    }
    if (show) {
      S.el.style.display = 'flex';
      S.el.classList.toggle('on', state.focus === S.k); S.el.classList.toggle('dim', !!dimmed[S.k]);
    } else if (S.el.style.display !== 'none') S.el.style.display = 'none';
  }
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
