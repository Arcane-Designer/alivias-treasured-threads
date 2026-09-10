const REVIEW_URL = 'https://aliviastreasuredthreads.com/reviews/';
const DEFAULT_SUBJECT = "A little thank-you from Alivia's Treasured Threads";
const DEFAULT_MESSAGE = "Thank you so much for your purchase. I hope you love your handmade treasure! If you have a moment, I'd be so grateful if you left a review. Your note helps my little shop more than you know.";

const clean = (value, max = 500) => String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const emailOk = value => /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(String(value || ''));
const esc = value => String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function firstName(value) {
  return clean(value, 80).split(/\s+/)[0] || '';
}

function addressText(raw) {
  if (!raw) return '';
  if (typeof raw === 'string' && !raw.trim().startsWith('{')) return clean(raw, 500);
  let shipping = raw;
  try { if (typeof raw === 'string') shipping = JSON.parse(raw); } catch { return ''; }
  const address = shipping?.address;
  if (!address) return '';
  return [shipping.name, address.line1, address.line2,
    [address.city, address.state, address.postal_code].filter(Boolean).join(', '), address.country]
    .filter(Boolean).map(value => clean(value, 120)).join('\n');
}

export function thankYouMessage({customerName, customerEmail, itemsText, subject, message}, from) {
  const recipient = clean(customerEmail, 254).toLowerCase();
  if (!emailOk(recipient)) throw new Error('Customer email missing or invalid');
  const name = firstName(customerName);
  const greeting = name ? `Hi ${name},` : 'Hi there,';
  const safeSubject = clean(subject, 140) || DEFAULT_SUBJECT;
  const body = clean(message, 1200) || DEFAULT_MESSAGE;
  const pieces = clean(itemsText, 500);
  const itemLine = pieces ? `I hope you're enjoying ${pieces}.` : '';
  const text = [greeting, '', body, itemLine, '', 'Leave a review:', REVIEW_URL, '', 'With love,', 'Alivia', "Alivia's Treasured Threads"].filter((line, index, all) => line || all[index - 1]).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f2f8;color:#35283e;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f2f8;"><tr><td align="center" style="padding:30px 14px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e6deec;border-radius:18px;overflow:hidden;">
<tr><td style="padding:28px;background:#4e365e;text-align:center;color:#fff;"><img src="https://aliviastreasuredthreads.com/images/brand/logo.jpg" width="118" height="118" alt="Alivia's Treasured Threads logo" style="display:block;margin:0 auto 17px;border:0;border-radius:14px;"><p style="margin:0;font:28px Georgia,serif;">Alivia's Treasured Threads</p><p style="margin:9px 0 0;font-size:12px;color:#e8d6ef;">Handmade with love, one stitch at a time.</p></td></tr>
<tr><td style="padding:32px 30px;"><p style="margin:0 0 18px;font:24px Georgia,serif;color:#4e365e;">${esc(greeting)}</p><p style="margin:0;font-size:15px;line-height:1.75;color:#5f5268;">${esc(body)}</p>${itemLine ? `<p style="margin:16px 0 0;font-size:15px;line-height:1.7;color:#5f5268;">${esc(itemLine)}</p>` : ''}<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 20px;"><tr><td bgcolor="#8E79DD" style="border-radius:9px;"><a href="${REVIEW_URL}" style="display:inline-block;padding:15px 24px;color:#fff;text-decoration:none;font-size:14px;font-weight:bold;">Leave a review 💜</a></td></tr></table><p style="margin:0;font-size:14px;line-height:1.7;color:#5f5268;">With love,<br><strong>Alivia</strong></p></td></tr>
<tr><td style="padding:18px 28px;border-top:1px dashed #d8c8e1;text-align:center;font-size:11px;color:#82728b;">Thank you for supporting my handmade shop.</td></tr></table></td></tr></table></body></html>`;
  return {from, to:[recipient], reply_to:'aliviagellatly@gmail.com', subject:safeSubject, text, html};
}

async function resolveSource(env, sourceType, sourceId) {
  if (sourceType === 'website') {
    const order = await env.ORDERS.prepare("SELECT order_ref AS id, customer_name, customer_email, shipping_json, paid_at AS sale_at, total_cents, currency FROM orders WHERE order_ref=? AND status='paid'").bind(sourceId).first();
    if (!order) return null;
    const items = await env.ORDERS.prepare('SELECT display_name FROM order_items WHERE order_ref=? ORDER BY rowid').bind(sourceId).all();
    return {...order, sourceType, itemsText:(items.results || []).map(item => item.display_name).join(', '), shippingText:addressText(order.shipping_json)};
  }
  if (sourceType === 'manual') {
    const order = await env.ORDERS.prepare('SELECT id, customer_name, customer_email, items_text, shipping_text, sale_at, notes FROM manual_orders WHERE id=?').bind(sourceId).first();
    return order ? {...order, sourceType, itemsText:order.items_text || '', shippingText:order.shipping_text || ''} : null;
  }
  return null;
}

export async function listStudioOrders(env) {
  const web = await env.ORDERS.prepare("SELECT order_ref AS id, customer_name, customer_email, shipping_json, paid_at AS sale_at, total_cents, currency FROM orders WHERE status='paid' ORDER BY paid_at DESC LIMIT 200").all();
  const items = await env.ORDERS.prepare("SELECT i.order_ref, i.display_name FROM order_items i JOIN orders o ON o.order_ref=i.order_ref WHERE o.status='paid' ORDER BY i.rowid").all();
  const byOrder = new Map();
  for (const item of items.results || []) {
    if (!byOrder.has(item.order_ref)) byOrder.set(item.order_ref, []);
    byOrder.get(item.order_ref).push(item.display_name);
  }
  const manual = await env.ORDERS.prepare('SELECT id, customer_name, customer_email, items_text, shipping_text, sale_at, notes FROM manual_orders ORDER BY sale_at DESC LIMIT 200').all();
  const sends = await env.ORDERS.prepare("SELECT source_type, source_id, state, created_at, accepted_at FROM thank_you_outbox ORDER BY created_at DESC").all();
  const latest = new Map();
  for (const send of sends.results || []) {
    const key = `${send.source_type}:${send.source_id}`;
    if (!latest.has(key)) latest.set(key, send);
  }
  return [
    ...(web.results || []).map(order => ({...order, sourceType:'website', itemsText:(byOrder.get(order.id) || []).join(', '), shippingText:addressText(order.shipping_json), thankYou:latest.get(`website:${order.id}`) || null})),
    ...(manual.results || []).map(order => ({...order, sourceType:'manual', itemsText:order.items_text || '', shippingText:order.shipping_text || '', thankYou:latest.get(`manual:${order.id}`) || null})),
  ].sort((a,b) => (b.sale_at || 0) - (a.sale_at || 0));
}

export async function saveManualOrder(env, body, now = Math.floor(Date.now()/1000)) {
  const id = clean(body.id, 80) || `manual-${crypto.randomUUID()}`;
  const email = clean(body.customerEmail, 254).toLowerCase();
  if (!emailOk(email)) throw new Error('Add a valid customer email');
  const saleAt = Number.isSafeInteger(Number(body.saleAt)) && Number(body.saleAt) > 0 ? Number(body.saleAt) : now;
  const existing = await env.ORDERS.prepare('SELECT id FROM manual_orders WHERE id=?').bind(id).first();
  if (body.id && !existing) throw new Error('Manual order not found');
  if (existing) {
    await env.ORDERS.prepare('UPDATE manual_orders SET customer_name=?, customer_email=?, items_text=?, shipping_text=?, notes=?, sale_at=?, updated_at=? WHERE id=?')
      .bind(clean(body.customerName,80),email,clean(body.itemsText,500),clean(body.shippingText,500),clean(body.notes,800),saleAt,now,id).run();
  } else {
    await env.ORDERS.prepare('INSERT INTO manual_orders (id,customer_name,customer_email,items_text,shipping_text,notes,sale_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id,clean(body.customerName,80),email,clean(body.itemsText,500),clean(body.shippingText,500),clean(body.notes,800),saleAt,now,now).run();
  }
  return {ok:true,id};
}

export async function deleteManualOrder(env, id) {
  const result = await env.ORDERS.prepare('DELETE FROM manual_orders WHERE id=?').bind(id).run();
  return {ok:Boolean(result?.meta?.changes ?? result?.changes ?? 0)};
}

export async function previewThankYou(env, body) {
  const order = await resolveSource(env, body.sourceType, body.sourceId);
  if (!order) throw new Error('Order not found');
  const message = thankYouMessage({customerName:order.customer_name,customerEmail:order.customer_email,itemsText:order.itemsText,subject:body.subject,message:body.message},env.ORDER_EMAIL_FROM);
  return {recipient:order.customer_email,customerName:order.customer_name || '',itemsText:order.itemsText,subject:message.subject,text:message.text,html:message.html};
}

export async function queueThankYou(env, body, now = Math.floor(Date.now()/1000)) {
  if (body.receivedConfirmed !== true) throw new Error('Confirm the customer received the item');
  const requestId = clean(body.requestId, 80);
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error('Invalid send request');
  const order = await resolveSource(env, body.sourceType, body.sourceId);
  if (!order) throw new Error('Order not found');
  const message = thankYouMessage({customerName:order.customer_name,customerEmail:order.customer_email,itemsText:order.itemsText,subject:body.subject,message:body.message},env.ORDER_EMAIL_FROM);
  await env.ORDERS.prepare(`INSERT OR IGNORE INTO thank_you_outbox
    (id,source_type,source_id,recipient_email,customer_name,items_text,subject,message,state,next_attempt_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(requestId,body.sourceType,body.sourceId,order.customer_email,order.customer_name || '',order.itemsText,message.subject,clean(body.message,1200) || DEFAULT_MESSAGE,'pending',now,now).run();
  return {ok:true,id:requestId};
}

export async function flushThankYous(env, now = Math.floor(Date.now()/1000)) {
  if (!env.RESEND_API_KEY || !env.ORDER_EMAIL_FROM) return;
  const rows = await env.ORDERS.prepare("SELECT id FROM thank_you_outbox WHERE state IN ('pending','sending') AND next_attempt_at<=? ORDER BY created_at LIMIT 10").bind(now).all();
  for (const row of rows.results || []) {
    const lease = crypto.randomUUID();
    const claimed = await env.ORDERS.prepare(`UPDATE thank_you_outbox SET state='sending',lease_token=?,next_attempt_at=?,attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?) WHERE id=? AND state IN ('pending','sending') AND next_attempt_at<=? RETURNING *`).bind(lease,now+120,now,row.id,now).first();
    if (!claimed) continue;
    if (now - claimed.first_attempt_at >= 23*3600) { await finish(env,claimed.id,lease,'review',now,'retry_window_expired',null); continue; }
    try {
      let payload = claimed.payload_json;
      if (!payload) {
        payload = JSON.stringify(thankYouMessage({customerName:claimed.customer_name,customerEmail:claimed.recipient_email,itemsText:claimed.items_text,subject:claimed.subject,message:claimed.message},env.ORDER_EMAIL_FROM));
        await env.ORDERS.prepare('UPDATE thank_you_outbox SET payload_json=? WHERE id=? AND lease_token=?').bind(payload,claimed.id,lease).run();
      }
      const response = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`att-thank-you/${claimed.id}`},body:payload,signal:AbortSignal.timeout(15000)});
      const result = await response.json().catch(()=>null);
      if (response.ok && result?.id) await finish(env,claimed.id,lease,'accepted',now,null,result.id,now);
      else {
        const retry = response.status === 429 || response.status >= 500;
        await finish(env,claimed.id,lease,retry?'pending':'review',now+Math.min(3600,60*2**Math.min(claimed.attempts,6)),`provider_http_${response.status}`,null);
      }
    } catch {
      await finish(env,claimed.id,lease,'pending',now+300,'send_or_record_failed',null);
    }
  }
}

function finish(env,id,lease,state,next,error,providerId,acceptedAt=null) {
  return env.ORDERS.prepare('UPDATE thank_you_outbox SET state=?,next_attempt_at=?,last_error=?,provider_id=COALESCE(?,provider_id),accepted_at=COALESCE(?,accepted_at),lease_token=NULL WHERE id=? AND lease_token=?').bind(state,next,error,providerId,acceptedAt,id,lease).run();
}

export const thankYouDefaults = {subject:DEFAULT_SUBJECT,message:DEFAULT_MESSAGE};
