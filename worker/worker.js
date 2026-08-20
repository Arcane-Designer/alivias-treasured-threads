/* ============================================================
   ATT REVIEW INBOX ~ a tiny Cloudflare Worker
   Shoppers' review submissions land here (KV) so Alivia's Studio
   can show them for one-tap adding. No accounts, no passwords:
   reading/deleting requires her existing GitHub "magic key",
   which the worker verifies has write access to the shop repo.
   ============================================================ */

const REPO = 'Arcane-Designer/alivias-treasured-threads';
const ALLOWED_ORIGINS = [
  'https://arcane-designer.github.io',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];
const MAX_INBOX = 200;
const RATE_LIMIT_PER_HOUR = 5;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('Origin') || '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (request.method === 'POST' && url.pathname === '/submit') return await submit(request, env, cors);
      if (request.method === 'GET' && url.pathname === '/inbox') return await inbox(request, env, cors);
      if (request.method === 'DELETE' && url.pathname.startsWith('/inbox/')) {
        return await remove(request, env, cors, decodeURIComponent(url.pathname.slice('/inbox/'.length)));
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ error: 'server hiccup' }, 500, cors);
    }
  },
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

/* ---------- public: a shopper submits a review ---------- */
async function submit(request, env, cors) {
  const body = await request.json().catch(() => null);
  /* honeypot field: bots that fill it get a polite fake success */
  if (!body || body.website) return json({ ok: true }, 200, cors);

  const name = String(body.name || '').trim().slice(0, 80);
  const text = String(body.text || '').trim().slice(0, 1200);
  const stars = Math.min(5, Math.max(1, parseInt(body.stars, 10) || 5));
  if (!name || !text) return json({ error: 'name and review required' }, 400, cors);

  /* gentle per-IP rate limit */
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = 'rl:' + ip;
  const count = parseInt((await env.REVIEWS.get(rlKey)) || '0', 10);
  if (count >= RATE_LIMIT_PER_HOUR) return json({ error: 'too many reviews from here right now ~ try again later!' }, 429, cors);
  await env.REVIEWS.put(rlKey, String(count + 1), { expirationTtl: 3600 });

  /* keep the inbox from overflowing */
  const list = await env.REVIEWS.list({ prefix: 'rev:', limit: MAX_INBOX });
  if (list.keys.length >= MAX_INBOX) return json({ error: 'inbox full' }, 503, cors);

  const id = 'rev:' + Date.now() + '-' + crypto.randomUUID().slice(0, 8);
  /* no expiry: submissions stay until Alivia selects or trashes them,
     so her Studio can always reach every review the site ever received */
  await env.REVIEWS.put(id, JSON.stringify({ name, text, stars, at: new Date().toISOString() }));
  return json({ ok: true }, 200, cors);
}

/* ---------- auth: only someone holding a GitHub token with push
   access to the shop repo (i.e. Alivia's magic key) may read/delete ---------- */
const authCache = new Map(); /* sha256(token) -> { ok, exp } per isolate */

async function isAlivia(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  const key = await sha256(token);
  const hit = authCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ok;

  let ok = false;
  try {
    const res = await fetch('https://api.github.com/repos/' + REPO, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'att-review-inbox',
      },
    });
    if (res.ok) {
      const repo = await res.json();
      ok = !!(repo.permissions && repo.permissions.push);
    }
  } catch (e) { ok = false; }

  authCache.set(key, { ok, exp: Date.now() + 5 * 60 * 1000 });
  return ok;
}

async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- Alivia's Studio: list waiting reviews ---------- */
async function inbox(request, env, cors) {
  if (!(await isAlivia(request))) return json({ error: 'unauthorized' }, 401, cors);
  const list = await env.REVIEWS.list({ prefix: 'rev:', limit: MAX_INBOX });
  const items = [];
  for (const k of list.keys) {
    const v = await env.REVIEWS.get(k.name);
    if (v) {
      try { items.push({ id: k.name, ...JSON.parse(v) }); } catch (e) { /* skip corrupt */ }
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return json({ items }, 200, cors);
}

/* ---------- Alivia's Studio: remove one (after adding or dismissing) ---------- */
async function remove(request, env, cors, id) {
  if (!(await isAlivia(request))) return json({ error: 'unauthorized' }, 401, cors);
  if (!id.startsWith('rev:')) return json({ error: 'bad id' }, 400, cors);
  await env.REVIEWS.delete(id);
  return json({ ok: true }, 200, cors);
}
