import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {thankYouMessage,listStudioOrders,saveManualOrder,deleteManualOrder,previewThankYou,queueThankYou,flushThankYous} from './thank-you-email.mjs';

const db=new DatabaseSync(':memory:');
for(const file of ['schema.sql','thank-you-schema.sql']) db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
const ORDERS={prepare(sql){let args=[];const query={bind(...values){args=values;return query},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return db.prepare(sql).run(...args)}};return query}};
const env={ORDERS,ORDER_EMAIL_FROM:"Alivia's Treasured Threads <orders@example.com>",RESEND_API_KEY:'test'};

db.prepare("INSERT INTO orders (order_ref,checkout_attempt_id,status,currency,subtotal_cents,shipping_cents,total_cents,expires_at,customer_email,customer_name,shipping_json,created_at,paid_at) VALUES ('ATT-TEST000001','attempt','paid','usd',2000,0,2000,99999,'nathan@example.com','',?,1,100)").run(JSON.stringify({name:'Nathan',address:{line1:'1 Main St',city:'Spokane',state:'WA',postal_code:'99201',country:'US'}}));
db.prepare("INSERT INTO order_items (order_ref,inventory_key,product_id,display_name,unit_amount_cents) VALUES ('ATT-TEST000001','piece','product','Lavender tote',2000)").run();

const fallback=thankYouMessage({customerEmail:'nathan@example.com'},env.ORDER_EMAIL_FROM);
assert.match(fallback.text,/^Hi there,/);
assert.doesNotMatch(fallback.text,/Hi ,|undefined|null/);
assert.match(fallback.html,/Leave a review/);

await saveManualOrder(env,{customerEmail:'friend@example.com',itemsText:'Coin pouch',saleAt:50},10);
let listed=await listStudioOrders(env);
assert.equal(listed.length,2);
assert.equal(listed[0].sourceType,'website');
assert.match(listed[0].shippingText,/1 Main St/);
const manual=listed.find(order=>order.sourceType==='manual');
await saveManualOrder(env,{id:manual.id,customerName:'Friend Name',customerEmail:'friend@example.com',itemsText:'Two coin pouches',saleAt:50},20);
const preview=await previewThankYou(env,{sourceType:'manual',sourceId:manual.id});
assert.match(preview.text,/Hi Friend,/);
assert.match(preview.text,/Two coin pouches/);

const requestId='11111111-1111-4111-8111-111111111111';
await queueThankYou(env,{sourceType:'website',sourceId:'ATT-TEST000001',receivedConfirmed:true,requestId},1000);
await queueThankYou(env,{sourceType:'website',sourceId:'ATT-TEST000001',receivedConfirmed:true,requestId},1000);
assert.equal(db.prepare('SELECT count(*) AS n FROM thank_you_outbox').get().n,1);
await assert.rejects(()=>queueThankYou(env,{sourceType:'website',sourceId:'ATT-TEST000001',receivedConfirmed:false,requestId:crypto.randomUUID()},1000),/received/);

let calls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{calls++;return Response.json({id:'resend-1'});};
try {
  await Promise.all([flushThankYous(env,1000),flushThankYous(env,1000)]);
  assert.equal(calls,1);
  assert.equal(db.prepare('SELECT state FROM thank_you_outbox WHERE id=?').get(requestId).state,'accepted');
} finally { globalThis.fetch=originalFetch; }

assert.equal((await deleteManualOrder(env,manual.id)).ok,true);
assert.equal((await listStudioOrders(env)).length,1);
db.prepare("INSERT INTO studio_preferences (preference_key,preference_value,updated_at) VALUES ('archive-collapse',?,1) ON CONFLICT(preference_key) DO UPDATE SET preference_value=excluded.preference_value,updated_at=excluded.updated_at").run(JSON.stringify(['p:one','p:two']));
assert.deepEqual(JSON.parse(db.prepare("SELECT preference_value FROM studio_preferences WHERE preference_key='archive-collapse'").get().preference_value),['p:one','p:two']);
console.log('Thank-you flow checks passed: order history, manual CRUD, name fallback, preview, receipt gate, duplicate protection, delivery and saved Studio preference schema.');
db.close();
