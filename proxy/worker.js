// Small proxy for live traffic data (stage 3). Runs as a Cloudflare Worker.
// The API keys live only as Worker secrets (VT_ID, VT_SECRET, TV_KEY) and never reach the browser or the repo.
// Read-only: only whitelisted Västtrafik paths and Trafikverket object types are forwarded.

const ORIGINS = ['https://kmatiq.github.io', 'http://localhost:5173', 'http://localhost:4173'];
const TV_TYPES = ['TrafficFlow', 'Situation', 'TravelTimeRoute', 'WeatherMeasurepoint', 'RoadCondition', 'Camera'];
let vtToken = null, vtExp = 0;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      // Status: shows which secrets are set (never their values).
      if (url.pathname === '/') return json({ ok: true, vasttrafik: !!(env.VT_ID && env.VT_SECRET), trafikverket: !!env.TV_KEY }, 200, cors);

      // Västtrafik Planera Resa v4: GET /vt/v4/... -> https://ext-api.vasttrafik.se/pr/v4/...
      if (url.pathname.startsWith('/vt/') && req.method === 'GET') {
        const path = url.pathname.slice(4);
        if (!/^v4(-api)?\/[\w\-\/.{}]+$/.test(path)) return json({ error: 'path not allowed' }, 404, cors);
        const cache = caches.default, key = new Request(url.toString());
        const hit = await cache.match(key);
        if (hit) return withCors(hit, cors);
        const token = await vasttrafikToken(env);
        const r = await fetch(`https://ext-api.vasttrafik.se/pr/${path}${url.search}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        const res = new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'public, max-age=10' } });
        if (r.ok) ctx.waitUntil(cache.put(key, res.clone()));
        return withCors(res, cors);
      }

      // Trafikverket: POST /tv with one or more <QUERY> elements (no LOGIN). The key is added here.
      if (url.pathname === '/tv' && req.method === 'POST') {
        let q = (await req.text()).replace(/<\/?REQUEST>/gi, '').trim();
        if (q.length > 6000 || /LOGIN/i.test(q)) return json({ error: 'bad query' }, 400, cors);
        const types = [...q.matchAll(/objecttype="([^"]+)"/gi)].map(m => m[1]);
        if (!types.length || types.some(t => !TV_TYPES.includes(t))) return json({ error: 'object type not allowed' }, 400, cors);
        const body = `<REQUEST><LOGIN authenticationkey="${env.TV_KEY}"/>${q}</REQUEST>`;
        const r = await fetch('https://api.trafikinfo.trafikverket.se/v2/data.json', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
        return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } });
      }
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502, cors);
    }
    return json({ error: 'not found' }, 404, cors);
  }
};

async function vasttrafikToken(env) {
  if (vtToken && Date.now() < vtExp) return vtToken;
  const r = await fetch('https://ext-api.vasttrafik.se/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${env.VT_ID}:${env.VT_SECRET}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!r.ok) throw new Error('Västtrafik token: HTTP ' + r.status);
  const j = await r.json();
  vtToken = j.access_token; vtExp = Date.now() + (j.expires_in - 60) * 1000;
  return vtToken;
}

const json = (o, status, cors) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
function withCors(res, cors) { const r = new Response(res.body, res); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; }
