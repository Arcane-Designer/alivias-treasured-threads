# Customer order confirmation

Status: enabled on 2026-09-07 after Nathan and Alivia approved the emails with the logo addition. CUSTOMER_EMAIL_ENABLED=true, CUSTOMER_EMAIL_START_AT=1788797516. Seller alerts and customer confirmations include the existing public brand logo. Worker version fef8bc3a-a2dc-4b64-8cca-3fc0f94f642b. Only orders created on or after this cutoff can qualify. Production customer queue verified empty after activation; no historical order was queued.

Nathan requested review emails only to nathanagellatly@gmail.com and no messages to past customers. Two fictional samples were accepted by Resend:
- Shipping-address sample: 3ae594d8-8047-4f44-956e-ac93bf2c16cd
- Missing-address sample: 9e7af410-540c-4210-b6e7-3fdfd7eda35e

Worker version: 69517c5f-0749-4d9c-8464-89ae2563055f. Customer queue schema applied. Production queue count verified zero after review sends.

## Review and activation

Activation is complete. Preserve the cutoff 1788797516 in future deploys; never backdate it or backfill past orders. Seller settings remain enabled.

A customer notification is queued only in the verified paid transition transaction, while the prior status is not paid, and only if the order was created on or after the cutoff. This excludes historical paid records and older checkouts whose callbacks arrive late. The sender also checks the activation flag. No customer resend/copy endpoint is provided.

The authenticated POST /customer-email/review endpoint takes only a variant (shipping or missing-address). It uses fictional fixtures and a fixed recipient of Nathan, never a caller-provided recipient or a historical order. Review subjects and bodies are clearly labeled. Production message replies go to Alivia, and customers receive no merchant Dashboard link or shipping promise.

Customer delivery uses its own customer_email_outbox and idempotency key namespace. It shares the seller queue's tested leasing, stable payload, retry and 23-hour review hold logic. Delivery failures are independent between the two queues. As with seller alerts, permanent failures or unresolved sends require operator review.

## Validation

node worker/customer-email.test.mjs
node worker/order-email.test.mjs
node worker/inventory.test.mjs
node worker/worker.test.mjs
node scripts/validate.mjs

Tests cover cutoff exclusion, historical paid and pending orders, signed paid/unpaid callbacks, duplicate callbacks, disabled delivery, stable retry payloads, concurrent claims, HTML escaping, customer reply-to, merchant-link exclusion and fixed review recipients. Browser preview verified the shipping layout. Nathan and Alivia approved the first review emails. Updated customer and seller logo samples were accepted by Resend for Nathan only: 600c4193-df04-41fc-ab8c-dd5080551e45 and 5cc163cf-1baa-4833-b8b2-f1d6c6240457. Logo rendering was visually checked in the browser.
