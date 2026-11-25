// Fetch SGU geology for the study area through SGU's public WMS
// (GetFeatureInfo returns GeoJSON incl. geometry for vector layers).
//  - Jordarter 1:25 000 (surface soil type polygons)
//  - Jorddjupsmodell (soil depth to bedrock, 10 m raster) sampled on a grid
//  - Berggrund 1:50 000 (bedrock unit polygons)
import fs from 'node:fs';
import { BBOX, RAW, s3007To3006 } from './lib/config.mjs';

const WMS = 'https://maps3.sgu.se/geoserver/ows';
const outDir = RAW + 'sgu/';
fs.mkdirSync(outDir, { recursive: true });

async function featureInfo(layer, e3007, n3007) {
  const [x, y] = s3007To3006(e3007, n3007);
  // WMS 1.3.0 + EPSG:3006 uses northing,easting axis order.
  const bbox = [y - 5, x - 5, y + 5, x + 5].join(',');
  const url = `${WMS}?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=${layer}&query_layers=${layer}` +
    `&crs=EPSG:3006&bbox=${bbox}&width=11&height=11&i=5&j=5&info_format=application/json&feature_count=5&styles=`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(res => setTimeout(res, 1000 * (attempt + 1)));
    }
  }
}

async function pool(items, n, fn) {
  let i = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function grid(step, margin = 0) {
  const pts = [];
  for (let n = BBOX[1] - margin; n <= BBOX[3] + margin + 1e-6; n += step)
    for (let e = BBOX[0] - margin; e <= BBOX[2] + margin + 1e-6; e += step) pts.push([e, n]);
  return pts;
}

async function polygons(layer, step, file) {
  const byId = new Map();
  const pts = grid(step);
  await pool(pts, 4, async ([e, n]) => {
    const j = await featureInfo(layer, e, n);
    for (const f of j.features || []) if (f.geometry && !byId.has(f.id)) byId.set(f.id, f);
  });
  const fc = { type: 'FeatureCollection', crs: 'EPSG:3006', layer, fetched: new Date().toISOString(), features: [...byId.values()] };
  fs.writeFileSync(outDir + file, JSON.stringify(fc));
  console.log(file, fc.features.length, 'features from', pts.length, 'samples');
}

async function depthGrid(step, file) {
  const pts = grid(step);
  const vals = await pool(pts, 4, async ([e, n]) => {
    const j = await featureInfo('misc:SE.GOV.SGU.MISC.JORDDJUPSMODELL.RASTER_INTERVALL', e, n);
    const v = j.features?.[0]?.properties?.jorddjup_10x10m;
    return v == null ? null : Number(v);
  });
  const nx = Math.round((BBOX[2] - BBOX[0]) / step) + 1;
  const out = { crs: 'EPSG:3007', origin: [BBOX[0], BBOX[1]], step, nx, ny: pts.length / nx, fetched: new Date().toISOString(), values: vals };
  fs.writeFileSync(outDir + file, JSON.stringify(out));
  console.log(file, vals.filter(v => v != null).length, '/', vals.length, 'values');
}

await polygons('jord:SE.GOV.SGU.JORD.GRUNDLAGER.25K', 60, 'jordarter.json');
await polygons('berg:SE.GOV.SGU.BERG.GEOLOGISK_ENHET.YTA.50K', 150, 'berggrund.json');
await depthGrid(50, 'jorddjup.json');
