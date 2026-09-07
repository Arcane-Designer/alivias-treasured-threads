// Paid-order alerts are durable and separate from payment processing.
export const RECIPIENT = 'aliviagellatly@gmail.com';
export function emailEnabled(env) { return env.ORDER_EMAIL_ENABLED === 'true'; }
export function enqueuePaidEmail(env, orderRef, now) {
  // Called BEFORE the paid update, in its transaction. Old paid orders are not replayed.
  return env.ORDERS.prepare(`INSERT OR IGNORE INTO order_email_outbox
    (order_ref, state, next_attempt_at, created_at)
    SELECT order_ref, 'pending', ?, ? FROM orders WHERE order_ref = ? AND status != 'paid'`)
    .bind(now, now, orderRef);
}
export function orderMessage(order, items, from) {
  const clean = value => String(value || '').replace(/[\r\n]+/g, ' ').replace(/\u2014/g, ' - ');
  const money = cents => new Intl.NumberFormat('en-US', {style:'currency',currency:order.currency.toUpperCase()}).format(cents / 100);
  return {
    from, to: [RECIPIENT],
    subject: `New paid order ${clean(order.order_ref)} | Alivia's Treasured Threads`,
    text: ["You have a paid order from Alivia's Treasured Threads.", '',
      `Order: ${clean(order.order_ref)}`, `Customer: ${clean(order.customer_name) || 'See Stripe'}`,
      `Customer email: ${clean(order.customer_email) || 'See Stripe'}`, '', 'Purchased pieces:',
      ...items.map(item => `- ${clean(item.display_name)}`), '',
      `Total paid: ${money(order.total_cents ?? order.subtotal_cents + order.shipping_cents)}`,
      `Shipping charged: ${money(order.shipping_cents)}`, '',
      'Check the shipping address and fulfillment details in Stripe before sending the order.',
      'https://dashboard.stripe.com/payments', '',
      'This is the website order alert. Stripe may send a separate payment notification.'
    ].join('\n'),
  };
}
export async function flushOrderEmails(env, now = Math.floor(Date.now()/1000)) {
  if (!emailEnabled(env) || !env.RESEND_API_KEY || !env.ORDER_EMAIL_FROM) return;
  const rows = await env.ORDERS.prepare(`SELECT order_ref FROM order_email_outbox
    WHERE state IN ('pending','sending') AND next_attempt_at <= ? ORDER BY created_at LIMIT 10`).bind(now).all();
  for (const row of rows.results || []) {
    const token = crypto.randomUUID();
    const claimed = await env.ORDERS.prepare(`UPDATE order_email_outbox SET state='sending', lease_token=?,
      next_attempt_at=?, attempts=attempts+1, first_attempt_at=COALESCE(first_attempt_at, ?)
      WHERE order_ref=? AND state IN ('pending','sending') AND next_attempt_at <= ? RETURNING *`)
      .bind(token, now+120, now, row.order_ref, now).first();
    if (!claimed) continue;
    // Resend retains idempotency keys for 24 hours. Hold ambiguous old sends for review.
    if (now - claimed.first_attempt_at >= 23*3600) {
      await finish(env, row.order_ref, token, 'review', now, 'retry_window_expired', null); continue;
    }
    try {
      let payload = claimed.payload_json;
      if (!payload) {
        const order = await env.ORDERS.prepare("SELECT * FROM orders WHERE order_ref=? AND status='paid'").bind(row.order_ref).first();
        if (!order) { await finish(env,row.order_ref,token,'review',now,'order_not_paid',null); continue; }
        const items = await env.ORDERS.prepare('SELECT display_name FROM order_items WHERE order_ref=? ORDER BY rowid').bind(row.order_ref).all();
        payload = JSON.stringify(orderMessage(order,items.results || [],env.ORDER_EMAIL_FROM));
        await env.ORDERS.prepare('UPDATE order_email_outbox SET payload_json=? WHERE order_ref=? AND lease_token=?').bind(payload,row.order_ref,token).run();
      }
      const response = await fetch('https://api.resend.com/emails', {
        method:'POST', headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json',
          'Idempotency-Key':`att-paid-order/${row.order_ref}`}, body:payload, signal:AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(()=>null);
      if (response.ok && result?.id) {
        await finish(env,row.order_ref,token,'accepted',now,null,result.id);
      } else {
        const retry = response.status === 429 || response.status >= 500;
        await finish(env,row.order_ref,token,retry?'pending':'review',now+Math.min(3600,60*2**Math.min(claimed.attempts,6)),`provider_http_${response.status}`,null);
      }
    } catch {
      // Do not expose provider payloads, credentials, or customer data in logs.
      await finish(env,row.order_ref,token,'pending',now+300,'send_or_record_failed',null);
    }
  }
}
function finish(env, ref, token, state, next, error, id) {
  return env.ORDERS.prepare(`UPDATE order_email_outbox SET state=?, next_attempt_at=?, last_error=?,
    provider_id=COALESCE(?,provider_id), lease_token=NULL WHERE order_ref=? AND lease_token=?`)
    .bind(state,next,error,id,ref,token).run();
}

export async function sendTestEmail(env) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
      'Idempotency-Key': 'att-order-alert-setup-test-v1' },
    body: JSON.stringify({ from: env.ORDER_EMAIL_FROM, to: [RECIPIENT],
      subject: "TEST: Website order alerts | Alivia's Treasured Threads",
      text: "Hi Alivia! This is a test of your website order alerts. No new purchase or charge was made. Future paid orders will send a separate website email listing the purchased pieces, customer, and total. Stripe can also send its own notification. Please let Nathan know this arrived." }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => null);
  return response.ok && data?.id ? { accepted: true, id: data.id } : { accepted: false, status: response.status, reason: data?.message || 'Email provider rejected test' };
}
