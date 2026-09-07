import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {customerEmailEnabled,enqueueCustomerEmail,flushCustomerEmails,customerMessage,customerReviewMessage,sendCustomerReview} from './customer-email.mjs';
const db=new DatabaseSync(':memory:');
for(const file of ['schema.sql','customer-email-schema.sql'])db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
const ORDERS={prepare(sql){let args=[];const q={bind(...a){args=a;return q},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return db.prepare(sql).run(...args)}};return q}};
const env={ORDERS,CUSTOMER_EMAIL_ENABLED:'true',CUSTOMER_EMAIL_START_AT:'1000',RESEND_API_KEY:'fixture',ORDER_EMAIL_FROM:'Alivia <orders@example.com>'};
const add=(ref,created,status='pending')=>db.prepare("INSERT INTO orders(order_ref,checkout_attempt_id,status,currency,subtotal_cents,shipping_cents,expires_at,created_at,customer_email) VALUES(?,?,?,'usd',2800,0,9999,?,'buyer@example.com')").run(ref,ref,status,created);
const queued=()=>db.prepare('SELECT count(*) AS n FROM customer_email_outbox').get().n;
assert(!customerEmailEnabled({...env,CUSTOMER_EMAIL_ENABLED:'false'}));assert(!customerEmailEnabled({...env,CUSTOMER_EMAIL_START_AT:'0'}));assert(!customerEmailEnabled({...env,CUSTOMER_EMAIL_START_AT:'invalid'}));
add('old-paid',500,'paid');add('old-pending',500);add('already-paid',1100,'paid');
for(const ref of ['old-paid','old-pending','already-paid'])await enqueueCustomerEmail(env,ref,2000).run();
assert.equal(queued(),0,'old paid, delayed old pending, and already paid orders excluded');
add('new',1001);await enqueueCustomerEmail(env,'new',2000).run();await enqueueCustomerEmail(env,'new',2000).run();assert.equal(queued(),1);
db.prepare("UPDATE orders SET status='paid' WHERE order_ref='new'").run();
let calls=[];let status=500;const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));assert(url==='https://api.resend.com/emails');return Response.json(status===200?{id:'test-id'}:{error:'temporary'},{status})};
try {
await flushCustomerEmails({...env,CUSTOMER_EMAIL_ENABLED:'false'},2000);assert.equal(calls.length,0,'disabled means no delivery');
await flushCustomerEmails(env,2000);assert.equal(calls.length,1);assert.equal(db.prepare('SELECT state FROM customer_email_outbox').get().state,'pending');
status=200;await Promise.all([flushCustomerEmails(env,2400),flushCustomerEmails(env,2400)]);assert.equal(calls.length,2,'concurrent retries send once');
assert.deepEqual(calls[0],calls[1],'retry payload unchanged');assert.deepEqual(calls[1].to,['buyer@example.com']);assert.equal(calls[1].reply_to,'aliviagellatly@gmail.com');assert(!calls[1].html.includes('dashboard.stripe.com'));assert(!calls[1].text.includes('dashboard.stripe.com'));
await flushCustomerEmails(env,3000);assert.equal(calls.length,2,'accepted emails never resend');
for(const variant of ['shipping','missing-address']){const msg=customerReviewMessage(env.ORDER_EMAIL_FROM,variant);assert.deepEqual(msg.to,['nathanagellatly@gmail.com']);assert(msg.html.includes('REVIEW SAMPLE ONLY'));assert(!msg.html.includes('Maddie'));assert(!msg.html.includes('\u2014'));await sendCustomerReview(env,variant);assert.deepEqual(calls.at(-1).to,['nathanagellatly@gmail.com']);}
const msg=customerMessage({order_ref:'ATT-TEST',customer_email:'buyer@example.com',customer_name:'<img src=x>',currency:'usd',subtotal_cents:1,shipping_cents:0,shipping_json:JSON.stringify({name:'Test',address:{line1:'<b>Street</b>',line2:'Unit 2',city:'Sample',state:'WA',postal_code:'00000',country:'US'}})},[{display_name:'<script>bad</script>'}],env.ORDER_EMAIL_FROM);
assert(msg.html.includes('&lt;b&gt;Street'));assert(!msg.html.includes('<script>'));assert(msg.text.includes('Unit 2'));assert(msg.text.includes('00000'));
console.log('Customer email checks passed: cutoff, old callbacks, duplicate queue, retry, concurrent send, review-only recipient, HTML escaping, reply-to and customer links.');
}finally{globalThis.fetch=original;db.close()}
