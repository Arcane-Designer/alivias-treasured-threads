/* ============================================================
   ALIVIA'S TREASURED THREADS ~ site behavior
   Loads data/site.json, renders the shop, and runs the
   basket → order flow. No frameworks, no build step.
   ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const BASKET_KEY = 'att-basket-v2';
  const PLACEHOLDER_IMG = 'images/brand/logo.jpg';

  let DATA = { settings: {}, products: [] };
  let activeProducts = [];
  let basket = [];
  let currentFilter = 'all';

  /* ---------------- boot ---------------- */
  /* preview mode: Alivia's studio stashes draft data + photo previews locally */
  let previewData = null;
  if (new URLSearchParams(location.search).get('preview') === '1') {
    try { previewData = JSON.parse(localStorage.getItem('att-preview-data') || 'null'); } catch (e) { previewData = null; }
  }

  if (previewData) {
    showPreviewRibbon();
    init(previewData);
  } else {
    fetch('data/site.json?v=' + Date.now())
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(init)
      .catch((err) => {
        console.error('Could not load shop data', err);
        $('productsGrid').innerHTML = '';
        const msg = $('gridEmpty');
        msg.hidden = false;
        msg.textContent = 'Hmm, the shop shelves are being restocked ~ please refresh in a moment! 💜';
      });
  }

  function showPreviewRibbon() {
    const ribbon = document.createElement('div');
    ribbon.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#FF74D4;color:#fff;' +
      'font-weight:800;font-size:0.8rem;text-align:center;padding:6px 12px;letter-spacing:0.06em;box-shadow:0 2px 10px rgba(224,90,184,.4)';
    ribbon.textContent = '🧵 PREVIEW ~ this is how your shop will look once you publish!';
    document.body.appendChild(ribbon);
    document.querySelector('.site-header').style.top = '31px';
  }

  /* in preview mode, unpublished photos live in local storage as data URLs */
  function resolveImg(path) {
    if (previewData && previewData._previewImages && previewData._previewImages[path]) {
      return previewData._previewImages[path];
    }
    return path;
  }

  function init(data) {
    DATA = data;
    activeProducts = (data.products || []).filter((p) => !p.archived);

    applySettings(data.settings || {});
    basket = loadBasket();
    renderGrid();
    renderBasketUI();
    bindGlobalUI();
    handleDeepLink();
  }

  /* ---------------- settings ---------------- */
  function applySettings(s) {
    /* every editable text block: falls back to what's already in the HTML */
    const textFields = {
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
      modalOneOffText: s.oneOffNote,
    };
    Object.entries(textFields).forEach(([id, val]) => {
      if (val) $(id).textContent = val;
    });
    const ig = s.instagramUrl || '#';
    ['footerIg', 'aboutIg', 'successIg'].forEach((id) => { const el = $(id); if (el) el.href = ig; });
    $('footerYear').textContent = new Date().getFullYear();
  }

  /* ---------------- helpers ---------------- */
  function productById(id) { return DATA.products.find((p) => p.id === id); }
  function listingById(product, id) { return (product.listings || []).find((l) => l.id === id); }
  function unsoldListings(p) { return (p.listings || []).filter((l) => !l.sold); }
  function coverImg(p) { return resolveImg((p.images && p.images[0]) || PLACEHOLDER_IMG); }
  /* products may carry up to two badges; older data used a single `badge` string */
  function productBadges(p) {
    const list = Array.isArray(p.badges) ? p.badges : (p.badge ? [p.badge] : []);
    return list.filter(Boolean).slice(0, 2);
  }
  function isAvailabilityBadge(text) {
    const t = String(text || '').toLowerCase();
    return t.includes('in stock') || t.includes('almost gone');
  }

  /* ---- bundle (quantity) pricing ---- */
  function productTiers(p) {
    const t = (p.priceTiers || []).filter((x) => typeof x.price === 'number' && x.qty >= 1);
    return t.length ? t : null;
  }
  /* cheapest way to buy exactly n items using any mix of the tiers */
  function tierCost(tiers, n) {
    const cost = [0];
    for (let i = 1; i <= n; i++) {
      let best = Infinity;
      tiers.forEach((t) => {
        if (t.qty <= i && cost[i - t.qty] !== Infinity) best = Math.min(best, cost[i - t.qty] + t.price);
      });
      cost[i] = best;
    }
    return cost[n];
  }

  /* ---- sale pricing ---- */
  function isOnSale(p) {
    return !productTiers(p) && typeof p.price === 'number' && typeof p.salePrice === 'number' && p.salePrice < p.price;
  }
  function saleTag(p) { return p.saleLabel || ('$' + p.salePrice); }
  function effectivePrice(p) { return isOnSale(p) ? p.salePrice : p.price; }
  /* label for basket rows / order text */
  function shownPrice(p) {
    if (isOnSale(p)) return saleTag(p);
    const tiers = productTiers(p);
    if (tiers) {
      const one = tiers.find((t) => t.qty === 1);
      return one ? '$' + one.price + ' each' : 'bundle pricing';
    }
    return p.priceLabel || (typeof p.price === 'number' ? '$' + p.price : '');
  }
  /* struck-through old price + bold new price (safe HTML) */
  function priceHtml(p) {
    if (!isOnSale(p)) return esc(p.priceLabel || '');
    return '<s class="price-was">' + esc(p.priceLabel || ('$' + p.price)) + '</s> <span class="price-now">' + esc(saleTag(p)) + '</span>';
  }
  function esc(str) {
    return String(str == null ? '' : str)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function toast(msg, tone) {
    const zone = $('toastZone');
    const t = document.createElement('div');
    t.className = 'toast' + (tone ? ' ' + tone : '');
    t.textContent = msg;
    zone.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  /* ---------------- floating stars ---------------- */
  (function makeStars() {
    const holder = $('starsContainer');
    const starSVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41Z"/></svg>';
    const colors = ['#B8A9F0', '#FFB0E8', '#8FF0D6'];
    for (let i = 0; i < 16; i++) {
      const star = document.createElement('div');
      star.className = 'star';
      star.innerHTML = starSVG;
      star.style.cssText =
        'left:' + (Math.random() * 100) + '%;top:' + (Math.random() * 100) + '%;' +
        '--size:' + (8 + Math.random() * 13) + 'px;--dur:' + (3 + Math.random() * 5) + 's;' +
        '--delay:' + (Math.random() * 6) + 's;--max-opacity:' + (0.12 + Math.random() * 0.22) + ';' +
        'color:' + colors[i % 3];
      holder.appendChild(star);
    }
  })();

  /* ================================================
     PRODUCT GRID
     ================================================ */
  function filteredProducts() {
    if (currentFilter === 'ready') return activeProducts.filter((p) => p.oneOfAKind || unsoldListings(p).length > 0);
    if (currentFilter === 'custom') return activeProducts.filter((p) => p.price === null && !p.oneOfAKind);
    return activeProducts;
  }

  function renderGrid() {
    const grid = $('productsGrid');
    grid.innerHTML = '';
    const list = filteredProducts();
    $('gridEmpty').hidden = list.length > 0;

    list.forEach((product) => {
      const isOneOff = !!product.oneOfAKind;
      const stock = unsoldListings(product).length;
      const imgs = (product.images && product.images.length ? product.images : [PLACEHOLDER_IMG]).map(resolveImg);

      const card = document.createElement('article');
      card.className = 'product-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', 'View ' + product.name);

      card.innerHTML =
        '<div class="product-card-img-wrap">' +
          imgs.map((src, i) =>
            '<img class="' + (i === 0 ? 'active' : '') + '" src="' + esc(src) + '" alt="' + (i === 0 ? esc(product.name) : '') + '" loading="lazy" decoding="async"' + (i > 0 ? ' aria-hidden="true"' : '') + '>'
          ).join('') +
          '<div class="sticker-row">' +
            (function (badges) {
              /* a lone availability sticker keeps its classic spot: right side, green */
              const solo = badges.length === 1 && isAvailabilityBadge(badges[0]);
              return badges.map((b) => '<span class="sticker sticker-badge' + (solo ? ' avail-solo' : '') + '">' + esc(b) + '</span>').join('');
            })(productBadges(product)) +
          '</div>' +
        '</div>' +
        '<div class="product-card-info">' +
          '<div class="product-card-name">' + esc(product.name) + '</div>' +
          '<div class="product-card-price' + (product.price === null ? ' custom' : '') + (isOnSale(product) ? ' on-sale' : '') + '">' + priceHtml(product) + '</div>' +
          (isOneOff ? '<div class="product-card-meta">🌟 one of a kind</div>' :
            (stock > 0 ? '<div class="product-card-meta">✨ ' + stock + ' ready to ship</div>' : '')) +
        '</div>';

      /* on hover, gently shuffle through all of the product's photos */
      if (imgs.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const frames = card.querySelectorAll('.product-card-img-wrap img');
        let slideIdx = 0;
        let slideTimer = null;
        const show = (n) => frames.forEach((im, j) => im.classList.toggle('active', j === n));
        const step = () => { slideIdx = (slideIdx + 1) % frames.length; show(slideIdx); };
        card.addEventListener('mouseenter', () => {
          if (slideTimer) return;
          step(); /* switch right away so the hover feels alive… */
          slideTimer = setInterval(step, 2000); /* …then keep looping every 2s */
        });
        card.addEventListener('mouseleave', () => {
          clearInterval(slideTimer);
          slideTimer = null;
          slideIdx = 0;
          show(0);
        });
      }

      const open = () => openModal(product);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
      grid.appendChild(card);
    });
  }

  /* filter chips */
  document.querySelectorAll('#filterChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#filterChips .chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderGrid();
    });
  });

  /* ================================================
     PRODUCT MODAL
     ================================================ */
  const overlay = $('modalOverlay');
  let currentProduct = null;
  let currentSlide = 0;
  let lastFocus = null;

  function openModal(product) {
    currentProduct = product;
    currentSlide = 0;
    lastFocus = document.activeElement;

    $('modalName').textContent = product.name;
    const priceEl = $('modalPrice');
    priceEl.innerHTML = priceHtml(product);
    priceEl.className = 'modal-price' + (product.price === null ? ' custom' : '') + (isOnSale(product) ? ' sale' : '');
    $('modalDesc').textContent = product.description || '';

    /* optional link under the description (e.g. a collab shout-out) */
    const linkWrap = $('modalDescLink');
    if (product.descriptionLink && product.descriptionLink.url) {
      const a = linkWrap.querySelector('a');
      a.href = product.descriptionLink.url;
      a.textContent = (product.descriptionLink.text || 'Learn more') + ' →';
      linkWrap.hidden = false;
    } else {
      linkWrap.hidden = true;
    }
    $('modalCustomText').textContent = product.price === null
      ? "This one is made just for you! Tell me your favorite colors or fabrics and I'll stitch up something special."
      : "Want this in a different fabric or style? Custom orders take a bit longer but I'll make it just for you!";

    buildGallery(product);
    buildListings(product);
    refreshOneOffUI(product);

    $('modalCustomAdd').onclick = (e) => addCustomToBasket(product.id, e);
    $('modalOneOffAdd').onclick = (e) => toggleOneOffInBasket(product.id, e);

    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('active'));
    document.body.style.overflow = 'hidden';
    history.replaceState(null, '', '#p-' + product.id);
    $('modalClose').focus({ preventScroll: true });
  }

  function closeModal() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    setTimeout(() => { overlay.hidden = true; }, 280);
    history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  $('modalClose').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  /* --- gallery --- */
  function buildGallery(product) {
    const track = $('galleryTrack');
    const dots = $('galleryDots');
    track.innerHTML = '';
    dots.innerHTML = '';

    const imgs = (product.images && product.images.length ? product.images : [PLACEHOLDER_IMG]).map(resolveImg);
    imgs.forEach((src, i) => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = product.name + ' photo ' + (i + 1);
      img.loading = i === 0 ? 'eager' : 'lazy';
      if (i === 0) img.classList.add('active');
      /* open the photo that's showing right now (the stacked images all sit
         on top of each other, so trusting `i` here opens the wrong one) */
      img.addEventListener('click', () => openLightbox(imgs, currentSlide, product.name));
      track.appendChild(img);

      const dot = document.createElement('button');
      dot.className = 'gallery-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', 'View photo ' + (i + 1));
      dot.addEventListener('click', (e) => { e.stopPropagation(); goToSlide(i); });
      dots.appendChild(dot);
    });

    $('galleryBackdrop').src = imgs[0];

    const multi = imgs.length > 1;
    $('galleryPrev').style.display = multi ? '' : 'none';
    $('galleryNext').style.display = multi ? '' : 'none';
    dots.style.display = multi ? '' : 'none';
  }

  function galleryImgs() { return $('galleryTrack').querySelectorAll('img'); }

  function goToSlide(index) {
    const imgs = galleryImgs();
    if (!imgs.length) return;
    currentSlide = (index + imgs.length) % imgs.length;
    imgs.forEach((im, i) => im.classList.toggle('active', i === currentSlide));
    $('galleryBackdrop').src = imgs[currentSlide].src;
    $('galleryDots').querySelectorAll('.gallery-dot').forEach((d, i) => d.classList.toggle('active', i === currentSlide));
  }

  $('galleryPrev').addEventListener('click', (e) => { e.stopPropagation(); goToSlide(currentSlide - 1); });
  $('galleryNext').addEventListener('click', (e) => { e.stopPropagation(); goToSlide(currentSlide + 1); });

  /* swipe */
  let touchX = 0;
  $('modalGallery').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('modalGallery').addEventListener('touchend', (e) => {
    const diff = touchX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 42) goToSlide(currentSlide + (diff > 0 ? 1 : -1));
  }, { passive: true });

  /* --- listings inside modal --- */
  /* one-of-a-kind products: the product itself is the listing */
  function refreshOneOffUI(product) {
    const isOneOff = !!product.oneOfAKind;
    $('modalCustomCta').hidden = isOneOff;
    $('modalOneOff').hidden = !isOneOff;
    if (!isOneOff) return;
    const inBasket = basket.some((b) => b.type === 'oneoff' && b.productId === product.id);
    const btn = $('modalOneOffAdd');
    btn.classList.toggle('btn-pink', !inBasket);
    btn.classList.toggle('btn-teal', inBasket);
    btn.textContent = inBasket ? '💜 In your basket! (tap to remove)' : '♡ Add to my basket';
  }

  function buildListings(product) {
    const wrap = $('modalAvailable');
    const grid = $('modalAvailableGrid');
    const listings = product.oneOfAKind ? [] : (product.listings || []);
    if (!listings.length) { wrap.hidden = true; return; }

    wrap.hidden = false;
    grid.innerHTML = '';

    /* unsold first, sold at the end */
    const sorted = [...listings].sort((a, b) => (a.sold === b.sold ? 0 : a.sold ? 1 : -1));

    sorted.forEach((listing) => {
      const inBasket = basket.some((b) => b.type === 'listing' && b.listingId === listing.id);
      const imgs = (listing.images && listing.images.length ? listing.images : [PLACEHOLDER_IMG]).map(resolveImg);

      const el = document.createElement('div');
      el.className = 'available-item' + (listing.sold ? ' is-sold' : '') + (inBasket ? ' in-basket' : '');
      el.innerHTML =
        '<button type="button" class="img-btn" aria-label="View photos of ' + esc(listing.name) + '">' +
          '<img src="' + esc(imgs[0]) + '" alt="' + esc(listing.name) + '" loading="lazy" decoding="async">' +
          (listing.sold ? '<span class="sticker sticker-sold">Sold</span>' : '') +
          (imgs.length > 1 ? '<span class="sticker sticker-stock" style="top:auto;bottom:8px;left:8px;right:auto;transform:rotate(-2deg)">+' + (imgs.length - 1) + ' 📷</span>' : '') +
        '</button>' +
        '<div class="available-item-name">' + esc(listing.name) + '</div>' +
        (listing.sold ? '' :
          '<button type="button" class="heart-btn' + (inBasket ? ' added' : '') + '">' +
            '<span class="hb-ico">' + (inBasket ? '💜' : '♡') + '</span>' +
            '<span class="hb-txt">' + (inBasket ? 'In your basket!' : 'Add to basket') + '</span>' +
          '</button>');

      el.querySelector('.img-btn').addEventListener('click', () => openLightbox(imgs, 0, listing.name));
      const heart = el.querySelector('.heart-btn');
      if (heart) heart.addEventListener('click', (e) => toggleListingInBasket(product.id, listing.id, e));
      grid.appendChild(el);
    });
  }

  /* re-render modal hearts + one-off button without rebuilding everything */
  function refreshModalListings() {
    if (currentProduct && !overlay.hidden) {
      buildListings(currentProduct);
      refreshOneOffUI(currentProduct);
    }
  }

  /* ================================================
     LIGHTBOX
     ================================================ */
  const lightbox = $('lightbox');
  const lightboxImg = $('lightboxImg');
  let lbImgs = [];
  let lbIndex = 0;

  function openLightbox(imgs, index, label) {
    lbImgs = imgs;
    lbIndex = index;
    showLbImage(label);
    lightbox.hidden = false;
    requestAnimationFrame(() => lightbox.classList.add('active'));
    const multi = imgs.length > 1;
    $('lightboxPrev').style.display = multi ? '' : 'none';
    $('lightboxNext').style.display = multi ? '' : 'none';
  }

  function showLbImage(label) {
    lightboxImg.classList.remove('zoomed');
    lightboxImg.style.transformOrigin = '';
    lightboxImg.src = lbImgs[lbIndex];
    lightboxImg.alt = (label || 'Photo') + ' ' + (lbIndex + 1);
    $('lightboxCount').textContent = lbImgs.length > 1 ? (lbIndex + 1) + ' / ' + lbImgs.length : '';
  }

  function closeLightbox() {
    lightbox.classList.remove('active');
    setTimeout(() => { lightbox.hidden = true; }, 240);
  }

  $('lightboxClose').addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
  $('lightboxPrev').addEventListener('click', () => { lbIndex = (lbIndex - 1 + lbImgs.length) % lbImgs.length; showLbImage(); });
  $('lightboxNext').addEventListener('click', () => { lbIndex = (lbIndex + 1) % lbImgs.length; showLbImage(); });

  lightboxImg.addEventListener('click', (e) => {
    const zoomIn = !lightboxImg.classList.contains('zoomed');
    if (zoomIn) {
      const rect = lightboxImg.getBoundingClientRect();
      const ox = ((e.clientX - rect.left) / rect.width) * 100;
      const oy = ((e.clientY - rect.top) / rect.height) * 100;
      lightboxImg.style.transformOrigin = ox + '% ' + oy + '%';
    }
    lightboxImg.classList.toggle('zoomed', zoomIn);
  });

  let lbTouchX = 0;
  lightbox.addEventListener('touchstart', (e) => { lbTouchX = e.touches[0].clientX; }, { passive: true });
  lightbox.addEventListener('touchend', (e) => {
    if (lightboxImg.classList.contains('zoomed')) return;
    const diff = lbTouchX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 42 && lbImgs.length > 1) {
      lbIndex = (lbIndex + (diff > 0 ? 1 : -1) + lbImgs.length) % lbImgs.length;
      showLbImage();
    }
  }, { passive: true });

  /* ================================================
     BASKET
     ================================================ */
  function loadBasket() {
    let stored = [];
    try { stored = JSON.parse(localStorage.getItem(BASKET_KEY) || '[]'); } catch (e) { stored = []; }
    if (!Array.isArray(stored)) stored = [];

    /* validate against current data */
    let dropped = 0;
    const valid = stored.filter((item) => {
      const p = productById(item.productId);
      if (!p || p.archived) { dropped++; return false; }
      if (item.type === 'listing') {
        const l = listingById(p, item.listingId);
        if (!l || l.sold) { dropped++; return false; }
      }
      if (item.type === 'oneoff' && !p.oneOfAKind) { dropped++; return false; }
      return true;
    });
    if (dropped > 0) toast('Some treasures in your basket were snapped up ~ sorry! 💜', 'pink');
    return valid;
  }

  function saveBasket() {
    try { localStorage.setItem(BASKET_KEY, JSON.stringify(basket)); } catch (e) { /* private mode ~ basket lives for the session only */ }
  }

  function basketCount() {
    return basket.reduce((n, item) => n + (item.type === 'custom' ? (item.qty || 1) : 1), 0);
  }

  function basketChanged() {
    saveBasket();
    renderBasketUI();
    refreshModalListings();
  }

  function toggleListingInBasket(productId, listingId, e) {
    const idx = basket.findIndex((b) => b.type === 'listing' && b.listingId === listingId);
    if (idx >= 0) {
      basket.splice(idx, 1);
      basketChanged();
      toast('Okay, popped it back on the shelf!');
    } else {
      basket.push({ type: 'listing', productId, listingId });
      basketChanged();
      bumpFab();
      if (e) flyStar(e.clientX, e.clientY);
      toast('Added to your basket! 💜', 'teal');
    }
  }

  function toggleOneOffInBasket(productId, e) {
    const idx = basket.findIndex((b) => b.type === 'oneoff' && b.productId === productId);
    if (idx >= 0) {
      basket.splice(idx, 1);
      basketChanged();
      toast('Okay, popped it back on the shelf!');
    } else {
      basket.push({ type: 'oneoff', productId });
      basketChanged();
      bumpFab();
      if (e) flyStar(e.clientX, e.clientY);
      toast('Added to your basket! 💜', 'teal');
    }
  }

  function addCustomToBasket(productId, e) {
    const existing = basket.find((b) => b.type === 'custom' && b.productId === productId);
    if (existing) existing.qty = Math.min((existing.qty || 1) + 1, 9);
    else basket.push({ type: 'custom', productId, qty: 1 });
    basketChanged();
    bumpFab();
    if (e) flyStar(e.clientX, e.clientY);
    toast('Custom request added! 🧵', 'teal');
  }

  function removeBasketItem(index) {
    basket.splice(index, 1);
    basketChanged();
  }

  function changeQty(index, delta) {
    const item = basket[index];
    if (!item || item.type !== 'custom') return;
    const next = (item.qty || 1) + delta;
    if (next <= 0) basket.splice(index, 1);
    else item.qty = Math.min(next, 9);
    basketChanged();
  }

  function basketEstimate() {
    let total = 0, priced = 0, unpriced = 0, bundleSaved = false;
    /* count everything per product so bundle deals apply across the whole basket */
    const perProduct = {};
    basket.forEach((item) => {
      const qty = item.type === 'custom' ? (item.qty || 1) : 1;
      perProduct[item.productId] = (perProduct[item.productId] || 0) + qty;
    });
    Object.entries(perProduct).forEach(([pid, count]) => {
      const p = productById(pid);
      if (!p) return;
      const tiers = productTiers(p);
      if (tiers) {
        const c = tierCost(tiers, count);
        if (isFinite(c)) {
          total += c;
          priced += count;
          const one = tiers.find((t) => t.qty === 1);
          if (one && c < one.price * count) bundleSaved = true;
          return;
        }
      }
      const unit = effectivePrice(p);
      if (typeof unit === 'number') { total += unit * count; priced += count; }
      else unpriced += count;
    });
    return { total: +total.toFixed(2), priced, unpriced, bundleSaved };
  }

  /* --- flying star + fab bump --- */
  function flyStar(x, y) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const star = document.createElement('span');
    star.className = 'fly-star';
    star.textContent = '✨';
    star.style.left = (x - 10) + 'px';
    star.style.top = (y - 10) + 'px';
    document.body.appendChild(star);
    const fab = $('basketFab');
    const target = fab.getBoundingClientRect();
    requestAnimationFrame(() => {
      const dx = (target.left + target.width / 2) - x;
      const dy = (target.top + target.height / 2) - y;
      star.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(0.3) rotate(180deg)';
      star.style.opacity = '0';
    });
    setTimeout(() => star.remove(), 700);
  }

  function bumpFab() {
    const fab = $('basketFab');
    fab.classList.remove('bump');
    void fab.offsetWidth;
    fab.classList.add('bump');
  }

  /* --- render basket everywhere --- */
  function basketItemHTML(item, index) {
    const p = productById(item.productId);
    if (!p) return '';
    if (item.type === 'listing') {
      const l = listingById(p, item.listingId);
      if (!l) return '';
      const img = (l.images && l.images[0]) ? resolveImg(l.images[0]) : coverImg(p);
      return '<div class="basket-item" data-index="' + index + '">' +
        '<img src="' + esc(img) + '" alt="">' +
        '<div><div class="bi-name">' + esc(l.name) + '</div>' +
        '<div class="bi-sub">' + esc(p.name) + ' · ready to ship' + (typeof p.price === 'number' ? ' · ' + esc(shownPrice(p)) + (isOnSale(p) ? ' 💸' : '') : '') + '</div></div>' +
        '<div class="bi-actions"><button type="button" class="bi-remove" aria-label="Remove ' + esc(l.name) + '">✕</button></div>' +
        '</div>';
    }
    if (item.type === 'oneoff') {
      return '<div class="basket-item" data-index="' + index + '">' +
        '<img src="' + esc(coverImg(p)) + '" alt="">' +
        '<div><div class="bi-name">' + esc(p.name) + '</div>' +
        '<div class="bi-sub">🌟 one of a kind · ready to ship' + (typeof p.price === 'number' ? ' · ' + esc(shownPrice(p)) + (isOnSale(p) ? ' 💸' : '') : '') + '</div></div>' +
        '<div class="bi-actions"><button type="button" class="bi-remove" aria-label="Remove ' + esc(p.name) + '">✕</button></div>' +
        '</div>';
    }
    /* custom */
    const qty = item.qty || 1;
    return '<div class="basket-item" data-index="' + index + '">' +
      '<img src="' + esc(coverImg(p)) + '" alt="">' +
      '<div><div class="bi-name">Custom ' + esc(p.name) + '</div>' +
      '<div class="bi-sub custom">made just for you' + (typeof p.price === 'number' ? ' · ' + esc(shownPrice(p)) + ' each' : ' · priced when we chat') + '</div></div>' +
      '<div class="bi-actions">' +
        '<button type="button" class="bi-remove" aria-label="Remove custom ' + esc(p.name) + '">✕</button>' +
        '<div class="bi-qty"><button type="button" class="q-minus" aria-label="One less">−</button><span class="q">' + qty + '</span><button type="button" class="q-plus" aria-label="One more">+</button></div>' +
      '</div></div>';
  }

  function bindBasketItemEvents(container) {
    container.querySelectorAll('.basket-item').forEach((row) => {
      const index = parseInt(row.dataset.index, 10);
      const rm = row.querySelector('.bi-remove');
      if (rm) rm.addEventListener('click', () => removeBasketItem(index));
      const minus = row.querySelector('.q-minus');
      const plus = row.querySelector('.q-plus');
      if (minus) minus.addEventListener('click', () => changeQty(index, -1));
      if (plus) plus.addEventListener('click', () => changeQty(index, 1));
    });
  }

  function estimateHTML() {
    const { total, priced, unpriced, bundleSaved } = basketEstimate();
    if (basket.length === 0) return '';
    let html = '';
    if (priced > 0) html += 'Estimated total: <strong>$' + total + '</strong>';
    if (bundleSaved) html += ' <span class="est-note-inline">~ bundle deal applied! 🧮✨</span>';
    if (unpriced > 0) html += '<span class="est-note">' + (priced > 0 ? '+ ' : '') + unpriced + ' custom item' + (unpriced > 1 ? 's' : '') + ' priced when we chat 💬</span>';
    return html;
  }

  function renderBasketUI() {
    const count = basketCount();

    /* FAB */
    const fab = $('basketFab');
    fab.hidden = count === 0;
    $('basketCount').textContent = count;

    /* drawer */
    const drawerItems = $('drawerItems');
    drawerItems.innerHTML = basket.map(basketItemHTML).join('');
    bindBasketItemEvents(drawerItems);
    $('drawerEmpty').style.display = count === 0 ? '' : 'none';
    $('drawerEstimate').innerHTML = estimateHTML();
    $('drawerCheckout').style.display = count === 0 ? 'none' : '';

    /* order section panel */
    const orderList = $('orderBasketList');
    orderList.innerHTML = basket.map(basketItemHTML).join('');
    bindBasketItemEvents(orderList);
    $('basketEmptyMsg').style.display = count === 0 ? '' : 'none';
    const est = $('basketEstimate');
    est.hidden = count === 0;
    est.innerHTML = estimateHTML();
  }

  /* --- drawer open/close --- */
  const drawer = $('basketDrawer');
  const drawerOverlay = $('drawerOverlay');

  function openDrawer() {
    drawer.hidden = false;
    drawerOverlay.hidden = false;
    requestAnimationFrame(() => {
      drawer.classList.add('active');
      drawerOverlay.classList.add('active');
    });
    document.body.style.overflow = 'hidden';
    $('drawerClose').focus({ preventScroll: true });
  }

  function closeDrawer() {
    drawer.classList.remove('active');
    drawerOverlay.classList.remove('active');
    document.body.style.overflow = '';
    setTimeout(() => { drawer.hidden = true; drawerOverlay.hidden = true; }, 380);
  }

  $('basketFab').addEventListener('click', openDrawer);
  $('drawerClose').addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);
  $('drawerCheckout').addEventListener('click', () => closeDrawer());

  /* ================================================
     CUSTOM REQUEST PICKER (order section)
     ================================================ */
  /* a hand-stitched dropdown (with product photos!) instead of the browser's plain one */
  function buildProductPicker() {
    let value = '';
    const wrap = document.createElement('div');
    wrap.className = 'cute-select';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cute-select-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML =
      '<span class="css-label placeholder">What should I make you?</span>' +
      '<svg class="css-arrow" width="14" height="9" viewBox="0 0 14 9" aria-hidden="true"><path d="M1.5 1.5 L7 7 L12.5 1.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 2.4"/></svg>';

    const panel = document.createElement('div');
    panel.className = 'cute-select-panel';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', 'Choose a product for a custom request');
    panel.hidden = true;

    function open() {
      panel.hidden = false;
      requestAnimationFrame(() => panel.classList.add('open'));
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      panel.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      setTimeout(() => { panel.hidden = true; }, 180);
    }

    /* one-of-a-kind items can't be custom ordered ~ they're the one and only */
    activeProducts.filter((p) => !p.oneOfAKind).forEach((p) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'cute-option';
      opt.setAttribute('role', 'option');
      opt.innerHTML =
        '<img src="' + esc(coverImg(p)) + '" alt="" loading="lazy">' +
        '<span class="co-name">' + esc(p.name) + '</span>' +
        '<span class="co-price' + (p.price === null ? ' custom' : '') + '">' + priceHtml(p) + '</span>';
      opt.addEventListener('click', () => {
        value = p.id;
        const label = btn.querySelector('.css-label');
        label.textContent = p.name;
        label.classList.remove('placeholder');
        panel.querySelectorAll('.cute-option').forEach((o) => o.classList.toggle('selected', o === opt));
        close();
        btn.focus();
      });
      panel.appendChild(opt);
    });

    btn.addEventListener('click', () => (panel.hidden ? open() : close()));

    const outside = (e) => {
      if (!wrap.isConnected) { document.removeEventListener('click', outside); return; }
      if (!wrap.contains(e.target) && !panel.hidden) close();
    };
    document.addEventListener('click', outside);

    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) {
        e.stopPropagation();
        close();
        btn.focus();
        return;
      }
      if (e.key === 'ArrowDown' && panel.hidden && document.activeElement === btn) {
        e.preventDefault();
        open();
        setTimeout(() => panel.querySelector('.cute-option').focus(), 60);
        return;
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !panel.hidden) {
        e.preventDefault();
        const opts = [...panel.querySelectorAll('.cute-option')];
        const i = opts.indexOf(document.activeElement);
        opts[e.key === 'ArrowDown' ? Math.min(i + 1, opts.length - 1) : Math.max(i - 1, 0)].focus();
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    return { el: wrap, get value() { return value; }, focus: () => btn.focus() };
  }

  $('addCustomBtn').addEventListener('click', function () {
    if (document.querySelector('.custom-add-row')) return;
    const row = document.createElement('div');
    row.className = 'custom-add-row';

    const picker = buildProductPicker();

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-purple btn-small';
    add.textContent = 'Add 🧵';
    add.addEventListener('click', (e) => {
      if (!picker.value) { picker.focus(); return; }
      addCustomToBasket(picker.value, e);
      row.remove();
    });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-outline btn-small';
    cancel.textContent = '✕';
    cancel.setAttribute('aria-label', 'Never mind');
    cancel.addEventListener('click', () => row.remove());

    row.appendChild(picker.el);
    row.appendChild(add);
    row.appendChild(cancel);
    this.after(row);
    picker.focus();
  });

  /* ================================================
     ORDER FORM
     ================================================ */
  const form = $('orderForm');
  const hint = $('formHint');

  function setFieldError(id, show) {
    const input = $(id);
    const err = document.querySelector('.field-error[data-for="' + id + '"]');
    input.classList.toggle('invalid', show);
    if (err) err.classList.toggle('show', show);
  }

  ['name', 'email'].forEach((id) => {
    $(id).addEventListener('input', () => setFieldError(id, false));
  });

  function buildOrderMessage() {
    const lines = [];
    lines.push('NEW ORDER REQUEST 🧵✨');
    lines.push('');
    if (basket.length) {
      lines.push('Items:');
      basket.forEach((item, i) => {
        const p = productById(item.productId);
        if (!p) return;
        const priceNote = isOnSale(p)
          ? ' ~ SALE ' + saleTag(p) + ' (was ' + (p.priceLabel || '$' + p.price) + ')'
          : (p.priceLabel ? ' ~ ' + p.priceLabel : '');
        if (item.type === 'listing') {
          const l = listingById(p, item.listingId);
          lines.push('  ' + (i + 1) + '. ' + (l ? l.name : '?') + ' ~ ' + p.name + ' (Ready to Ship)' + priceNote);
        } else if (item.type === 'oneoff') {
          lines.push('  ' + (i + 1) + '. ' + p.name + ' (One of a Kind ~ Ready to Ship)' + priceNote);
        } else {
          lines.push('  ' + (i + 1) + '. CUSTOM ' + p.name + ' × ' + (item.qty || 1) + priceNote);
        }
      });
      const { total, priced, unpriced } = basketEstimate();
      if (priced > 0) lines.push('  Estimated total (ready-to-ship & priced items): $' + total);
      if (unpriced > 0) lines.push('  (+ ' + unpriced + ' custom item(s) to price together)');
    } else {
      lines.push('Items: (no items picked ~ see notes)');
    }
    lines.push('');
    lines.push('Name: ' + $('name').value.trim());
    lines.push('Email: ' + $('email').value.trim());
    lines.push('Phone: ' + ($('phone').value.trim() || '~'));
    const notes = $('notes').value.trim();
    lines.push('');
    lines.push('Notes:');
    lines.push(notes || '~');
    return lines.join('\n');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hint.textContent = '';
    hint.classList.remove('error');

    /* validate */
    let ok = true;
    if (!$('name').value.trim()) { setFieldError('name', true); ok = false; }
    const email = $('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFieldError('email', true); ok = false; }
    if (!ok) {
      hint.textContent = 'Almost there ~ check the fields above! 💜';
      hint.classList.add('error');
      return;
    }
    if (basket.length === 0 && !$('notes').value.trim()) {
      hint.textContent = 'Pick something from the collection (or tell me your idea in the notes) first! 🧺';
      hint.classList.add('error');
      return;
    }

    const s = DATA.settings || {};
    const message = buildOrderMessage();
    const submitBtn = $('submitBtn');

    /* Web3Forms configured? */
    const key = (s.web3formsKey || '').trim();
    const hasKey = key && !/YOUR_ACCESS_KEY/i.test(key);

    if (hasKey) {
      submitBtn.disabled = true;
      submitBtn.classList.add('sending');
      submitBtn.textContent = 'Sending… 🪡';
      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            access_key: key,
            subject: 'New Order ~ ' + $('name').value.trim(),
            from_name: "Alivia's Treasured Threads Website",
            name: $('name').value.trim(),
            email: email,
            phone: $('phone').value.trim(),
            message: message,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.success !== false) {
          showSuccess();
        } else { throw new Error(json.message || 'send failed'); }
      } catch (err) {
        console.error(err);
        hint.textContent = "Hmm, that didn't send. Please try again ~ or DM me on Instagram! 💌";
        hint.classList.add('error');
        submitBtn.disabled = false;
        submitBtn.classList.remove('sending');
        submitBtn.textContent = 'Send My Order ✨';
      }
      return;
    }

    /* fallback: open the visitor's email app pre-filled */
    const to = (s.contactEmail || '').trim();
    if (to && !/example\.com$/i.test(to)) {
      const subject = encodeURIComponent("Order request ~ Alivia's Treasured Threads");
      const body = encodeURIComponent(message);
      window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + body;
      hint.textContent = 'Your email app should pop open with everything filled in ~ just hit send! 💌';
    } else {
      hint.textContent = 'The order form is still being set up ~ please DM me on Instagram and I\'ll get you sorted! 💌';
      hint.classList.add('error');
    }
  });

  function showSuccess() {
    form.style.display = 'none';
    document.querySelector('.order-basket-panel').style.display = 'none';
    document.querySelector('.form-intro').style.display = 'none';
    const success = $('formSuccess');
    success.classList.add('show');
    makeConfetti();
    basket = [];
    saveBasket();
    renderBasketUI();
    success.scrollIntoView({ behavior: 'smooth', block: 'center' });
    success.focus({ preventScroll: true });
  }

  function makeConfetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const holder = $('confetti');
    const colors = ['#8E79DD', '#4FE4BC', '#FF74D4', '#FFB0E8', '#B8A9F0', '#8FF0D6'];
    for (let i = 0; i < 28; i++) {
      const c = document.createElement('span');
      c.style.left = (4 + Math.random() * 92) + '%';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--cd', (Math.random() * 0.55) + 's');
      c.style.setProperty('--cx', (Math.random() * 160 - 80) + 'px');
      holder.appendChild(c);
    }
  }

  /* ================================================
     GLOBAL UI
     ================================================ */
  function bindGlobalUI() {
    /* scroll top */
    const scrollTopBtn = $('scrollTop');
    window.addEventListener('scroll', () => {
      scrollTopBtn.classList.toggle('show', window.scrollY > 500);
    }, { passive: true });
    scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    /* keyboard: esc closes topmost layer, arrows steer galleries */
    document.addEventListener('keydown', (e) => {
      const lbOpen = !lightbox.hidden;
      const drawerOpen = !drawer.hidden;
      const modalOpen = !overlay.hidden;

      if (e.key === 'Escape') {
        if (lbOpen) closeLightbox();
        else if (drawerOpen) closeDrawer();
        else if (modalOpen) closeModal();
        return;
      }
      if (lbOpen && lbImgs.length > 1) {
        if (e.key === 'ArrowLeft') { lbIndex = (lbIndex - 1 + lbImgs.length) % lbImgs.length; showLbImage(); }
        if (e.key === 'ArrowRight') { lbIndex = (lbIndex + 1) % lbImgs.length; showLbImage(); }
        return;
      }
      if (modalOpen) {
        if (e.key === 'ArrowLeft') goToSlide(currentSlide - 1);
        if (e.key === 'ArrowRight') goToSlide(currentSlide + 1);
      }
    });

    /* focus trap for dialogs */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const container = !lightbox.hidden ? lightbox : (!drawer.hidden ? drawer : (!overlay.hidden ? $('modal') : null));
      if (!container) return;
      const focusables = container.querySelectorAll('button, a[href], select, input, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* deep link: #p-<productId> opens that product */
  function handleDeepLink() {
    const m = location.hash.match(/^#p-(.+)$/);
    if (!m) return;
    const product = activeProducts.find((p) => p.id === decodeURIComponent(m[1]));
    if (product) setTimeout(() => openModal(product), 250);
  }
})();
