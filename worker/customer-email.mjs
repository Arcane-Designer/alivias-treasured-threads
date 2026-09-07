import {orderMessage,flushOrderEmails} from './order-email.mjs';
export const REVIEW_RECIPIENT = 'nathanagellatly@gmail.com';
export function customerEmailEnabled(env) {
  const cutoff = Number(env.CUSTOMER_EMAIL_START_AT);
  return env.CUSTOMER_EMAIL_ENABLED === 'true' && Number.isSafeInteger(cutoff) && cutoff > 0;
}
export function enqueueCustomerEmail(env, orderRef, now) {
  // Before the paid update, within the same transaction. Old paid and old pending orders are excluded.
  return env.ORDERS.prepare(`INSERT OR IGNORE INTO customer_email_outbox
    (order_ref,state,next_attempt_at,created_at)
    SELECT order_ref,'pending',?,? FROM orders
    WHERE order_ref=? AND status!='paid' AND created_at>=?`)
    .bind(now,now,orderRef,Number(env.CUSTOMER_EMAIL_START_AT));
}
export function customerMessage(order,items,from) {
  if (!/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(order.customer_email || '')) throw new Error('Customer email missing or invalid');
  return orderMessage(order,items,from,{customer:true});
}
export async function flushCustomerEmails(env, now = Math.floor(Date.now()/1000)) {
  return flushOrderEmails(env,now,{table:'customer_email_outbox',keyPrefix:'att-customer-confirmation',enabled:customerEmailEnabled(env),makeMessage(order,items,from) {
    if (order.created_at < Number(env.CUSTOMER_EMAIL_START_AT)) throw new Error('Order predates activation');
    return customerMessage(order,items,from);
  }});
}
export function customerReviewMessage(from, variant='shipping') {
  if (!['shipping','missing-address','seller'].includes(variant)) throw new Error('Invalid review variant');
  const order={order_ref:'ATT-REVIEW-ONLY',currency:'usd',customer_name:'Nathan (review sample)',customer_email:REVIEW_RECIPIENT,
    subtotal_cents:2800,shipping_cents:0,total_cents:2800,paid_at:1788800400,
    shipping_json:variant!=='missing-address'?JSON.stringify({name:'Nathan (review sample)',address:{line1:'123 Example Lane',line2:'Unit 2',city:'Sample City',state:'WA',postal_code:'00000',country:'US'}}):null};
  const items=[{display_name:'Strawberry Zipper Pouch'},{display_name:'Lemon Blueberry Zipper Pouch'}];
  const message=variant==='seller'?orderMessage(order,items,from):customerMessage(order,items,from);
  message.to=[REVIEW_RECIPIENT];
  message.subject=`[REVIEW TEST: ${variant}] ${variant==='seller'?'New paid order':'Your order is confirmed'} | Alivia's Treasured Threads`;
  message.text='REVIEW SAMPLE ONLY. Fictional order and address. No purchase or charge occurred.\n\n'+message.text;
  message.html=message.html.replace('<table role="presentation" width="100%"', '<div style="padding:16px;background:#fff4ce;text-align:center;font:13px Arial;color:#594700;">REVIEW SAMPLE ONLY. Fictional order and address. No purchase or charge occurred.</div><table role="presentation" width="100%"');
  return message;
}
export async function sendCustomerReview(env,variant) {
  const message=customerReviewMessage(env.ORDER_EMAIL_FROM,variant);
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`att-logo-review-v2/${variant}`},body:JSON.stringify(message),signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>null);
  return response.ok && data?.id ? {accepted:true,id:data.id,to:REVIEW_RECIPIENT} : {accepted:false,status:response.status};
}
