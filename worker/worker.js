/* Alivia's Treasured Threads API: reviews plus test-mode Stripe Checkout. */
const REPO = 'Arcane-Designer/alivias-treasured-threads';
const DEFAULT_CATALOG_URL = 'https://arcane-designer.github.io/alivias-treasured-threads/data/site.json';
const DEFAULT_SITE_URL = 'https://arcane-designer.github.io/alivias-treasured-threads';
const ALLOWED_ORIGINS = ['https://arcane-designer.github.io', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const MAX_INBOX = 200;
const RATE_LIMIT_PER_HOUR = 5;
const MAX_CART_ITEMS = 40;
const RESERVATION_SECONDS = 30 * 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (request.method === 'POST' && url.pathname === '/submit') return await submitReview(request, env, cors);
      if (request.method === 'GET' && url.pathname === '/inbox') return await inbox(request, env, cors);
      if (request.method === 'DELETE' && url.pathname.startsWith('/inbox/')) return await removeReview(request, env, cors, decodeURIComponent(url.pathname.slice(7)));
      if (request.method === 'POST' && url.pathname === '/checkout/session') {
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403, cors);
        return await createCheckoutSession(request, env, cors);
      }
      if (request.method === 'GET' && url.pathname === '/checkout/status') {
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403, cors);
        return await checkoutStatus(url, env, cors);
      }
      if (request.method === 'POST' && url.pathname === '/stripe/webhook') return await stripeWebhook(request, env);
      return json({ error: 'not found' }, 404, cors);
    } catch (error) {
      console.error(JSON.stringify({ message: 'request failed', path: url.pathname, error: safeError(error) }));
      return json({ error: 'server hiccup' }, 500, cors);
    }
  },
};

function safeError(error) { return error instanceof Error ? error.message : String(error); }
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400', Vary: 'Origin',
  };
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

/* Reviews: preserve the public inbox and Studio behavior. */
async function submitReview(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body || body.website) return json({ ok: true }, 200, cors);
  const name = String(body.name || '').trim().slice(0, 80);
  const text = String(body.text || '').trim().slice(0, 1200);
  const stars = Math.min(5, Math.max(1, parseInt(body.stars, 10) || 5));
  if (!name || !text) return json({ error: 'name and review required' }, 400, cors);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = 'rl:' + ip;
  const count = parseInt((await env.REVIEWS.get(rlKey)) || '0', 10);
  if (count >= RATE_LIMIT_PER_HOUR) return json({ error: 'too many reviews from here right now ~ try again later!' }, 429, cors);
  await env.REVIEWS.put(rlKey, String(count + 1), { expirationTtl: 3600 });
  const list = await env.REVIEWS.list({ prefix: 'rev:', limit: MAX_INBOX });
  if (list.keys.length >= MAX_INBOX) return json({ error: 'inbox full' }, 503, cors);
  const id = 'rev:' + Date.now() + '-' + crypto.randomUUID().slice(0, 8);
  await env.REVIEWS.put(id, JSON.stringify({ name, text, stars, at: new Date().toISOString() }));
  return json({ ok: true }, 200, cors);
}

const authCache = new Map();
async function isAlivia(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  const key = await sha256(token);
  const hit = authCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ok;
  let ok = false;
  try {
    const response = await fetch('https://api.github.com/repos/' + REPO, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'att-store-api' } });
    if (response.ok) { const repo = await response.json(); ok = !!(repo.permissions && repo.permissions.push); }
  } catch { ok = false; }
  authCache.set(key, { ok, exp: Date.now() + 5 * 60 * 1000 });
  return ok;
}
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}
async function inbox(request, env, cors) {
  if (!(await isAlivia(request))) return json({ error: 'unauthorized' }, 401, cors);
  const list = await env.REVIEWS.list({ prefix: 'rev:', limit: MAX_INBOX });
  const items = [];
  for (const key of list.keys) {
    const value = await env.REVIEWS.get(key.name);
    if (value) try { items.push({ id: key.name, ...JSON.parse(value) }); } catch { /* skip corrupt */ }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return json({ items }, 200, cors);
}
async function removeReview(request, env, cors, id) {
  if (!(await isAlivia(request))) return json({ error: 'unauthorized' }, 401, cors);
  if (!id.startsWith('rev:')) return json({ error: 'bad id' }, 400, cors);
  await env.REVIEWS.delete(id);
  return json({ ok: true }, 200, cors);
}

/* Canonical inventory and pricing. Client names and prices are ignored. */
export function validateCart(catalog, rawItems) {
  if (!catalog || !Array.isArray(catalog.products)) throw new CheckoutError('catalog unavailable', 503, 'catalog_unavailable');
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > MAX_CART_ITEMS) throw new CheckoutError('basket must contain 1 to 40 items', 400, 'invalid_basket');
  const seen = new Set();
  const items = rawItems.map((raw) => {
    if (!raw || (raw.type !== 'listing' && raw.type !== 'oneoff')) throw new CheckoutError('invalid basket item', 400, 'invalid_basket');
    if ((raw.qty != null && raw.qty !== 1) || (raw.quantity != null && raw.quantity !== 1)) throw new CheckoutError('finished inventory quantity must be one per exact item', 400, 'invalid_basket');
    const productId = String(raw.productId || '');
    const product = catalog.products.find((entry) => entry.id === productId && !entry.archived);
    if (!product) throw new CheckoutError('product is unavailable', 409, 'inventory_changed');
    let listingId = null;
    let inventoryKey;
    let name;
    if (raw.type === 'listing') {
      listingId = String(raw.listingId || '');
      const listing = (product.listings || []).find((entry) => entry.id === listingId && !entry.sold);
      if (!listing) throw new CheckoutError('a selected piece is no longer available', 409, 'inventory_changed');
      inventoryKey = `listing:${productId}:${listingId}`;
      name = String(listing.name || product.name).trim();
    } else {
      if (!product.oneOfAKind) throw new CheckoutError('product is not available as a finished piece', 409, 'inventory_changed');
      inventoryKey = `oneoff:${productId}`;
      name = String(product.name).trim();
    }
    if (seen.has(inventoryKey)) throw new CheckoutError('duplicate basket item', 400, 'invalid_basket');
    seen.add(inventoryKey);
    const price = typeof product.salePrice === 'number' ? product.salePrice : product.price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) throw new CheckoutError('item has no checkout price', 409, 'inventory_changed');
    return { type: raw.type, productId, listingId, inventoryKey, name, productName: String(product.name).trim(), unitAmount: Math.round(price * 100), tiers: product.priceTiers || [] };
  });
  const lineItems = pricedLineItems(items);
  return { items, lineItems, subtotal: lineItems.reduce((sum, line) => sum + line.amount, 0) };
}

function pricedLineItems(items) {
  const byProduct = new Map();
  for (const item of items) {
    if (!byProduct.has(item.productId)) byProduct.set(item.productId, []);
    byProduct.get(item.productId).push(item);
  }
  const lines = [];
  for (const group of byProduct.values()) {
    const tiers = (group[0].tiers || []).filter((tier) => Number.isInteger(tier.qty) && tier.qty > 0 && typeof tier.price === 'number').sort((a, b) => b.qty - a.qty);
    let cursor = 0;
    while (cursor < group.length) {
      const remaining = group.length - cursor;
      const tier = tiers.find((entry) => entry.qty <= remaining);
      const count = tier ? tier.qty : 1;
      const chunk = group.slice(cursor, cursor + count);
      lines.push({ amount: tier ? Math.round(tier.price * 100) : chunk[0].unitAmount, name: count > 1 ? `${group[0].productName} (${count}-piece price)` : chunk[0].name, description: count > 1 ? chunk.map((item) => item.name).join(', ').slice(0, 500) : group[0].productName, inventoryKeys: chunk.map((item) => item.inventoryKey) });
      cursor += count;
    }
  }
  return lines;
}
async function fetchCatalog(env) {
  const response = await fetch(env.CATALOG_URL || DEFAULT_CATALOG_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new CheckoutError('catalog unavailable', 503, 'catalog_unavailable');
  return await response.json();
}

async function createCheckoutSession(request, env, cors) {
  requireCheckoutConfig(env);
  const body = await request.json().catch(() => null);
  const attemptId = String(body?.attemptId || '');
  if (!/^[a-f0-9-]{36}$/i.test(attemptId)) return json({ error: 'invalid checkout attempt', code: 'invalid_basket' }, 400, cors);
  const now = Math.floor(Date.now() / 1000);
  const existing = await env.ORDERS.prepare('SELECT order_ref, stripe_session_id, checkout_url, status, expires_at FROM orders WHERE checkout_attempt_id = ?').bind(attemptId).first();
  if (existing?.checkout_url && existing.status === 'pending' && existing.expires_at > now) return json({ url: existing.checkout_url }, 200, cors);
  if (existing) {
    if (existing.status === 'paid') return json({ error: 'This checkout attempt is already paid.', code: 'already_paid' }, 409, cors);
    if (existing.status === 'creating' && existing.expires_at > now) return json({ error: 'Checkout is already starting. Please try again in a moment.', code: 'checkout_starting' }, 409, cors);
    await env.ORDERS.batch([
      env.ORDERS.prepare('DELETE FROM inventory_reservations WHERE order_ref = ? AND status = ?').bind(existing.order_ref, 'pending'),
      env.ORDERS.prepare('DELETE FROM order_items WHERE order_ref = ?').bind(existing.order_ref),
      env.ORDERS.prepare('DELETE FROM orders WHERE order_ref = ? AND status != ?').bind(existing.order_ref, 'paid'),
    ]);
  }
  let cart;
  try { cart = validateCart(await fetchCatalog(env), body?.items); } catch (error) { return checkoutError(error, cors); }
  const shippingCents = parseShippingCents(env.SHIPPING_RATE_CENTS);
  const orderRef = createOrderRef();
  const expiresAt = now + RESERVATION_SECONDS;
  const reservationExpiresAt = expiresAt + 60 * 60;
  await env.ORDERS.prepare('DELETE FROM inventory_reservations WHERE status = ? AND expires_at < ?').bind('pending', now).run();
  const statements = [env.ORDERS.prepare('INSERT INTO orders (order_ref, checkout_attempt_id, status, currency, subtotal_cents, shipping_cents, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(orderRef, attemptId, 'creating', 'usd', cart.subtotal, shippingCents, expiresAt, now)];
  for (const item of cart.items) {
    statements.push(env.ORDERS.prepare('INSERT INTO inventory_reservations (inventory_key, order_ref, status, expires_at) VALUES (?, ?, ?, ?)').bind(item.inventoryKey, orderRef, 'pending', reservationExpiresAt));
    statements.push(env.ORDERS.prepare('INSERT INTO order_items (order_ref, inventory_key, product_id, listing_id, display_name, unit_amount_cents) VALUES (?, ?, ?, ?, ?, ?)').bind(orderRef, item.inventoryKey, item.productId, item.listingId, item.name, item.unitAmount));
  }
  try { await env.ORDERS.batch(statements); } catch { return json({ error: 'One or more pieces are reserved or no longer available.', code: 'inventory_changed' }, 409, cors); }
  let session = null;
  try {
    session = await stripeRequest(env, '/v1/checkout/sessions', { method: 'POST', body: buildStripeSessionParams(cart, env, orderRef, expiresAt), idempotencyKey: `att-${attemptId}` });
    if (!session.id || !session.url || session.livemode !== false) throw new Error('Stripe returned an invalid test session');
    await env.ORDERS.prepare('UPDATE orders SET stripe_session_id = ?, checkout_url = ?, status = ? WHERE order_ref = ?').bind(session.id, session.url, 'pending', orderRef).run();
    return json({ url: session.url }, 200, cors);
  } catch (error) {
    if (session?.id) {
      try { await stripeRequest(env, `/v1/checkout/sessions/${encodeURIComponent(session.id)}/expire`, { method: 'POST' }); } catch { /* original failure still wins */ }
    }
    await env.ORDERS.batch([env.ORDERS.prepare('DELETE FROM inventory_reservations WHERE order_ref = ? AND status = ?').bind(orderRef, 'pending'), env.ORDERS.prepare('UPDATE orders SET status = ? WHERE order_ref = ?').bind('session_failed', orderRef)]);
    console.error(JSON.stringify({ message: 'checkout session creation failed', orderRef, error: safeError(error) }));
    return json({ error: 'Secure checkout could not start. Please try again.', code: 'checkout_unavailable' }, 502, cors);
  }
}

export function buildStripeSessionParams(cart, env, orderRef, expiresAt) {
  const site = String(env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('payment_method_types[0]', 'card');
  params.set('wallet_options[link][display]', 'never');
  params.set('success_url', `${site}/checkout/success/?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${site}/checkout/cancel/`);
  params.set('client_reference_id', orderRef);
  params.set('customer_creation', 'always');
  params.set('shipping_address_collection[allowed_countries][0]', 'US');
  params.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  params.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(parseShippingCents(env.SHIPPING_RATE_CENTS)));
  params.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'usd');
  params.set('shipping_options[0][shipping_rate_data][display_name]', 'Standard shipping');
  const minDays = positiveInt(env.SHIPPING_MIN_DAYS);
  const maxDays = positiveInt(env.SHIPPING_MAX_DAYS);
  if (minDays && maxDays && maxDays >= minDays) {
    params.set('shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]', 'business_day');
    params.set('shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]', String(minDays));
    params.set('shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]', 'business_day');
    params.set('shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]', String(maxDays));
  }
  params.set('expires_at', String(expiresAt));
  params.set('metadata[order_ref]', orderRef);
  params.set('payment_intent_data[metadata][order_ref]', orderRef);
  cart.lineItems.forEach((line, index) => {
    params.set(`line_items[${index}][quantity]`, '1');
    params.set(`line_items[${index}][price_data][currency]`, 'usd');
    params.set(`line_items[${index}][price_data][unit_amount]`, String(line.amount));
    params.set(`line_items[${index}][price_data][product_data][name]`, line.name);
    params.set(`line_items[${index}][price_data][product_data][description]`, line.description);
    params.set(`line_items[${index}][price_data][product_data][metadata][inventory_keys]`, line.inventoryKeys.join('|'));
  });
  return params;
}

async function stripeRequest(env, path, options = {}) {
  const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2026-07-29.dahlia' };
  if (options.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await fetch(`https://api.stripe.com${path}`, { method: options.method || 'GET', headers, body: options.body });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || 'Stripe request failed');
  return result;
}

async function checkoutStatus(url, env, cors) {
  requireStatusConfig(env);
  const sessionId = url.searchParams.get('session_id') || '';
  if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) return json({ verified: false, error: 'Invalid checkout reference.' }, 400, cors);
  let session;
  try { session = await stripeRequest(env, `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`); }
  catch { return json({ verified: false, error: 'Invalid checkout reference.' }, 400, cors); }
  if (session.livemode !== false || session.status !== 'complete' || session.payment_status !== 'paid') return json({ verified: false, status: session.status || 'unknown' }, 200, cors);
  const order = await env.ORDERS.prepare('SELECT order_ref, status, stripe_event_id FROM orders WHERE stripe_session_id = ?').bind(sessionId).first();
  if (!order || session.client_reference_id !== order.order_ref) return json({ verified: false, error: 'Order record could not be verified.' }, 409, cors);
  try { await markPaid(env, session, `status:${sessionId}`); } catch (error) { if (!isUniqueConstraint(error)) throw error; }
  const items = await env.ORDERS.prepare('SELECT display_name FROM order_items WHERE order_ref = ? ORDER BY rowid').bind(order.order_ref).all();
  return json({ verified: true, orderRef: order.order_ref, items: (items.results || []).map((item) => item.display_name), webhookVerified: /^evt_/.test(order.stripe_event_id || '') }, 200, cors);
}

export async function stripeWebhook(request, env) {
  requireWebhookConfig(env);
  const rawBody = await request.text();
  if (!(await verifyStripeSignature(rawBody, request.headers.get('Stripe-Signature') || '', env.STRIPE_WEBHOOK_SECRET))) return json({ error: 'bad signature' }, 400);
  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: 'bad payload' }, 400); }
  if (!event.id || !event.type) return json({ error: 'bad event' }, 400);
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data?.object;
    if (session?.livemode !== false || session?.payment_status !== 'paid') return json({ received: true });
    try { await markPaid(env, session, event.id); } catch (error) { if (isUniqueConstraint(error)) return json({ received: true, duplicate: true }); throw error; }
  }
  return json({ received: true });
}

async function markPaid(env, session, eventId) {
  const order = await env.ORDERS.prepare('SELECT order_ref FROM orders WHERE stripe_session_id = ?').bind(session.id).first();
  if (!order || session.client_reference_id !== order.order_ref) throw new Error('paid session has no matching order');
  const now = Math.floor(Date.now() / 1000);
  await env.ORDERS.batch([
    env.ORDERS.prepare('INSERT INTO stripe_events (event_id, event_type, processed_at) VALUES (?, ?, ?)').bind(eventId, 'checkout.session.paid', now),
    env.ORDERS.prepare('UPDATE orders SET status = ?, total_cents = ?, customer_email = ?, customer_name = ?, shipping_json = ?, paid_at = ?, stripe_event_id = ? WHERE order_ref = ? AND status != ?').bind('paid', session.amount_total || null, session.customer_details?.email || null, session.customer_details?.name || null, JSON.stringify(session.collected_information?.shipping_details || session.shipping_details || null), now, eventId, order.order_ref, 'paid'),
    env.ORDERS.prepare('UPDATE inventory_reservations SET status = ?, expires_at = ? WHERE order_ref = ?').bind('paid', 2147483647, order.order_ref),
  ]);
}

export async function verifyStripeSignature(payload, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || !header) return false;
  const parts = header.split(',').map((part) => part.split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300 || !signatures.length) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = hex(new Uint8Array(digest));
  return signatures.some((signature) => constantTimeEqual(signature, expected));
}
function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  if (a.length === b.length && typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(a, b);
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) mismatch |= (a[i % (a.length || 1)] || 0) ^ (b[i % (b.length || 1)] || 0);
  return mismatch === 0;
}
function hex(bytes) { return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function requireTestMode(env) {
  if (env.PAYMENTS_MODE !== 'test') throw new Error('PAYMENTS_MODE must remain test until launch approval');
}
function requireCheckoutConfig(env) {
  requireTestMode(env);
  if (!isTestStripeKey(env.STRIPE_SECRET_KEY)) throw new Error('test Stripe secret is not configured');
  if (!env.STRIPE_WEBHOOK_SECRET || !env.ORDERS) throw new Error('payment bindings are incomplete');
  parseShippingCents(env.SHIPPING_RATE_CENTS);
}
function requireStatusConfig(env) {
  requireTestMode(env);
  if (!isTestStripeKey(env.STRIPE_SECRET_KEY) || !env.ORDERS) throw new Error('payment status bindings are incomplete');
}
function requireWebhookConfig(env) {
  requireTestMode(env);
  if (!env.STRIPE_WEBHOOK_SECRET || !env.ORDERS) throw new Error('webhook bindings are incomplete');
}
function parseShippingCents(value) {
  const cents = Number(value);
  if (!Number.isInteger(cents) || cents < 0 || cents > 10000) throw new Error('SHIPPING_RATE_CENTS must be configured');
  return cents;
}
function isTestStripeKey(value) { return typeof value === 'string' && (value.startsWith('sk_test_') || value.startsWith('rk_test_')); }
function positiveInt(value) { const result = Number(value); return Number.isInteger(result) && result > 0 ? result : null; }
function createOrderRef() { return 'ATT-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase(); }
function checkoutError(error, cors) { if (error instanceof CheckoutError) return json({ error: error.message, code: error.code }, error.status, cors); throw error; }
function isUniqueConstraint(error) { return /UNIQUE|constraint/i.test(safeError(error)); }
class CheckoutError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
