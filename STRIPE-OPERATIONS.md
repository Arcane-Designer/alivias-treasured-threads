# Stripe Checkout operations

This integration is code-complete for local fixture testing. The empty staging and production D1 databases exist and have the reviewed schema, but checkout code and Stripe credentials are not deployed. Live payments remain disabled.

## Paid-order workflow

1. The basket sends only product, listing, and one-of-a-kind IDs to the Worker.
2. The Worker reloads canonical `data/site.json`, validates availability, recalculates prices, reserves each exact inventory key in D1, and creates a Stripe-hosted Checkout Session.
3. Stripe collects the customer's name, email, payment, and US shipping address. Standard shipping is a single configured flat rate with a configurable business-day estimate.
4. A signed `checkout.session.completed` or `checkout.session.async_payment_succeeded` webhook records payment idempotently. A paid D1 reservation keeps the item from being sold through another Checkout Session.
5. The success page independently retrieves the Session through the Worker. It clears the browser basket only after Stripe reports test-mode `complete` and `paid` and the Session matches the D1 order.
6. Alivia checks the paid order in Stripe and D1, marks each exact listing sold in Studio, publishes that content change through the normal workflow, packs it, and ships it.

Automatic `site.json` mutation is intentionally not implemented. The static Studio/GitHub publishing flow has no safe atomic transaction with Stripe and D1. A paid reservation is the server-side source that prevents a second sale until the manual Studio update lands.

## Payment, shipping, and records

- Cards and other enabled methods stay entirely on Stripe-hosted Checkout.
- Currency is USD. Shipping country is restricted to US.
- `SHIPPING_RATE_CENTS` is fixed at `600`, the approved $6.00 flat standard-shipping charge per US order. The same value is mirrored in `data/site.json` solely for the customer-facing order review; the Worker remains authoritative when creating the Stripe Session and D1 order.
- `SHIPPING_MIN_DAYS` and `SHIPPING_MAX_DAYS` optionally describe an approved standard-shipping estimate in business days. If either is unset, Checkout makes no delivery estimate.
- Stripe Tax is not enabled. The Session deliberately omits `automatic_tax`.
- Stripe holds payment/refund records. D1 stores the Alivia order reference, exact inventory IDs, customer contact/shipping details needed for fulfillment, payment state, and processed webhook IDs.
- Treat D1 order data as customer data. Restrict access, define retention before launch, and never expose an order-query endpoint publicly.

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
- [ ] Stripe test-mode end-to-end Session, payment, webhook retry, cancel, and refund using official test values

### Nathan/account decisions and actions

- [x] Nathan chose one $6.00 flat standard-shipping charge per US order
- [ ] Choose an honest business-day shipping estimate or leave it unset
- [ ] Confirm whether/when to enable Stripe Tax; it is off now
- [ ] Complete Stripe business identity, legal terms, payout bank, statement descriptor, support, and receipt settings
- [ ] Decide customer/order record retention and who may access D1

### Credentials and Cloudflare bindings

- [x] Create separate `att-orders-staging` and `att-orders-production` D1 databases; apply and verify `worker/schema.sql`
- [x] Configure staging for the local preview return URL and the staged branch catalog; production uses the canonical live URLs
- [x] Add the `ORDERS` D1 binding IDs to the appropriate Wrangler environments
- [ ] Store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as environment secrets, never vars/source
- [x] Store the approved `SHIPPING_RATE_CENTS=600` as a non-secret environment variable
- [ ] Register `/stripe/webhook` for Checkout Session completed/async-success events in Stripe test mode
- [ ] Pin the test webhook endpoint to Stripe API version `2026-02-25.clover`, matching the Worker
- [ ] Keep `PAYMENTS_MODE=test` until a separately reviewed live-mode change

### Release and first live canary

- [ ] Deploy Worker staging and static staging; rerun all test-mode checks
- [ ] Review CSP/headers on the actual hosting layer; redirects need no Stripe JavaScript allowance
- [ ] Explicitly authorize production deployment and live payments
- [ ] Run one small live canary purchase to Nathan-controlled details
- [ ] Confirm paid record, notification, manual Studio sold update, and customer receipt
- [ ] Refund the canary in Stripe and verify the refund/manual inventory workflow

## Exact launch runbook

1. Push the reconciled `mara/alivia-storefront-2` branch so the staging Worker can load the exact canonical catalog revision. Do not merge it yet.
2. Nathan or Alivia completes Stripe account identity, legal, payout-bank, business-profile, support, statement-descriptor, receipt, and allowed-payment-method settings. Stripe Tax stays off.
3. In Stripe test mode, obtain a restricted test secret suitable for creating and retrieving Checkout Sessions. Register the staging endpoint `https://att-checkout-staging.nathanagellatly.workers.dev/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then store both test values as the staging Worker's `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` secrets. Never paste their values into source, Git, or this document.
4. Deploy `worker/wrangler.jsonc` with `--env staging`. Confirm the deployment binds `att-orders-staging`, `PAYMENTS_MODE=test`, `SHIPPING_RATE_CENTS=600`, the staged branch catalog, and the local preview return URL.
5. From the local preview, complete Stripe's official test-mode payment flow. Verify one $6 shipping option, US-only address collection, Tax off, signed webhook processing, one paid D1 order, exact item reservations, verified success, basket clearing only after verification, cancel preservation, bad signature rejection, duplicate-event idempotency, stale inventory rejection, and test refund handling. Use only controlled test details.
6. Review the final branch diff against `origin/main`, regenerate pages, run validation/Worker fixtures/Studio QA, and render desktop plus 390px flows. Merge only the verified revision to `main`; GitHub Pages serves `main` from `/` with enforced HTTPS.
7. Confirm GitHub Pages serves the exact merged commit and verify home, Shop, zero-inventory Custom links, basket, checkout, Custom, reviews, About, Studio, sitemap, canonicals, SSL, console, and network state. Keep checkout disabled or the production Worker undeployed until live credentials are ready.
8. At the action-time handoff, Nathan or Alivia switches Stripe to live mode, completes any remaining account activation, creates the live webhook endpoint for the production Worker, and securely stores the live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Change the reviewed Worker gate from test to live only in that launch revision; keep `SHIPPING_RATE_CENTS=600`, US-only shipping, and Tax off.
9. Deploy the production Worker with `att-orders-production`, then verify the deployed version and secret names without revealing values. Merge/publish the static site only when its checkout endpoint and production Worker are both ready.
10. Run one explicitly confirmed low-value canary purchase using Nathan-controlled customer/address details. Confirm Stripe payment, receipt/notification, signed webhook, D1 paid order, exact reservation, verified success, and manual Studio sold-state update. Refund it from Stripe, verify the refund record, and deliberately decide whether to restore the physical item before changing Studio or D1.
