# Stripe Checkout operations

## Staging retirement (2026-08-24)

Staging is no longer needed and is retired. Removed from the repo: the `env.staging` Wrangler config and the storefront's `checkoutTestApiUrl` setting. Still pending manual cleanup in the external accounts:

- **Stripe sandbox:** disable or delete both webhook destinations pointing at `https://att-checkout-staging.nathanagellatly.workers.dev/stripe/webhook` (the superseded destination and `Alivia Checkout Staging Verified`). Failing test-mode deliveries to that URL are what trigger Stripe's warning emails.
- **Cloudflare:** delete the `att-checkout-staging` Worker (this also removes its two Stripe secrets), then the `att-orders-staging` D1 database if its test orders are no longer wanted. The `REVIEWS` KV namespace is shared with production — keep it.

Production — the `att-review-inbox` Worker, `att-orders-production` D1, and the live-mode webhook — stays as is.

The staging integration ran in Stripe sandbox mode with isolated encrypted credentials and the staging D1 database. Production uses separate encrypted live credentials and `att-orders-production`; the Worker rejects any key, Session, reference, or webhook whose mode does not match its environment.

## Paid-order workflow

1. The basket sends only product, listing, and one-of-a-kind IDs to the Worker.
2. The Worker reloads canonical `data/site.json`, validates availability, recalculates prices, reserves each exact inventory key in D1, and creates a Stripe-hosted Checkout Session.
3. Stripe collects the customer's name, email, payment, and US shipping address. Shipping is currently free; the configured rate is zero.
4. A signed `checkout.session.completed` or `checkout.session.async_payment_succeeded` webhook records payment idempotently. A paid D1 reservation keeps the item from being sold through another Checkout Session.
5. The success page independently retrieves the Session through the Worker. It clears the browser basket only after Stripe reports the environment-matched Session `complete` and `paid` and the Session matches the D1 order.
6. The storefront and Studio read confirmed paid inventory automatically. The exact purchased listing or one-of-a-kind product stays visible as Sold with no purchase button. Alivia can change it back to available with the Sold button and publish normally.

The paid D1 reservation is authoritative. `GET /inventory/sold` supplies only visible inventory keys and opaque sale versions, never customer data, payment IDs, order references, tags, or archive entries. Storefront page loads and Studio reads project these records onto the existing `sold` field. Studio publishes retain those fields in `site.json`; payments do not need a GitHub rebuild or a repository credential in the Worker.

The shared `assets/inventory.mjs` records `stripeSaleVersion`. Switching a piece back to available stores `availableAfterSale` for that exact sale. Checkout trusts this marker only from the canonical catalog and atomically replaces only that sale's paid reservation. A subsequent purchase has a different version and becomes sold again. Duplicate or delayed webhooks for older orders cannot reclaim a relisted reservation. Refunds do not automatically restock physical inventory.

Studio rechecks sales before publishing and stops if that check fails. Product fields, photos, archive entries, and internal tags stay intact. If the public status fetch is temporarily unavailable, the storefront falls back to saved catalog status; checkout still prevents buying paid inventory. Existing open pages pick up the latest status on reload/navigation.

## Payment, shipping, and records

- Cards and supported card wallets stay entirely on Stripe-hosted Checkout. Link is disabled per Session so its bank and pay-later options do not appear.
- Currency is USD. Shipping country is restricted to US.
- `SHIPPING_RATE_CENTS` is `0`: no shipping charge applies to new orders. The same value is mirrored in `data/site.json` solely for the customer-facing order review; the Worker remains authoritative when creating the Stripe Session and D1 order.
- `SHIPPING_MIN_DAYS` and `SHIPPING_MAX_DAYS` optionally describe an approved standard-shipping estimate in business days. If either is unset, Checkout makes no delivery estimate.
- Stripe Tax is not enabled. The Session deliberately omits `automatic_tax`.
- Stripe holds payment/refund records. D1 stores the Alivia order reference, exact inventory IDs, customer contact/shipping details needed for fulfillment, payment state, and processed webhook IDs.
- Treat D1 order data as customer data. Restrict access, define retention before launch, and never expose an order-query endpoint publicly.
- Local storefront previews use the non-secret `settings.checkoutTestApiUrl`; deployed pages continue using `settings.checkoutApiUrl`. This proves sandbox success without pointing production visitors at staging.

## Refunds and cancellations

- Before payment: the cancel page preserves the basket. Checkout Sessions expire after 30 minutes; abandoned inventory reservations retain a one-hour webhook-delivery grace window before cleanup.
- After payment: issue refunds from Stripe using the matching `ATT-…` order reference. A refund does not automatically return an item to inventory. Alivia should decide whether the physical piece is sellable, then update Studio and the D1 reservation deliberately.
- Do not delete paid order/event records during routine fulfillment.

## Paid-order notification assessment

The current Web3Forms path is a browser-side custom/review notification mechanism and is not appropriate as the authoritative paid-order notification. Stripe's Dashboard notifications plus the D1 paid-order record are the safe launch baseline. A later server-side Cloudflare Email Service or Queue notification can be added from the verified webhook, but it needs an explicitly configured recipient/domain and must remain idempotent. No email is sent by this revision.

## Launch checklist

### Code and test completion

- [x] Canonical server-side inventory and price validation
- [x] Exact-item D1 reservation boundary and idempotent webhook record
- [x] US-only Stripe-hosted Checkout Session parameters
- [x] Verified success, honest cancel, and basket behavior
- [x] Fixture tests for tampering, unavailable items, invalid baskets, signatures, and duplicate webhooks
- [x] Stripe test-mode end-to-end Session, payment, webhook retry, cancel, and inventory blocking using official test values

### Nathan/account decisions and actions

- [x] Nathan chose no shipping charge for new orders
- [ ] Choose an honest business-day shipping estimate or leave it unset
- [ ] Confirm whether/when to enable Stripe Tax; it is off now
- [x] Verify Stripe shows no active account requirements and a linked payout destination, without exposing private account data
- [ ] Decide customer/order record retention and who may access D1

### Credentials and Cloudflare bindings

- [x] Create separate `att-orders-staging` and `att-orders-production` D1 databases; apply and verify `worker/schema.sql`
- [x] Configure staging for the local preview return URL and the staged branch catalog; production uses the canonical live URLs
- [x] Add the `ORDERS` D1 binding IDs to the appropriate Wrangler environments
- [x] Store the restricted sandbox `STRIPE_SECRET_KEY` and sandbox `STRIPE_WEBHOOK_SECRET` as encrypted staging environment secrets, never vars/source
- [x] Store the approved `SHIPPING_RATE_CENTS=0` as a non-secret environment variable
- [x] Register `/stripe/webhook` for Checkout Session completed/async-success events in Stripe sandbox mode
- [x] Pin the Worker to Stripe API version `2026-07-29.dahlia`, matching the sandbox webhook endpoint
- [x] Keep staging at `PAYMENTS_MODE=test` and set production to `PAYMENTS_MODE=live` with strict mode matching

### Release and first live canary

- [x] Deploy the isolated Worker staging environment and verify real hosted Checkout Session creation
- [x] Complete the static local/staging browser flow and a sandbox card payment through signed webhook success
- [ ] Review CSP/headers on the actual hosting layer; redirects need no Stripe JavaScript allowance
- [x] Explicitly authorize production deployment and live payments
- [ ] Run one small live canary purchase to Nathan-controlled details
- [ ] Confirm paid record, notification, automatic sold status, and customer receipt
- [ ] Refund the canary in Stripe and verify the refund/manual inventory workflow

## Exact launch runbook

1. Push the reconciled `mara/alivia-storefront-2` branch so the staging Worker can load the exact canonical catalog revision. Do not merge it yet.
2. Nathan or Alivia completes Stripe account identity, legal, payout-bank, business-profile, support, statement-descriptor, receipt, and allowed-payment-method settings. Stripe Tax stays off.
3. In Stripe test mode, obtain a restricted test secret suitable for creating and retrieving Checkout Sessions. Register the staging endpoint `https://att-checkout-staging.nathanagellatly.workers.dev/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then store both test values as the staging Worker's `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` secrets. Never paste their values into source, Git, or this document.
4. Deploy `worker/wrangler.jsonc` with `--env staging`. Confirm the deployment binds `att-orders-staging`, `PAYMENTS_MODE=test`, `SHIPPING_RATE_CENTS=0`, the staged branch catalog, and the local preview return URL.
5. From the local preview, complete Stripe's official test-mode payment flow. Verify $0 shipping, US-only address collection, Tax off, signed webhook processing, one paid D1 order, exact item reservations, verified success, basket clearing only after verification, cancel preservation, bad signature rejection, duplicate-event idempotency, stale inventory rejection, and test refund handling. Use only controlled test details.
6. Review the final branch diff against `origin/main`, regenerate pages, run validation/Worker fixtures/Studio QA, and render desktop plus 390px flows. Merge only the verified revision to `main`; GitHub Pages serves `main` from `/` with enforced HTTPS.
7. Confirm GitHub Pages serves the exact merged commit and verify home, Shop, zero-inventory Custom links, basket, checkout, Custom, reviews, About, Studio, sitemap, canonicals, SSL, console, and network state. Keep checkout disabled or the production Worker undeployed until live credentials are ready.
8. At the action-time handoff, Nathan or Alivia switches Stripe to live mode, completes any remaining account activation, creates the live webhook endpoint for the production Worker, and securely stores the live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Change the reviewed Worker gate from test to live only in that launch revision; keep `SHIPPING_RATE_CENTS=0`, US-only shipping, and Tax off.
9. Deploy the production Worker with `att-orders-production`, then verify the deployed version and secret names without revealing values. Merge/publish the static site only when its checkout endpoint and production Worker are both ready.
10. Run one explicitly confirmed low-value canary purchase using Nathan-controlled customer/address details. Confirm Stripe payment, receipt/notification, signed webhook, D1 paid order, exact reservation, verified success, and automatic storefront and Studio sold state. Refund it from Stripe, verify the refund record, and deliberately decide whether to restore the physical item before changing Studio or D1.

## Current sandbox proof

- Three official Stripe sandbox card payments completed through hosted Checkout with $6 US shipping and Stripe Tax off.
- Verified success returned the matching order reference and item; cancel preserved its basket; verified success cleared it. Desktop and 390px renders passed without horizontal overflow.
- The status response includes `webhookVerified` so QA can distinguish signed-event processing from the safe Stripe-status fallback.
- The final proof payment returned `webhookVerified: true`; Stripe recorded HTTP 200 for `checkout.session.completed`, and replay also returned HTTP 200. A new attempt to buy the paid inventory returned `409 inventory_changed`.
- The superseded sandbox destination retains its historical HTTP 400 attempts. With staging retired, both sandbox destinations — the superseded one and `Alivia Checkout Staging Verified` — are obsolete; see the staging retirement section.
