# Order history and thank-you emails

Status: built and locally verified on 2026-09-09. No production database migration, Worker deployment, customer email, or live website publication has been performed for this feature.

## What it does

- Studio has an Orders drawer with paid website orders from D1.
- Website order details are read-only and include items, customer name, email, shipping address, date, and total.
- Alivia can add, edit, and delete manual sales for in-person or Instagram purchases.
- Each order can open a branded thank-you preview. A missing name becomes `Hi there,` and a missing item does not leave an empty placeholder.
- Sending requires a checked confirmation that the customer received the item.
- Delivery uses Resend with a durable D1 outbox, retries, a stable provider idempotency key, and visible send state in Studio.
- Existing seller alerts and customer purchase confirmations are unchanged.
- Archive product sections remember their collapsed state in a private Studio preference, with local device storage as a fallback.

## Production activation

1. Apply `worker/thank-you-schema.sql` to the production `att-orders-production` D1 database.
2. Deploy the Worker while preserving dashboard-managed variables and secrets.
3. Publish the static Studio files through the normal GitHub Pages flow.
4. Open Studio and verify existing paid orders appear without exposing the endpoint publicly.
5. Locate Nathan's original paid test order, confirm its stored recipient, preview the email, and send only after Nathan gives fresh approval for that specific test.
6. Confirm provider acceptance, inbox receipt, and the recorded sent status in Studio.

Existing paid website orders require no backfill. They appear as soon as the authenticated order-history endpoint and schema are live. No historical customer is emailed automatically.

## Validation

Run:

`node worker/thank-you-email.test.mjs`

`node worker/order-email.test.mjs`

`node worker/customer-email.test.mjs`

`node worker/inventory.test.mjs`

`node worker/worker.test.mjs`

`node scripts/validate.mjs`

The order drawer and email preview must also be inspected at desktop and phone sizes before deployment.
