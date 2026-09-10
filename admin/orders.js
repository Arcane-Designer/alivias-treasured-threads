(function () {
  'use strict';
  const TOKEN_KEY='att-studio-token';
  const defaults={
    subject:"A little thank-you from Alivia's Treasured Threads",
    message:"Thank you so much for your purchase. I hope you love your handmade treasure! If you have a moment, I'd be so grateful if you left a review. Your note helps my little shop more than you know."
  };
  const $=id=>document.getElementById(id);
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let apiBase='';
  let orders=[];
  let activeOrder=null;
  let previewTimer=null;
  let sendRequestId='';

  async function api(path,options={}) {
    if (!apiBase) await loadApiBase();
    const response=await fetch(apiBase+path,{...options,headers:{Authorization:'Bearer '+localStorage.getItem(TOKEN_KEY),'Content-Type':'application/json',...(options.headers||{})}});
    const body=await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(body.error||'The order list could not be updated.');
    return body;
  }

  async function loadApiBase() {
    const data=await fetch('../data/site.json?v='+Date.now(),{cache:'no-store'}).then(response=>response.json());
    apiBase=String(data.settings?.checkoutApiUrl||data.settings?.reviewInboxUrl||'').replace(/\/+$/,'');
    if (!apiBase) throw new Error('The order connection is not configured.');
  }

  function prettyDate(seconds) {
    if (!seconds) return 'Date not recorded';
    return new Date(seconds*1000).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  }

  function money(order) {
    if (!Number.isFinite(order.total_cents)) return '';
    return new Intl.NumberFormat('en-US',{style:'currency',currency:String(order.currency||'usd').toUpperCase()}).format(order.total_cents/100);
  }

  function sentLabel(send) {
    if (!send) return '';
    if (send.state==='accepted') return '<span class="sent-chip">Thank-you sent '+esc(prettyDate(send.accepted_at||send.created_at))+'</span>';
    if (send.state==='review') return '<span class="sent-chip">Send needs a check</span>';
    return '<span class="sent-chip">Thank-you queued</span>';
  }

  function renderOrders() {
    const list=$('ordersList');
    if (!orders.length) {
      list.innerHTML='<div class="archive-empty">No completed orders yet.</div>';
      return;
    }
    list.innerHTML=orders.map(order=>{
      const name=order.customer_name||'No name provided';
      const source=order.sourceType==='website'?'Website':'Added by Alivia';
      return `<details class="order-card" data-order-key="${esc(order.sourceType+':'+order.id)}">
        <summary><div class="order-card-head"><div class="order-card-title"><strong>${esc(name)}</strong><span>${esc(order.itemsText||'Purchase details not added')}</span></div><span class="order-source ${order.sourceType==='manual'?'manual':''}">${source}</span></div><div class="order-date">${esc(prettyDate(order.sale_at))}${money(order)?' · '+esc(money(order)):''}</div></summary>
        <div class="order-body"><p class="order-items">${esc(order.itemsText||'Item not listed')}</p><div class="order-details">
          <div class="order-detail"><span class="order-detail-label">Email</span>${esc(order.customer_email||'No email recorded')}</div>
          ${order.shippingText?`<div class="order-detail"><span class="order-detail-label">Shipping or pickup</span>${esc(order.shippingText).replaceAll('\n','<br>')}</div>`:''}
          ${order.notes?`<div class="order-detail"><span class="order-detail-label">Private notes</span>${esc(order.notes)}</div>`:''}
          <div class="order-detail"><span class="order-detail-label">Order</span>${esc(order.id)}</div>
        </div><div class="order-actions"><button type="button" class="btn btn-pink btn-small order-thank-you" data-key="${esc(order.sourceType+':'+order.id)}">Send thank-you 💌</button>
          ${order.sourceType==='manual'?`<button type="button" class="ghost-btn manual-edit" data-key="${esc(order.sourceType+':'+order.id)}">Edit</button><button type="button" class="ghost-btn danger manual-delete" data-key="${esc(order.sourceType+':'+order.id)}">Delete</button>`:''}${sentLabel(order.thankYou)}</div></div>
      </details>`;
    }).join('');
  }

  function findOrder(key) { return orders.find(order=>order.sourceType+':'+order.id===key); }

  async function loadOrders() {
    $('ordersStatus').textContent='Loading orders...';
    try {
      const result=await api('/studio/orders');
      orders=result.orders||[];
      renderOrders();
      $('ordersStatus').textContent=orders.length+' order'+(orders.length===1?'':'s');
    } catch (error) {
      $('ordersStatus').textContent=error.message;
      $('ordersList').innerHTML='';
    }
  }

  function openOrders() {
    $('ordersOverlay').hidden=false;
    document.body.style.overflow='hidden';
    $('ordersClose').focus();
    loadOrders();
  }
  function closeOrders() { $('ordersOverlay').hidden=true; document.body.style.overflow=''; $('ordersBtn').focus(); }

  function openManual(order=null) {
    $('manualOrderTitle').textContent=order?'Edit sale':'Add a sale';
    $('manualOrderId').value=order?.id||'';
    $('manualOrderName').value=order?.customer_name||'';
    $('manualOrderEmail').value=order?.customer_email||'';
    $('manualOrderItems').value=order?.itemsText||'';
    $('manualOrderShipping').value=order?.shippingText||'';
    $('manualOrderNotes').value=order?.notes||'';
    $('manualOrderDate').value=order?.sale_at?new Date(order.sale_at*1000).toISOString().slice(0,10):new Date().toISOString().slice(0,10);
    $('manualOrderError').textContent='';
    $('manualOrderOverlay').hidden=false;
    $('manualOrderName').focus();
  }
  function closeManual() { $('manualOrderOverlay').hidden=true; }

  async function saveManual() {
    const date=$('manualOrderDate').value;
    const body={customerName:$('manualOrderName').value,customerEmail:$('manualOrderEmail').value,itemsText:$('manualOrderItems').value,shippingText:$('manualOrderShipping').value,notes:$('manualOrderNotes').value,saleAt:date?Math.floor(new Date(date+'T12:00:00').getTime()/1000):null};
    const id=$('manualOrderId').value;
    $('manualOrderSave').disabled=true;
    $('manualOrderError').textContent='';
    try {
      await api(id?'/studio/manual-orders/'+encodeURIComponent(id):'/studio/manual-orders',{method:id?'PUT':'POST',body:JSON.stringify(body)});
      closeManual();
      await loadOrders();
    } catch (error) { $('manualOrderError').textContent=error.message; }
    finally { $('manualOrderSave').disabled=false; }
  }

  async function deleteManual(order) {
    if (!confirm('Delete this manually added sale? This cannot be undone.')) return;
    try { await api('/studio/manual-orders/'+encodeURIComponent(order.id),{method:'DELETE'}); await loadOrders(); }
    catch (error) { $('ordersStatus').textContent=error.message; }
  }

  function openThankYou(order) {
    activeOrder=order;
    sendRequestId=crypto.randomUUID();
    $('thankYouRecipient').textContent='To: '+(order.customer_name||'Customer')+' <'+(order.customer_email||'no email')+'>';
    $('thankYouSubject').value=defaults.subject;
    $('thankYouMessage').value=defaults.message;
    $('receivedConfirmed').checked=false;
    $('thankYouSend').disabled=true;
    $('thankYouError').textContent='';
    $('thankYouPreview').srcdoc='<p style="font-family:Arial;padding:24px">Building preview...</p>';
    $('thankYouOverlay').hidden=false;
    updatePreview();
  }
  function closeThankYou() { $('thankYouOverlay').hidden=true; activeOrder=null; }

  async function updatePreview() {
    if (!activeOrder) return;
    try {
      const result=await api('/thank-you/preview',{method:'POST',body:JSON.stringify({sourceType:activeOrder.sourceType,sourceId:activeOrder.id,subject:$('thankYouSubject').value,message:$('thankYouMessage').value})});
      $('thankYouPreview').srcdoc=result.html;
      $('thankYouError').textContent='';
    } catch (error) { $('thankYouError').textContent=error.message; }
  }

  function schedulePreview() { clearTimeout(previewTimer); previewTimer=setTimeout(updatePreview,300); }

  async function sendThankYou() {
    if (!activeOrder||!$('receivedConfirmed').checked) return;
    $('thankYouSend').disabled=true;
    $('thankYouSend').textContent='Sending...';
    $('thankYouError').textContent='';
    try {
      await api('/thank-you/send',{method:'POST',body:JSON.stringify({sourceType:activeOrder.sourceType,sourceId:activeOrder.id,subject:$('thankYouSubject').value,message:$('thankYouMessage').value,receivedConfirmed:true,requestId:sendRequestId})});
      closeThankYou();
      await loadOrders();
      $('ordersStatus').textContent='Thank-you sent or safely queued for delivery.';
    } catch (error) { $('thankYouError').textContent=error.message; $('thankYouSend').disabled=false; }
    finally { $('thankYouSend').textContent='Send thank-you 💌'; }
  }

  $('ordersBtn').addEventListener('click',openOrders);
  $('ordersClose').addEventListener('click',closeOrders);
  $('ordersRefresh').addEventListener('click',loadOrders);
  $('manualOrderAdd').addEventListener('click',()=>openManual());
  $('manualOrderClose').addEventListener('click',closeManual);
  $('manualOrderCancel').addEventListener('click',closeManual);
  $('manualOrderSave').addEventListener('click',saveManual);
  $('thankYouClose').addEventListener('click',closeThankYou);
  $('thankYouCancel').addEventListener('click',closeThankYou);
  $('thankYouSubject').addEventListener('input',schedulePreview);
  $('thankYouMessage').addEventListener('input',schedulePreview);
  $('receivedConfirmed').addEventListener('change',()=>{$('thankYouSend').disabled=!$('receivedConfirmed').checked;});
  $('thankYouSend').addEventListener('click',sendThankYou);
  $('ordersList').addEventListener('click',event=>{
    const button=event.target.closest('[data-key]');
    if (!button) return;
    const order=findOrder(button.dataset.key);
    if (!order) return;
    if (button.classList.contains('order-thank-you')) openThankYou(order);
    if (button.classList.contains('manual-edit')) openManual(order);
    if (button.classList.contains('manual-delete')) deleteManual(order);
  });
  $('ordersOverlay').addEventListener('click',event=>{if(event.target===$('ordersOverlay'))closeOrders();});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if(!$('thankYouOverlay').hidden)closeThankYou();
    else if(!$('manualOrderOverlay').hidden)closeManual();
    else if(!$('ordersOverlay').hidden)closeOrders();
  });
})();
