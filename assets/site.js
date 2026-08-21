/* ============================================================
   Alivia's Treasured Threads - Storefront 2.0 client
   Shared across home, shop, product, custom, about, faq.
   Basket in localStorage; data from data/site.json.
   No frameworks. Safe DOM. Preserves review Worker + Web3Forms.
   ============================================================ */
(function () {
  'use strict';

  const BASKET_KEY = 'att-basket-v2';
  const PLACEHOLDER = 'images/brand/logo.jpg';

  /** Resolve asset / data paths relative to current page depth. */
  function rootPrefix() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    // product/slug → two levels up; shop|custom|about|faq → one; root → empty
    if (/\/product\/[^/]+$/i.test(path) || /\/product\/[^/]+\/index\.html$/i.test(path)) {
      return '../../';
    }
    if (/\/(shop|custom|about|faq)(\/index\.html)?$/i.test(path)) {
      return '../';
    }
    return '';
  }

  const ROOT = rootPrefix();
  const DATA_URL = ROOT + 'data/site.json';
  const IMG = (p) => {
    if (!p) return ROOT + PLACEHOLDER;
    if (/^https?:\/\//i.test(p) || p.startsWith('data:')) return p;
    return ROOT + p.replace(/^\//, '');
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function text(el, s) {
    if (el) el.textContent = s == null ? '' : String(s);
  }

  /* ---------- data boot ---------- */
  let DATA = { settings: {}, products: [], reviews: [] };
  let activeProducts = [];
  let basket = [];
  let previewData = null;

  const params = new URLSearchParams(location.search);
  if (params.get('preview') === '1') {
    try {
      previewData = JSON.parse(localStorage.getItem('att-preview-data') || 'null');
    } catch (e) {
      previewData = null;
    }
  }

  function resolveImg(path) {
    if (previewData && previewData._previewImages && previewData._previewImages[path]) {
      return previewData._previewImages[path];
    }
    return IMG(path);
  }

  function showPreviewRibbon() {
    if (document.querySelector('.preview-ribbon')) return;
    const ribbon = document.createElement('div');
    ribbon.className = 'preview-ribbon';
    ribbon.textContent = '🧵 PREVIEW: this is how your shop will look once you publish!';
    document.body.prepend(ribbon);
    document.body.classList.add('has-preview');
  }

  function boot(data) {
    DATA = data || { settings: {}, products: [], reviews: [] };
    activeProducts = (DATA.products || []).filter((p) => !p.archived);
    applySettings(DATA.settings || {});
    loadBasket();
    renderBasketUI();
    document.dispatchEvent(new CustomEvent('att:ready', { detail: { data: DATA, activeProducts } }));
  }

  if (previewData) {
    showPreviewRibbon();
    queueMicrotask(() => boot(previewData));
  } else {
    fetch(DATA_URL + '?v=' + Date.now())
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(boot)
      .catch((err) => {
        console.error('Could not load shop data', err);
        document.dispatchEvent(new CustomEvent('att:error', { detail: err }));
      });
  }

  function applySettings(s) {
    const map = {
      heroTagline: s.tagline,
      heroSub: s.heroSub,
      aboutHeading: s.aboutHeading,
      aboutText1: s.aboutText1,
      aboutText2: s.aboutText2,
      shopScript: s.shopScript,
      shopTitle: s.shopTitle,
      shopSubtitle: s.shopSubtitle,
      orderScript: s.orderScript,
      orderTitle: s.orderTitle,
      orderIntro: s.orderIntro,
      successTitle: s.successTitle,
      successBody: s.successBody,
      reviewsScript: s.reviewsScript,
      reviewsTitle: s.reviewsTitle,
      leaveScript: s.leaveScript,
      leaveTitle: s.leaveTitle,
      leaveReviewIntro: s.leaveReviewIntro,
    };
    Object.keys(map).forEach((id) => {
      if (map[id] != null && $(id)) text($(id), map[id]);
    });
    document.querySelectorAll('[data-copy]').forEach((el) => {
      const value = s[el.dataset.copy];
      if (value == null) return;
      const attr = el.dataset.copyAttr;
      if (attr) el.setAttribute(attr, value);
      else text(el, value);
    });
    const ig = $('aboutIg') || document.querySelector('[data-ig]');
    if (ig && s.instagramUrl) {
      ig.href = s.instagramUrl;
      ig.setAttribute('rel', 'noopener noreferrer');
      ig.setAttribute('target', '_blank');
    }
    document.querySelectorAll('[data-brand]').forEach((el) => {
      text(el, s.brandName || "Alivia's Treasured Threads");
    });
  }

  /* ---------- product helpers ---------- */
  function productById(id) {
    return (DATA.products || []).find((p) => p.id === id);
  }
  function unsoldListings(p) {
    return (p.listings || []).filter((l) => !l.sold);
  }
  function isReady(p) {
    return !!(p.oneOfAKind || unsoldListings(p).length > 0);
  }
  function isCustomOnly(p) {
    return p.price === null && !p.oneOfAKind;
  }
  function isOnSale(p) {
    return typeof p.salePrice === 'number' && typeof p.price === 'number' && p.salePrice < p.price;
  }
  function shownPrice(p) {
    if (typeof p.price !== 'number') return null;
    return isOnSale(p) ? p.salePrice : p.price;
  }
  function priceHtml(p) {
    if (p.price === null || typeof p.price !== 'number') {
      return esc(p.priceLabel || 'Custom Order');
    }
    if (isOnSale(p)) {
      return (
        '<span class="was">' +
        esc(p.priceLabel || '$' + p.price) +
        '</span><span class="now">$' +
        esc(String(p.salePrice)) +
        '</span>'
      );
    }
    if (p.priceTiers && p.priceTiers.length) {
      const t = p.priceTiers;
      const low = Math.min(...t.map((x) => x.price));
      return 'from $' + esc(String(low));
    }
    return esc(p.priceLabel || '$' + p.price);
  }
  function coverImg(p) {
    if (p.images && p.images[0]) return resolveImg(p.images[0]);
    const u = unsoldListings(p);
    if (u[0] && u[0].images && u[0].images[0]) return resolveImg(u[0].images[0]);
    return resolveImg(PLACEHOLDER);
  }
  function allImages(p) {
    const out = [];
    (p.images || []).forEach((i) => out.push(i));
    (p.listings || []).forEach((l) => {
      (l.images || []).forEach((i) => {
        if (out.indexOf(i) === -1) out.push(i);
      });
    });
    return out;
  }
  function productHref(p) {
    return ROOT + 'product/' + encodeURIComponent(p.id) + '/';
  }
  function checkoutUrl(p) {
    const u = (p.checkoutUrl || p.paymentLink || '').trim();
    if (!u) return '';
    try {
      const parsed = new URL(u);
      if (parsed.protocol === 'https:') return u;
    } catch (e) { /* invalid */ }
    return '';
  }

  /* ---------- cards ---------- */
  function productCardHtml(p) {
    const stock = unsoldListings(p).length;
    const badges = (p.badges || []).slice(0, 2);
    const badgeHtml = badges
      .map((b) => '<span class="sticker">' + esc(b) + '</span>')
      .join('');
    const readyTag =
      stock > 0 || p.oneOfAKind
        ? '<div class="product-card-meta">' +
          (p.oneOfAKind ? 'One of a kind' : stock + ' ready to ship') +
          '</div>'
        : isCustomOnly(p)
          ? '<div class="product-card-meta custom">Made to order</div>'
          : '';
    return (
      '<a class="product-card" href="' +
      esc(productHref(p)) +
      '">' +
      '<div class="product-card-media">' +
      badgeHtml +
      '<img src="' +
      esc(coverImg(p)) +
      '" alt="' +
      esc(p.name) +
      '" loading="lazy" width="400" height="400">' +
      '</div>' +
      '<div class="product-card-body">' +
      '<h3 class="product-card-name">' +
      esc(p.name) +
      '</h3>' +
      '<div class="product-card-price' +
      (p.price === null ? ' custom' : '') +
      (isOnSale(p) ? ' on-sale' : '') +
      '">' +
      priceHtml(p) +
      '</div>' +
      readyTag +
      '</div></a>'
    );
  }

  /* ---------- basket ---------- */
  function loadBasket() {
    try {
      const stored = JSON.parse(localStorage.getItem(BASKET_KEY) || '[]');
      if (!Array.isArray(stored)) {
        basket = [];
        return;
      }
      let dropped = 0;
      basket = stored.filter((item) => {
        const p = productById(item.productId);
        if (!p || p.archived) {
          dropped++;
          return false;
        }
        if (item.type === 'listing') {
          const l = (p.listings || []).find((x) => x.id === item.listingId);
          if (!l || l.sold) {
            dropped++;
            return false;
          }
        }
        if (item.type === 'oneoff' && !p.oneOfAKind) {
          dropped++;
          return false;
        }
        return true;
      });
      if (dropped) saveBasket();
    } catch (e) {
      basket = [];
    }
  }
  function saveBasket() {
    try {
      localStorage.setItem(BASKET_KEY, JSON.stringify(basket));
    } catch (e) { /* quota */ }
    renderBasketUI();
  }
  function basketCount() {
    return basket.reduce((n, item) => n + (item.type === 'custom' ? item.qty || 1 : 1), 0);
  }
  function addListing(productId, listingId) {
    const exists = basket.find(
      (b) => b.type === 'listing' && b.productId === productId && b.listingId === listingId
    );
    if (exists) return false;
    basket.push({ type: 'listing', productId, listingId });
    saveBasket();
    toast('Added to basket');
    return true;
  }
  function addOneOff(productId) {
    const exists = basket.find((b) => b.type === 'oneoff' && b.productId === productId);
    if (exists) return false;
    basket.push({ type: 'oneoff', productId });
    saveBasket();
    toast('Added to basket');
    return true;
  }
  function addCustom(productId) {
    const existing = basket.find((b) => b.type === 'custom' && b.productId === productId);
    if (existing) {
      existing.qty = (existing.qty || 1) + 1;
    } else {
      basket.push({ type: 'custom', productId, qty: 1 });
    }
    saveBasket();
    toast('Custom request added');
    return true;
  }
  function removeItem(idx) {
    basket.splice(idx, 1);
    saveBasket();
  }
  function setCustomQty(idx, qty) {
    const item = basket[idx];
    if (!item || item.type !== 'custom') return;
    qty = Math.max(1, Math.min(20, parseInt(qty, 10) || 1));
    item.qty = qty;
    saveBasket();
  }
  /** Tier-aware total for one product's quantity ("2 for $6" style pricing). */
  function tierTotal(p, qty) {
    const tiers = (p.priceTiers || [])
      .filter((t) => t && typeof t.price === 'number' && typeof t.qty === 'number' && t.qty > 0)
      .sort((a, b) => b.qty - a.qty);
    if (!tiers.length) return null;
    let remaining = qty;
    let total = 0;
    tiers.forEach((t) => {
      while (remaining >= t.qty) {
        total += t.price;
        remaining -= t.qty;
      }
    });
    if (remaining > 0) {
      const smallest = tiers[tiers.length - 1];
      const unitPrice = smallest.qty === 1 ? smallest.price : shownPrice(p);
      total += remaining * (typeof unitPrice === 'number' ? unitPrice : 0);
    }
    return total;
  }

  function estimate() {
    /* Combine quantities per product so tier/bundle pricing (e.g. "2 for $6")
       applies across listings, one-of-a-kinds, and custom requests alike.
       Sale prices still apply via shownPrice for non-tiered products. */
    const qtyByProduct = {};
    let unpriced = 0;
    basket.forEach((item) => {
      const p = productById(item.productId);
      if (!p) return;
      const q = item.type === 'custom' ? item.qty || 1 : 1;
      const hasTiers = !!(p.priceTiers && p.priceTiers.length);
      if (typeof shownPrice(p) === 'number' || hasTiers) {
        qtyByProduct[p.id] = (qtyByProduct[p.id] || 0) + q;
      } else {
        unpriced += q;
      }
    });
    let total = 0;
    let priced = 0;
    Object.keys(qtyByProduct).forEach((id) => {
      const p = productById(id);
      const qty = qtyByProduct[id];
      const tiered = tierTotal(p, qty);
      if (tiered != null) total += tiered;
      else total += (shownPrice(p) || 0) * qty;
      priced += qty;
    });
    return { total, priced, unpriced };
  }

  function renderBasketUI() {
    const fab = $('basketFab');
    const countEl = $('basketCount');
    const n = basketCount();
    if (fab) {
      /* Keep the basket visible even when it is empty so visitors can
         understand that products can be collected before ordering. */
      fab.hidden = false;
      fab.setAttribute('aria-label', n ? 'Open my basket, ' + n + ' item' + (n === 1 ? '' : 's') : 'Open my empty basket');
      if (countEl) {
        text(countEl, String(n));
        countEl.hidden = n === 0;
      }
    }
    const drawerItems = $('drawerItems');
    const drawerEmpty = $('drawerEmpty');
    const drawerEst = $('drawerEstimate');
    if (drawerItems) {
      if (!basket.length) {
        drawerItems.innerHTML = '';
        if (drawerEmpty) drawerEmpty.hidden = false;
      } else {
        if (drawerEmpty) drawerEmpty.hidden = true;
        drawerItems.innerHTML = basket
          .map((item, idx) => {
            const p = productById(item.productId);
            if (!p) return '';
            let title = p.name;
            let sub = '';
            let img = coverImg(p);
            if (item.type === 'listing') {
              const l = (p.listings || []).find((x) => x.id === item.listingId);
              title = l ? l.name : p.name;
              sub =
                p.name +
                ' · ready to ship' +
                (typeof shownPrice(p) === 'number' ? ' · $' + shownPrice(p) : '');
              if (l && l.images && l.images[0]) img = resolveImg(l.images[0]);
            } else if (item.type === 'oneoff') {
              sub =
                'one of a kind · ready to ship' +
                (typeof shownPrice(p) === 'number' ? ' · $' + shownPrice(p) : '');
            } else {
              sub =
                'made just for you' +
                (typeof shownPrice(p) === 'number'
                  ? ' · $' + shownPrice(p) + ' each'
                  : ' · priced when we chat');
            }
            const qtyControls =
              item.type === 'custom'
                ? '<div class="bi-qty">' +
                  '<button type="button" data-qty-minus="' +
                  idx +
                  '" aria-label="Decrease">−</button>' +
                  '<span>' +
                  (item.qty || 1) +
                  '</span>' +
                  '<button type="button" data-qty-plus="' +
                  idx +
                  '" aria-label="Increase">+</button>' +
                  '</div>'
                : '';
            return (
              '<div class="bi">' +
              '<img class="bi-img" src="' +
              esc(img) +
              '" alt="">' +
              '<div class="bi-body">' +
              '<div class="bi-name">' +
              esc(title) +
              '</div>' +
              '<div class="bi-sub' +
              (item.type === 'custom' ? ' custom' : '') +
              '">' +
              esc(sub) +
              '</div>' +
              qtyControls +
              '</div>' +
              '<button type="button" class="bi-remove" data-remove="' +
              idx +
              '" aria-label="Remove">✕</button>' +
              '</div>'
            );
          })
          .join('');
      }
    }
    if (drawerEst) {
      const { total, priced, unpriced } = estimate();
      let html = '';
      if (priced > 0) html += 'Estimate: $' + total;
      if (unpriced > 0) {
        html +=
          '<span class="est-note">' +
          (priced > 0 ? '+ ' : '') +
          unpriced +
          ' custom item' +
          (unpriced > 1 ? 's' : '') +
          ' priced when we chat</span>';
      }
      drawerEst.innerHTML = html;
    }
    /* order page basket panel */
    const orderList = $('orderBasketList');
    const basketEmptyMsg = $('basketEmptyMsg');
    const basketEstimate = $('basketEstimate');
    if (orderList) {
      if (!basket.length) {
        orderList.innerHTML = '';
        if (basketEmptyMsg) basketEmptyMsg.hidden = false;
        if (basketEstimate) basketEstimate.hidden = true;
      } else {
        if (basketEmptyMsg) basketEmptyMsg.hidden = true;
        orderList.innerHTML = basket
          .map((item, idx) => {
            const p = productById(item.productId);
            if (!p) return '';
            let label = p.name;
            if (item.type === 'listing') {
              const l = (p.listings || []).find((x) => x.id === item.listingId);
              label = (l ? l.name : p.name) + ' (ready to ship)';
            } else if (item.type === 'oneoff') label += ' (one of a kind)';
            else label += ' ×' + (item.qty || 1) + ' (custom)';
            return (
              '<div class="bi" style="border:0;padding:0.4rem 0">' +
              '<div class="bi-body"><div class="bi-name">' +
              esc(label) +
              '</div></div>' +
              '<button type="button" class="bi-remove" data-remove="' +
              idx +
              '" aria-label="Remove">✕</button></div>'
            );
          })
          .join('');
        if (basketEstimate) {
          const { total, priced, unpriced } = estimate();
          let html = '';
          if (priced > 0) html += 'Estimate: $' + total;
          if (unpriced > 0) {
            html +=
              (priced > 0 ? ' · ' : '') +
              unpriced +
              ' custom item' +
              (unpriced > 1 ? 's' : '') +
              ' to price together';
          }
          basketEstimate.innerHTML = html;
          basketEstimate.hidden = false;
        }
      }
    }
  }

  document.addEventListener('click', (e) => {
    const rem = e.target.closest('[data-remove]');
    if (rem) {
      removeItem(parseInt(rem.getAttribute('data-remove'), 10));
      return;
    }
    const minus = e.target.closest('[data-qty-minus]');
    if (minus) {
      const idx = parseInt(minus.getAttribute('data-qty-minus'), 10);
      const item = basket[idx];
      if (item) setCustomQty(idx, (item.qty || 1) - 1);
      return;
    }
    const plus = e.target.closest('[data-qty-plus]');
    if (plus) {
      const idx = parseInt(plus.getAttribute('data-qty-plus'), 10);
      const item = basket[idx];
      if (item) setCustomQty(idx, (item.qty || 1) + 1);
      return;
    }
  });

  /* drawer open/close */
  function openDrawer() {
    const d = $('basketDrawer');
    const o = $('drawerOverlay');
    if (d) d.hidden = false;
    if (o) o.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    const d = $('basketDrawer');
    const o = $('drawerOverlay');
    if (d) d.hidden = true;
    if (o) o.hidden = true;
    document.body.style.overflow = '';
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('#basketFab')) openDrawer();
    if (e.target.closest('#drawerClose') || e.target.id === 'drawerOverlay') closeDrawer();
    if (e.target.closest('#drawerCheckout')) closeDrawer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDrawer();
      closeLightbox();
    }
  });

  /* ---------- toast ---------- */
  function toast(msg) {
    const zone = $('toastZone') || document.body;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    zone.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 2600);
  }

  /* ---------- lightbox ---------- */
  let lbImages = [];
  let lbIndex = 0;
  function openLightbox(images, start) {
    lbImages = images.map((p) => resolveImg(p));
    lbIndex = start || 0;
    const lb = $('lightbox');
    if (!lb) return;
    updateLightbox();
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() {
    const lb = $('lightbox');
    if (lb) lb.hidden = true;
    document.body.style.overflow = '';
  }
  function updateLightbox() {
    const img = $('lightboxImg');
    const count = $('lightboxCount');
    if (img) {
      img.src = lbImages[lbIndex] || '';
      img.alt = 'Photo ' + (lbIndex + 1) + ' of ' + lbImages.length;
    }
    if (count) text(count, lbIndex + 1 + ' / ' + lbImages.length);
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('#lightboxClose')) closeLightbox();
    if (e.target.closest('#lightboxPrev')) {
      lbIndex = (lbIndex - 1 + lbImages.length) % lbImages.length;
      updateLightbox();
    }
    if (e.target.closest('#lightboxNext')) {
      lbIndex = (lbIndex + 1) % lbImages.length;
      updateLightbox();
    }
  });

  /* ---------- nav mobile ---------- */
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('#navToggle');
    const nav = $('navMain');
    if (toggle && nav) {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (nav && e.target.closest('.nav-main a')) {
      nav.classList.remove('is-open');
      const t = $('navToggle');
      if (t) t.setAttribute('aria-expanded', 'false');
    }
  });

  /* ---------- scroll top ---------- */
  const scrollTopBtn = $('scrollTop');
  if (scrollTopBtn) {
    window.addEventListener(
      'scroll',
      () => {
        scrollTopBtn.classList.toggle('is-visible', window.scrollY > 400);
      },
      { passive: true }
    );
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- order form ---------- */
  function setupOrderForm() {
    const form = $('orderForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const s = DATA.settings || {};
      const name = (form.name && form.name.value || '').trim();
      const email = (form.email && form.email.value || '').trim();
      const instagram = (form.instagram && form.instagram.value || '').trim();
      const notes = (form.notes && form.notes.value || '').trim();
      const bot = form.botcheck && form.botcheck.checked;

      $$('.form-group', form).forEach((g) => g.classList.remove('is-invalid'));
      let valid = true;
      if (!name) {
        form.name.closest('.form-group').classList.add('is-invalid');
        valid = false;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        form.email.closest('.form-group').classList.add('is-invalid');
        valid = false;
      }
      if (!valid) return;
      if (bot) {
        /* honeypot: fake success */
        showOrderSuccess();
        return;
      }

      const lines = [];
      lines.push('New order request from ' + name);
      lines.push('Email: ' + email);
      if (instagram) lines.push('Instagram: ' + instagram);
      lines.push('');
      lines.push('Basket:');
      if (!basket.length) lines.push('  (empty; custom notes only)');
      basket.forEach((item) => {
        const p = productById(item.productId);
        if (!p) return;
        if (item.type === 'listing') {
          const l = (p.listings || []).find((x) => x.id === item.listingId);
          lines.push('  • ' + (l ? l.name : p.name) + ' [' + p.name + '] ready-to-ship');
        } else if (item.type === 'oneoff') {
          lines.push('  • ' + p.name + ' (one of a kind)');
        } else {
          lines.push('  • ' + p.name + ' ×' + (item.qty || 1) + ' (custom)');
        }
      });
      const { total, priced, unpriced } = estimate();
      if (priced > 0) lines.push('  Estimated total (ready-to-ship & priced items): $' + total);
      if (unpriced > 0) lines.push('  (+ ' + unpriced + ' custom item(s) to price together)');
      if (notes) {
        lines.push('');
        lines.push('Notes:');
        lines.push(notes);
      }
      const message = lines.join('\n');
      const submitBtn = $('submitBtn');
      const hint = $('formHint');
      const key = (s.web3formsKey || '').trim();

      if (key) {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Sending…';
        }
        try {
          const res = await fetch('https://api.web3forms.com/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              access_key: key,
              subject: 'Order request from ' + name,
              from_name: name,
              email: email,
              message: message,
            }),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok && json.success) {
            basket = [];
            saveBasket();
            showOrderSuccess();
          } else {
            if (hint) text(hint, 'Something hiccuped. Try again or DM on Instagram.');
          }
        } catch (err) {
          if (hint) text(hint, 'Network issue. Try again or DM on Instagram.');
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send My Order ✨';
        }
      } else if ((s.contactEmail || '').trim()) {
        const mailto =
          'mailto:' +
          encodeURIComponent(s.contactEmail.trim()) +
          '?subject=' +
          encodeURIComponent('Order request from ' + name) +
          '&body=' +
          encodeURIComponent(message);
        location.href = mailto;
        if (hint) text(hint, 'Your email app should open with the order. Just hit send.');
      } else {
        if (hint) text(hint, 'The order form is still being set up. Please DM on Instagram!');
      }
    });
  }
  function showOrderSuccess() {
    const form = $('orderForm');
    const success = $('formSuccess');
    const layout = document.querySelector('.order-layout');
    if (form) form.hidden = true;
    if (layout) layout.hidden = true;
    if (success) success.hidden = false;
  }

  /* ---------- review form (preserves Worker + Web3Forms) ---------- */
  function setupReviewForm() {
    const form = $('reviewForm');
    if (!form) return;
    let pickedStars = 5;
    $$('.star-pick', form).forEach((btn) => {
      btn.addEventListener('click', () => {
        pickedStars = parseInt(btn.getAttribute('data-stars'), 10) || 5;
        $$('.star-pick', form).forEach((b) => {
          const n = parseInt(b.getAttribute('data-stars'), 10);
          b.setAttribute('aria-pressed', n <= pickedStars ? 'true' : 'false');
          b.textContent = n <= pickedStars ? '★' : '☆';
        });
      });
    });

    if (localStorage.getItem('att-reviewed') === '1') {
      form.hidden = true;
      const thanks = $('reviewThanks');
      if (thanks) thanks.hidden = false;
      const again = $('reviewAgainBtn');
      if (again) again.hidden = false;
    }
    const againBtn = $('reviewAgainBtn');
    if (againBtn) {
      againBtn.addEventListener('click', () => {
        form.hidden = false;
        const thanks = $('reviewThanks');
        if (thanks) thanks.hidden = true;
        againBtn.hidden = true;
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const s = DATA.settings || {};
      const name = (form.reviewName && form.reviewName.value || '').trim();
      const textVal = (form.reviewText && form.reviewText.value || '').trim();
      const website = form.website && form.website.value;
      const hintEl = $('reviewHint');
      if (!name || !textVal) {
        if (hintEl) text(hintEl, 'Please add your name and a short note.');
        return;
      }
      if (website) {
        form.hidden = true;
        const thanks = $('reviewThanks');
        if (thanks) thanks.hidden = false;
        return;
      }
      const message =
        'NEW REVIEW 🌟\n\nStars: ' +
        '★'.repeat(pickedStars) +
        ' (' +
        pickedStars +
        '/5)\nName: ' +
        name +
        '\n\n' +
        textVal;
      const key = (s.web3formsKey || '').trim();
      const btn = $('reviewSubmitBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
      }

      const inboxUrl = (s.reviewInboxUrl || '').trim().replace(/\/+$/, '');
      let workerOk = false;
      if (inboxUrl) {
        try {
          const inboxRes = await fetch(inboxUrl + '/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, text: textVal, stars: pickedStars, website: '' }),
          });
          workerOk = inboxRes.ok;
        } catch (err) { /* network failure; fall through to email / mailto */ }
      }

      let emailed = false;
      if (key) {
        try {
          const res = await fetch('https://api.web3forms.com/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              access_key: key,
              subject: 'New review 🌟 from ' + name,
              from_name: name,
              message: message,
            }),
          });
          const json = await res.json().catch(() => ({}));
          emailed = res.ok && json.success;
        } catch (err) { /* fall through */ }
      }

      if (emailed || workerOk) {
        try {
          localStorage.setItem('att-reviewed', '1');
        } catch (e) { /* fine */ }
        form.hidden = true;
        const thanks = $('reviewThanks');
        if (thanks) thanks.hidden = false;
      } else if ((s.contactEmail || '').trim()) {
        location.href =
          'mailto:' +
          encodeURIComponent(s.contactEmail.trim()) +
          '?subject=' +
          encodeURIComponent('Review from ' + name) +
          '&body=' +
          encodeURIComponent(message);
        if (hintEl) text(hintEl, 'Your email app should open with your review. Just hit send.');
      } else {
        if (hintEl) text(hintEl, 'Please DM me on Instagram with your review!');
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Send My Review 💌';
      }
    });
  }

  /* ---------- page-specific: shop ---------- */
  function setupShopPage() {
    const grid = $('productsGrid');
    if (!grid) return;
    let currentFilter = 'all';
    let currentSort = 'featured';
    let currentSeason = 'all';
    let currentType = 'all';

    function seasonsInData() {
      const set = new Set();
      activeProducts.forEach((p) => {
        if (p.season) set.add(String(p.season).toLowerCase());
        (p.tags || []).forEach((t) => {
          if (/^(fall|winter|spring|summer|halloween|holiday|seasonal)/i.test(t)) {
            set.add(String(t).toLowerCase());
          }
        });
      });
      return Array.from(set).sort();
    }
    function typesInData() {
      const set = new Set();
      activeProducts.forEach((p) => {
        if (p.itemType) set.add(String(p.itemType));
        else {
          const n = (p.name || '').toLowerCase();
          if (/tote|bag/.test(n)) set.add('Bags');
          else if (/bookmark/.test(n)) set.add('Bookmarks');
          else if (/pouch/.test(n)) set.add('Pouches');
          else if (/coaster/.test(n)) set.add('Coasters');
          else if (/cape/.test(n)) set.add('Capes');
          else if (/pot holder|potholder/.test(n)) set.add('Kitchen');
          else if (/roll/.test(n)) set.add('Organizers');
          else if (/bundle/.test(n)) set.add('Bundles');
          else set.add('Other');
        }
      });
      return Array.from(set).sort();
    }

    function filtered() {
      let list = activeProducts.slice();
      if (currentFilter === 'ready') list = list.filter(isReady);
      if (currentFilter === 'custom') list = list.filter((p) => isCustomOnly(p) || (!isReady(p) && typeof p.price === 'number'));
      if (currentSeason !== 'all') {
        list = list.filter((p) => {
          const s = (p.season || '').toLowerCase();
          const tags = (p.tags || []).map((t) => String(t).toLowerCase());
          return s === currentSeason || tags.includes(currentSeason);
        });
      }
      if (currentType !== 'all') {
        list = list.filter((p) => {
          if (p.itemType) return p.itemType === currentType;
          const n = (p.name || '').toLowerCase();
          const map = {
            Bags: /tote|bag/,
            Bookmarks: /bookmark/,
            Pouches: /pouch/,
            Coasters: /coaster/,
            Capes: /cape/,
            Kitchen: /pot holder|potholder/,
            Organizers: /roll/,
            Bundles: /bundle/,
            Other: null,
          };
          const re = map[currentType];
          if (!re) {
            return !/tote|bag|bookmark|pouch|coaster|cape|pot holder|potholder|roll|bundle/.test(n);
          }
          return re.test(n);
        });
      }
      if (currentSort === 'price-asc') {
        list.sort((a, b) => (shownPrice(a) ?? 9999) - (shownPrice(b) ?? 9999));
      } else if (currentSort === 'price-desc') {
        list.sort((a, b) => (shownPrice(b) ?? -1) - (shownPrice(a) ?? -1));
      } else if (currentSort === 'name') {
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      }
      return list;
    }

    function render() {
      const list = filtered();
      const empty = $('gridEmpty');
      if (!list.length) {
        grid.innerHTML = '';
        if (empty) {
          empty.hidden = false;
        }
        return;
      }
      if (empty) empty.hidden = true;
      grid.innerHTML = list.map(productCardHtml).join('');
    }

    function syncUrl() {
      const u = new URL(location.href);
      if (currentFilter === 'all') u.searchParams.delete('filter');
      else u.searchParams.set('filter', currentFilter);
      if (currentSort === 'featured') u.searchParams.delete('sort');
      else u.searchParams.set('sort', currentSort);
      if (currentSeason === 'all') u.searchParams.delete('season');
      else u.searchParams.set('season', currentSeason);
      if (currentType === 'all') u.searchParams.delete('type');
      else u.searchParams.set('type', currentType);
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    }

    /* init from URL */
    currentFilter = params.get('filter') || 'all';
    currentSort = params.get('sort') || 'featured';
    currentSeason = params.get('season') || 'all';
    currentType = params.get('type') || 'all';

    $$('#filterChips .chip').forEach((chip) => {
      const f = chip.getAttribute('data-filter');
      chip.classList.toggle('active', f === currentFilter);
      chip.setAttribute('aria-pressed', f === currentFilter ? 'true' : 'false');
      chip.addEventListener('click', () => {
        currentFilter = f;
        $$('#filterChips .chip').forEach((c) => {
          const on = c.getAttribute('data-filter') === currentFilter;
          c.classList.toggle('active', on);
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        syncUrl();
        render();
      });
    });

    const sortEl = $('sortSelect');
    if (sortEl) {
      sortEl.value = currentSort;
      sortEl.addEventListener('change', () => {
        currentSort = sortEl.value;
        syncUrl();
        render();
      });
    }

    /* Season/type chips are data-driven, so (re)build them once products have
       loaded; building only at setup left permanently empty chip rows. The
       delegated click handlers below are bound once and survive rebuilds. */
    const seasonWrap = $('seasonChips');
    function buildSeasonChips() {
      if (!seasonWrap) return;
      const seasons = seasonsInData();
      if (!seasons.length) {
        seasonWrap.hidden = true;
        seasonWrap.innerHTML = '';
        return;
      }
      seasonWrap.hidden = false;
      seasonWrap.innerHTML =
        '<button type="button" class="chip' +
        (currentSeason === 'all' ? ' active' : '') +
        '" data-season="all" aria-pressed="' +
        (currentSeason === 'all') +
        '">All seasons</button>' +
        seasons
          .map(
            (s) =>
              '<button type="button" class="chip' +
              (currentSeason === s ? ' active' : '') +
              '" data-season="' +
              esc(s) +
              '" aria-pressed="' +
              (currentSeason === s) +
              '">' +
              esc(s) +
              '</button>'
          )
          .join('');
    }
    if (seasonWrap) {
      seasonWrap.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-season]');
        if (!btn) return;
        currentSeason = btn.getAttribute('data-season');
        $$('[data-season]', seasonWrap).forEach((c) => {
          const on = c.getAttribute('data-season') === currentSeason;
          c.classList.toggle('active', on);
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        syncUrl();
        render();
      });
    }

    const typeWrap = $('typeChips');
    function buildTypeChips() {
      if (!typeWrap) return;
      const types = typesInData();
      typeWrap.innerHTML =
        '<button type="button" class="chip' +
        (currentType === 'all' ? ' active' : '') +
        '" data-type="all" aria-pressed="' +
        (currentType === 'all') +
        '">All types</button>' +
        types
          .map(
            (t) =>
              '<button type="button" class="chip' +
              (currentType === t ? ' active' : '') +
              '" data-type="' +
              esc(t) +
              '" aria-pressed="' +
              (currentType === t) +
              '">' +
              esc(t) +
              '</button>'
          )
          .join('');
    }
    if (typeWrap) {
      typeWrap.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-type]');
        if (!btn) return;
        currentType = btn.getAttribute('data-type');
        $$('[data-type]', typeWrap).forEach((c) => {
          const on = c.getAttribute('data-type') === currentType;
          c.classList.toggle('active', on);
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        syncUrl();
        render();
      });
    }

    function renderAll() {
      buildSeasonChips();
      buildTypeChips();
      render();
    }
    document.addEventListener('att:ready', renderAll);
    if (activeProducts.length) renderAll();
  }

  /* ---------- page-specific: home featured ---------- */
  function setupHomePage() {
    const grid = $('featuredGrid');
    if (!grid) return;
    function render() {
      const featured = activeProducts.filter((p) => isReady(p) || (p.badges && p.badges.length)).slice(0, 6);
      const list = featured.length ? featured : activeProducts.slice(0, 6);
      grid.innerHTML = list.map(productCardHtml).join('');
    }
    document.addEventListener('att:ready', render);
    if (activeProducts.length) render();

    const rev = $('homeReviews');
    if (rev) {
      document.addEventListener('att:ready', () => {
        const shown = (DATA.reviews || []).filter((r) => r.show && (r.text || '').trim());
        if (!shown.length) {
          rev.hidden = true;
          return;
        }
        rev.hidden = false;
        const track = $('homeReviewList');
        if (track) {
          track.innerHTML = shown
            .map(
              (r) =>
                '<article class="review-card">' +
                '<div class="review-stars" aria-label="' +
                r.stars +
                ' out of 5 stars">' +
                '★'.repeat(r.stars || 5) +
                '</div>' +
                '<p class="review-text">' +
                esc(r.text) +
                '</p>' +
                '<div class="review-name">~ ' +
                esc(r.name || 'a happy customer') +
                '</div></article>'
            )
            .join('');
        }
      });
    }
  }

  /* ---------- page-specific: product detail ---------- */
  function setupProductPage() {
    const root = $('productRoot');
    if (!root) return;
    const productId = root.getAttribute('data-product-id');
    document.addEventListener('att:ready', () => {
      const p = productById(productId);
      if (!p) {
        root.innerHTML =
          '<p class="grid-empty">This piece isn’t on the shelves right now. <a href="' +
          esc(ROOT + 'shop/') +
          '">Browse the collection</a>.</p>';
        return;
      }
      /* enhance interactive bits that static HTML may already have */
      const addOne = $('addOneOffBtn');
      if (addOne) {
        addOne.addEventListener('click', () => addOneOff(p.id));
      }
      const addCustomBtn = $('addCustomBtn');
      if (addCustomBtn) {
        addCustomBtn.addEventListener('click', () => addCustom(p.id));
      }
      $$('[data-add-listing]').forEach((btn) => {
        btn.addEventListener('click', () => {
          addListing(p.id, btn.getAttribute('data-add-listing'));
        });
      });
      const mainImg = $('galleryMainImg');
      const thumbs = $$('[data-gallery-idx]');
      const imgs = allImages(p);
      thumbs.forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = parseInt(btn.getAttribute('data-gallery-idx'), 10);
          if (mainImg && imgs[i]) {
            mainImg.src = resolveImg(imgs[i]);
            thumbs.forEach((t) => t.setAttribute('aria-current', t === btn ? 'true' : 'false'));
          }
        });
      });
      if (mainImg) {
        mainImg.addEventListener('click', () => openLightbox(imgs, 0));
        mainImg.style.cursor = 'zoom-in';
      }
      /* Buy Now only when valid checkout URL */
      const buyWrap = $('buyNowWrap');
      const url = checkoutUrl(p);
      if (buyWrap && url && (p.oneOfAKind || unsoldListings(p).length > 0) && typeof p.price === 'number') {
        buyWrap.hidden = false;
        const link = $('buyNowLink');
        if (link) {
          link.href = url;
          link.rel = 'noopener noreferrer';
        }
      }
    });
  }

  /* ---------- page-specific: custom ---------- */
  function setupCustomPage() {
    const grid = $('customGrid');
    if (!grid) return;
    function render() {
      const list = activeProducts.filter((p) => !p.oneOfAKind);
      grid.innerHTML = list
        .map((p) => {
          return (
            '<a class="silhouette-card" href="' +
            esc(productHref(p)) +
            '">' +
            '<img src="' +
            esc(coverImg(p)) +
            '" alt="' +
            esc(p.name) +
            '" loading="lazy" width="400" height="400">' +
            '<div class="body"><h3>' +
            esc(p.name) +
            '</h3><p>' +
            (p.price === null
              ? 'Custom order'
              : 'From ' + (p.priceLabel || '$' + p.price) + ' · made to order available') +
            '</p></div></a>'
          );
        })
        .join('');
    }
    document.addEventListener('att:ready', render);
    if (activeProducts.length) render();
  }

  /* ---------- page-specific: about reviews ---------- */
  function setupAboutPage() {
    const list = $('aboutReviewList');
    if (!list) return;
    document.addEventListener('att:ready', () => {
      const shown = (DATA.reviews || []).filter((r) => r.show && (r.text || '').trim());
      const sec = $('aboutReviewsSection');
      if (!shown.length) {
        if (sec) sec.hidden = true;
        return;
      }
      if (sec) sec.hidden = false;
      list.innerHTML = shown
        .map(
          (r) =>
            '<article class="review-card">' +
            '<div class="review-stars">' +
            '★'.repeat(r.stars || 5) +
            '</div>' +
            '<p class="review-text">' +
            esc(r.text) +
            '</p>' +
            '<div class="review-name">~ ' +
            esc(r.name || 'a happy customer') +
            '</div></article>'
        )
        .join('');
    });
  }

  /* ---------- public API for generated product pages ---------- */
  window.ATT = {
    ROOT,
    productById,
    addListing,
    addOneOff,
    addCustom,
    openLightbox,
    coverImg,
    resolveImg,
    checkoutUrl,
    isReady,
    productCardHtml,
    getData: () => DATA,
    getActive: () => activeProducts,
  };

  /* boot page hooks after DOM ready (script is at end of body) */
  setupOrderForm();
  setupReviewForm();
  setupShopPage();
  setupHomePage();
  setupProductPage();
  setupCustomPage();
  setupAboutPage();

  /* ---------- cross-page anchor targets (e.g. /shop/#order) ----------
     The browser jumps to the hash before the product grid replaces its
     skeletons (and before web fonts settle), which strands the viewport
     in the wrong place. Re-scroll to the target once content has
     rendered. This listener is registered after the page setups above,
     so it runs after their att:ready renders. Skipped as soon as the
     visitor scrolls on their own. */
  let userInterrupted = false;
  ['wheel', 'touchstart', 'keydown'].forEach((ev) => {
    window.addEventListener(ev, () => { userInterrupted = true; }, { passive: true, once: true });
  });
  function scrollToHashTarget() {
    if (userInterrupted || !location.hash || location.hash.length < 2) return;
    let el = null;
    try {
      el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    } catch (e) { /* malformed hash */ }
    if (!el) return;
    /* scrollIntoView flushes layout synchronously, so no rAF needed.
       rAF callbacks can starve in backgrounded tabs. The html
       scroll-behavior is bypassed so the correction is an instant jump,
       and scroll-margin-top in the CSS keeps the target clear of the
       sticky header. */
    const root = document.documentElement;
    const prevBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    el.scrollIntoView({ block: 'start' });
    root.style.scrollBehavior = prevBehavior;
  }
  document.addEventListener('att:ready', () => {
    scrollToHashTarget();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(scrollToHashTarget);
    }
  });
})();
