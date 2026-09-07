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
export function orderMessage(order, items, from, { existing = false, customer = false } = {}) {
  const clean = value => String(value || '').replace(/[\r\n]+/g, ' ').replace(/\u2014/g, ' - ');
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = cents => new Intl.NumberFormat('en-US', {style:'currency',currency:order.currency.toUpperCase()}).format(cents / 100);
  let shipping;
  try { shipping = typeof order.shipping_json === 'string' ? JSON.parse(order.shipping_json) : order.shipping_json; } catch { shipping = null; }
  const address = shipping?.address;
  const shippingLines = address ? [shipping.name, address.line1, address.line2,
    [address.city, address.state, address.postal_code].filter(Boolean).join(', '), address.country].filter(Boolean).map(clean) : [];
  const shippingText = shippingLines.length ? shippingLines.join('\n') : (customer ? 'No shipping address was recorded. Please reply to this email to confirm shipping or pickup arrangements.' : 'Shipping address was not provided. Check Stripe and confirm fulfillment with the customer.');
  const shippingHtml = shippingLines.length ? shippingLines.map(esc).join('<br>') : esc(shippingText);
  const total = money(order.total_cents ?? order.subtotal_cents + order.shipping_cents);
  const date = order.paid_at ? new Intl.DateTimeFormat('en-US',{dateStyle:'long',timeStyle:'short',timeZone:'America/Los_Angeles'}).format(new Date(order.paid_at*1000)) + ' Pacific' : 'See Stripe';
  const title = customer ? 'Your order is confirmed.' : existing ? 'Your order details are here.' : 'A new treasure has a home.';
  const notice = customer ? 'Thank you for supporting my handmade shop! Your payment went through and I received your order. I’m so excited for you to enjoy your new treasures.' : existing ? 'Existing order copy: this purchase was already placed. This email tests the new alert format; it is not a new order or charge.' : 'Payment confirmed. Here is everything you need to get this order ready.';
  const actionUrl = customer ? 'mailto:aliviagellatly@gmail.com' : 'https://dashboard.stripe.com/payments';
  const nextStep = customer ? 'This confirms your order, not shipment. If we arranged an in-person handoff, that arrangement still applies. Questions or an address correction? Reply to this email and I’ll help.' : 'Confirm fulfillment arrangements before shipping. Open Stripe for the original payment details.';
  const footer = customer ? 'With love, Alivia\nYou may also receive a separate payment receipt from Stripe.' : 'Website order alert. Stripe may send a separate payment notification.';
  const text = [title, notice, '', `Order: ${clean(order.order_ref)}`, `Paid: ${date}`,
    `Customer: ${clean(order.customer_name) || 'See Stripe'}`, `Customer email: ${clean(order.customer_email) || 'See Stripe'}`,
    '', 'Ship to:', shippingText, '', 'Purchased pieces:', ...items.map(item => `- ${clean(item.display_name)}`), '',
    `Total paid: ${total}`, `Shipping charged: ${money(order.shipping_cents)}`, '',
    nextStep, actionUrl, '', 'Alivia’s Treasured Threads | Handmade with love, one stitch at a time.',
    footer].join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f2f8;color:#35283e;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(customer?'Order confirmed':existing?'Existing order copy':'Payment confirmed')} · ${esc(order.order_ref)} · ${esc(total)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f2f8;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e6deec;border-radius:18px;overflow:hidden;">
<tr><td style="padding:30px 28px;background:#4e365e;color:#ffffff;text-align:center;">
<img src="https://aliviastreasuredthreads.com/images/brand/logo.jpg" width="132" height="132" alt="Alivia’s Treasured Threads logo" style="display:block;margin:0 auto 20px;border:0;border-radius:14px;">
<p style="margin:0 0 10px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#e8d6ef;">A little handmade happiness</p>
<p style="margin:0;font-family:Georgia,serif;font-size:28px;line-height:1.25;">Alivia’s Treasured Threads</p>
<p style="margin:12px 0 0;font-size:12px;color:#e8d6ef;">Handmade with love, one stitch at a time.</p></td></tr>
<tr><td style="padding:30px 28px 20px;">
<p style="margin:0 0 14px;font-size:11px;letter-spacing:2px;font-weight:bold;color:#497658;">PAYMENT CONFIRMED</p>
<h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:29px;line-height:1.25;font-weight:normal;">${title}</h1>
<p style="margin:0;font-size:14px;line-height:1.7;color:#6c5c76;">${notice}</p>
</td></tr><tr><td style="padding:0 28px 24px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f3f9;border-radius:10px;"><tr><td style="padding:18px;font-size:13px;line-height:1.8;">
<strong>Order ${esc(order.order_ref)}</strong><br><span style="color:#6c5c76;">${esc(date)}</span><br>
<strong>${esc(order.customer_name) || 'Customer details in Stripe'}</strong><br>${esc(order.customer_email) || 'Email available in Stripe'}
</td></tr></table></td></tr>
<tr><td style="padding:0 28px 24px;"><h2 style="margin:0 0 12px;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Ship to</h2><p style="margin:0;font-size:14px;line-height:1.7;">${shippingHtml}</p></td></tr>
<tr><td style="padding:0 28px;"><h2 style="margin:0 0 12px;font-size:13px;letter-spacing:1px;text-transform:uppercase;">${customer?'Your handmade treasures':'The treasures they chose'}</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${items.map(item=>`<tr><td style="padding:15px 0;border-bottom:1px solid #eee6f1;font-size:15px;line-height:1.5;">${esc(item.display_name)}</td><td width="45" align="right" style="padding:15px 0;border-bottom:1px solid #eee6f1;font-size:12px;color:#6c5c76;">Qty 1</td></tr>`).join('')}
<tr><td style="padding:18px 0 8px;font-size:13px;color:#6c5c76;">Shipping charged</td><td align="right" style="padding:18px 0 8px;font-size:13px;">${esc(money(order.shipping_cents))}</td></tr>
<tr><td style="padding:8px 0 22px;font-size:17px;font-weight:bold;">Total paid</td><td align="right" style="padding:8px 0 22px;font-size:22px;font-weight:bold;color:#4e365e;">${esc(total)}</td></tr></table></td></tr>
<tr><td style="padding:0 28px 30px;"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#4e365e" style="border-radius:8px;"><a href="${actionUrl}" style="display:inline-block;padding:15px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;">${customer?'Contact Alivia':'Open Stripe payments'}</a></td></tr></table>
<p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:#6c5c76;">${nextStep}</p></td></tr>
<tr><td style="padding:20px 28px;border-top:1px dashed #d8c8e1;text-align:center;font-size:11px;line-height:1.7;color:#82728b;">${customer?'With love, Alivia<br>You may also receive a separate payment receipt from Stripe.':'Sent by your website to keep every little treasure on its way.<br>Stripe may send a separate payment notification.'}</td></tr>
</table></td></tr></table></body></html>`;
  return { from, to:[customer ? order.customer_email : RECIPIENT], ...(customer ? {reply_to:RECIPIENT} : {}), subject:`${customer?'Your order is confirmed':existing?'Existing paid order':'New paid order'} ${clean(order.order_ref)} | Alivia's Treasured Threads`, text, html };
}
export async function flushOrderEmails(env, now = Math.floor(Date.now()/1000), {table='order_email_outbox', makeMessage=orderMessage, keyPrefix='att-paid-order', enabled=emailEnabled(env)} = {}) {
  if (!['order_email_outbox','customer_email_outbox'].includes(table)) throw new Error('Invalid email queue');
  if (!enabled || !env.RESEND_API_KEY || !env.ORDER_EMAIL_FROM) return;
  const rows = await env.ORDERS.prepare(`SELECT order_ref FROM ${table}
    WHERE state IN ('pending','sending') AND next_attempt_at <= ? ORDER BY created_at LIMIT 10`).bind(now).all();
  for (const row of rows.results || []) {
    const token = crypto.randomUUID();
    const claimed = await env.ORDERS.prepare(`UPDATE ${table} SET state='sending', lease_token=?,
      next_attempt_at=?, attempts=attempts+1, first_attempt_at=COALESCE(first_attempt_at, ?)
      WHERE order_ref=? AND state IN ('pending','sending') AND next_attempt_at <= ? RETURNING *`)
      .bind(token, now+120, now, row.order_ref, now).first();
    if (!claimed) continue;
    // Resend retains idempotency keys for 24 hours. Hold ambiguous old sends for review.
    if (now - claimed.first_attempt_at >= 23*3600) {
      await finish(env,table, row.order_ref, token, 'review', now, 'retry_window_expired', null); continue;
    }
    try {
      let payload = claimed.payload_json;
      if (!payload) {
        const order = await env.ORDERS.prepare("SELECT * FROM orders WHERE order_ref=? AND status='paid'").bind(row.order_ref).first();
        if (!order) { await finish(env,table,row.order_ref,token,'review',now,'order_not_paid',null); continue; }
        const items = await env.ORDERS.prepare('SELECT display_name FROM order_items WHERE order_ref=? ORDER BY rowid').bind(row.order_ref).all();
        payload = JSON.stringify(makeMessage(order,items.results || [],env.ORDER_EMAIL_FROM));
        await env.ORDERS.prepare(`UPDATE ${table} SET payload_json=? WHERE order_ref=? AND lease_token=?`).bind(payload,row.order_ref,token).run();
      }
      const response = await fetch('https://api.resend.com/emails', {
        method:'POST', headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json',
          'Idempotency-Key':`${keyPrefix}/${row.order_ref}`}, body:payload, signal:AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(()=>null);
      if (response.ok && result?.id) {
        await finish(env,table,row.order_ref,token,'accepted',now,null,result.id);
      } else {
        const retry = response.status === 429 || response.status >= 500;
        await finish(env,table,row.order_ref,token,retry?'pending':'review',now+Math.min(3600,60*2**Math.min(claimed.attempts,6)),`provider_http_${response.status}`,null);
      }
    } catch {
      // Do not expose provider payloads, credentials, or customer data in logs.
      await finish(env,table,row.order_ref,token,'pending',now+300,'send_or_record_failed',null);
    }
  }
}
function finish(env,table, ref, token, state, next, error, id) {
  return env.ORDERS.prepare(`UPDATE ${table} SET state=?, next_attempt_at=?, last_error=?,
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

export async function sendOrderCopy(env, orderRef) {
  if (!/^ATT-[A-F0-9]{10}$/.test(orderRef || '')) return {accepted:false,reason:'Invalid order reference'};
  const order = await env.ORDERS.prepare("SELECT * FROM orders WHERE order_ref=? AND status='paid'").bind(orderRef).first();
  if (!order) return {accepted:false,reason:'Paid order not found'};
  const items = await env.ORDERS.prepare('SELECT display_name FROM order_items WHERE order_ref=? ORDER BY rowid').bind(orderRef).all();
  const message = orderMessage(order,items.results || [],env.ORDER_EMAIL_FROM,{existing:true});
  message.subject = `Updated order details ${orderRef} | Alivia's Treasured Threads`;
  const response = await fetch('https://api.resend.com/emails', {method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`att-shipping-copy-v1/${orderRef}`},body:JSON.stringify(message),signal:AbortSignal.timeout(15000)});
  const data = await response.json().catch(()=>null);
  return response.ok && data?.id ? {accepted:true,id:data.id} : {accepted:false,status:response.status};
}
