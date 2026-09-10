# Order history and thank-you emails

Status: deployed and verified on 2026-09-09. The production schema, Worker, and Studio are live. No thank-you email has been sent.

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

- D1 schema applied to `att-orders-production`.
- Worker version `0062ca18-de4b-46f5-aaa4-637b374f4030` deployed.
- Studio published from commit `bb0e02657b09d8d9d79e8ea98a538638f90b622d`.
- The authenticated order-history endpoint returns three existing paid website orders.
- Nathan's original test order is `ATT-93D4FD4E7E`, for `Corner Bookmark - Green`.
- The thank-you outbox was verified empty after deployment.

Existing paid website orders require no backfill. They appear as soon as the authenticated order-history endpoint and schema are live. No historical customer is emailed automatically.

## Validation

Run:

`node worker/thank-you-email.test.mjs`

`node worker/order-email.test.mjs`

`node worker/customer-email.test.mjs`

`node worker/inventory.test.mjs`

`node worker/worker.test.mjs`

`node scripts/validate.mjs`

The order drawer and email preview were also inspected at desktop and phone sizes before deployment.
