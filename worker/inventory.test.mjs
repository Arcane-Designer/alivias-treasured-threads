import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from './worker.js';
import { applySales, setSold } from '../assets/inventory.mjs';

const db = new DatabaseSync(':memory:');
db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
db.exec(await readFile(new URL('./order-email-schema.sql', import.meta.url), 'utf8'));
const ORDERS = {
  prepare(sql) {
    let args = [];
    const query = {
      bind(...values) { args = values; return query; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { return db.prepare(sql).run(...args); },
    };
    return query;
  },
  async batch(queries) {
    db.exec('BEGIN');
    try { const results = []; for (const q of queries) results.push(await q.run()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  },
};
const env = { ORDERS, ORDER_EMAIL_ENABLED: 'true', PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', SHIPPING_RATE_CENTS: '0', CATALOG_URL: 'https://catalog.test/site.json' };
const canonical = { products: [
  { id: 'p', name: 'Pouches', price: 7, listings: [{ id: 'a', name: 'A', sold: false }, { id: 'b', name: 'B', sold: false }] },
  { id: 'bundle', name: 'Bundle', price: 25, oneOfAKind: true },
] };
const realFetch = globalThis.fetch;
let nextSession = 0;
globalThis.fetch = async (url) => {
  if (String(url).startsWith('https://catalog.test/')) return Response.json(canonical);
  if (String(url) === 'https://api.stripe.com/v1/checkout/sessions') {
    const id = `cs_test_fixture${++nextSession}`;
    return Response.json({ id, url: `https://checkout.stripe.com/${id}`, livemode: false });
  }
  throw new Error(`Unexpected request ${url}`);
};
const call = (path, options = {}) => worker.fetch(new Request('https://worker.test' + path, { ...options, headers: { Origin: 'http://localhost:4173', ...options.headers } }), env);
const checkout = (items, extra = {}) => call('/checkout/session', { method: 'POST', body: JSON.stringify({ attemptId: crypto.randomUUID(), items, ...extra }) });
const listing = { type: 'listing', productId: 'p', listingId: 'a' };
const oneoff = { type: 'oneoff', productId: 'bundle' };
async function pay(sessionId, eventId, paymentStatus = 'paid') {
  const order = db.prepare('SELECT * FROM orders WHERE stripe_session_id = ?').get(sessionId);
  const payload = JSON.stringify({ id: eventId, type: 'checkout.session.completed', data: { object: { id: sessionId, livemode: false, payment_status: paymentStatus, client_reference_id: order.order_ref, amount_total: order.subtotal_cents } } });
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const sig = Buffer.from(digest).toString('hex');
  return call('/stripe/webhook', { method:'POST', body:payload, headers:{'Stripe-Signature':`t=${timestamp},v1=${sig}`} });
}
const sales = async () => (await (await call('/inventory/sold')).json()).sales;
try {
  assert.equal((await checkout([listing, oneoff])).status, 200);
  assert.deepEqual(await sales(), [], 'pending checkout never marks an item sold');
  assert.equal((await pay('cs_test_fixture1', 'evt_unpaid', 'unpaid')).status, 200);
  assert.deepEqual(await sales(), [], 'unpaid completion never marks an item sold');
  assert.equal(db.prepare('SELECT count(*) AS n FROM order_email_outbox').get().n, 0, 'unpaid events do not queue an email');
  const bad = await call('/stripe/webhook', {method:'POST',body:'{}',headers:{'Stripe-Signature':'bad'}});
  assert.equal(bad.status, 400);
  assert.equal((await pay('cs_test_fixture1', 'evt_paid1')).status, 200);
  assert.equal(db.prepare('SELECT count(*) AS n FROM order_email_outbox').get().n, 1, 'signed paid event queues one email');
  const paid = await sales();
  assert.equal(paid.length, 2);
  assert.deepEqual(Object.keys(paid[0]).sort(), ['inventoryKey','saleVersion'], 'public response excludes order and customer details');
  const studio = structuredClone(canonical);
  applySales(studio, paid);
  assert.equal(studio.products[0].listings[0].sold, true);
  assert.equal(studio.products[0].listings[1].sold, false, 'other exact pieces remain available');
  assert.equal(studio.products[1].sold, true, 'one-of-a-kind products also become sold');
  const version = studio.products[0].listings[0].stripeSaleVersion;
  assert.equal((await checkout([{...listing,availableAfterSale:version}])).status, 409, 'client input cannot unlock paid inventory');
  setSold(studio.products[0].listings[0], false);
  applySales(studio, paid);
  assert.equal(studio.products[0].listings[0].sold, false, 'explicit relist survives repeated sale projection');
  canonical.products = studio.products;
  assert.equal((await checkout([listing])).status, 200, 'published Studio relist releases only the acknowledged reservation');
  assert.equal((await checkout([listing])).status, 409, 'a second buyer cannot reserve the relisted piece concurrently');
  assert.equal((await pay('cs_test_fixture1', 'evt_paid1')).status, 200, 'webhook retry stays idempotent');
  assert.equal((await pay('cs_test_fixture1', 'evt_delayed_old')).status, 200);
  assert.equal(db.prepare('SELECT count(*) AS n FROM order_email_outbox').get().n, 1, 'duplicate and delayed callbacks do not duplicate alerts');
  assert.equal((await sales()).some(s => s.inventoryKey === 'listing:p:a'), false, 'old event cannot re-sell a relisted piece');
  assert.equal((await pay('cs_test_fixture2', 'evt_paid2')).status, 200);
  const secondSales = await sales();
  applySales(studio, secondSales);
  assert.equal(studio.products[0].listings[0].sold, true, 'a new purchase marks the piece sold again');
  assert.notEqual(studio.products[0].listings[0].stripeSaleVersion, version);
  setSold(studio.products[1], false);
  canonical.products = studio.products;
  assert.equal((await checkout([oneoff])).status, 200, 'one-of-a-kind relisting works too');
  const staleDraft = structuredClone(canonical);
  staleDraft.products[0].listings[0].sold = false;
  applySales(staleDraft, secondSales);
  assert.equal(staleDraft.products[0].listings[0].sold, true, 'an unacknowledged stale edit cannot undo a newer sale');
  canonical.products[0].archived = true;
  assert.equal((await sales()).some(s => s.inventoryKey.startsWith('listing:p:')), false, 'private archive inventory does not appear in the public endpoint');
  console.log('Automatic sold lifecycle: paid/unpaid, exact items, no public PII, relist, resale, duplicate/delayed webhooks, concurrent buyers: OK');
} finally { globalThis.fetch = realFetch; db.close(); }
