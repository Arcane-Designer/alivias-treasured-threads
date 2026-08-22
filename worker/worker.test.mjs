import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker, { buildStripeSessionParams, stripeWebhook, validateCart, verifyStripeSignature } from './worker.js';

const catalog = JSON.parse(await readFile(new URL('../data/site.json', import.meta.url), 'utf8'));
const available = [
  { type: 'listing', productId: 'bookmarks', listingId: 'bk-fall-fun', price: 1 },
  { type: 'listing', productId: 'bookmarks', listingId: 'bk-fall-fun-2', price: 999999 },
];

const cart = validateCart(catalog, available);
assert.equal(cart.items.length, 2);
assert.equal(cart.subtotal, 600, 'canonical two-bookmark tier must be $6 despite client price tampering');
assert.equal(cart.lineItems[0].amount, 600);
assert.throws(() => validateCart(catalog, []), /basket must contain/);
assert.throws(() => validateCart(catalog, [{ type: 'listing', productId: 'bookmarks', listingId: 'missing' }]), /no longer available/);
assert.throws(() => validateCart(catalog, [available[0], available[0]]), /duplicate/);
assert.throws(() => validateCart(catalog, [{ ...available[0], quantity: 2 }]), /quantity must be one/);
assert.throws(() => validateCart(catalog, [{ type: 'oneoff', productId: 'craft-roll' }]), /not available as a finished piece/);

const params = buildStripeSessionParams(cart, {
  SITE_URL: 'https://example.test', SHIPPING_RATE_CENTS: '600', SHIPPING_MIN_DAYS: '3', SHIPPING_MAX_DAYS: '7',
}, 'ATT-TESTORDER', 2000000000);
assert.equal(params.get('shipping_address_collection[allowed_countries][0]'), 'US');
assert.equal(params.get('payment_method_types[0]'), 'card', 'Checkout must stay limited to card and card-wallet payments');
assert.equal(params.get('wallet_options[link][display]'), 'never', 'Link bank and pay-later options must stay disabled');
assert.equal(params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '600');
assert.equal(params.get('automatic_tax[enabled]'), null, 'Stripe Tax must stay disabled');
assert.match(params.get('success_url'), /\{CHECKOUT_SESSION_ID\}/);
assert.equal(params.get('line_items[0][price_data][unit_amount]'), '600');

const webhookSecret = 'whsec_fixture_only';
const timestamp = 1900000000;
const payload = JSON.stringify({ id: 'evt_fixture', type: 'checkout.session.completed', data: { object: { id: 'cs_test_fixture', livemode: false, payment_status: 'paid', client_reference_id: 'ATT-TESTORDER', amount_total: 1200, customer_details: { email: 'safe@example.invalid', name: 'Fixture' }, shipping_details: { address: { country: 'US' } } } } });
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(webhookSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
const signature = [...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
assert.equal(await verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, webhookSecret, timestamp), true);
assert.equal(await verifyStripeSignature(payload, `t=${timestamp},v1=bad`, webhookSecret, timestamp), false);
assert.equal(await verifyStripeSignature(payload, `t=${timestamp - 301},v1=${signature}`, webhookSecret, timestamp), false);

function mockOrders() {
  const events = new Set();
  let paidUpdates = 0;
  return {
    get paidUpdates() { return paidUpdates; },
    prepare(sql) {
      return {
        sql, args: [], bind(...args) { this.args = args; return this; },
        async first() { return sql.startsWith('SELECT order_ref FROM orders') ? { order_ref: 'ATT-TESTORDER' } : null; },
      };
    },
    async batch(statements) {
      const event = statements.find((statement) => statement.sql.startsWith('INSERT INTO stripe_events'))?.args[0];
      if (events.has(event)) throw new Error('UNIQUE constraint failed: stripe_events.event_id');
      events.add(event);
      paidUpdates += 1;
      return statements.map(() => ({ success: true }));
    },
  };
}
const orders = mockOrders();
const webhookEnv = { PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture_only', STRIPE_WEBHOOK_SECRET: webhookSecret, SHIPPING_RATE_CENTS: '600', ORDERS: orders };
const signedRequest = () => new Request('https://worker.test/stripe/webhook', { method: 'POST', body: payload, headers: { 'Stripe-Signature': `t=${timestamp},v1=${signature}` } });
const realNow = Date.now;
Date.now = () => timestamp * 1000;
const first = await stripeWebhook(signedRequest(), webhookEnv);
const duplicate = await stripeWebhook(signedRequest(), webhookEnv);
Date.now = realNow;
assert.equal(first.status, 200);
assert.equal((await duplicate.json()).duplicate, true);
assert.equal(orders.paidUpdates, 1, 'duplicate webhook must not process fulfillment twice');

const badSignature = await worker.fetch(new Request('https://worker.test/stripe/webhook', { method: 'POST', body: payload, headers: { 'Stripe-Signature': 't=1,v1=bad' } }), webhookEnv);
assert.equal(badSignature.status, 400);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes('/v1/checkout/sessions/cs_test_verified')) return new Response(JSON.stringify({ id: 'cs_test_verified', livemode: false, status: 'complete', payment_status: 'paid', client_reference_id: 'ATT-TESTORDER', amount_total: 1200, customer_details: { email: 'safe@example.invalid', name: 'Fixture' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (String(url).includes('/v1/checkout/sessions/cs_test_open')) return new Response(JSON.stringify({ id: 'cs_test_open', livemode: false, status: 'open', payment_status: 'unpaid' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  throw new Error('unexpected fixture fetch');
};
const statusOrders = mockOrders();
statusOrders.prepare = (sql) => ({
  sql, args: [], bind(...args) { this.args = args; return this; },
  async first() { return sql.startsWith('SELECT order_ref') ? { order_ref: 'ATT-TESTORDER', status: 'pending' } : null; },
  async all() { return { results: [{ display_name: 'Fall Fun Bookmark' }] }; },
});
const statusEnv = { ...webhookEnv, ORDERS: statusOrders };
const verifiedStatus = await worker.fetch(new Request('https://worker.test/checkout/status?session_id=cs_test_verified', { headers: { Origin: 'http://localhost:4173' } }), statusEnv);
assert.equal((await verifiedStatus.json()).verified, true);
const openStatus = await worker.fetch(new Request('https://worker.test/checkout/status?session_id=cs_test_open', { headers: { Origin: 'http://localhost:4173' } }), statusEnv);
assert.equal((await openStatus.json()).verified, false);
const fakeStatus = await worker.fetch(new Request('https://worker.test/checkout/status?session_id=fake', { headers: { Origin: 'http://localhost:4173' } }), statusEnv);
assert.equal(fakeStatus.status, 400);
globalThis.fetch = originalFetch;

console.log('Worker checkout fixtures: OK');
