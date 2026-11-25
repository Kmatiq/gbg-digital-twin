// Build compact web data for the digital twin from raw open data.
//
// Inputs (see scripts/fetch-data.sh and scripts/fetch-sgu.mjs):
//   data-raw/baskarta/*.shp   Göteborgs Stad baskarta, SHP, EPSG:3007, RH 2000 (CC0)
//   data-raw/dem/639_14/*.tif Göteborgs Stad höjdmodell 2022, 0.5 m (CC0)
//   data-raw/osm/t*.osm       OpenStreetMap extract (ODbL)
//   data-raw/sgu/*.json       SGU jordarter 1:25 000, berggrund 1:50 000, jorddjupsmodell
//
// Outputs in public/data/: buildings.glb, roads.glb, terrain.bin, scene.json
//
// Local scene frame: x = E - ORIGIN_E, y = height (m, RH 2000), z = -(N - ORIGIN_N).
import fs from 'node:fs';
import earcut from 'earcut';
import { fromFile } from 'geotiff';
import { BBOX, ORIGIN, SIZE, RAW, OUT, wgsTo3007, sweref3006To3007, s3007ToWgs } from './lib/config.mjs';
import { readLayer, readShp } from './lib/shp.mjs';
import { loadOsm, areas } from './lib/osm.mjs';
import { writeGlb, MeshBuilder } from './lib/glb.mjs';

fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const lx = e => e - ORIGIN[0];
const lz = n => -(n - ORIGIN[1]);

// ---------------------------------------------------------------- DEM
// Mosaic the 1x1 km 0.5 m tiles covering BBOX (plus a margin).
const DEM_RES = 0.5, DEM_MARGIN = 20;
const D0 = [BBOX[0] - DEM_MARGIN, BBOX[1] - DEM_MARGIN];
const DW = Math.round((SIZE + 2 * DEM_MARGIN) / DEM_RES);
const dem = new Float32Array(DW * DW).fill(NaN);
{
  const files = fs.readdirSync(RAW + 'dem/639_14').filter(f => f.endsWith('.tif'));
  for (const f of files) {
    const [nKm, eKm] = f.replace('.tif', '').split('_').map(Number);
    const e0 = eKm * 1000, n0 = nKm * 1000;
    if (e0 > D0[0] + DW * DEM_RES || e0 + 1000 < D0[0] || n0 > D0[1] + DW * DEM_RES || n0 + 1000 < D0[1]) continue;
    const img = await (await fromFile(RAW + 'dem/639_14/' + f)).getImage();
    const ras = (await img.readRasters())[0];
    const [ox, oy] = img.getOrigin(); const w = img.getWidth(), h = img.getHeight();
    for (let r = 0; r < h; r++) {
      const n = oy - (r + 0.5) * DEM_RES; const gy = Math.floor((n - D0[1]) / DEM_RES);
      if (gy < 0 || gy >= DW) continue;
      for (let c = 0; c < w; c++) {
        const e = ox + (c + 0.5) * DEM_RES; const gx = Math.floor((e - D0[0]) / DEM_RES);
        if (gx < 0 || gx >= DW) continue;
        const v = ras[r * w + c]; if (v > -1000) dem[gy * DW + gx] = v;
      }
    }
    log('DEM tile', f);
  }
}
function demAt(e, n) { // bilinear
  const fx = (e - D0[0]) / DEM_RES - 0.5, fy = (n - D0[1]) / DEM_RES - 0.5;
  const x = Math.max(0, Math.min(DW - 2, Math.floor(fx))), y = Math.max(0, Math.min(DW - 2, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - x)), ty = Math.min(1, Math.max(0, fy - y));
  const a = dem[y * DW + x], b = dem[y * DW + x + 1], c = dem[(y + 1) * DW + x], d = dem[(y + 1) * DW + x + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
function demMean(e, n, r) { let s = 0, k = 0; for (let dy = -r; dy <= r; dy += DEM_RES) for (let dx = -r; dx <= r; dx += DEM_RES) { const v = demAt(e + dx, n + dy); if (!isNaN(v)) { s += v; k++; } } return k ? s / k : NaN; }

// ---------------------------------------------------------------- OSM
const osmFiles = fs.readdirSync(RAW + 'osm').filter(f => f.endsWith('.osm')).map(f => RAW + 'osm/' + f);
const osm = loadOsm(osmFiles);
const osmDate = new Date(Math.max(...osmFiles.map(f => fs.statSync(f).mtimeMs))).toISOString().slice(0, 10);
log('OSM', osm.nodes.size, 'nodes', osm.ways.size, 'ways', osm.rels.size, 'relations');
const nodeXY = new Map();
const xy = id => { let p = nodeXY.get(id); if (!p) { const n = osm.nodes.get(id); if (!n) return null; p = wgsTo3007(n.lon, n.lat); nodeXY.set(id, p); } return p; };
const ringXY = ids => { const r = ids.map(xy); return r.some(p => !p) ? null : r; };

// ---------------------------------------------------------------- geometry helpers
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const pointInPoly = (x, y, outer, inner) => outer.some(r => pointInRing(x, y, r)) && !inner.some(r => pointInRing(x, y, r));
function distToRing(x, y, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[i + 1]; const dx = bx - ax, dy = by - ay; const L = dx * dx + dy * dy;
    let t = L ? ((x - ax) * dx + (y - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; }; // >0 = CCW
const bboxOf = rings => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const r of rings) for (const [x, y] of r) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); } return b; };
const intersectsBBox = b => !(b[2] < BBOX[0] || b[0] > BBOX[2] || b[3] < BBOX[1] || b[1] > BBOX[3]);
const insideBBox = (x, y, m = 0) => x >= BBOX[0] + m && x <= BBOX[2] - m && y >= BBOX[1] + m && y <= BBOX[3] - m;
const percentile = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]; };

// Sutherland–Hodgman clip of a ring against BBOX.
function clipRing(ring) {
  let pts = ring.slice(0, ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? -1 : undefined);
  const edges = [[0, BBOX[0], 1], [0, BBOX[2], -1], [1, BBOX[1], 1], [1, BBOX[3], -1]];
  for (const [k, v, s] of edges) {
    const out = []; const inside = p => (p[k] - v) * s >= 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) { const t = (v - a[k]) / (b[k] - a[k]); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
    }
    pts = out; if (!pts.length) return null;
  }
  if (pts.length < 3) return null;
  pts.push(pts[0]);
  return pts;
}

// ---------------------------------------------------------------- terrain grid (4 m)
const TSTEP = 4, TN = SIZE / TSTEP + 1;
const terrain = new Float32Array(TN * TN);
for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
  const e = BBOX[0] + i * TSTEP, n = BBOX[3] - j * TSTEP; // row 0 = north
  terrain[j * TN + i] = demMean(e, n, 1.5);
}
// Water mask from the DEM: open water is interpolated to ~0 m in the ground model.
// Threshold + connected-component cleanup keeps rivers/canals and drops low spots.
const LC = { paved: 0, green: 1, water: 2, rail: 3, square: 4 };
const landcover = new Uint8Array(TN * TN);
const waterComponents = [];
// SGU "Vatten" polygons rasterised and dilated by 3 cells (12 m) to tolerate the 1:25 000 scale.
const sguWater = new Uint8Array(TN * TN);
{
  const ja = JSON.parse(fs.readFileSync(RAW + 'sgu/jordarter.json', 'utf8'));
  const raw = new Uint8Array(TN * TN);
  for (const f of ja.features) {
    if (f.properties.Jordart !== 'Vatten') continue;
    const gs = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const g of gs) {
      const outer = [g[0].map(([x, y]) => sweref3006To3007(x, y))], inner = g.slice(1).map(r => r.map(([x, y]) => sweref3006To3007(x, y)));
      const b = bboxOf(outer);
      for (let j = 0; j < TN; j++) { const n = BBOX[3] - j * TSTEP; if (n < b[1] || n > b[3]) continue;
        for (let i = 0; i < TN; i++) { const e = BBOX[0] + i * TSTEP; if (e < b[0] || e > b[2] || raw[j * TN + i]) continue;
          if (pointInPoly(e, n, outer, inner)) raw[j * TN + i] = 1; } }
    }
  }
  const R = 3;
  for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
    if (!raw[j * TN + i]) continue;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < TN && b < TN) sguWater[b * TN + a] = 1; }
  }
}
{
  const wet = new Uint8Array(TN * TN);
  for (let k = 0; k < wet.length; k++) wet[k] = terrain[k] < 0.45 ? 1 : 0;
  const seen = new Int32Array(TN * TN).fill(-1);
  for (let k = 0; k < wet.length; k++) {
    if (!wet[k] || seen[k] >= 0) continue;
    const stack = [k], comp = []; seen[k] = k;
    while (stack.length) {
      const c = stack.pop(); comp.push(c); const ci = c % TN, cj = (c / TN) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= TN || nj >= TN) continue;
        const nk = nj * TN + ni; if (wet[nk] && seen[nk] < 0) { seen[nk] = k; stack.push(nk); }
      }
    }
    if (comp.length < 60) continue; // < ~1000 m²
    // Cross-check against SGU's mapped water bodies: excavations (e.g. the Västlänken
    // construction pit at Centralen) are low in the 2022 DEM but are not water.
    const overlap = comp.filter(c => sguWater[c]).length / comp.length;
    waterComponents.push({ cells: comp.length, overlap: +overlap.toFixed(2), kept: overlap > 0.25 });
    if (overlap > 0.25) for (const c of comp) landcover[c] = LC.water;
  }
  log('DEM water components', JSON.stringify(waterComponents));
}
// Rasterise OSM landcover polygons onto the grid.
function rasterise(polys, value, onlyIf = () => true) {
  for (const p of polys) {
    const b = bboxOf(p.outer);
    const i0 = Math.max(0, Math.floor((b[0] - BBOX[0]) / TSTEP)), i1 = Math.min(TN - 1, Math.ceil((b[2] - BBOX[0]) / TSTEP));
    const j0 = Math.max(0, Math.floor((BBOX[3] - b[3]) / TSTEP)), j1 = Math.min(TN - 1, Math.ceil((BBOX[3] - b[1]) / TSTEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * TN + i; if (!onlyIf(landcover[k])) continue;
      if (pointInPoly(BBOX[0] + i * TSTEP, BBOX[3] - j * TSTEP, p.outer, p.inner)) landcover[k] = value;
    }
  }
}
const toXYPolys = list => list.map(a => ({ ...a, outer: a.outer.map(ringXY).filter(Boolean), inner: a.inner.map(ringXY).filter(Boolean) })).filter(a => a.outer.length && intersectsBBox(bboxOf(a.outer)));
const greenTags = t => ['park', 'garden', 'playground'].includes(t.leisure) || ['grass', 'recreation_ground', 'village_green', 'cemetery', 'meadow'].includes(t.landuse) || ['wood', 'scrub', 'grassland'].includes(t.natural);
const greens = toXYPolys(areas(osm, greenTags));
const rails = toXYPolys(areas(osm, t => t.landuse === 'railway'));
const squares = toXYPolys(areas(osm, t => (t.highway === 'pedestrian' && t.area === 'yes') || t.place === 'square' || t['area:highway'] === 'pedestrian'));
rasterise(rails, LC.rail, v => v !== LC.water);
rasterise(squares, LC.square, v => v !== LC.water);
rasterise(greens, LC.green, v => v !== LC.water);
// Lower the river bed a little so quay edges read as edges.
for (let k = 0; k < terrain.length; k++) if (landcover[k] === LC.water) terrain[k] = Math.min(terrain[k], -1.5);
log('terrain grid', TN, 'x', TN, 'water cells', landcover.filter(v => v === LC.water).length);
{
  const buf = Buffer.alloc(TN * TN * 3);
  for (let k = 0; k < TN * TN; k++) { buf.writeInt16LE(Math.round(terrain[k] * 100), k * 2); buf[TN * TN * 2 + k] = landcover[k]; }
  fs.writeFileSync(OUT + 'terrain.bin', buf);
}
const groundAt = (e, n) => { const v = demAt(e, n); return isNaN(v) ? 2 : v; };

// ---------------------------------------------------------------- baskarta
const BK = RAW + 'baskarta/';
const bkDate = fs.statSync(BK + 'byggnad_l.shp').mtime.toISOString().slice(0, 10);
const byggnad = await readLayer(BK + 'byggnad_l', BBOX);
const kommunikation = await readLayer(BK + 'kommunikation', BBOX);
const mark = await readLayer(BK + 'markanvandning_p', BBOX);
const anlP = await readLayer(BK + 'anlaggningar_p', BBOX);
log('baskarta records', byggnad.length, kommunikation.length, mark.length, anlP.length);

// Spatial index of roof-outline vertices (with measured Z).
const ROOF_CELL = 10; const roofIdx = new Map();
for (const g of byggnad) {
  if (g.props.typ !== 'Takkonturer') continue;
  for (const r of g.rings) for (const [x, y, z] of r) {
    if (z < -5 || z > 300) continue;
    const key = Math.floor(x / ROOF_CELL) + ',' + Math.floor(y / ROOF_CELL);
    let a = roofIdx.get(key); if (!a) roofIdx.set(key, a = []); a.push([x, y, z]);
  }
}

// ---------------------------------------------------------------- buildings
const COL = {
  building: [170, 190, 206], landmark: [214, 190, 132], estimated: [140, 150, 162], part: [184, 200, 214]
};
const LANDMARKS = new Map([
  ['w26251811', 'Nordstan'], ['w40330178', 'Stora Teatern'], ['w44697495', 'Kronhuset'], ['w45408372', 'Palmhuset'],
  ['w24502883', 'Göteborgsoperan'], ['w175648796', 'Lilla Bommen (Läppstiftet)'], ['w73850681', 'Börsen'],
  ['w13704178', 'Centralhuset'], ['w72231334', 'Clarion Hotel Post']
]);
const bAreas = areas(osm, t => t.building && t.building !== 'no' && t.building !== 'construction' || t['building:part']);
const buildings = []; const stats = { baskarta: 0, osmHeight: 0, osmLevels: 0, fallback: 0 };
for (const a of bAreas) {
  const isPart = !!a.tags['building:part'] && !a.tags.building;
  if (isPart) continue; // v1: whole buildings only
  let outer = a.outer.map(ringXY).filter(Boolean), inner = a.inner.map(ringXY).filter(Boolean);
  if (!outer.length) continue;
  const bb = bboxOf(outer);
  if (!intersectsBBox(bb)) continue;
  if (!(bb[0] >= BBOX[0] && bb[2] <= BBOX[2] && bb[1] >= BBOX[1] && bb[3] <= BBOX[3])) {
    outer = outer.map(clipRing).filter(Boolean); inner = inner.map(clipRing).filter(Boolean);
    if (!outer.length) continue;
  }
  const area = outer.reduce((s, r) => s + Math.abs(ringArea(r)), 0) - inner.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
  if (area < 4) continue;
  // Ground: lowest DEM value along the footprint (buildings sit on the lowest adjacent ground).
  const gs = []; for (const r of outer) for (const [x, y] of r) gs.push(groundAt(x, y));
  const ground = percentile(gs, 0.1);
  // Roof: measured roof-outline vertices from the baskarta inside / on the footprint.
  const zs = [];
  for (let cx = Math.floor((bb[0] - 1.5) / ROOF_CELL); cx <= Math.floor((bb[2] + 1.5) / ROOF_CELL); cx++)
    for (let cy = Math.floor((bb[1] - 1.5) / ROOF_CELL); cy <= Math.floor((bb[3] + 1.5) / ROOF_CELL); cy++)
      for (const [x, y, z] of roofIdx.get(cx + ',' + cy) || [])
        if (pointInPoly(x, y, outer, inner) || outer.some(r => distToRing(x, y, r) < 1.0)) zs.push(z);
  let top, src;
  const tagH = parseFloat(a.tags.height), lv = parseFloat(a.tags['building:levels']);
  if (zs.length >= 3 && percentile(zs, area > 3000 ? 0.6 : 0.85) - ground > 1.5) {
    top = percentile(zs, area > 3000 ? 0.6 : 0.85); src = 'baskarta'; stats.baskarta++;
  } else if (tagH > 1) { top = ground + tagH; src = 'osm-height'; stats.osmHeight++; }
  else if (lv > 0) { top = ground + lv * 3.2 + 1; src = 'osm-levels'; stats.osmLevels++; }
  else { top = ground + 6; src = 'fallback'; stats.fallback++; }
  const name = a.tags.name || LANDMARKS.get(a.id) || null;
  const addr = a.tags['addr:street'] ? (a.tags['addr:street'] + (a.tags['addr:housenumber'] ? ' ' + a.tags['addr:housenumber'] : '')) : null;
  const year = (a.tags.start_date || a.tags['construction_date'] || '').match(/\d{4}/)?.[0] || null;
  buildings.push({ id: a.id, name, addr, year, levels: lv > 0 ? lv : null, kind: a.tags.building, outer, inner, ground, top, src, area, landmark: LANDMARKS.has(a.id) });
}
log('buildings', buildings.length, stats);

{
  const mb = new MeshBuilder('buildings');
  const info = [];
  for (const b of buildings) {
    const triStart = mb.triangles;
    const col = b.landmark ? COL.landmark : b.src === 'fallback' ? COL.estimated : COL.building;
    const base = b.ground - 2, top = b.top;
    // Walls
    const rings = [...b.outer.map(r => ({ r, outer: true })), ...b.inner.map(r => ({ r, outer: false }))];
    for (const { r, outer } of rings) {
      const ccw = ringArea(r) > 0; const flip = outer ? !ccw : ccw; // make walls face outward
      for (let i = 0; i < r.length - 1; i++) {
        let a = r[i], c = r[i + 1]; if (flip) [a, c] = [c, a];
        const ax = lx(a[0]), az = lz(a[1]), cx = lx(c[0]), cz = lz(c[1]);
        const dx = cx - ax, dz = cz - az, L = Math.hypot(dx, dz); if (L < 0.01) continue;
        // Geometric normal of (v0,v1,v2) below is (-dz, 0, dx); winding is chosen so it points outward.
        const nx = -dz / L, nz = dx / L;
        const shade = 0.78 + 0.22 * Math.abs(nx * 0.6 + nz * 0.8);
        const cc = col.map(v => Math.round(v * shade));
        const v0 = mb.vertex(ax, base, az, nx, 0, nz, cc), v1 = mb.vertex(cx, base, cz, nx, 0, nz, cc);
        const v2 = mb.vertex(cx, top, cz, nx, 0, nz, cc), v3 = mb.vertex(ax, top, az, nx, 0, nz, cc);
        mb.tri(v0, v1, v2); mb.tri(v0, v2, v3);
      }
    }
    // Roof (one earcut per outer ring; holes assigned by containment)
    for (const o of b.outer) {
      const holes = b.inner.filter(h => pointInRing(h[0][0], h[0][1], o));
      const flat = [], holeIdx = [];
      const addRing = r => { for (let i = 0; i < r.length - 1; i++) flat.push(r[i][0] - ORIGIN[0], r[i][1] - ORIGIN[1]); };
      addRing(o); for (const h of holes) { holeIdx.push(flat.length / 2); addRing(h); }
      const tris = earcut(flat, holeIdx);
      const roofCol = col.map(v => Math.min(255, Math.round(v * 1.06)));
      const ids = []; for (let i = 0; i < flat.length / 2; i++) ids.push(mb.vertex(flat[i * 2], top, -flat[i * 2 + 1], 0, 1, 0, roofCol));
      for (let i = 0; i < tris.length; i += 3) mb.triUp(ids[tris[i]], ids[tris[i + 1]], ids[tris[i + 2]]);
    }
    const c = b.outer[0].reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map(v => v / b.outer[0].length);
    info.push([b.id, b.name, r1(b.top - b.ground), r1(b.ground), b.src, triStart, mb.triangles - triStart, r1(lx(c[0])), r1(lz(c[1])), b.kind, Math.round(b.area), b.addr, b.year, b.levels, r1(b.top)]);
  }
  const size = writeGlb(OUT + 'buildings.glb', [mb.build()]);
  fs.writeFileSync(OUT + 'buildings.json', JSON.stringify({ fields: ['id', 'name', 'height', 'ground', 'src', 'triStart', 'triCount', 'x', 'z', 'kind', 'area', 'addr', 'year', 'levels', 'top'], rows: info }));
  log('buildings.glb', (size / 1e6).toFixed(2), 'MB', mb.triangles, 'triangles');
}

// ---------------------------------------------------------------- roads (OSM centrelines -> ribbons)
const ROAD_W = { motorway: 16, trunk: 14, primary: 13, secondary: 11, tertiary: 9, unclassified: 7, residential: 7, living_street: 6, service: 4.5, pedestrian: 6, footway: 2.4, cycleway: 2.4, path: 2, steps: 2.4, motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 7 };
const ROAD_COL = { major: [40, 50, 60], minor: [52, 62, 72], ped: [92, 100, 108], tram: [70, 90, 110] };
const roadClass = h => ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'].includes(h) ? 'major' : ['pedestrian', 'footway', 'cycleway', 'path', 'steps'].includes(h) ? 'ped' : 'minor';
const roadWays = [...osm.ways.values()].filter(w => ROAD_W[w.tags.highway] && w.tags.area !== 'yes');
const tunnelWays = []; const roadLines = []; // roadLines used for simulated utilities
const roadInfo = []; // [triStart, name, highway, maxspeed, lanes, oneway, bridge]
const streets = []; // drivable centrelines for the simulated car traffic
{
  const mb = new MeshBuilder('roads');
  const lift = { major: 0.35, minor: 0.28, ped: 0.22 };
  for (const w of roadWays) {
    const isTunnel = w.tags.tunnel === 'yes' || w.tags.tunnel === 'building_passage' && false || (w.tags.layer && +w.tags.layer < 0 && w.tags.tunnel);
    const pts = ringXY(w.nodes); if (!pts) continue;
    const cls = roadClass(w.tags.highway);
    if (w.tags.tunnel === 'yes') { if (cls === 'major') tunnelWays.push({ way: w, pts, kind: 'road' }); continue; }
    if (w.tags.tunnel && w.tags.tunnel !== 'no') continue; // building passages etc.
    // densify to <= 6 m
    const d = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1]; const L = Math.hypot(bx - ax, by - ay); const k = Math.max(1, Math.ceil(L / 6));
      for (let s = 0; s < k; s++) d.push([ax + (bx - ax) * s / k, ay + (by - ay) * s / k]);
    }
    d.push(pts[pts.length - 1]);
    if (!d.some(([x, y]) => insideBBox(x, y))) continue;
    const isBridge = w.tags.bridge && w.tags.bridge !== 'no';
    // Height profile: drape on DEM, bridges interpolate between their ends.
    let cum = [0]; for (let i = 1; i < d.length; i++) cum.push(cum[i - 1] + Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]));
    const hA = groundAt(...d[0]), hB = groundAt(...d[d.length - 1]);
    const H = d.map(([x, y], i) => isBridge ? Math.max(hA + (hB - hA) * cum[i] / (cum[cum.length - 1] || 1), groundAt(x, y)) : groundAt(x, y));
    const hw = (parseFloat(w.tags.width) || ROAD_W[w.tags.highway]) / 2;
    const col = ROAD_COL[cls]; const up = lift[cls] + (isBridge ? 0.6 : 0);
    roadInfo.push([mb.triangles, w.tags.name || null, w.tags.highway, w.tags.maxspeed || null, w.tags.lanes || null, w.tags.oneway === 'yes' || w.tags.junction === 'roundabout' ? 1 : 0, isBridge ? (w.tags['bridge:name'] || 1) : 0]);
    let prevL = null, prevR = null;
    for (let i = 0; i < d.length; i++) {
      const p = d[i], a = d[Math.max(0, i - 1)], b = d[Math.min(d.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      const nx = -ty, ny = tx; // left normal in EN
      const Lp = [p[0] + nx * hw, p[1] + ny * hw], Rp = [p[0] - nx * hw, p[1] - ny * hw];
      const vl = mb.vertex(lx(Lp[0]), H[i] + up, lz(Lp[1]), 0, 1, 0, col);
      const vr = mb.vertex(lx(Rp[0]), H[i] + up, lz(Rp[1]), 0, 1, 0, col);
      if (prevL !== null) { mb.triUp(prevL, prevR, vr); mb.triUp(prevL, vr, vl); }
      prevL = vl; prevR = vr;
    }
    if (cls !== 'ped' && w.tags.highway !== 'service' && w.tags.motor_vehicle !== 'no' && w.tags.access !== 'no')
      streets.push({ n: w.tags.name || '', c: cls === 'major' ? 1 : 0, o: w.tags.oneway === 'yes' || w.tags.junction === 'roundabout' ? 1 : w.tags.oneway === '-1' ? -1 : 0,
        v: parseFloat(w.tags.maxspeed) || (cls === 'major' ? 50 : 30), pts: d.filter((_, i) => i % 2 === 0 || i === d.length - 1).map(([x, y], i, arr) => [r1(lx(x)), r2(H[Math.min(d.length - 1, i * 2)] + up), r1(lz(y))]) });
    if (cls !== 'ped' && !isBridge && !['service'].includes(w.tags.highway))
      roadLines.push({ cls, pts: d.filter((_, i) => i % 2 === 0 || i === d.length - 1).map(([x, y]) => [r1(lx(x)), r2(groundAt(x, y)), r1(lz(y))]), name: w.tags.name || '' });
  }
  // Pedestrian squares as flat paving polygons
  for (const s of squares) {
    roadInfo.push([mb.triangles, s.tags.name || null, 'square', null, null, 0, 0]);
    for (const o of s.outer) {
      const ring = clipRing(o); if (!ring) continue;
      const flat = []; for (let i = 0; i < ring.length - 1; i++) flat.push(ring[i][0], ring[i][1]);
      const tris = earcut(flat);
      const ids = []; for (let i = 0; i < flat.length / 2; i++) ids.push(mb.vertex(lx(flat[i * 2]), groundAt(flat[i * 2], flat[i * 2 + 1]) + 0.2, lz(flat[i * 2 + 1]), 0, 1, 0, [96, 104, 112]));
      for (let i = 0; i < tris.length; i += 3) mb.triUp(ids[tris[i]], ids[tris[i + 1]], ids[tris[i + 2]]);
    }
  }
  const size = writeGlb(OUT + 'roads.glb', [mb.build()]);
  fs.writeFileSync(OUT + 'roads.json', JSON.stringify(roadInfo));
  log('roads.glb', (size / 1e6).toFixed(2), 'MB', mb.triangles, 'triangles');
}

// Railway tunnels (Västlänken) from OSM
for (const w of osm.ways.values()) {
  if (!(w.tags.tunnel === 'yes' && w.tags.railway && ['rail', 'construction', 'light_rail', 'subway'].includes(w.tags.railway))) continue;
  const pts = ringXY(w.nodes); if (pts) tunnelWays.push({ way: w, pts, kind: 'rail' });
}

// ---------------------------------------------------------------- baskarta lines: curbs, tram tracks, platforms
const lines = { curb: [], track: [], platform: [] };
for (const g of kommunikation) {
  const t = g.props.typ;
  const key = t.startsWith('Vägkant') ? 'curb' : t === 'Spårbunden trafik' ? 'track' : t === 'Perrong' ? 'platform' : null;
  if (!key) continue;
  for (const r of g.rings) {
    const pts = r.filter(([x, y]) => insideBBox(x, y));
    if (pts.length < 2) continue;
    // Some lines carry Z=0; fall back to DEM then.
    lines[key].push(pts.map(([x, y, z]) => [r1(lx(x)), r2((z > 0.2 ? z : groundAt(x, y)) + 0.12), r1(lz(y))]).flat());
  }
}
log('lines', Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v.length])));

// ---------------------------------------------------------------- trees, street lights, signs
const trees = [];
for (const g of mark) {
  const t = g.props.typ; if (t !== 'Lövträd' && t !== 'Barrträd') continue;
  const [x, y, z] = g.coords ?? g.rings?.[0]?.[0] ?? []; if (x == null || !insideBBox(x, y)) continue;
  const gz = z > 0.2 && Math.abs(z - groundAt(x, y)) < 3 ? z : groundAt(x, y);
  trees.push([r1(lx(x)), r2(gz), r1(lz(y)), t === 'Barrträd' ? 1 : 0]);
}
const lamps = [];
for (const g of anlP) {
  if (g.props.typ !== 'Belysningsstolpe') continue;
  const [x, y, z] = g.coords; if (!insideBBox(x, y)) continue;
  lamps.push([r1(lx(x)), r2(Math.abs(z - groundAt(x, y)) < 3 ? z : groundAt(x, y)), r1(lz(y))]);
}
const signs = [];
for (const n of osm.nodes.values()) {
  const h = n.tags.highway; let kind = null;
  if (h === 'traffic_signals') kind = 'signal';
  else if (h === 'stop') kind = 'stop';
  else if (h === 'give_way') kind = 'giveway';
  else if (h === 'crossing' && n.tags.crossing !== 'unmarked') kind = 'crossing';
  else if (n.tags.traffic_sign) kind = 'sign';
  if (!kind) continue;
  const [x, y] = wgsTo3007(n.lon, n.lat); if (!insideBBox(x, y)) continue;
  signs.push([r1(lx(x)), r2(groundAt(x, y)), r1(lz(y)), kind]);
}
log('trees', trees.length, 'lamps', lamps.length, 'signs', signs.length);

// ---------------------------------------------------------------- tunnels (path from OSM, depth simulated)
const tunnels = [];
{
  // A tunnel end is a portal if it connects to a non-tunnel way of the same mode.
  const nodeUse = new Map();
  for (const w of osm.ways.values()) {
    if (!(w.tags.highway || w.tags.railway)) continue;
    const isT = w.tags.tunnel === 'yes';
    for (const id of [w.nodes[0], w.nodes[w.nodes.length - 1]]) { const u = nodeUse.get(id) || { t: 0, o: 0 }; isT ? u.t++ : u.o++; nodeUse.set(id, u); }
  }
  for (const t of tunnelWays) {
    const depth = t.kind === 'rail' ? 22 : 10; const slope = t.kind === 'rail' ? 0.03 : 0.06;
    const ids = t.way.nodes; const pts = t.pts;
    if (!pts.some(([x, y]) => insideBBox(x, y, -50))) continue;
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1]; if (L < 20) continue;
    const portalA = (nodeUse.get(ids[0])?.o || 0) > 0, portalB = (nodeUse.get(ids[ids.length - 1])?.o || 0) > 0;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i]; if (!insideBBox(x, y, -10)) { if (out.length) { tunnels.push({ kind: t.kind, name: t.way.tags.name || '', construction: t.way.tags.railway === 'construction', pts: out.splice(0) }); } continue; }
      let dpt = depth;
      if (portalA) dpt = Math.min(dpt, cum[i] * slope);
      if (portalB) dpt = Math.min(dpt, (L - cum[i]) * slope);
      const cx = Math.max(BBOX[0], Math.min(BBOX[2], x)), cy = Math.max(BBOX[1], Math.min(BBOX[3], y));
      out.push([r1(lx(cx)), r2(groundAt(cx, cy) - Math.max(dpt, 0) - (t.kind === 'rail' ? 6 : 4)), r1(lz(cy))]);
    }
    if (out.length > 1) tunnels.push({ kind: t.kind, name: t.way.tags.name || '', construction: t.way.tags.railway === 'construction', pts: out });
  }
  log('tunnel segments', tunnels.length);
}

// ---------------------------------------------------------------- simulated utilities along the road network
// NOT real data: Göteborg's utility networks are not open. Generated deterministically from OSM roads.
const utilities = [];
{
  const TYPES = [['va', -2.2, -2.0], ['fjv', -1.4, 2.0], ['el', -0.9, -0.8], ['fiber', -0.6, 0.9]]; // [id, depth below ground, lateral offset]
  for (const r of roadLines) {
    if (r.pts.length < 2) continue;
    for (const [id, dz, off] of TYPES) {
      if (id === 'fjv' && r.cls !== 'major' && r.pts.length < 6) continue; // district heating mainly along larger streets
      const pts = r.pts.map((p, i) => {
        const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(r.pts.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[2] - a[2]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
        return [r1(p[0] - tz * off), r2(p[1] + dz), r1(p[2] + tx * off)];
      });
      utilities.push({ type: id, n: r.name, pts });
    }
  }
  log('simulated utility polylines', utilities.length);
}

// ---------------------------------------------------------------- subsurface (SGU)
const sgu = {};
{
  const jd = JSON.parse(fs.readFileSync(RAW + 'sgu/jorddjup.json', 'utf8'));
  // 255 marks cells without model value (mainly under water) -> fill by inverse-distance weighting.
  const v = jd.values.map(x => (x == null || x >= 255 ? null : x));
  const filled = v.slice(); const isFilled = v.map(x => x == null);
  for (let k = 0; k < v.length; k++) {
    if (v[k] != null) continue;
    const ki = k % jd.nx, kj = (k / jd.nx) | 0; let s = 0, ws = 0;
    for (let m = 0; m < v.length; m++) { if (v[m] == null) continue; const d2 = (m % jd.nx - ki) ** 2 + (((m / jd.nx) | 0) - kj) ** 2; const w = 1 / (d2 * d2); s += w * v[m]; ws += w; }
    filled[k] = s / ws;
  }
  // Grid in scene frame: SGU grid starts at south-west; convert to rows from north.
  const nx = jd.nx, ny = jd.ny, step = jd.step;
  const depth = [], ground = [], interp = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = (ny - 1 - j) * nx + i; const e = BBOX[0] + i * step, n = BBOX[3] - j * step;
    depth.push(r1(filled[k])); interp.push(isFilled[k] ? 1 : 0);
    ground.push(r2(demMean(e, n, 6)));
  }
  // Surface soil type (SGU jordarter 1:25 000) rasterised at 10 m.
  const ja = JSON.parse(fs.readFileSync(RAW + 'sgu/jordarter.json', 'utf8'));
  const uniq = new Map();
  for (const f of ja.features) { const key = f.properties.Jordart + '|' + JSON.stringify(f.geometry.coordinates).slice(0, 120); uniq.set(key, f); }
  const classes = []; const polys = [];
  for (const f of uniq.values()) {
    const name = f.properties.Jordart; if (!classes.includes(name)) classes.push(name);
    const gs = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const g of gs) polys.push({ c: classes.indexOf(name), outer: [g[0].map(([x, y]) => sweref3006To3007(x, y))], inner: g.slice(1).map(r => r.map(([x, y]) => sweref3006To3007(x, y))) });
  }
  const SS = 10, SN = SIZE / SS + 1; const soil = new Array(SN * SN).fill(-1);
  for (const p of polys) {
    const b = bboxOf(p.outer);
    for (let j = 0; j < SN; j++) { const n = BBOX[3] - j * SS; if (n < b[1] || n > b[3]) continue;
      for (let i = 0; i < SN; i++) { const e = BBOX[0] + i * SS; if (e < b[0] || e > b[2]) continue;
        if (pointInPoly(e, n, p.outer, p.inner)) soil[j * SN + i] = p.c; } }
  }
  const bg = JSON.parse(fs.readFileSync(RAW + 'sgu/berggrund.json', 'utf8'));
  const rock = [...new Set(bg.features.map(f => f.properties.bergart_tx))];
  const rockUnit = bg.features[0]?.properties.geo_enh_tx;
  Object.assign(sgu, { nx, ny, step, depth, ground, interp, soilStep: SS, soilN: SN, soil, soilClasses: classes, rock, rockUnit, fetched: jd.fetched.slice(0, 10) });
  log('SGU depth', Math.min(...depth), '-', Math.max(...depth), 'm; soil classes', classes, 'rock', rock);
}

// ---------------------------------------------------------------- labels (positions from OSM)
const labels = [];
{
  const centroid = rings => { let x = 0, y = 0, k = 0; for (const [a, b] of rings[0]) { x += a; y += b; k++; } return [x / k, y / k]; };
  const find = (pred) => { for (const coll of [osm.ways, osm.rels, osm.nodes]) for (const e of coll.values()) if (pred(e)) return e; return null; };
  const posOf = e => {
    if (e.lon != null) return wgsTo3007(e.lon, e.lat);
    if (e.nodes) { const r = ringXY(e.nodes); return r ? centroid([r]) : null; }
    const a = areas(osm, () => true).find(x => x.id === 'r' + e.id); if (a) { const r = ringXY(a.outer[0]); return r ? centroid([r]) : null; }
    return null;
  };
  const roofAt = (x, y) => { const b = buildings.find(b => pointInPoly(x, y, b.outer, b.inner)); return b ? b.top : groundAt(x, y); };
  const want = [
    ['Centralstationen', e => e.id === '13704178', 'hus', 'star'],
    ['Nordstan', e => e.id === '26251811', 'hus', 'star'],
    ['Trädgårdsföreningen', e => e.tags.name === 'Trädgårdsföreningen' && e.tags.leisure === 'park', 'mark', 'park'],
    ['Kungsportsplatsen', e => e.tags.name === 'Kungsportsplatsen' && e.tags.place === 'square', 'vagar', 'star'],
    ['Stora Teatern', e => e.id === '40330178', 'hus'],
    ['Kronhuset', e => e.id === '44697495', 'hus'],
    ['Palmhuset', e => e.id === '45408372', 'hus'],
    ['Göteborgsoperan', e => e.id === '24502883', 'hus'],
    ['Läppstiftet', e => e.id === '175648796', 'hus'],
    ['Gamla Ullevi', e => e.tags.name === 'Gamla Ullevi' && e.tags.leisure === 'stadium', 'hus'],
    ['Brunnsparken', e => e.tags.name === 'Brunnsparken' && e.tags.place === 'square', 'vagar'],
    ['Drottningtorget', e => e.id === '205747357', 'vagar'],
    ['Vallgraven', e => e.tags.name === 'Vallgraven' && e.tags.waterway === 'canal', 'mark', 'water'],
    ['Göta älv', e => e.tags.name === 'Göta älv' && e.tags.waterway === 'river' && e.nodes, 'mark', 'water']
  ];
  for (const [text, pred, layer, kind] of want) {
    const e = find(pred); if (!e) { log('label not found', text); continue; }
    let p = posOf(e); if (!p) continue;
    if (e.nodes && e.tags.waterway) { // pick the vertex of the waterway closest to the bbox centre
      const r = ringXY(e.nodes).filter(([x, y]) => insideBBox(x, y, 120));
      if (!r.length) { log('label outside', text); continue; }
      p = r[Math.floor(r.length / 2)];
    }
    if (!insideBBox(p[0], p[1])) { log('label outside', text); continue; }
    const y = layer === 'hus' ? roofAt(p[0], p[1]) + 2 : groundAt(p[0], p[1]) + 3;
    labels.push({ t: text, x: r1(lx(p[0])), y: r1(y), z: r1(lz(p[1])), g: layer, k: kind || '' });
  }
  for (const tn of [['Götatunneln', 'road'], ['Västlänken', 'rail']]) {
    const seg = tunnels.filter(t => t.name.includes(tn[0]) || (tn[1] === 'rail' && t.kind === 'rail'));
    const s = seg.sort((a, b) => b.pts.length - a.pts.length)[0];
    if (s) { const p = s.pts[Math.floor(s.pts.length / 2)]; labels.push({ t: tn[0] + (tn[1] === 'rail' ? ' (under byggnad)' : ''), x: p[0], y: p[1] + 8, z: p[2], g: 'tunnlar', k: 'tun' }); }
  }
  log('labels', labels.map(l => l.t).join(', '));
}

// ---------------------------------------------------------------- zoom-level labels: streets, places, buildings
// lv: 0 = overview, 1 = block, 2 = close-up
for (const l of labels) l.lv = 0;
{
  // Street names: along the longest pieces of each named street, roughly every 300 m.
  const byName = new Map();
  for (const st of streets) { if (!st.n) continue; (byName.get(st.n) || byName.set(st.n, []).get(st.n)).push(st); }
  for (const [name, list] of byName) {
    const cand = [];
    for (const st of list) {
      const p = st.pts; let L = 0; const cum = [0];
      for (let i = 1; i < p.length; i++) { L += Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]); cum.push(L); }
      if (L < 50) continue;
      const n = Math.max(1, Math.floor(L / 300));
      for (let k = 0; k < n; k++) {
        const target = L * (k + 0.5) / n; const i = cum.findIndex(c => c >= target);
        const q = p[Math.max(0, i)];
        if (Math.abs(q[0]) < SIZE / 2 - 20 && Math.abs(q[2]) < SIZE / 2 - 20) cand.push({ q, L });
      }
    }
    // keep candidates at least 220 m apart, longest pieces first
    cand.sort((a, b) => b.L - a.L); const kept = [];
    for (const c of cand) if (kept.every(k => Math.hypot(k.q[0] - c.q[0], k.q[2] - c.q[2]) > 220)) kept.push(c);
    for (const c of kept.slice(0, 4)) labels.push({ t: name, x: c.q[0], y: r1(c.q[1] + 2), z: c.q[2], g: 'vagar', k: 'street', lv: 1 });
  }
  // Named squares, parks and canals not already labelled
  const have = new Set(labels.map(l => l.t));
  const named = [...squares.map(a => [a, 'vagar', 'place']), ...greens.map(a => [a, 'mark', 'park'])];
  for (const [a, g, k] of named) {
    const n = a.tags.name; if (!n || have.has(n)) continue; have.add(n);
    const r = a.outer[0]; const c = r.reduce((s, p) => [s[0] + p[0] / r.length, s[1] + p[1] / r.length], [0, 0]);
    if (!insideBBox(c[0], c[1], 10)) continue;
    labels.push({ t: n, x: r1(lx(c[0])), y: r1(groundAt(c[0], c[1]) + 3), z: r1(lz(c[1])), g, k, lv: 1 });
  }
  // Buildings: name, otherwise address
  for (const b of buildings) {
    const t = b.name || b.addr; if (!t || have.has(t) && b.name) continue;
    const r = b.outer[0]; const c = r.reduce((s, p) => [s[0] + p[0] / r.length, s[1] + p[1] / r.length], [0, 0]);
    if (!pointInPoly(c[0], c[1], b.outer, b.inner)) continue;
    labels.push({ t, x: r1(lx(c[0])), y: r1(b.top + 1.5), z: r1(lz(c[1])), g: 'hus', k: b.name ? 'bname' : 'addr', lv: 2 });
  }
  log('labels total', labels.length, 'by level', [0, 1, 2].map(v => labels.filter(l => l.lv === v).length));
}

// ---------------------------------------------------------------- public transport stops (OSM)
const stops = [];
{
  const routeOf = new Map(); // node id -> Set of "mode:ref"
  for (const r of osm.rels.values()) {
    if (r.tags.type !== 'route' || !['tram', 'bus', 'ferry', 'train', 'trolleybus'].includes(r.tags.route) || !r.tags.ref) continue;
    for (const m of r.members) if (m.type === 'node') { (routeOf.get(m.ref) || routeOf.set(m.ref, new Set()).get(m.ref)).add(r.tags.route + ':' + r.tags.ref); }
  }
  const raw = [];
  for (const n of osm.nodes.values()) {
    const t = n.tags;
    const isStop = t.public_transport === 'platform' || t.public_transport === 'stop_position' || t.railway === 'tram_stop' || t.highway === 'bus_stop' || t.amenity === 'ferry_terminal';
    if (!isStop || !t.name) continue;
    const [x, y] = wgsTo3007(n.lon, n.lat); if (!insideBBox(x, y)) continue;
    raw.push({ name: t.name, x, y, routes: routeOf.get(n.id) || new Set(), tram: t.tram === 'yes' || t.railway === 'tram_stop', bus: t.bus === 'yes' || t.highway === 'bus_stop' });
  }
  // Group by name within 120 m
  for (const s of raw) {
    let g = stops.find(o => o.name === s.name && Math.hypot(o.e - s.x, o.n - s.y) < 120);
    if (!g) { g = { name: s.name, e: s.x, n: s.y, k: 0, routes: new Set(), tram: false, bus: false }; stops.push(g); }
    g.e = (g.e * g.k + s.x) / (g.k + 1); g.n = (g.n * g.k + s.y) / (g.k + 1); g.k++;
    s.routes.forEach(r => g.routes.add(r)); g.tram ||= s.tram; g.bus ||= s.bus;
  }
  const sortRef = (a, b) => (parseInt(a) || 999) - (parseInt(b) || 999) || a.localeCompare(b);
  for (const g of stops) {
    const by = m => [...g.routes].filter(r => r.startsWith(m + ':')).map(r => r.split(':')[1]).sort(sortRef);
    Object.assign(g, { x: r1(lx(g.e)), y: r2(groundAt(g.e, g.n)), z: r1(lz(g.n)), lines: { tram: by('tram'), bus: by('bus'), ferry: by('ferry'), train: by('train') } });
    if (g.lines.tram.length) g.tram = true; if (g.lines.bus.length) g.bus = true;
    delete g.e; delete g.n; delete g.k; delete g.routes;
  }
  for (const g of stops) labels.push({ t: g.name, x: g.x, y: r1(g.y + 9), z: g.z, g: 'kollektiv', k: 'stop', lv: 1 });
  log('stops', stops.length, stops.slice(0, 3).map(s => s.name + ' ' + JSON.stringify(s.lines)).join(' | '));
}

// Named waterways for click info (sparse points)
const waters = [];
for (const w of osm.ways.values()) {
  if (!w.tags.name || !['canal', 'river'].includes(w.tags.waterway)) continue;
  const r = ringXY(w.nodes); if (!r) continue;
  const pts = r.filter(([x, y]) => insideBBox(x, y, -100)).map(([x, y]) => [r1(lx(x)), r1(lz(y))]);
  if (pts.length) waters.push({ n: w.tags.name, k: w.tags.waterway, pts });
}

// ---------------------------------------------------------------- scene.json
const wgsCorners = [[BBOX[0], BBOX[1]], [BBOX[2], BBOX[3]]].map(([e, n]) => s3007ToWgs(e, n).map(v => +v.toFixed(6)));
const scene = {
  generated: new Date().toISOString(),
  crs: 'EPSG:3007', origin: ORIGIN, bbox: BBOX, size: SIZE, wgs84: wgsCorners,
  terrain: { step: TSTEP, n: TN, file: 'terrain.bin', landcover: LC },
  sources: {
    baskarta: { date: bkDate }, dem: { date: '2022-05' }, osm: { date: osmDate }, sgu: { date: sgu.fetched }
  },
  stats: { buildings: buildings.length, heights: stats, trees: trees.length, lamps: lamps.length, signs: signs.length, curbs: lines.curb.length, tracks: lines.track.length },
  lines, trees, lamps, signs, tunnels, utilities, sgu, labels, streets, stops, waters
};
fs.writeFileSync(OUT + 'scene.json', JSON.stringify(scene));
log('scene.json', (fs.statSync(OUT + 'scene.json').size / 1e6).toFixed(2), 'MB');
