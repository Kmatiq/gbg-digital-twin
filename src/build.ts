// Builds Three.js objects from the preprocessed data in public/data.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface SceneData {
  generated: string;
  bbox: number[]; origin: number[]; size: number; wgs84: number[][];
  terrain: { step: number; n: number; landcover: Record<string, number> };
  sources: Record<string, { date: string }>;
  stats: { buildings: number; heights: Record<string, number>; trees: number; lamps: number; signs: number };
  lines: { curb: number[][]; track: number[][]; platform: number[][] };
  trees: [number, number, number, number][];
  lamps: [number, number, number][];
  signs: [number, number, number, string][];
  tunnels: { kind: 'road' | 'rail'; name: string; construction: boolean; pts: number[][] }[];
  utilities: { type: string; pts: number[][] }[];
  sgu: {
    nx: number; ny: number; step: number; depth: number[]; ground: number[]; interp: number[];
    soilStep: number; soilN: number; soil: number[]; soilClasses: string[]; rock: string[]; rockUnit: string; fetched: string;
  };
  labels: { t: string; x: number; y: number; z: number; g: string; k: string }[];
}

export const BASE = -140; // bottom of the block model (m, RH 2000)
export const FILL = 3; // schematic thickness of the fill/surface layer

const lambert = (color: THREE.ColorRepresentation, o: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...o });

export class Terrain {
  n: number; step: number; half: number; h: Float32Array; lc: Uint8Array;
  constructor(buf: ArrayBuffer, n: number, step: number) {
    this.n = n; this.step = step; this.half = ((n - 1) * step) / 2;
    const i16 = new Int16Array(buf, 0, n * n); this.h = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) this.h[k] = i16[k] / 100;
    this.lc = new Uint8Array(buf, n * n * 2, n * n);
  }
  // Height at scene x,z (bilinear). Row 0 is north (z = -half).
  at(x: number, z: number): number {
    const fx = Math.min(this.n - 1.001, Math.max(0, (x + this.half) / this.step));
    const fy = Math.min(this.n - 1.001, Math.max(0, (z + this.half) / this.step));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, n = this.n, h = this.h;
    return (h[j * n + i] * (1 - tx) + h[j * n + i + 1] * tx) * (1 - ty) + (h[(j + 1) * n + i] * (1 - tx) + h[(j + 1) * n + i + 1] * tx) * ty;
  }
}

// A closed block between two height fields over the square, with vertex colours on top.
// top/bottom are functions of (i,j) on an n x n grid spanning the square.
function block(n: number, half: number, top: (i: number, j: number) => number, bottom: (i: number, j: number) => number,
  topColor: (i: number, j: number) => THREE.Color, sideColor: THREE.Color, bottomColor?: THREE.Color): THREE.BufferGeometry {
  const step = (2 * half) / (n - 1);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  // top surface
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    pos.push(-half + i * step, top(i, j), -half + j * step);
    const c = topColor(i, j); col.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // bottom surface (only if not flat it still works)
  const bo = pos.length / 3; const bc = bottomColor ?? sideColor;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { pos.push(-half + i * step, bottom(i, j), -half + j * step); col.push(bc.r, bc.g, bc.b); }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = bo + j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  // side walls: walk the perimeter clockwise seen from above
  const edges: [number, number][][] = [
    Array.from({ length: n }, (_, k) => [k, n - 1] as [number, number]),           // south (z=+half), west->east
    Array.from({ length: n }, (_, k) => [n - 1, n - 1 - k] as [number, number]),   // east, south->north
    Array.from({ length: n }, (_, k) => [n - 1 - k, 0] as [number, number]),       // north, east->west
    Array.from({ length: n }, (_, k) => [0, k] as [number, number])                // west, north->south
  ];
  for (const e of edges) {
    const so = pos.length / 3;
    for (const [i, j] of e) {
      const x = -half + i * step, z = -half + j * step;
      pos.push(x, top(i, j), z); col.push(sideColor.r, sideColor.g, sideColor.b);
      pos.push(x, bottom(i, j), z); col.push(sideColor.r * 0.8, sideColor.g * 0.8, sideColor.b * 0.8);
    }
    for (let k = 0; k < e.length - 1; k++) {
      const a = so + k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, c, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Solid with a dark "cap" look when cut by the clipping plane (back faces drawn flat).
function solid(geo: THREE.BufferGeometry, capColor: THREE.ColorRepresentation): THREE.Group {
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide })));
  grp.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: capColor, side: THREE.BackSide })));
  return grp;
}

const LC_COL: Record<number, THREE.Color> = {
  0: new THREE.Color(0x2c3e48), // paved / built
  1: new THREE.Color(0x2f7a58), // green
  2: new THREE.Color(0x0e3a52), // river bed
  3: new THREE.Color(0x3a3a40), // rail
  4: new THREE.Color(0x46535c)  // square
};

export function buildMark(t: Terrain): THREE.Group {
  const grp = new THREE.Group();
  const n = t.n;
  const geo = block(n, t.half, (i, j) => t.h[j * n + i], (i, j) => t.h[j * n + i] - FILL,
    (i, j) => LC_COL[t.lc[j * n + i]] ?? LC_COL[0], new THREE.Color(0x6b6a60));
  grp.add(solid(geo, 0x3d3a33));
  // Water surface over water cells
  const pos: number[] = []; const s = t.step, h = t.half, W = 2;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    if (t.lc[j * n + i] !== W && t.lc[j * n + i + 1] !== W && t.lc[(j + 1) * n + i] !== W && t.lc[(j + 1) * n + i + 1] !== W) continue;
    const x0 = -h + i * s, z0 = -h + j * s, x1 = x0 + s, z1 = z0 + s, y = 0.05;
    pos.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
  }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wg.computeVertexNormals();
  const water = new THREE.Mesh(wg, new THREE.MeshPhongMaterial({ color: 0x1d7fb4, transparent: true, opacity: 0.72, shininess: 90, specular: 0x88ccff, depthWrite: false }));
  water.renderOrder = 2;
  grp.add(water);
  return grp;
}

export function buildTrees(d: SceneData): THREE.Group {
  const grp = new THREE.Group();
  const dummy = new THREE.Object3D();
  const leaf = d.trees.filter(t => t[3] === 0), conifer = d.trees.filter(t => t[3] === 1);
  const rnd = (k: number) => { const x = Math.sin(k * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), lambert(0x2f8a5a), leaf.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 1, 5), lambert(0x5a4a3a), d.trees.length);
  leaf.forEach((t, k) => {
    const s = 2.6 + rnd(k) * 2.2;
    dummy.position.set(t[0], t[1] + 2.6 + s * 0.8, t[2]); dummy.scale.set(s, s * 1.1, s); dummy.updateMatrix(); crowns.setMatrixAt(k, dummy.matrix);
  });
  const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(1.8, 7, 6), lambert(0x1f5c40), Math.max(1, conifer.length));
  cones.count = conifer.length;
  conifer.forEach((t, k) => { dummy.position.set(t[0], t[1] + 5, t[2]); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); cones.setMatrixAt(k, dummy.matrix); });
  d.trees.forEach((t, k) => { dummy.position.set(t[0], t[1] + 1.5, t[2]); dummy.scale.set(1, 3, 1); dummy.updateMatrix(); trunks.setMatrixAt(k, dummy.matrix); });
  grp.add(crowns, cones, trunks);
  return grp;
}

function polylineSegments(lines: number[][], color: number, opacity = 1): THREE.LineSegments {
  const pos: number[] = [];
  for (const l of lines) for (let i = 0; i + 5 < l.length; i += 3) pos.push(l[i], l[i + 1], l[i + 2], l[i + 3], l[i + 4], l[i + 5]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

export function buildStreetFurniture(d: SceneData): THREE.Group {
  const grp = new THREE.Group();
  grp.add(polylineSegments(d.lines.curb, 0xe6edf2, 0.55));
  grp.add(polylineSegments(d.lines.track, 0x6ec0ff, 0.9));
  grp.add(polylineSegments(d.lines.platform, 0xc9d6e0, 0.7));
  const dummy = new THREE.Object3D();
  // Street lights (baskarta)
  const lamps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.15, 7, 5), lambert(0x9fb0bd), d.lamps.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd27a }), d.lamps.length);
  d.lamps.forEach((l, k) => {
    dummy.position.set(l[0], l[1] + 3.5, l[2]); dummy.updateMatrix(); lamps.setMatrixAt(k, dummy.matrix);
    dummy.position.set(l[0], l[1] + 7.1, l[2]); dummy.updateMatrix(); heads.setMatrixAt(k, dummy.matrix);
  });
  grp.add(lamps, heads);
  // Signals and signs (OSM)
  const SIGN_COL: Record<string, number> = { signal: 0x3ddc97, stop: 0xd8362f, giveway: 0xf2f2f2, crossing: 0x2f6bd6, sign: 0x2f6bd6 };
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 5), lambert(0xb7c4cd), d.signs.length);
  const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 1.1, 0.15), new THREE.MeshBasicMaterial({ color: 0xffffff }), d.signs.length);
  d.signs.forEach((s, k) => {
    dummy.position.set(s[0], s[1] + 1.6, s[2]); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); posts.setMatrixAt(k, dummy.matrix);
    const tall = s[3] === 'signal';
    dummy.position.set(s[0], s[1] + (tall ? 3.4 : 3.3), s[2]); dummy.scale.set(tall ? 0.6 : 1, tall ? 1.6 : 1, tall ? 4 : 1); dummy.rotation.set(0, (k * 0.7) % Math.PI, 0); dummy.updateMatrix(); plates.setMatrixAt(k, dummy.matrix);
    plates.setColorAt(k, new THREE.Color(SIGN_COL[s[3]] ?? 0xffffff));
  });
  if (plates.instanceColor) plates.instanceColor.needsUpdate = true;
  grp.add(posts, plates);
  return grp;
}

// Douglas–Peucker in the xz-plane
function simplify(pts: number[][], tol: number): number[][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!; let best = -1, bi = -1;
    const [ax, , az] = pts[a], [bx, , bz] = pts[b]; const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][2] - az) * dx) / L; if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function buildUtilities(d: SceneData): THREE.Group {
  const grp = new THREE.Group();
  const TYPES: Record<string, [number, number]> = { va: [0x3aa0ff, 0.55], fjv: [0xff5a4d, 0.45], el: [0xffd23f, 0.25], fiber: [0x3ddc97, 0.2] };
  const up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3(), dummy = new THREE.Object3D();
  for (const [type, [color, r]] of Object.entries(TYPES)) {
    const segs: [THREE.Vector3, THREE.Vector3][] = [];
    for (const u of d.utilities) if (u.type === type) {
      const p = simplify(u.pts, 1.5);
      for (let i = 0; i < p.length - 1; i++) segs.push([new THREE.Vector3(...p[i]), new THREE.Vector3(...p[i + 1])]);
    }
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(r, r, 1, 6, 1, true),
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45 }), segs.length);
    segs.forEach(([p, q], k) => {
      a.copy(p); b.copy(q); const len = a.distanceTo(b);
      dummy.position.copy(a).add(b).multiplyScalar(0.5);
      dummy.quaternion.setFromUnitVectors(up, b.sub(a).normalize());
      dummy.scale.set(1, len + r, 1); dummy.updateMatrix(); im.setMatrixAt(k, dummy.matrix);
    });
    grp.add(im);
  }
  return grp;
}

export function buildTunnels(d: SceneData): THREE.Group {
  const grp = new THREE.Group();
  const geos: Record<string, THREE.BufferGeometry[]> = { road: [], rail: [] };
  for (const t of d.tunnels) {
    if (t.pts.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(t.pts.map(p => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
    const segs = Math.max(4, Math.round(curve.getLength() / 6));
    geos[t.kind].push(new THREE.TubeGeometry(curve, segs, t.kind === 'rail' ? 7 : 5, 12, false));
  }
  for (const [kind, list] of Object.entries(geos)) {
    if (!list.length) continue;
    const color = kind === 'rail' ? 0xb69cff : 0xffb454;
    const g = mergeGeometries(list);
    grp.add(new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.55, emissive: color, emissiveIntensity: 0.3, side: THREE.DoubleSide, depthWrite: false })));
  }
  return grp;
}

// Soil and bedrock from the SGU depth model. Grid is resampled to the soil raster (10 m).
const SOIL_COL: Record<string, THREE.Color> = {
  'Postglacial lera': new THREE.Color(0x7d91a3), 'Glacial lera': new THREE.Color(0x8396a8), 'Lera': new THREE.Color(0x7d91a3),
  'Fyllning': new THREE.Color(0x8a7560), 'Urberg': new THREE.Color(0x9a8f8a), 'Vatten': new THREE.Color(0x1d7fb4)
};
export function buildGeology(d: SceneData, t: Terrain): { jord: THREE.Group; berg: THREE.Group; bedrockAt: (x: number, z: number) => number } {
  const g = d.sgu, half = t.half;
  const depthAt = (x: number, z: number) => {
    const fx = Math.min(g.nx - 1.001, Math.max(0, (x + half) / g.step)), fy = Math.min(g.ny - 1.001, Math.max(0, (z + half) / g.step));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, D = g.depth, n = g.nx;
    return (D[j * n + i] * (1 - tx) + D[j * n + i + 1] * tx) * (1 - ty) + (D[(j + 1) * n + i] * (1 - tx) + D[(j + 1) * n + i + 1] * tx) * ty;
  };
  const groundSmooth = (x: number, z: number) => {
    const fx = Math.min(g.nx - 1.001, Math.max(0, (x + half) / g.step)), fy = Math.min(g.ny - 1.001, Math.max(0, (z + half) / g.step));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, G = g.ground, n = g.nx;
    return (G[j * n + i] * (1 - tx) + G[j * n + i + 1] * tx) * (1 - ty) + (G[(j + 1) * n + i] * (1 - tx) + G[(j + 1) * n + i + 1] * tx) * ty;
  };
  const N = g.soilN, step = (2 * half) / (N - 1);
  const X = (i: number) => -half + i * step, Z = (j: number) => -half + j * step;
  const jordTop = (i: number, j: number) => t.at(X(i), Z(j)) - FILL;
  const bedrockAt = (x: number, z: number) => groundSmooth(x, z) - depthAt(x, z);
  const rockTop = (i: number, j: number) => Math.min(bedrockAt(X(i), Z(j)), jordTop(i, j) - 0.3);
  const soilCol = (i: number, j: number) => { const c = g.soil[j * N + i]; return (c >= 0 && SOIL_COL[g.soilClasses[c]]) || SOIL_COL['Postglacial lera']; };
  const jordGeo = block(N, half, jordTop, rockTop, soilCol, new THREE.Color(0x7d91a3), new THREE.Color(0x5b6876));
  const rockCol = new THREE.Color(0x6e7488);
  const bergGeo = block(N, half, rockTop, () => BASE, () => rockCol, new THREE.Color(0x60667a), new THREE.Color(0x3b3f4c));
  return { jord: solid(jordGeo, 0x56626e), berg: solid(bergGeo, 0x3e4250), bedrockAt };
}
