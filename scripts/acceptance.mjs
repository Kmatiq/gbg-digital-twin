// Acceptance check for etapp 1: compare OSM building footprints used in the model with
// Göteborgs Stad's baskarta (independent photogrammetric survey) for known landmarks.
// Prints a table (used in docs/acceptans.md) and writes docs/acceptans.svg.
import fs from 'node:fs';
import { BBOX, RAW, wgsTo3007, s3007ToWgs } from './lib/config.mjs';
import { readLayer } from './lib/shp.mjs';
import { loadOsm } from './lib/osm.mjs';

const osm = loadOsm(fs.readdirSync(RAW + 'osm').filter(f => f.endsWith('.osm')).map(f => RAW + 'osm/' + f));
const bk = (await readLayer(RAW + 'baskarta/byggnad_l', BBOX)).filter(g => ['Takkonturer', 'Fasad'].includes(g.props.typ));
const segs = []; for (const g of bk) for (const r of g.rings) for (let i = 0; i < r.length - 1; i++) segs.push([r[i][0], r[i][1], r[i + 1][0], r[i + 1][1], r[i][2]]);
const bjson = JSON.parse(fs.readFileSync(new URL('../public/data/buildings.json', import.meta.url)));
const binfo = new Map(bjson.rows.map(r => [r[0], Object.fromEntries(bjson.fields.map((f, i) => [f, r[i]]))]));

const CHECK = [
  ['w13704178', 'Centralstationen (Centralhuset)', null],
  ['w26251811', 'Nordstan', null],
  ['w40330178', 'Stora Teatern', null],
  ['w44697495', 'Kronhuset', null],
  ['w45408372', 'Palmhuset, Trädgårdsföreningen', null],
  ['w175648796', 'Lilla Bommen (Läppstiftet)', 86],
  ['w24502883', 'Göteborgsoperan', null]
];
function segDist(x, y, s) { const dx = s[2] - s[0], dy = s[3] - s[1]; const L = dx * dx + dy * dy; let t = L ? ((x - s[0]) * dx + (y - s[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - s[0] - t * dx, y - s[1] - t * dy); }
const rows = []; const panels = [];
for (const [wid, name, refH] of CHECK) {
  const w = osm.ways.get(wid.slice(1)); if (!w) { console.log('missing', wid); continue; }
  const ring = w.nodes.map(id => { const n = osm.nodes.get(id); return wgsTo3007(n.lon, n.lat); });
  const bb = [Math.min(...ring.map(p => p[0])) - 15, Math.min(...ring.map(p => p[1])) - 15, Math.max(...ring.map(p => p[0])) + 15, Math.max(...ring.map(p => p[1])) + 15];
  const near = segs.filter(s => Math.max(s[0], s[2]) > bb[0] && Math.min(s[0], s[2]) < bb[2] && Math.max(s[1], s[3]) > bb[1] && Math.min(s[1], s[3]) < bb[3]);
  const d = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[i + 1]; const L = Math.hypot(bx - ax, by - ay);
    for (let s = 0; s < L; s += 1) { const x = ax + (bx - ax) * s / L, y = ay + (by - ay) * s / L; d.push(Math.min(...near.map(q => segDist(x, y, q)))); }
  }
  d.sort((a, b) => a - b);
  const med = d[d.length >> 1], p90 = d[Math.floor(d.length * 0.9)];
  const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
  const [lon, lat] = s3007ToWgs(...c);
  const b = binfo.get(wid);
  rows.push({ name, wid, lat: lat.toFixed(5), lon: lon.toFixed(5), med: med.toFixed(2), p90: p90.toFixed(2), h: b?.height, src: b?.src, refH });
  panels.push({ name, ring, near, bb });
}
// SVG: one panel per landmark, OSM footprint (blue) over baskarta roof/facade lines (red).
const PW = 300, cols = 4; let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW * cols}" height="${PW * Math.ceil(panels.length / cols)}" style="background:#fff;font-family:sans-serif">`;
panels.forEach((p, k) => {
  const ox = (k % cols) * PW, oy = Math.floor(k / cols) * PW; const span = Math.max(p.bb[2] - p.bb[0], p.bb[3] - p.bb[1]); const sc = (PW - 30) / span;
  const P = (x, y) => `${(ox + 15 + (x - p.bb[0]) * sc).toFixed(1)},${(oy + 25 + (p.bb[3] - y) * sc).toFixed(1)}`;
  svg += `<rect x="${ox}" y="${oy}" width="${PW}" height="${PW}" fill="none" stroke="#ddd"/><text x="${ox + 8}" y="${oy + 16}" font-size="12">${p.name}</text>`;
  svg += `<polygon points="${p.ring.map(q => P(...q)).join(' ')}" fill="rgba(0,110,255,.18)" stroke="#06c" stroke-width="1.5"/>`;
  for (const s of p.near) svg += `<line x1="${P(s[0], s[1]).split(',')[0]}" y1="${P(s[0], s[1]).split(',')[1]}" x2="${P(s[2], s[3]).split(',')[0]}" y2="${P(s[2], s[3]).split(',')[1]}" stroke="#d00" stroke-width=".8"/>`;
  svg += `<line x1="${ox + PW - 70}" y1="${oy + PW - 12}" x2="${ox + PW - 70 + 20 * sc}" y2="${oy + PW - 12}" stroke="#000" stroke-width="2"/><text x="${ox + PW - 70}" y="${oy + PW - 16}" font-size="10">20 m</text>`;
});
svg += '</svg>';
fs.mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../docs/acceptans.svg', import.meta.url), svg); // render to PNG for the docs
console.table(rows);

