// Minimal glTF 2.0 binary writer: triangle meshes with POSITION, NORMAL, COLOR_0 and indices.
import fs from 'node:fs';

// meshes: [{name, positions: Float32Array, normals: Float32Array, colors: Uint8Array(rgba), indices: Uint32Array}]
export function writeGlb(file, meshes, extras = {}) {
  const chunks = []; let offset = 0;
  const bufferViews = [], accessors = [], gltfMeshes = [], nodes = [];
  const push = (arr, target) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (bytes.byteLength % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(bytes); if (pad) chunks.push(new Uint8Array(pad));
    offset += bytes.byteLength + pad;
    return bufferViews.length - 1;
  };
  for (const m of meshes) {
    const n = m.positions.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = m.positions[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    const attrs = {};
    accessors.push({ bufferView: push(m.positions, 34962), componentType: 5126, count: n, type: 'VEC3', min, max }); attrs.POSITION = accessors.length - 1;
    if (m.normals) { accessors.push({ bufferView: push(m.normals, 34962), componentType: 5126, count: n, type: 'VEC3' }); attrs.NORMAL = accessors.length - 1; }
    if (m.colors) { accessors.push({ bufferView: push(m.colors, 34962), componentType: 5121, normalized: true, count: n, type: 'VEC4' }); attrs.COLOR_0 = accessors.length - 1; }
    accessors.push({ bufferView: push(m.indices, 34963), componentType: 5125, count: m.indices.length, type: 'SCALAR' });
    gltfMeshes.push({ name: m.name, primitives: [{ attributes: attrs, indices: accessors.length - 1, mode: 4 }] });
    nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 });
  }
  const json = {
    asset: { version: '2.0', generator: 'gbg-digital-twin build-data' },
    scene: 0, scenes: [{ nodes: nodes.map((_, i) => i), extras }], nodes, meshes: gltfMeshes,
    buffers: [{ byteLength: offset }], bufferViews, accessors
  };
  let jsonBytes = Buffer.from(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4; jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jpad, 0x20)]);
  const bin = Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  jh.writeUInt32LE(jsonBytes.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jh, jsonBytes, bh, bin]));
  return total;
}

// glTF vertex colours are linear; inputs here are sRGB 0-255.
const lin = v => { const c = v / 255; return Math.round(255 * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); };

// Growable mesh builder with flat-shaded triangles.
export class MeshBuilder {
  constructor(name) { this.name = name; this.p = []; this.n = []; this.c = []; this.i = []; this.v = 0; }
  vertex(x, y, z, nx, ny, nz, col) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(lin(col[0]), lin(col[1]), lin(col[2]), 255); return this.v++; }
  tri(a, b, c) { this.i.push(a, b, c); }
  // Add a triangle wound so that its geometric normal points up (+y).
  triUp(a, b, c) {
    const p = this.p;
    const ux = p[b * 3] - p[a * 3], uz = p[b * 3 + 2] - p[a * 3 + 2], vx = p[c * 3] - p[a * 3], vz = p[c * 3 + 2] - p[a * 3 + 2];
    if (uz * vx - ux * vz >= 0) this.i.push(a, b, c); else this.i.push(a, c, b);
  }
  get triangles() { return this.i.length / 3; }
  build() {
    return { name: this.name, positions: new Float32Array(this.p), normals: new Float32Array(this.n), colors: new Uint8Array(this.c), indices: new Uint32Array(this.i) };
  }
}
