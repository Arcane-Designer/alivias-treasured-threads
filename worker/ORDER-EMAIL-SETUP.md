# Paid order email alerts

Status: deployed with Resend on 2026-09-06. Worker version ee8b3b56-e75e-4663-99b5-e5c2389aeece. Sending domain orders.aliviastreasuredthreads.com verified by Nathan. RESEND_API_KEY confirmed present without reading its value. Resend accepted setup test 8bd159b2-64d3-45f0-9e75-215be69728ef; inbox receipt awaits confirmation.
Recipient confirmed by Nathan: aliviagellatly@gmail.com. Nathan enabled Stripe seller notifications separately.

## Activation prerequisites

1. Connect an Alivia-owned transactional sending account. The current adapter uses Resend's HTTPS API. Set up and verify an Alivia sender domain in that account. Do not use an unrelated client sender or migrate DNS providers for this feature.
2. Store RESEND_API_KEY as a Worker secret. Configure ORDER_EMAIL_FROM with the verified sender. Never store the key in the catalog or repository.
3. Apply worker/order-email-schema.sql to the production ORDERS database before enabling the code.
4. Add ORDER_EMAIL_ENABLED="true" and a five-minute cron trigger to the production Worker configuration, then deploy. These production settings are now deployed.
5. Send a clearly labeled test to Alivia and confirm receipt. Provider acceptance alone does not prove inbox delivery.
6. Nathan specifically requested the existing Maddie order ATT-0304F180E9 be delivered. After verification, enqueue only that paid order with INSERT OR IGNORE, then flush. No other historical orders are authorized for replay.
7. Verify the outbox provider_id and accepted state, and Alivia's receipt of that order. Do not mark done until both are checked.

## Behavior and operations

A signed paid webhook or verified status fallback queues the email in the same transaction as the paid update. Unpaid events never enqueue. Existing paid records are not automatically replayed. Duplicate Stripe callbacks keep one outbox row per order.

The Worker immediately attempts delivery in waitUntil after the payment response. Cron retries temporary failures. A two-minute database lease prevents simultaneous sends; a stable Resend idempotency key and persisted payload protect retries after ambiguous network failures. After 23 hours from the first attempt, hold for manual review instead of risking delivery after the provider's 24-hour deduplication window. Permanent provider failures also enter review.

Inspect order_email_outbox for state, attempts, last_error and provider_id. Do not expose payload_json publicly: it includes customer contact details. Review rows need operator investigation; there is no independent email alert for a broken sending account. Stripe's separate seller notification remains useful redundancy.

Run node worker/order-email.test.mjs, node worker/inventory.test.mjs, node worker/worker.test.mjs and node scripts/validate.mjs. Local tests verify concurrent send exclusion, provider failure retry, stable payload and key, old-order exclusion, signed paid/unpaid behavior and duplicate callbacks. They do not prove external delivery.

References: https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/dashboard/emails/idempotency-keys

The POST /order-email/test endpoint requires Studio GitHub repository write authorization. It sends only a fixed labeled test to Alivia using a stable setup-test idempotency key. Never expose the secret to callers. No historical orders were replayed during deployment.

Branded HTML order template deployed as Worker version 15c23bbc-29ef-436b-9d5c-c033d1872ddc. Includes plain-text alternative, escaped customer fields, original payment date, exact item names, charged shipping and total, plus Stripe link. Nathan confirmed the initial connection test arrived. At Nathan's explicit request, the existing order ATT-0304F180E9 was sent once using this template with a prominent existing-order notice. Resend accepted message 8013ac4a-b2d3-4967-b652-9d00d483be7d on attempt 1. Styled message inbox receipt has not yet been confirmed.

Shipping update: future HTML and plain-text order alerts now include the Stripe shipping recipient and full address, with explicit missing-address text when unavailable. Deployed version c9d83ce3-a806-4b13-8c84-b57733c62b07. Nathan requested an updated Maddie copy; Resend accepted message 373b97f1-7a89-41f9-8451-72a7d44ca091. POST /order-email/copy requires Studio repository-write authentication and a valid paid-order reference; copies use a separate stable idempotency key. Customer addresses remain outside public endpoints and repository artifacts.
