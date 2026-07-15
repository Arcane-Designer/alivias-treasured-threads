/* ============================================================
   ALIVIA'S STUDIO ~ admin behavior
   Talks straight to the GitHub API: reads data/site.json,
   and publishes edits + new photos as a single commit to main.
   GitHub Pages then redeploys the shop automatically.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- config ---------------- */
  const GH_OWNER = 'Arcane-Designer';
  const GH_REPO = 'alivias-treasured-threads';
  /* normally 'main' ~ a localStorage override exists so future testing can
     publish to a scratch branch without touching the live shop */
  const GH_BRANCH = localStorage.getItem('att-studio-branch') || 'main';
  const DATA_PATH = 'data/site.json';
  const UPLOAD_DIR = 'images/uploads';
  const TOKEN_KEY = 'att-studio-token';
  const DRAFT_KEY = 'att-studio-draft-v1';
  const PREVIEW_KEY = 'att-preview-data';
  const MAX_IMG_EDGE = 1400;
  const JPEG_QUALITY = 0.82;

  const $ = (id) => document.getElementById(id);

  /* ---------------- state ---------------- */
  let token = null;
  let draft = null;                 /* working copy of {settings, products} */
  let publishedSnapshot = '';       /* JSON string of what's live */
  let pendingImages = {};           /* path -> {base64, dataUrl} (not yet on GitHub) */
  let currentProduct = null;        /* product object being edited (reference into draft) */
  let editorWasNew = false;
  let expandedListingId = null;
  let stagedListingPhotos = [];     /* photos picked for a not-yet-added listing */
  let warnedQuota = false;
  let saveTimer = null;

  /* ================================================
     tiny helpers
     ================================================ */
  function esc(str) {
    return String(str == null ? '' : str)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function slug(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function toast(msg, tone) {
    const t = document.createElement('div');
    t.className = 'toast' + (tone ? ' ' + tone : '');
    t.textContent = msg;
    $('toastZone').appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function imgSrc(path) {
    if (!path) return '';
    if (pendingImages[path]) return pendingImages[path].dataUrl;
    return '../' + path;
  }

  function confirmCute(msg, yesLabel, noLabel) {
    return new Promise((resolve) => {
      $('confirmMsg').textContent = msg;
      $('confirmYes').textContent = yesLabel || 'Yes, do it';
      $('confirmNo').textContent = noLabel || 'Never mind';
      $('confirmOverlay').hidden = false;
      const done = (answer) => {
        $('confirmOverlay').hidden = true;
        $('confirmYes').onclick = null;
        $('confirmNo').onclick = null;
        resolve(answer);
      };
      $('confirmYes').onclick = () => done(true);
      $('confirmNo').onclick = () => done(false);
    });
  }

  function progress(msg) {
    if (msg === null) { $('progressOverlay').hidden = true; return; }
    $('progressMsg').textContent = msg;
    $('progressOverlay').hidden = false;
  }

  function confettiBurst() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const holder = document.createElement('div');
    holder.className = 'confetti-burst';
    const colors = ['#8E79DD', '#4FE4BC', '#FF74D4', '#FFB0E8', '#B8A9F0', '#8FF0D6'];
    for (let i = 0; i < 36; i++) {
      const c = document.createElement('span');
      c.style.left = (Math.random() * 100) + '%';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--cd', (Math.random() * 0.6) + 's');
      c.style.setProperty('--cx', (Math.random() * 180 - 90) + 'px');
      holder.appendChild(c);
    }
    document.body.appendChild(holder);
    setTimeout(() => holder.remove(), 2600);
  }

  /* ================================================
     GitHub client
     ================================================ */
  async function gh(path, opts = {}) {
    const res = await fetch('https://api.github.com' + path, {
      ...opts,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401) {
      const err = new Error('unauthorized');
      err.code = 401;
      throw err;
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (e) { /* ignore */ }
      const err = new Error('GitHub said: ' + (detail || res.status));
      err.code = res.status;
      throw err;
    }
    return res;
  }

  async function ghJson(path, opts) { return (await gh(path, opts)).json(); }

  const repoBase = '/repos/' + GH_OWNER + '/' + GH_REPO;

  async function validateToken() {
    const repo = await ghJson(repoBase);
    if (!repo.permissions || !repo.permissions.push) {
      const err = new Error('no-push');
      err.code = 'no-push';
      throw err;
    }
    return repo;
  }

  async function fetchLiveData() {
    const res = await gh(repoBase + '/contents/' + DATA_PATH + '?ref=' + GH_BRANCH, {
      headers: { 'Accept': 'application/vnd.github.raw+json' },
    });
    const text = await res.text();
    return normalizeData(JSON.parse(text));
  }

  /* older data used a single `badge` string; the shop now supports up to two badges */
  function normalizeData(d) {
    (d.products || []).forEach((p) => {
      if (!Array.isArray(p.badges)) p.badges = (p.badge && String(p.badge).trim()) ? [p.badge] : [];
      p.badges = p.badges.filter(Boolean).slice(0, 2);
      delete p.badge;
    });
    return d;
  }

  /* one commit containing the JSON + any new photos */
  async function publishToGitHub(files, message, onStep) {
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        onStep('Checking the latest version…');
        const ref = await ghJson(repoBase + '/git/ref/heads/' + GH_BRANCH);
        const headSha = ref.object.sha;
        const headCommit = await ghJson(repoBase + '/git/commits/' + headSha);

        const tree = [];
        let photoNum = 0;
        const photoTotal = files.filter((f) => f.base64).length;
        for (const file of files) {
          if (file.base64) {
            photoNum++;
            onStep('Uploading photo ' + photoNum + ' of ' + photoTotal + '…');
            const blob = await ghJson(repoBase + '/git/blobs', {
              method: 'POST',
              body: JSON.stringify({ content: file.base64, encoding: 'base64' }),
            });
            tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
          } else {
            tree.push({ path: file.path, mode: '100644', type: 'blob', content: file.content });
          }
        }

        onStep('Stitching it all together…');
        const newTree = await ghJson(repoBase + '/git/trees', {
          method: 'POST',
          body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
        });
        const newCommit = await ghJson(repoBase + '/git/commits', {
          method: 'POST',
          body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }),
        });
        await ghJson(repoBase + '/git/refs/heads/' + GH_BRANCH, {
          method: 'PATCH',
          body: JSON.stringify({ sha: newCommit.sha }),
        });
        return newCommit.sha;
      } catch (err) {
        if (attempt >= 2 || err.code === 401 || err.code === 'no-push') throw err;
        /* someone else pushed between our read and write ~ try once more from the new head */
      }
    }
  }

  /* ================================================
     auth flow
     ================================================ */
  function showLogin(message) {
    $('appView').hidden = true;
    $('loginView').hidden = false;
    $('loginErr').textContent = message || '';
    $('tokenInput').value = '';
  }

  async function enterStudio() {
    const btn = $('loginBtn');
    btn.disabled = true;
    btn.textContent = 'Unlocking… 🗝️';
    try {
      await validateToken();
      localStorage.setItem(TOKEN_KEY, token);
      await loadData();
      $('loginView').hidden = true;
      $('appView').hidden = false;
      greet();
      renderAll();
    } catch (err) {
      console.error(err);
      token = null;
      localStorage.removeItem(TOKEN_KEY);
      if (err.code === 'no-push') {
        showLogin('That key can peek but not publish ~ ask Nathan to check its permissions 💜');
      } else if (err.code === 401 || err.code === 404) {
        showLogin("Hmm, that key doesn't seem right ~ double-check with Nathan!");
      } else {
        showLogin('Something hiccuped: ' + err.message + ' ~ try again in a moment!');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Unlock my studio 🗝️';
    }
  }

  async function loadData() {
    const live = await fetchLiveData();
    publishedSnapshot = JSON.stringify(live);
    draft = clone(live);
    pendingImages = {};

    /* restore an unfinished draft, if there is one */
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { stored = null; }
    if (stored && stored.draft) {
      const storedDirty = JSON.stringify(stored.draft) !== publishedSnapshot ||
        Object.keys(stored.pendingImages || {}).length > 0;
      if (storedDirty) {
        const keep = await confirmCute('You have unpublished changes from last time ~ keep working on them?', 'Yes, keep them!');
        if (keep) {
          draft = normalizeData(stored.draft);
          pendingImages = stored.pendingImages || {};
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    }
  }

  function greet() {
    const greetings = [
      'Hi Alivia! What are we making today?',
      'Welcome back, Alivia! ✨',
      'Hello, maker of treasures!',
      'Your studio missed you, Alivia! 🧵',
      "Let's make the shop sparkle, Alivia!",
    ];
    $('helloLine').textContent = greetings[Math.floor(Math.random() * greetings.length)];
  }

  /* ================================================
     dirty tracking / autosave
     ================================================ */
  function isDirty() {
    if (!draft) return false;
    return JSON.stringify(draft) !== publishedSnapshot || Object.keys(pendingImages).length > 0;
  }

  function markDirty() {
    updatePublishBar();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraftLocal, 800);
  }

  function saveDraftLocal() {
    if (!draft) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, pendingImages }));
    } catch (e) {
      /* photos too big for local save ~ keep them in memory and save just the words */
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, pendingImages: {} })); } catch (e2) { /* ignore */ }
      if (!warnedQuota) {
        warnedQuota = true;
        toast('Heads up: new photos only live in this tab until you publish ~ publish soon to be safe! 💜', 'pink');
      }
    }
  }

  function updatePublishBar() {
    $('publishBar').hidden = !isDirty();
  }

  window.addEventListener('beforeunload', (e) => {
    if (isDirty() && Object.keys(pendingImages).length > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ================================================
     image handling
     ================================================ */
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          let { width, height } = img;
          const scale = Math.min(1, MAX_IMG_EDGE / Math.max(width, height));
          width = Math.round(width * scale);
          height = Math.round(height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          resolve({ dataUrl, base64: dataUrl.split(',')[1] });
        } catch (e) { reject(e); }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('unreadable'));
      };
      img.src = url;
    });
  }

  async function ingestFiles(fileList, label) {
    const results = [];
    for (const file of Array.from(fileList)) {
      try {
        const { dataUrl, base64 } = await compressImage(file);
        const path = UPLOAD_DIR + '/' + (slug(label) || 'photo') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + '.jpg';
        results.push({ path, dataUrl, base64 });
      } catch (e) {
        toast("One photo didn't work (" + esc(file.name) + ") ~ try a JPG or PNG, or a screenshot of it!", 'pink');
      }
    }
    return results;
  }

  /* ================================================
     render: product cards
     ================================================ */
  function productCover(p) {
    return (p.images && p.images[0]) ? imgSrc(p.images[0]) : '../images/brand/logo.jpg';
  }

  function renderAll() {
    renderProducts();
    renderSettings();
    updatePublishBar();
  }

  function renderProducts() {
    const grid = $('adminGrid');
    grid.innerHTML = '';

    draft.products.forEach((p, i) => {
      const unsold = (p.listings || []).filter((l) => !l.sold).length;
      const card = document.createElement('div');
      card.className = 'admin-card' + (p.archived ? ' is-archived' : '');
      card.innerHTML =
        (p.archived ? '<span class="sticker">Hidden 🙈</span>' : '') +
        '<img class="admin-card-img" src="' + esc(productCover(p)) + '" alt="" loading="lazy">' +
        '<div class="admin-card-body">' +
          '<div class="admin-card-name">' + esc(p.name || 'Untitled') + '</div>' +
          '<div class="admin-card-price' + (p.price === null ? ' custom' : '') + '">' +
            (isOnSaleP(p)
              ? '<span class="was">' + esc(p.priceLabel || ('$' + p.price)) + '</span>' + esc(p.saleLabel || ('$' + p.salePrice)) + ' 💸'
              : esc(p.priceLabel || '~')) +
          '</div>' +
          '<div class="admin-card-meta">📷 ' + (p.images || []).length + (p.oneOfAKind ? ' · 🌟 one of a kind' : ' · ✨ ' + unsold + ' ready to ship') + '</div>' +
        '</div>' +
        '<div class="admin-card-actions">' +
          '<button type="button" class="edit-btn">✏️ Edit</button>' +
          '<div class="move-btns">' +
            '<button type="button" class="icon-btn mini mv-up" aria-label="Move earlier" ' + (i === 0 ? 'disabled style="opacity:.35"' : '') + '>←</button>' +
            '<button type="button" class="icon-btn mini mv-dn" aria-label="Move later" ' + (i === draft.products.length - 1 ? 'disabled style="opacity:.35"' : '') + '>→</button>' +
          '</div>' +
        '</div>';

      card.querySelector('.edit-btn').addEventListener('click', () => openEditor(p.id));
      card.querySelector('.admin-card-img').addEventListener('click', () => openEditor(p.id));
      card.querySelector('.mv-up').addEventListener('click', () => moveProduct(i, -1));
      card.querySelector('.mv-dn').addEventListener('click', () => moveProduct(i, 1));
      grid.appendChild(card);
    });

    /* add-new card */
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add-card';
    add.innerHTML = '<span class="plus">+</span> Add a new product';
    add.addEventListener('click', createProduct);
    grid.appendChild(add);
  }

  function moveProduct(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= draft.products.length) return;
    const [p] = draft.products.splice(index, 1);
    draft.products.splice(target, 0, p);
    markDirty();
    renderProducts();
  }

  /* ================================================
     product editor
     ================================================ */
  function createProduct() {
    const p = {
      id: uid('p'),
      name: '',
      price: null,
      priceLabel: 'Custom Order',
      description: '',
      badges: [],
      archived: false,
      oneOfAKind: false,
      images: [],
      listings: [],
    };
    draft.products.push(p);
    openEditor(p.id, true);
  }

  function openEditor(productId, isNew) {
    currentProduct = draft.products.find((p) => p.id === productId);
    if (!currentProduct) return;
    editorWasNew = !!isNew;
    expandedListingId = null;
    stagedListingPhotos = [];

    $('editorTitle').textContent = isNew ? 'New product ✨' : 'Edit product';
    $('epName').value = currentProduct.name || '';
    $('epName').classList.remove('invalid');
    setPriceMode(detectPriceMode(currentProduct), false);
    $('epPriceSimple').value = typeof currentProduct.price === 'number' ? currentProduct.price : '';
    $('epPriceLabel').value = currentProduct.priceLabel || '';
    $('epPrice').value = typeof currentProduct.price === 'number' ? currentProduct.price : '';
    $('epDesc').value = currentProduct.description || '';
    if (!Array.isArray(currentProduct.badges)) currentProduct.badges = [];
    $('epBadge').value = currentProduct.badges.find((b) => !BADGE_PRESETS.includes(b)) || '';
    delete $('epBadge').dataset.warned;
    syncBadgeChips();
    $('epArchived').checked = !!currentProduct.archived;
    updateArchivedText();
    $('epOneOff').checked = !!currentProduct.oneOfAKind;
    updateOneOffUI();
    const saleOn = typeof currentProduct.salePrice === 'number';
    $('epSaleOn').checked = saleOn;
    $('saleFields').hidden = !saleOn;
    $('epSalePrice').value = saleOn ? currentProduct.salePrice : '';
    $('epSaleLabel').value = currentProduct.saleLabel || '';
    updateSaleMath();
    $('epDelete').style.display = isNew ? 'none' : '';
    $('newListingName').value = '';
    $('newListingPreview').innerHTML = '';
    $('newListingPhotoLabel').textContent = '📷 Pick photo(s)';
    $('newListingAlsoProduct').checked = false;

    renderEditorPhotos();
    renderEditorListings();

    $('editorOverlay').hidden = false;
    requestAnimationFrame(() => $('editorOverlay').classList.add('active'));
    document.body.style.overflow = 'hidden';
    if (isNew) setTimeout(() => $('epName').focus(), 250);
  }

  async function closeEditor(force) {
    if (!force && !$('epName').value.trim()) {
      /* brand-new product left without a name → quietly remove the empty shell */
      if (editorWasNew && isProductUntouched(currentProduct)) {
        draft.products = draft.products.filter((p) => p !== currentProduct);
      } else {
        $('epName').classList.add('invalid');
        $('epName').focus();
        toast('Give it a name first! 💜', 'pink');
        return;
      }
    }

    /* gentle note: sale switch on, but the numbers don't make a deal yet */
    if (!force && currentProduct && $('epSaleOn').checked && !isOnSaleP(currentProduct)) {
      toast("Just so you know ~ the sale won't show until the sale price is lower than the regular price!", 'pink');
    }

    /* last check before the editor closes: an availability sticker with no
       ready-to-ship listings (and no one-of-a-kind switch) is probably a mistake */
    if (!force && currentProduct) {
      const mismatch = availabilityMismatch(currentProduct);
      if (mismatch) {
        const ok = await confirmCute(
          'Heads up! This product wears the "' + mismatch + '" sticker, but it has no ready-to-ship listings and the one-of-a-kind switch is off ~ so shoppers can\'t actually grab one. Save it anyway?',
          'Save anyway', 'Keep editing');
        if (!ok) return;
      }
    }
    $('editorOverlay').classList.remove('active');
    document.body.style.overflow = '';
    setTimeout(() => { $('editorOverlay').hidden = true; }, 260);
    currentProduct = null;
    stagedListingPhotos = [];
    renderProducts();
    updatePublishBar();
  }

  function isProductUntouched(p) {
    return p && !p.name && !p.description && !(p.images || []).length && !(p.listings || []).length;
  }

  /* field bindings */
  $('epName').addEventListener('input', function () {
    if (!currentProduct) return;
    currentProduct.name = this.value;
    this.classList.remove('invalid');
    markDirty();
  });
  /* ---------- pricing modes: one price / fancy tag / custom order ---------- */
  let priceMode = 'custom';

  function detectPriceMode(p) {
    if (Array.isArray(p.priceTiers) && p.priceTiers.some((t) => typeof t.price === 'number')) return 'multi';
    if (typeof p.price !== 'number') return 'custom';
    if (p.priceLabel && p.priceLabel !== '$' + p.price) return 'fancy';
    return 'simple';
  }

  function setPriceMode(mode, fromUser) {
    priceMode = mode;
    document.querySelectorAll('#priceModeChips .mode-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.mode === mode);
    });
    $('priceSimpleRow').hidden = mode !== 'simple';
    $('priceMultiRow').hidden = mode !== 'multi';
    $('priceFancyRow').hidden = mode !== 'fancy';
    $('customPriceNote').hidden = mode !== 'custom';
    /* bundles change price by quantity ~ a sale on top would be double math */
    $('saleGroup').hidden = mode === 'custom' || mode === 'multi';
    $('saleLabelGroup').hidden = mode !== 'fancy';

    if (fromUser && currentProduct) {
      if (mode !== 'multi') delete currentProduct.priceTiers;
      if (mode === 'custom' || mode === 'multi') {
        currentProduct.salePrice = null;
        currentProduct.saleLabel = '';
        $('epSaleOn').checked = false;
        $('saleFields').hidden = true;
      }
      if (mode === 'custom') {
        currentProduct.price = null;
        currentProduct.priceLabel = 'Custom Order';
      } else if (mode === 'simple') {
        const v = parseFloat($('epPriceSimple').value);
        currentProduct.price = isNaN(v) ? null : v;
        currentProduct.priceLabel = isNaN(v) ? '' : '$' + v;
      } else if (mode === 'fancy') {
        currentProduct.priceLabel = $('epPriceLabel').value.trim();
        const v = parseFloat($('epPrice').value);
        currentProduct.price = isNaN(v) ? null : v;
      } else {
        /* multi: start the ladder from the existing single price, if any */
        if (!Array.isArray(currentProduct.priceTiers) || !currentProduct.priceTiers.length) {
          currentProduct.priceTiers = typeof currentProduct.price === 'number'
            ? [{ qty: 1, price: currentProduct.price }] : [];
        }
        const one = currentProduct.priceTiers.find((t) => t.qty === 1);
        currentProduct.price = one ? one.price : null;
        if (currentProduct.priceTiers.length) currentProduct.priceLabel = tierAutoLabel(currentProduct.priceTiers);
      }
      updateSaleMath();
      markDirty();
    }
    if (mode === 'multi') renderTierRows();
  }

  document.querySelectorAll('#priceModeChips .mode-chip').forEach((chip) => {
    chip.addEventListener('click', () => setPriceMode(chip.dataset.mode, true));
  });

  /* ---------- bundle price tiers ---------- */
  const MAX_TIERS = 10;

  function tierCostAdmin(tiers, n) {
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

  function tierAutoLabel(tiers) {
    return tiers.map((t) => (t.qty === 1 ? '$' + t.price + ' each' : t.qty + ' for $' + t.price)).join(' · ');
  }

  /* read the row inputs -> product data + auto price tag */
  function applyTiers() {
    if (!currentProduct) return;
    const tiers = [];
    $('tierRows').querySelectorAll('input').forEach((input, i) => {
      const v = parseFloat(input.value);
      if (!isNaN(v)) tiers.push({ qty: i + 1, price: Math.max(0, v) });
    });
    currentProduct.priceTiers = tiers;
    const one = tiers.find((t) => t.qty === 1);
    currentProduct.price = one ? one.price : null;
    currentProduct.priceLabel = tiers.length ? tierAutoLabel(tiers) : '';
    updateMultiPreview();
  }

  function updateMultiPreview() {
    const el = $('multiPreview');
    const tiers = (currentProduct && currentProduct.priceTiers) || [];
    el.className = 'field-hint';
    if (!tiers.length) { el.textContent = 'Fill in at least the price for 1 item!'; return; }
    if (!tiers.find((t) => t.qty === 1)) {
      el.textContent = 'Add the price for 1 item too, so every amount has a price!';
      el.classList.add('warn');
      return;
    }
    let text = 'Shoppers see: “' + tierAutoLabel(tiers) + '”';
    if (tiers.length > 1) {
      const n = Math.max(...tiers.map((t) => t.qty)) + 1;
      const c = tierCostAdmin(tiers, n);
      if (isFinite(c)) text += ' ~ and the basket does the math: ' + n + ' items = $' + +c.toFixed(2) + ' 🧮';
    }
    el.textContent = text;
    el.classList.add('happy');
  }

  function renderTierRows() {
    const wrap = $('tierRows');
    wrap.innerHTML = '';
    const tiers = (currentProduct && currentProduct.priceTiers) || [];
    const byQty = {};
    tiers.forEach((t) => { byQty[t.qty] = t.price; });
    const maxFilled = tiers.length ? Math.max(...tiers.map((t) => t.qty)) : 0;
    const rows = Math.min(MAX_TIERS, Math.max(1, maxFilled + 1));

    for (let q = 1; q <= rows; q++) {
      const row = document.createElement('div');
      row.className = 'tier-row';
      row.innerHTML =
        '<span class="tier-qty">' + (q === 1 ? '1 item' : q + ' items') + '</span>' +
        '<span class="tier-dollar">$</span>' +
        '<input type="number" class="field-input" min="0" step="0.5" placeholder="' + (q === 1 ? '4' : 'skip or fill') + '">';
      const input = row.querySelector('input');
      if (byQty[q] !== undefined) input.value = byQty[q];
      input.addEventListener('input', function () {
        applyTiers();
        markDirty();
        /* typing in the last row grows a fresh one below (up to 10) */
        const inputs = [...$('tierRows').querySelectorAll('input')];
        if (this === inputs[inputs.length - 1] && this.value !== '' && inputs.length < MAX_TIERS) {
          const wasFocused = document.activeElement === this;
          const myIndex = inputs.length - 1;
          renderTierRows();
          if (wasFocused) {
            const fresh = [...$('tierRows').querySelectorAll('input')][myIndex];
            fresh.focus();
            const len = fresh.value.length;
            fresh.setSelectionRange && fresh.type === 'text' && fresh.setSelectionRange(len, len);
          }
        }
      });
      wrap.appendChild(row);
    }
    updateMultiPreview();
  }

  $('epPriceSimple').addEventListener('input', function () {
    if (!currentProduct) return;
    const v = this.value.trim();
    currentProduct.price = v === '' ? null : Math.max(0, parseFloat(v) || 0);
    currentProduct.priceLabel = v === '' ? '' : '$' + currentProduct.price;
    updateSaleMath();
    markDirty();
  });

  $('epPriceLabel').addEventListener('input', function () {
    if (!currentProduct) return;
    currentProduct.priceLabel = this.value;
    updateSaleMath();
    markDirty();
  });

  $('epPrice').addEventListener('input', function () {
    if (!currentProduct) return;
    const v = this.value.trim();
    currentProduct.price = v === '' ? null : Math.max(0, parseFloat(v) || 0);
    updateSaleMath();
    markDirty();
  });
  $('epDesc').addEventListener('input', function () {
    if (!currentProduct) return;
    currentProduct.description = this.value;
    markDirty();
  });
  /* ---------- badge stickers: up to two, tap to toggle ---------- */
  const MAX_BADGES = 2;
  const BADGE_PRESETS = [
    'In stock!',
    'NEW!',
    'Back in stock!',
    'Seasonal drop!',
    'Limited edition!',
    'Almost gone!',
    'Fan favorite!',
    'Sale!',
    'Now available in mini!',
  ];

  /* stickers that promise something is grab-able right now */
  function isAvailabilityBadge(text) {
    const t = String(text || '').toLowerCase();
    return t.includes('in stock') || t.includes('almost gone');
  }

  function unsoldCount(p) {
    return (p.listings || []).filter((l) => !l.sold).length;
  }

  function availabilityMismatch(p) {
    if (!p || p.oneOfAKind) return null;
    if (unsoldCount(p) > 0) return null;
    return (p.badges || []).find(isAvailabilityBadge) || null;
  }

  function badgeList() {
    if (!currentProduct) return [];
    if (!Array.isArray(currentProduct.badges)) currentProduct.badges = [];
    return currentProduct.badges;
  }

  (function buildBadgeChips() {
    const wrap = $('epBadgeChips');
    BADGE_PRESETS.forEach((text) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'badge-chip';
      chip.textContent = text;
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => {
        if (!currentProduct) return;
        const arr = badgeList();
        const at = arr.indexOf(text);
        if (at >= 0) {
          arr.splice(at, 1); /* peel it off */
        } else if (arr.length >= MAX_BADGES) {
          toast('Two stickers max ~ peel one off first! 💜', 'pink');
          return;
        } else {
          arr.push(text);
          /* gentle nudge, not a blocker: sticker promises stock that isn't listed */
          if (isAvailabilityBadge(text) && availabilityMismatch(currentProduct)) {
            toast("Psst ~ this product has no ready-to-ship listings yet, so that sticker might confuse shoppers! 💜", 'pink');
          }
        }
        syncBadgeChips();
        markDirty();
      });
      wrap.appendChild(chip);
    });
  })();

  /* the text field manages one hand-written sticker alongside the presets */
  $('epBadge').addEventListener('input', function () {
    if (!currentProduct) return;
    const arr = badgeList();
    const text = this.value.trim();
    const customIdx = arr.findIndex((b) => !BADGE_PRESETS.includes(b));
    if (customIdx >= 0) arr.splice(customIdx, 1);
    if (text && !arr.includes(text)) {
      if (arr.length >= MAX_BADGES) {
        if (!this.dataset.warned) {
          this.dataset.warned = '1';
          toast('Two stickers max ~ peel a preset off to add your own! 💜', 'pink');
        }
      } else {
        arr.push(text);
        delete this.dataset.warned;
      }
    }
    if (!text) delete this.dataset.warned;
    syncBadgeChips();
    markDirty();
  });

  function syncBadgeChips() {
    const arr = currentProduct ? (currentProduct.badges || []) : [];
    $('epBadgeChips').querySelectorAll('.badge-chip').forEach((chip) => {
      const on = arr.includes(chip.textContent);
      chip.classList.toggle('active', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  $('epArchived').addEventListener('change', function () {
    if (!currentProduct) return;
    currentProduct.archived = this.checked;
    updateArchivedText();
    markDirty();
  });

  function updateArchivedText() {
    $('epArchivedTxt').textContent = $('epArchived').checked ? 'Hidden from shop 🙈' : 'Showing in shop ✨';
  }

  /* ---------- sale pricing ---------- */
  function isOnSaleP(p) {
    return p && typeof p.price === 'number' && typeof p.salePrice === 'number' && p.salePrice < p.price;
  }

  $('epSaleOn').addEventListener('change', function () {
    if (!currentProduct) return;
    $('saleFields').hidden = !this.checked;
    if (this.checked) {
      const v = parseFloat($('epSalePrice').value);
      currentProduct.salePrice = isNaN(v) ? null : v;
      currentProduct.saleLabel = priceMode === 'fancy' ? $('epSaleLabel').value.trim() : '';
      toast("Tip: pop the 'Sale!' sticker on it so shoppers spot the deal! ✨");
      setTimeout(() => $('epSalePrice').focus(), 100);
    } else {
      currentProduct.salePrice = null;
      currentProduct.saleLabel = '';
    }
    updateSaleMath();
    markDirty();
  });

  $('epSalePrice').addEventListener('input', function () {
    if (!currentProduct) return;
    const v = this.value.trim();
    currentProduct.salePrice = v === '' ? null : Math.max(0, parseFloat(v) || 0);
    updateSaleMath();
    markDirty();
  });

  $('epSaleLabel').addEventListener('input', function () {
    if (!currentProduct) return;
    currentProduct.saleLabel = this.value;
    updateSaleMath();
    markDirty();
  });

  function updateSaleMath() {
    const el = $('saleMath');
    if (!currentProduct || !$('epSaleOn').checked || priceMode === 'custom') { el.textContent = ''; return; }
    const price = currentProduct.price;
    const sale = currentProduct.salePrice;
    el.className = 'field-hint';
    if (typeof price !== 'number') {
      el.textContent = 'Set the regular price first so the deal has something to compare to!';
      el.classList.add('warn');
    } else if (typeof sale !== 'number') {
      el.textContent = 'Regular price is ' + (currentProduct.priceLabel || '$' + price) + ' ~ type the new sale price!';
    } else if (sale >= price) {
      el.textContent = "Hmm ~ the sale price isn't lower than the regular price ($" + price + "), so it won't show as a deal yet!";
      el.classList.add('warn');
    } else {
      const off = Math.round((1 - sale / price) * 100);
      const shows = currentProduct.saleLabel || ('$' + sale);
      el.textContent = "That's $" + +(price - sale).toFixed(2) + ' off ~ ' + off + '% off! 🎉 Shoppers see “' +
        (currentProduct.priceLabel || '$' + price) + '” crossed out, then “' + shows + '”.';
      el.classList.add('happy');
    }
  }

  /* ---------- one-of-a-kind toggle ---------- */
  $('epOneOff').addEventListener('change', function () {
    if (!currentProduct) return;
    currentProduct.oneOfAKind = this.checked;
    updateOneOffUI();
    markDirty();
    if (this.checked && (currentProduct.listings || []).length) {
      toast('Your ' + currentProduct.listings.length + ' listing' + (currentProduct.listings.length > 1 ? 's are' : ' is') + ' tucked away safe ~ flip this off to get them back!');
    }
  });

  function updateOneOffUI() {
    const on = $('epOneOff').checked;
    $('epOneOffTxt').textContent = on ? '🌟 One-of-a-kind ~ this product IS the listing!' : '🌟 One-of-a-kind item';
    $('listingsSection').hidden = on;
  }

  $('editorClose').addEventListener('click', () => closeEditor());
  $('epDone').addEventListener('click', () => closeEditor());
  $('editorOverlay').addEventListener('click', (e) => {
    if (e.target === $('editorOverlay')) closeEditor();
  });

  $('epDelete').addEventListener('click', async () => {
    if (!currentProduct) return;
    const ok = await confirmCute('Delete "' + (currentProduct.name || 'this product') + '" and all its listings? (Tip: you can hide it instead with the visibility switch!)', 'Delete it');
    if (!ok) return;
    draft.products = draft.products.filter((p) => p !== currentProduct);
    markDirty();
    closeEditor(true);
    toast('Product deleted 🗑');
  });

  /* ---------- product photos ---------- */
  function renderEditorPhotos() {
    const grid = $('epPhotos');
    grid.innerHTML = '';
    const imgs = currentProduct.images || (currentProduct.images = []);

    imgs.forEach((path, i) => {
      const cell = document.createElement('div');
      cell.className = 'photo-cell';
      cell.innerHTML =
        '<img src="' + esc(imgSrc(path)) + '" alt="Photo ' + (i + 1) + '">' +
        (i === 0 ? '<span class="cover-tag">cover</span>' : '') +
        (pendingImages[path] ? '<span class="new-tag">new</span>' : '') +
        '<div class="photo-cell-actions">' +
          '<button type="button" class="pc-btn mv-l" aria-label="Move left" ' + (i === 0 ? 'disabled style="opacity:.3"' : '') + '>←</button>' +
          '<button type="button" class="pc-btn mv-r" aria-label="Move right" ' + (i === imgs.length - 1 ? 'disabled style="opacity:.3"' : '') + '>→</button>' +
          '<button type="button" class="pc-btn del" aria-label="Remove photo">🗑</button>' +
        '</div>';
      cell.querySelector('.mv-l').addEventListener('click', () => movePhoto(imgs, i, -1));
      cell.querySelector('.mv-r').addEventListener('click', () => movePhoto(imgs, i, 1));
      cell.querySelector('.del').addEventListener('click', async () => {
        const ok = await confirmCute('Remove this photo from ' + (currentProduct.name || 'this product') + '?', 'Remove it');
        if (!ok) return;
        removeImageRef(imgs, i);
        renderEditorPhotos();
        markDirty();
      });
      grid.appendChild(cell);
    });
  }

  function movePhoto(arr, index, delta) {
    const t = index + delta;
    if (t < 0 || t >= arr.length) return;
    const [x] = arr.splice(index, 1);
    arr.splice(t, 0, x);
    renderEditorPhotos();
    markDirty();
  }

  function removeImageRef(arr, index) {
    const [path] = arr.splice(index, 1);
    /* if it was a never-published upload and nothing else uses it, drop the bytes too */
    if (pendingImages[path] && !JSON.stringify(draft).includes(path)) delete pendingImages[path];
  }

  $('epPhotoInput').addEventListener('change', async function () {
    if (!currentProduct || !this.files.length) return;
    toast('Adding ' + this.files.length + ' photo' + (this.files.length > 1 ? 's' : '') + '… 📷', 'teal');
    const shots = await ingestFiles(this.files, currentProduct.name || 'product');
    shots.forEach(({ path, dataUrl, base64 }) => {
      pendingImages[path] = { dataUrl, base64 };
      currentProduct.images.push(path);
    });
    this.value = '';
    renderEditorPhotos();
    markDirty();
  });

  /* ---------- listings ---------- */
  function renderEditorListings() {
    const wrap = $('epListings');
    wrap.innerHTML = '';
    const listings = currentProduct.listings || (currentProduct.listings = []);

    listings.forEach((listing) => {
      const row = document.createElement('div');
      row.className = 'listing-row' + (listing.sold ? ' is-sold' : '');
      const thumb = (listing.images && listing.images[0])
        ? '<img class="listing-thumb" src="' + esc(imgSrc(listing.images[0])) + '" alt="">'
        : '<div class="listing-thumb-empty">🧵</div>';
      const isNewPhoto = (listing.images || []).some((p) => pendingImages[p]);

      row.innerHTML =
        '<div class="listing-main">' +
          thumb +
          '<div>' +
            '<input type="text" class="listing-name-input" value="' + esc(listing.name || '') + '" placeholder="Name this treasure…">' +
            '<div class="listing-badges">' +
              (listing.sold ? '<span class="mini-chip sold">Sold</span>' : '<span class="mini-chip">Available</span>') +
              '<span class="mini-chip">📷 ' + (listing.images || []).length + '</span>' +
              (isNewPhoto ? '<span class="mini-chip new">new photo</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="listing-actions">' +
            '<button type="button" class="sold-chip' + (listing.sold ? ' active' : '') + '">' + (listing.sold ? 'Sold ✓' : 'Mark sold') + '</button>' +
            '<button type="button" class="icon-btn mini l-photos" aria-label="Manage photos">📷</button>' +
            '<button type="button" class="icon-btn mini l-dup" aria-label="Duplicate listing" title="Duplicate">📑</button>' +
            '<button type="button" class="icon-btn mini l-del" aria-label="Delete listing">🗑</button>' +
          '</div>' +
        '</div>' +
        (expandedListingId === listing.id ? '<div class="listing-photos"><div class="photo-strip"></div></div>' : '');

      row.querySelector('.listing-name-input').addEventListener('input', function () {
        listing.name = this.value;
        markDirty();
      });

      row.querySelector('.sold-chip').addEventListener('click', () => {
        listing.sold = !listing.sold;
        markDirty();
        renderEditorListings();
        toast(listing.sold ? 'Marked sold ~ congrats!! 🎉' : 'Back on the shelf!', 'teal');
      });

      row.querySelector('.l-dup').addEventListener('click', () => {
        /* "Fall Fun Bookmark" -> "Fall Fun Bookmark 2"; "… 2" -> "… 3" */
        const m = (listing.name || '').match(/^(.*?)(\d+)\s*$/);
        const nextName = m ? m[1] + (parseInt(m[2], 10) + 1) : ((listing.name || 'Untitled') + ' 2');
        const copy = { id: uid('l'), name: nextName, images: [...(listing.images || [])], sold: false };
        const at = currentProduct.listings.indexOf(listing);
        currentProduct.listings.splice(at + 1, 0, copy);
        markDirty();
        renderEditorListings();
        toast('Duplicated! Tweak the name & photos ✨', 'teal');
        const inputs = $('epListings').querySelectorAll('.listing-name-input');
        const newInput = inputs[at + 1];
        if (newInput) { newInput.focus(); newInput.select(); }
      });

      row.querySelector('.l-del').addEventListener('click', async () => {
        const ok = await confirmCute('Delete the listing "' + (listing.name || 'untitled') + '"?', 'Delete it');
        if (!ok) return;
        (listing.images || []).forEach((p) => {
          if (pendingImages[p]) delete pendingImages[p];
        });
        currentProduct.listings = currentProduct.listings.filter((l) => l !== listing);
        /* re-check: keep bytes if some other spot still uses the path */
        markDirty();
        renderEditorListings();
      });

      row.querySelector('.l-photos').addEventListener('click', () => {
        expandedListingId = expandedListingId === listing.id ? null : listing.id;
        renderEditorListings();
      });

      const thumbEl = row.querySelector('.listing-thumb');
      if (thumbEl) thumbEl.addEventListener('click', () => {
        expandedListingId = expandedListingId === listing.id ? null : listing.id;
        renderEditorListings();
      });

      /* expanded photo strip */
      if (expandedListingId === listing.id) {
        const strip = row.querySelector('.photo-strip');
        const imgs = listing.images || (listing.images = []);
        imgs.forEach((path, i) => {
          const cell = document.createElement('div');
          cell.className = 'photo-cell';
          cell.innerHTML =
            '<img src="' + esc(imgSrc(path)) + '" alt="">' +
            (i === 0 ? '<span class="cover-tag">main</span>' : '') +
            '<div class="photo-cell-actions">' +
              '<button type="button" class="pc-btn mv-l" ' + (i === 0 ? 'disabled style="opacity:.3"' : '') + ' aria-label="Move left">←</button>' +
              '<button type="button" class="pc-btn del" aria-label="Remove">🗑</button>' +
            '</div>';
          cell.querySelector('.mv-l').addEventListener('click', () => {
            if (i === 0) return;
            const [x] = imgs.splice(i, 1);
            imgs.splice(i - 1, 0, x);
            markDirty();
            renderEditorListings();
          });
          cell.querySelector('.del').addEventListener('click', () => {
            removeImageRef(imgs, i);
            markDirty();
            renderEditorListings();
          });
          strip.appendChild(cell);
        });

        const addLbl = document.createElement('label');
        addLbl.className = 'add-photos-btn small';
        addLbl.innerHTML = '<input type="file" accept="image/*" multiple hidden><span>+ Add</span>';
        addLbl.querySelector('input').addEventListener('change', async function () {
          if (!this.files.length) return;
          const shots = await ingestFiles(this.files, listing.name || 'listing');
          shots.forEach(({ path, dataUrl, base64 }) => {
            pendingImages[path] = { dataUrl, base64 };
            imgs.push(path);
          });
          markDirty();
          renderEditorListings();
        });
        strip.appendChild(addLbl);

        const reuseBtn = document.createElement('button');
        reuseBtn.type = 'button';
        reuseBtn.className = 'add-photos-btn small';
        reuseBtn.textContent = '📚 Reuse';
        reuseBtn.addEventListener('click', async () => {
          const picks = await openPhotoPicker(imgs);
          if (!picks.length) return;
          picks.forEach((path) => { if (!imgs.includes(path)) imgs.push(path); });
          markDirty();
          renderEditorListings();
        });
        strip.appendChild(reuseBtn);
      }

      wrap.appendChild(row);
    });

    if (!listings.length) {
      const none = document.createElement('p');
      none.className = 'field-hint';
      none.textContent = 'No ready-to-ship listings yet ~ add one below whenever something is finished and ready for a new home!';
      wrap.appendChild(none);
    }
  }

  /* ---------- photo library picker (reuse without re-uploading) ---------- */
  let pickerResolve = null;

  function allDraftPhotos() {
    const seen = new Map(); /* path -> where it lives */
    (draft.products || []).forEach((p) => {
      (p.images || []).forEach((path) => { if (!seen.has(path)) seen.set(path, p.name || ''); });
      (p.listings || []).forEach((l) => (l.images || []).forEach((path) => {
        if (!seen.has(path)) seen.set(path, l.name || p.name || '');
      }));
    });
    return [...seen.entries()];
  }

  function openPhotoPicker(excludePaths) {
    return new Promise((resolve) => {
      pickerResolve = resolve;
      const grid = $('pickerGrid');
      grid.innerHTML = '';
      const items = allDraftPhotos().filter(([path]) => !excludePaths.includes(path));
      if (!items.length) {
        grid.innerHTML = '<p class="picker-hint" style="grid-column:1/-1">No other photos to reuse yet ~ add some first!</p>';
      }
      items.forEach(([path, label]) => {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'picker-cell';
        cell.dataset.path = path;
        cell.innerHTML =
          '<img src="' + esc(imgSrc(path)) + '" alt="" loading="lazy">' +
          '<span class="picker-check" aria-hidden="true">✓</span>' +
          (label ? '<span class="picker-label">' + esc(label) + '</span>' : '');
        cell.addEventListener('click', () => cell.classList.toggle('selected'));
        grid.appendChild(cell);
      });
      $('pickerOverlay').hidden = false;
    });
  }

  function closePicker(paths) {
    $('pickerOverlay').hidden = true;
    if (pickerResolve) { pickerResolve(paths); pickerResolve = null; }
  }

  $('pickerClose').addEventListener('click', () => closePicker([]));
  $('pickerCancel').addEventListener('click', () => closePicker([]));
  $('pickerOverlay').addEventListener('click', (e) => { if (e.target === $('pickerOverlay')) closePicker([]); });
  $('pickerAdd').addEventListener('click', () => {
    closePicker([...$('pickerGrid').querySelectorAll('.picker-cell.selected')].map((c) => c.dataset.path));
  });

  /* reuse into the product gallery */
  $('epPickExisting').addEventListener('click', async () => {
    if (!currentProduct) return;
    const picks = await openPhotoPicker(currentProduct.images || []);
    if (!picks.length) return;
    picks.forEach((path) => { if (!currentProduct.images.includes(path)) currentProduct.images.push(path); });
    renderEditorPhotos();
    markDirty();
    toast(picks.length + ' photo' + (picks.length > 1 ? 's' : '') + ' added! 📚', 'teal');
  });

  /* reuse into a brand-new listing (staged until "+ Add listing") */
  $('newListingPickExisting').addEventListener('click', async () => {
    if (!currentProduct) return;
    const already = stagedListingPhotos.map((s) => s.path);
    const picks = await openPhotoPicker(already);
    if (!picks.length) return;
    picks.forEach((path) => stagedListingPhotos.push({ path, existing: true }));
    renderStagedPreview();
  });

  function renderStagedPreview() {
    $('newListingPhotoLabel').textContent = stagedListingPhotos.length
      ? '📷 ' + stagedListingPhotos.length + ' picked' : '📷 Pick photo(s)';
    $('newListingPreview').innerHTML = stagedListingPhotos
      .map((s, i) => '<div class="photo-cell" style="width:74px"><img src="' + esc(s.dataUrl || imgSrc(s.path)) + '" alt="Photo ' + (i + 1) + '"></div>')
      .join('');
  }

  /* add-listing form */
  $('newListingPhotos').addEventListener('change', async function () {
    if (!this.files.length) return;
    const shots = await ingestFiles(this.files, $('newListingName').value || 'listing');
    stagedListingPhotos.push(...shots);
    renderStagedPreview();
    this.value = '';
  });

  $('addListingBtn').addEventListener('click', () => {
    if (!currentProduct) return;
    const name = $('newListingName').value.trim();
    if (!name) {
      $('newListingName').classList.add('invalid');
      $('newListingName').focus();
      return;
    }
    $('newListingName').classList.remove('invalid');

    const listing = { id: uid('l'), name, images: [], sold: false };
    stagedListingPhotos.forEach(({ path, dataUrl, base64, existing }) => {
      if (!existing) pendingImages[path] = { dataUrl, base64 };
      if (!listing.images.includes(path)) listing.images.push(path);
    });
    currentProduct.listings.push(listing);

    /* one tap, both places: mirror the photos into the product gallery */
    if ($('newListingAlsoProduct').checked) {
      listing.images.forEach((path) => {
        if (!currentProduct.images.includes(path)) currentProduct.images.push(path);
      });
      renderEditorPhotos();
    }

    stagedListingPhotos = [];
    $('newListingName').value = '';
    $('newListingAlsoProduct').checked = false;
    renderStagedPreview();
    markDirty();
    renderEditorListings();
    toast('Listing added! ✨', 'teal');
  });

  $('newListingName').addEventListener('input', function () { this.classList.remove('invalid'); });

  /* ================================================
     settings tab
     ================================================ */
  function renderSettings() {
    document.querySelectorAll('[data-setting]').forEach((input) => {
      input.value = (draft.settings || {})[input.dataset.setting] || '';
    });
  }

  document.querySelectorAll('[data-setting]').forEach((input) => {
    input.addEventListener('input', function () {
      if (!draft) return;
      if (!draft.settings) draft.settings = {};
      draft.settings[this.dataset.setting] = this.value.trim();
      markDirty();
    });
  });

  /* tabs */
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      $('panel-products').hidden = tab.dataset.tab !== 'products';
      $('panel-settings').hidden = tab.dataset.tab !== 'settings';
    });
  });

  /* ================================================
     preview / discard / publish
     ================================================ */
  $('previewBtn').addEventListener('click', () => {
    const previewImages = {};
    Object.entries(pendingImages).forEach(([path, v]) => { previewImages[path] = v.dataUrl; });
    const payload = { ...clone(draft), _previewImages: previewImages };
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify(payload));
    } catch (e) {
      try {
        payload._previewImages = {};
        localStorage.setItem(PREVIEW_KEY, JSON.stringify(payload));
        toast('Preview is on, but brand-new photos may show blank until you publish!', 'pink');
      } catch (e2) {
        toast("Preview didn't fit in this browser ~ publish to see it live!", 'pink');
        return;
      }
    }
    window.open('../?preview=1', '_blank', 'noopener');
  });

  $('discardBtn').addEventListener('click', async () => {
    const ok = await confirmCute('Throw away all your unpublished changes and go back to what the shop looks like now?', 'Yes, start over');
    if (!ok) return;
    draft = JSON.parse(publishedSnapshot);
    pendingImages = {};
    localStorage.removeItem(DRAFT_KEY);
    renderAll();
    toast('Back to a clean slate!');
  });

  $('publishBtn').addEventListener('click', async () => {
    if (!isDirty()) return;

    const draftJson = JSON.stringify(draft, null, 2) + '\n';
    const used = Object.entries(pendingImages).filter(([path]) => draftJson.includes(path));
    const files = used.map(([path, v]) => ({ path, base64: v.base64 }));
    files.push({ path: DATA_PATH, content: draftJson });

    const photoCount = used.length;
    const message = 'Shop update from Alivia\'s Studio ✨' + (photoCount ? ' (' + photoCount + ' new photo' + (photoCount > 1 ? 's' : '') + ')' : '');

    try {
      progress('Getting your changes ready…');
      await publishToGitHub(files, message, progress);
      progress(null);

      publishedSnapshot = JSON.stringify(draft);
      pendingImages = {};
      localStorage.removeItem(DRAFT_KEY);
      updatePublishBar();
      renderProducts();
      confettiBurst();
      toast('Published!! 🎉 Give it a minute or two to appear on the site.', 'teal');
    } catch (err) {
      progress(null);
      console.error(err);
      if (err.code === 401) {
        showLogin('Your key stopped working ~ paste it again (or ask Nathan for a fresh one)!');
      } else {
        toast("Publishing hiccuped: " + err.message + " ~ your changes are safe here, try again in a moment!", 'pink');
      }
    }
  });

  /* ================================================
     login / logout wiring
     ================================================ */
  $('loginBtn').addEventListener('click', () => {
    const val = $('tokenInput').value.trim();
    if (!val) {
      $('loginErr').textContent = 'Paste your magic key first! 💜';
      return;
    }
    token = val;
    enterStudio();
  });

  $('tokenInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('loginBtn').click();
  });

  $('logoutBtn').addEventListener('click', async () => {
    if (isDirty()) {
      const ok = await confirmCute('Log out? Your unpublished changes will stay saved on this device.', 'Log out');
      if (!ok) return;
      saveDraftLocal();
    }
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    showLogin('See you soon! 👋');
  });

  /* esc closes editor / confirm */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('confirmOverlay').hidden) return; /* let the buttons decide */
    if (!$('pickerOverlay').hidden) { closePicker([]); return; }
    if (!$('editorOverlay').hidden) closeEditor();
  });

  /* ================================================
     boot
     ================================================ */
  (async function boot() {
    token = localStorage.getItem(TOKEN_KEY);
    if (!token) { showLogin(); return; }
    try {
      await validateToken();
      await loadData();
      $('loginView').hidden = true;
      $('appView').hidden = false;
      greet();
      renderAll();
    } catch (err) {
      console.error(err);
      token = null;
      localStorage.removeItem(TOKEN_KEY);
      showLogin(err.code === 'no-push'
        ? 'Your key can peek but not publish ~ ask Nathan to check it 💜'
        : 'Welcome back! Paste your magic key to unlock the studio.');
    }
  })();
})();
