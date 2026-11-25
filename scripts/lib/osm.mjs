// Tiny OSM XML (API 0.6 /map) parser and multipolygon assembler.
import fs from 'node:fs';

const attr = (s, k) => { const m = s.match(new RegExp('\\s' + k + '="([^"]*)"')); return m ? decode(m[1]) : undefined; };
const decode = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tagsOf = body => { const t = {}; for (const m of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) t[decode(m[1])] = decode(m[2]); return t; };

export function loadOsm(files) {
  const nodes = new Map(), ways = new Map(), rels = new Map();
  for (const f of files) {
    const x = fs.readFileSync(f, 'utf8');
    for (const m of x.matchAll(/<node\b([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
      const id = attr(m[1], 'id');
      if (!nodes.has(id)) nodes.set(id, { id, lon: +attr(m[1], 'lon'), lat: +attr(m[1], 'lat'), tags: m[3] ? tagsOf(m[3]) : {} });
    }
    for (const m of x.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
      const id = attr(m[1], 'id');
      if (!ways.has(id)) ways.set(id, { id, nodes: [...m[2].matchAll(/<nd ref="(\d+)"/g)].map(a => a[1]), tags: tagsOf(m[2]) });
    }
    for (const m of x.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)) {
      const id = attr(m[1], 'id');
      if (!rels.has(id)) rels.set(id, {
        id, tags: tagsOf(m[2]),
        members: [...m[2].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"\s*\/>/g)].map(a => ({ type: a[1], ref: a[2], role: a[3] }))
      });
    }
  }
  return { nodes, ways, rels };
}

// Join way node-lists into closed rings. Returns arrays of node ids; open chains are dropped.
export function joinRings(nodeLists) {
  const chains = nodeLists.map(l => l.slice()).filter(l => l.length > 1);
  const rings = [];
  while (chains.length) {
    let cur = chains.shift();
    let changed = true;
    while (cur[0] !== cur[cur.length - 1] && changed) {
      changed = false;
      for (let i = 0; i < chains.length; i++) {
        const c = chains[i], end = cur[cur.length - 1];
        if (c[0] === end) cur = cur.concat(c.slice(1));
        else if (c[c.length - 1] === end) cur = cur.concat(c.slice().reverse().slice(1));
        else if (c[c.length - 1] === cur[0]) cur = c.concat(cur.slice(1));
        else if (c[0] === cur[0]) cur = c.slice().reverse().concat(cur.slice(1));
        else continue;
        chains.splice(i, 1); changed = true; break;
      }
    }
    if (cur.length >= 4 && cur[0] === cur[cur.length - 1]) rings.push(cur);
  }
  return rings;
}

// Areas: closed ways and multipolygon relations -> [{tags, outer:[ring], inner:[ring], id}]
// Rings are arrays of node ids.
export function areas(osm, filter) {
  const out = [];
  for (const w of osm.ways.values()) {
    if (w.nodes.length >= 4 && w.nodes[0] === w.nodes[w.nodes.length - 1] && filter(w.tags))
      out.push({ id: 'w' + w.id, tags: w.tags, outer: [w.nodes], inner: [] });
  }
  for (const r of osm.rels.values()) {
    if (r.tags.type !== 'multipolygon' || !filter(r.tags)) continue;
    const get = role => r.members.filter(m => m.type === 'way' && (m.role === role || (role === 'outer' && m.role === '')))
      .map(m => osm.ways.get(m.ref)).filter(Boolean).map(w => w.nodes);
    const outer = joinRings(get('outer')), inner = joinRings(get('inner'));
    if (outer.length) out.push({ id: 'r' + r.id, tags: r.tags, outer, inner });
  }
  return out;
}
