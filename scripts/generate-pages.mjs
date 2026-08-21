#!/usr/bin/env node
/**
 * Alivia's Treasured Threads — static page generator (zero deps)
 *
 * Reads data/site.json and writes:
 *   product/<id>/index.html   for every product (archived included for stable URLs)
 *   sitemap.xml
 *   robots.txt
 *
 * Usage (from repo root):
 *   node scripts/generate-pages.mjs
 *   node scripts/generate-pages.mjs --base https://arcane-designer.github.io/alivias-treasured-threads
 *
 * Safe for GitHub Pages project sites and future custom domains:
 * pass --base with the public origin (no trailing slash). Relative asset
 * paths inside product pages always use ../../ so local preview works.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_PATH = join(ROOT, 'data', 'site.json');
const PRODUCT_DIR = join(ROOT, 'product');

const args = process.argv.slice(2);
function argVal(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const BASE = (argVal('--base', 'https://arcane-designer.github.io/alivias-treasured-threads') || '').replace(/\/+$/, '');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;');
}

function loadData() {
  const raw = readFileSync(DATA_PATH, 'utf8');
  return JSON.parse(raw);
}

function coverPath(p) {
  if (p.images && p.images[0]) return p.images[0];
  const listing = (p.listings || []).find((l) => l.images && l.images[0]);
  if (listing) return listing.images[0];
  return 'images/brand/logo.jpg';
}

function allImages(p) {
  const out = [];
  (p.images || []).forEach((i) => out.push(i));
  (p.listings || []).forEach((l) => {
    (l.images || []).forEach((i) => {
      if (!out.includes(i)) out.push(i);
    });
  });
  if (!out.length) out.push('images/brand/logo.jpg');
  return out;
}

function isOnSale(p) {
  return typeof p.salePrice === 'number' && typeof p.price === 'number' && p.salePrice < p.price;
}

function priceBlock(p) {
  if (p.price === null || typeof p.price !== 'number') {
    return `<div class="price-block custom">${esc(p.priceLabel || 'Custom Order')}</div>`;
  }
  if (isOnSale(p)) {
    return `<div class="price-block"><span class="was">${esc(p.priceLabel || '$' + p.price)}</span><span class="now">$${esc(String(p.salePrice))}</span></div>`;
  }
  if (p.priceTiers && p.priceTiers.length) {
    if (p.priceLabel) return `<div class="price-block">${esc(p.priceLabel)}</div>`;
    const low = Math.min(...p.priceTiers.map((t) => t.price));
    return `<div class="price-block">from $${esc(String(low))}</div>`;
  }
  return `<div class="price-block">${esc(p.priceLabel || '$' + p.price)}</div>`;
}

function checkoutUrl(p) {
  const u = String(p.checkoutUrl || p.paymentLink || '').trim();
  if (!u) return '';
  try {
    const parsed = new URL(u);
    if (parsed.protocol === 'https:') return u;
  } catch {
    /* invalid */
  }
  return '';
}

function jsonLdProduct(p, pageUrl) {
  const imgs = allImages(p).map((i) => `${BASE}/${i.replace(/^\//, '')}`);
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description || undefined,
    image: imgs,
    url: pageUrl,
    brand: {
      '@type': 'Brand',
      name: "Alivia's Treasured Threads",
    },
  };
  const pay = checkoutUrl(p);
  const offerable =
    pay &&
    typeof p.price === 'number' &&
    (p.oneOfAKind || (p.listings || []).some((l) => !l.sold));
  if (offerable) {
    obj.offers = {
      '@type': 'Offer',
      url: pageUrl,
      priceCurrency: 'USD',
      price: String(isOnSale(p) ? p.salePrice : p.price),
      availability: 'https://schema.org/InStock',
    };
  }
  return JSON.stringify(obj, null, 2);
}

function listingsHtml(p) {
  const listings = p.listings || [];
  if (p.oneOfAKind || !listings.length) return '';
  const sorted = [...listings].sort((a, b) => (a.sold === b.sold ? 0 : a.sold ? 1 : -1));
  const rows = sorted
    .map((l) => {
      const thumb = l.images && l.images[0] ? `../../${l.images[0]}` : '../../images/brand/logo.jpg';
      const sold = !!l.sold;
      const action = sold
        ? ''
        : `<button type="button" class="btn btn-sm btn-primary" data-add-listing="${escAttr(l.id)}">Add to basket</button>`;
      return `<div class="listing-row${sold ? ' is-sold' : ''}">
        <img class="listing-thumb" src="${escAttr(thumb)}" alt="" width="56" height="56" loading="lazy">
        <div class="listing-meta">
          <div class="listing-name">${esc(l.name)}</div>
          ${sold ? '<div class="listing-status">Sold</div>' : '<div class="listing-status">Ready to ship</div>'}
        </div>
        ${action}
      </div>`;
    })
    .join('\n');
  return `<div class="listings-block"><h3>Available now</h3>${rows}</div>`;
}

function actionsHtml(p) {
  const parts = [];
  const hasReady = (p.listings || []).some((l) => !l.sold);
  if (p.oneOfAKind) {
    parts.push(`<button type="button" class="btn btn-primary" id="addOneOffBtn">Add to basket</button>`);
  }
  if (!p.oneOfAKind) {
    parts.push(`<button type="button" class="btn ${hasReady ? 'btn-secondary' : 'btn-primary'}" id="addCustomBtn">Request custom</button>`);
  }
  const pay = checkoutUrl(p);
  const showBuy =
    pay &&
    typeof p.price === 'number' &&
    (p.oneOfAKind || (p.listings || []).some((l) => !l.sold));
  if (showBuy) {
    parts.push(`<div class="buy-now-wrap" id="buyNowWrap">
      <a class="btn btn-primary" id="buyNowLink" href="${escAttr(pay)}" target="_blank" rel="noopener noreferrer">Buy now</a>
      <p class="checkout-note">Hosted checkout opens in a new tab.</p>
    </div>`);
  } else {
    parts.push(`<div class="buy-now-wrap" id="buyNowWrap" hidden>
      <a class="btn btn-primary" id="buyNowLink" href="#" target="_blank" rel="noopener noreferrer">Buy now</a>
      <p class="checkout-note">Hosted checkout opens in a new tab.</p>
    </div>`);
  }
  parts.push(`<a class="btn btn-secondary" href="../../shop/#order">Go to order form</a>`);
  return `<div class="product-actions">${parts.join('\n')}</div>`;
}

function galleryHtml(p) {
  const imgs = allImages(p);
  const main = imgs[0];
  const thumbs = imgs
    .map(
      (src, i) =>
        `<button type="button" data-gallery-idx="${i}" aria-current="${i === 0 ? 'true' : 'false'}" aria-label="Photo ${i + 1}">
          <img src="../../${escAttr(src)}" alt="" width="64" height="64" loading="lazy">
        </button>`
    )
    .join('\n');
  return `<div class="gallery">
    <div class="gallery-main">
      <img id="galleryMainImg" src="../../${escAttr(main)}" alt="${escAttr(p.name)}" width="800" height="800">
    </div>
    <div class="gallery-thumbs">${thumbs}</div>
  </div>`;
}

function productPage(p, settings) {
  const pageUrl = `${BASE}/product/${encodeURIComponent(p.id)}/`;
  const title = `${p.name} — ${settings.brandName || "Alivia's Treasured Threads"}`;
  const desc = (p.description || `${p.name} — handmade by Alivia.`).replace(/\s+/g, ' ').trim().slice(0, 160);
  const ogImg = `${BASE}/${coverPath(p).replace(/^\//, '')}`;
  const badges = (p.badges || [])
    .map((b) => `<span class="sticker sticker-inline">${esc(b)}</span>`)
    .join('');
  const archivedNote = p.archived
    ? `<p class="muted" style="margin-bottom:1rem">This piece isn't currently listed in the shop — the page stays up for reference.</p>`
    : '';
  const descLink =
    p.descriptionLink && p.descriptionLink.url
      ? `<p><a href="${escAttr(p.descriptionLink.url)}" target="_blank" rel="noopener noreferrer">${esc(p.descriptionLink.text || 'Learn more')}</a></p>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${escAttr(pageUrl)}">
  <link rel="icon" href="../../favicon.ico" type="image/x-icon">
  <meta property="og:type" content="product">
  <meta property="og:title" content="${esc(p.name)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:image" content="${escAttr(ogImg)}">
  <meta property="og:url" content="${escAttr(pageUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Dancing+Script:wght@600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../../assets/site.css">
  <script type="application/ld+json">
${jsonLdProduct(p, pageUrl)}
  </script>
</head>
<body>
  <a class="sr-only" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="header-inner">
      <a href="../../" class="brand-link" aria-label="Alivia's Treasured Threads — home">
        <img src="../../images/brand/logo.jpg" alt="" class="brand-logo" width="46" height="46">
        <span class="brand-text">
          <span class="script">Alivia's</span>
          <span class="serif">Treasured Threads</span>
        </span>
      </a>
      <button type="button" class="nav-toggle" id="navToggle" aria-expanded="false" aria-controls="navMain" aria-label="Menu">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <nav class="nav-main" id="navMain" aria-label="Main">
        <a href="../../shop/">Shop</a>
        <a href="../../custom/">Custom</a>
        <a href="../../about/">About</a>
        <a class="nav-cta" href="../../shop/#order">Place an order</a>
      </nav>
    </div>
  </header>

  <main id="main" class="section">
    <div class="wrap" id="productRoot" data-product-id="${escAttr(p.id)}">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="../../">Home</a> <span aria-hidden="true">/</span>
        <a href="../../shop/">Shop</a> <span aria-hidden="true">/</span>
        <span>${esc(p.name)}</span>
      </nav>
      ${archivedNote}
      <div class="product-detail">
        ${galleryHtml(p)}
        <div class="product-detail-info">
          <h1>${esc(p.name)}</h1>
          ${badges}
          ${priceBlock(p)}
          <div class="product-desc">${esc(p.description || '')}</div>
          ${descLink}
          ${listingsHtml(p)}
          ${actionsHtml(p)}
          <p class="checkout-note" style="margin-top:1rem">
            Most orders go through the request form — Alivia confirms details, timing, and payment by email.
          </p>
        </div>
      </div>
    </div>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <div class="footer-grid">
        <div class="footer-brand">
          <span class="footer-brand-stack">
            <span class="script">Alivia's</span>
            <span class="serif">Treasured Threads</span>
          </span>
          <p>Handmade with love, one stitch at a time.</p>
        </div>
        <div class="footer-col"><h4>Explore</h4><ul>
          <li><a href="../../shop/">Shop</a></li>
          <li><a href="../../custom/">Custom orders</a></li>
          <li><a href="../../about/">About</a></li>
          <li><a href="../../about/#faq">FAQ &amp; policies</a></li>
        </ul></div>
        <div class="footer-col"><h4>Connect</h4><ul>
          <li><a href="https://www.instagram.com/alivias_treasured_threads" target="_blank" rel="noopener noreferrer">Instagram</a></li>
          <li><a href="../../shop/#order">Place an order</a></li>
          <li><a href="../../about/#leave-review">Leave a review</a></li>
        </ul></div>
      </div>
      <div class="footer-bottom">
        <span>© <span data-brand>Alivia's Treasured Threads</span></span>
        <a class="studio-link" href="../../admin/" title="Alivia's Studio">🧵</a>
      </div>
    </div>
  </footer>

  <div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" hidden>
    <button type="button" class="lightbox-close" id="lightboxClose" aria-label="Close">×</button>
    <button type="button" class="lightbox-nav prev" id="lightboxPrev" aria-label="Previous">‹</button>
    <img src="" alt="" id="lightboxImg">
    <button type="button" class="lightbox-nav next" id="lightboxNext" aria-label="Next">›</button>
    <div class="lightbox-count" id="lightboxCount"></div>
  </div>

  <button class="basket-fab" id="basketFab" aria-label="Open my basket" hidden>
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
    <span class="basket-count" id="basketCount">0</span>
  </button>
  <div class="drawer-overlay" id="drawerOverlay" hidden></div>
  <aside class="basket-drawer" id="basketDrawer" role="dialog" aria-modal="true" aria-label="My basket" hidden>
    <div class="drawer-head">
      <h3><span class="script-accent">my</span> Basket</h3>
      <button type="button" class="drawer-close" id="drawerClose" aria-label="Close">×</button>
    </div>
    <div class="drawer-items" id="drawerItems"></div>
    <p class="drawer-empty" id="drawerEmpty">Nothing in here yet! Add anything you love from the shop.</p>
    <div class="drawer-foot">
      <div class="drawer-estimate" id="drawerEstimate"></div>
      <a href="../../shop/#order" class="btn btn-gradient" id="drawerCheckout">Ready to Order →</a>
    </div>
  </aside>
  <div class="toast-zone" id="toastZone" aria-live="polite"></div>
  <button type="button" class="scroll-top" id="scrollTop" aria-label="Scroll to top">↑</button>
  <script src="../../assets/site.js"></script>
</body>
</html>
`;
}

function writeSitemap(products) {
  const urls = [
    { loc: `${BASE}/`, priority: '1.0' },
    { loc: `${BASE}/shop/`, priority: '0.9' },
    { loc: `${BASE}/custom/`, priority: '0.8' },
    { loc: `${BASE}/about/`, priority: '0.7' },
    /* /faq/ is intentionally absent: it is a noindex compatibility
       bridge that redirects to /about/#faq */
  ];
  products.forEach((p) => {
    if (p.archived) return;
    urls.push({
      loc: `${BASE}/product/${encodeURIComponent(p.id)}/`,
      priority: '0.8',
    });
  });
  const body = urls
    .map(
      (u) => `  <url>
    <loc>${esc(u.loc)}</loc>
    <changefreq>weekly</changefreq>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
  writeFileSync(join(ROOT, 'sitemap.xml'), xml, 'utf8');
}

function writeRobots() {
  const txt = `User-agent: *
Allow: /

Sitemap: ${BASE}/sitemap.xml
`;
  writeFileSync(join(ROOT, 'robots.txt'), txt, 'utf8');
}

function cleanProductDir() {
  if (!existsSync(PRODUCT_DIR)) {
    mkdirSync(PRODUCT_DIR, { recursive: true });
    return;
  }
  for (const name of readdirSync(PRODUCT_DIR)) {
    rmSync(join(PRODUCT_DIR, name), { recursive: true, force: true });
  }
}

function main() {
  const data = loadData();
  const settings = data.settings || {};
  const products = data.products || [];
  const ids = new Set();
  for (const p of products) {
    if (!p.id) throw new Error('Product missing id');
    if (ids.has(p.id)) throw new Error('Duplicate product id: ' + p.id);
    ids.add(p.id);
  }

  cleanProductDir();
  let n = 0;
  for (const p of products) {
    const dir = join(PRODUCT_DIR, p.id);
    mkdirSync(dir, { recursive: true });
    const html = productPage(p, settings).replace(/[ \t]+$/gm, '');
    writeFileSync(join(dir, 'index.html'), html, 'utf8');
    n++;
  }
  writeSitemap(products);
  writeRobots();
  console.log(`Generated ${n} product page(s), sitemap.xml, robots.txt`);
  console.log(`Base URL: ${BASE}`);
}

main();
