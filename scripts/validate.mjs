#!/usr/bin/env node
/**
 * Validation for Alivia's Treasured Threads storefront source.
 * Checks: site.json schema, duplicate slugs, generated product pages,
 * relative path depth, accidental live checkout placeholders, basic image refs.
 *
 * Usage (from repo root):
 *   node scripts/validate.mjs
 * Exit code 0 = ok, 1 = failures.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const failures = [];
const warnings = [];

function fail(msg) {
  failures.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}
function htmlText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`Cannot parse JSON: ${path} (${e.message})`);
    return null;
  }
}

function walkHtml(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'admin' || name === 'node_modules' || name === '.git') continue;
      walkHtml(p, acc);
    } else if (name.endsWith('.html')) {
      acc.push(p);
    }
  }
  return acc;
}

const data = loadJson(join(ROOT, 'data', 'site.json'));
if (!data) {
  console.error('FATAL: data/site.json unreadable');
  process.exit(1);
}

/* schema */
if (!data.settings || typeof data.settings !== 'object') fail('settings missing');
if (!Array.isArray(data.products)) fail('products must be an array');
if (!Array.isArray(data.reviews)) warn('reviews array missing (ok if empty site)');

const requiredSettings = ['brandName', 'tagline', 'reviewInboxUrl', 'contactEmail'];
for (const k of requiredSettings) {
  if (data.settings && data.settings[k] == null) warn(`settings.${k} is empty`);
}

const ids = new Set();
const imageRefs = new Set();
let themeTagCount = 0;
const categoryCases = new Map();
if (!Array.isArray(data.settings?.categories)) fail('Settings categories must be an array');
else {
  const seenCategories = new Set();
  for (const category of data.settings.categories) {
    if (typeof category !== 'string' || !category.trim() || category !== category.trim().replace(/\s+/g, ' ')) fail('Settings has an invalid category');
    const key = String(category).toLocaleLowerCase();
    if (seenCategories.has(key)) fail(`Settings has duplicate category ${category}`);
    seenCategories.add(key);
  }
}
if (data.settings?.seasonImage) imageRefs.add(data.settings.seasonImage);
for (const p of data.products || []) {
  if (!p.id || typeof p.id !== 'string') {
    fail('Product missing string id');
    continue;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(p.id)) {
    fail(`Product id has unsafe characters for URL: ${p.id}`);
  }
  if (ids.has(p.id)) fail(`Duplicate product id: ${p.id}`);
  ids.add(p.id);
  if (!p.name) fail(`Product ${p.id} missing name`);
  if (p.category != null && typeof p.category !== 'string') fail(`Product ${p.id} has an invalid category`);
  else if (p.category) {
    const category = p.category.trim().replace(/\s+/g, ' ');
    if (category !== p.category) fail(`Product ${p.id} category has extra whitespace`);
    const key = category.toLocaleLowerCase();
    if (categoryCases.has(key) && categoryCases.get(key) !== category) fail(`Category casing conflict: ${categoryCases.get(key)} / ${category}`);
    categoryCases.set(key, category);
  }
  if (p.theme != null && (typeof p.theme !== 'string' || p.theme !== p.theme.trim().replace(/\s+/g, ' '))) fail(`Product ${p.id} has an invalid theme`);
  (p.images || []).forEach((i) => imageRefs.add(i));
  (p.listings || []).forEach((l) => {
    if (!l.id) fail(`Listing under ${p.id} missing id`);
    (l.images || []).forEach((i) => imageRefs.add(i));
  });
  /* accidental live checkout */
  for (const key of ['checkoutUrl', 'paymentLink']) {
    const u = (p[key] || '').trim();
    if (!u) continue;
    if (/example\.com|placeholder|YOUR_|TODO|stripe\.com\/test|buy\.stripe\.com\/test/i.test(u)) {
      fail(`Product ${p.id} has placeholder checkout field ${key}=${u}`);
    }
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'https:') fail(`Product ${p.id} ${key} must be https`);
    } catch {
      fail(`Product ${p.id} ${key} is not a valid URL: ${u}`);
    }
  }
}

/* archive: every past piece, kept whole. Shoppers never see these, but a
   broken entry would be lost history, so it is checked as carefully as a product */
const PIECE_TAGS = new Set(['', 'sold', 'custom', 'in-person', 'gift']);
if (data.archive != null && !Array.isArray(data.archive)) fail('archive must be an array when present');
{
  const archiveIds = new Set();
  const listingIds = new Set();
  for (const p of data.products || []) for (const l of p.listings || []) if (l && l.id) listingIds.add(l.id);
  for (const p of data.products || []) {
    if (p.tag != null && (typeof p.tag !== 'string' || !PIECE_TAGS.has(p.tag))) fail(`Product ${p.id} has an unknown tag ${p.tag}`);
    for (const l of p.listings || []) {
      if (l.tag != null && (typeof l.tag !== 'string' || !PIECE_TAGS.has(l.tag))) fail(`Listing ${l.id} has an unknown tag ${l.tag}`);
    }
  }
  for (const entry of Array.isArray(data.archive) ? data.archive : []) {
    if (!entry || typeof entry !== 'object') { fail('Archive has a non-object entry'); continue; }
    const kind = entry.kind === 'product' ? 'product' : 'listing';
    const piece = kind === 'product' ? entry.product : entry;
    if (!piece || typeof piece !== 'object') { fail(`Archive entry ${entry.id || '?'} is a product entry without a product`); continue; }
    if (!entry.id || typeof entry.id !== 'string') fail('Archive entry missing string id');
    else {
      if (archiveIds.has(entry.id)) fail(`Duplicate archive id: ${entry.id}`);
      archiveIds.add(entry.id);
      if (kind === 'product' && ids.has(entry.id)) fail(`Archived product ${entry.id} is also a live product`);
      if (kind === 'listing' && listingIds.has(entry.id)) fail(`Archived listing ${entry.id} is also a live listing`);
    }
    if (kind === 'product' && piece.id !== entry.id) fail(`Archived product entry ${entry.id} does not match its product id ${piece.id}`);
    if (!piece.name) warn(`Archive entry ${entry.id} has no name`);
    if (!Array.isArray(piece.images)) fail(`Archive entry ${entry.id} images must be an array`);
    else piece.images.forEach((i) => imageRefs.add(i));
    for (const l of Array.isArray(piece.listings) ? piece.listings : []) (l?.images || []).forEach((i) => imageRefs.add(i));
    if (piece.tag != null && (typeof piece.tag !== 'string' || !PIECE_TAGS.has(piece.tag))) fail(`Archive entry ${entry.id} has an unknown tag ${piece.tag}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.archivedAt || ''))) fail(`Archive entry ${entry.id} needs an archivedAt date (YYYY-MM-DD)`);
    if (piece.theme != null && (typeof piece.theme !== 'string' || piece.theme !== piece.theme.trim().replace(/\s+/g, ' '))) fail(`Archive entry ${entry.id} has an invalid theme`);
    if (kind === 'listing' && entry.productId && !ids.has(entry.productId)) warn(`Archive entry ${entry.id} came from product ${entry.productId}, which no longer exists (bringing it back will make a new hidden product)`);
  }
}

/* generated active Shop catalog pages */
const productRoot = join(ROOT, 'shop');
if (!existsSync(productRoot)) {
  fail('shop/ directory missing. Run: node scripts/generate-pages.mjs');
} else {
  for (const id of ids) {
    const product = (data.products || []).find((x) => x.id === id);
    if (!product || product.archived) continue;
    const page = join(productRoot, id, 'index.html');
    if (!existsSync(page)) {
      fail(`Missing generated page: shop/${id}/index.html`);
      continue;
    }
    const html = readFileSync(page, 'utf8');
    if (!html.includes(`data-product-id="${id}"`)) {
      fail(`shop/${id}/index.html missing data-product-id`);
    }
    /* nested depth: assets must be ../../assets */
    if (!html.includes('href="../../assets/site.css"')) {
      fail(`shop/${id}/index.html broken CSS relative path`);
    }
    if (!html.includes('src="../../assets/site.js"')) {
      fail(`shop/${id}/index.html broken JS relative path`);
    }
    if (!html.includes('href="../../shop/"')) {
      fail(`shop/${id}/index.html missing shop link at ../../shop/`);
    }
    const showsListings = (product.listings || []).some((listing) => !listing.sold);
    for (const listing of product.listings || []) {
      if (showsListings && !html.includes(htmlText(listing.name))) fail(`shop/${id}/index.html missing listing ${listing.id}`);
      const addMarker = `data-add-listing="${listing.id}"`;
      if (!listing.sold && !html.includes(addMarker)) fail(`shop/${id}/index.html cannot add available listing ${listing.id}`);
      if (listing.sold && html.includes(addMarker)) fail(`shop/${id}/index.html can add sold listing ${listing.id}`);
      const listingThumb = listing.images && listing.images[0];
      if (showsListings && listingThumb && !html.includes(listingThumb)) {
        fail(`shop/${id}/index.html missing listing image ${listingThumb}`);
      }
    }
    /* no secrets in browser */
    if (/github_pat_|sk_live|sk_test|whsec_/i.test(html)) {
      fail(`shop/${id}/index.html appears to contain a secret`);
    }
  }
  /* orphan product dirs */
  for (const name of readdirSync(productRoot)) {
    if (name !== 'index.html' && !ids.has(name)) warn(`Orphan Shop dir not in site.json: shop/${name}`);
  }
}

/* top-level pages */
for (const rel of ['index.html', 'shop/index.html', 'custom/index.html', 'checkout/index.html', 'checkout/success/index.html', 'checkout/cancel/index.html', 'reviews/index.html', 'about/index.html', 'faq/index.html']) {
  if (!existsSync(join(ROOT, rel))) fail(`Missing page: ${rel}`);
}

/* sitemap / robots */
if (!existsSync(join(ROOT, 'sitemap.xml'))) fail('sitemap.xml missing. Run generate-pages');
else {
  const sm = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  if (!sm.includes('<urlset')) fail('sitemap.xml invalid');
  for (const id of ids) {
    const p = (data.products || []).find((x) => x.id === id);
    if (p && !p.archived && !sm.includes(`/shop/${id}/`)) {
      fail(`sitemap missing active Shop product ${id}`);
    }
  }
}
if (!existsSync(join(ROOT, 'robots.txt'))) fail('robots.txt missing');
else {
  const rb = readFileSync(join(ROOT, 'robots.txt'), 'utf8');
  if (!/Sitemap:/i.test(rb)) fail('robots.txt missing Sitemap directive');
}

/* admin preserved */
if (!existsSync(join(ROOT, 'admin', 'index.html'))) fail('admin/ missing');
if (!existsSync(join(ROOT, 'worker', 'worker.js'))) fail('worker/ missing');
const adminHtml = readFileSync(join(ROOT, 'admin', 'index.html'), 'utf8');
const editorSettingKeys = [...adminHtml.matchAll(/data-setting="([^"]+)"/g)].map((match) => match[1]);
for (const key of new Set(editorSettingKeys)) {
  if (data.settings?.[key] == null || data.settings[key] === '') {
    fail(`Editor field data-setting=${key} has no current value in data/site.json`);
  }
}
if (!data.settings?.seasonImage) fail('Seasonal editor image setting is missing');
if (!data.settings?.seasonImageAlt) fail('Seasonal editor image description is missing');

/* image path style: relative, no leading slash required but warn absolute */
for (const img of imageRefs) {
  if (!img || typeof img !== 'string') {
    fail('Empty image path in data');
    continue;
  }
  if (img.startsWith('http://')) fail(`Insecure image URL: ${img}`);
  if (img.startsWith('/')) warn(`Root-absolute image path (may break project Pages base): ${img}`);
}

/* every theme tag should resolve to a theme in settings, otherwise a rename
   or delete left an orphan that would never show up in the shop filters */
{
  const vocab = new Set(
    (Array.isArray(data.settings?.themes) ? data.settings.themes : [])
      .map((s) => String(typeof s === 'string' ? s : s?.label || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const seenTags = new Set();
  for (const p of data.products || []) {
    if (p.theme && !p.oneOfAKind) {
      warn(`Product "${p.name}" carries a theme but is not one of a kind. Themes belong to individual pieces.`);
    }
    const tags = [['product', p.name, p.theme], ...(p.listings || []).map((l) => ['listing', l.name, l.theme])];
    for (const [kind, name, value] of tags) {
      const clean = String(value || '').trim().replace(/\s+/g, ' ');
      if (!clean) continue;
      seenTags.add(clean);
      if (!vocab.has(clean.toLowerCase())) {
        warn(`Theme "${clean}" on ${kind} "${name}" is not in settings.themes, so shoppers cannot filter by it.`);
      }
    }
  }
  for (const entry of Array.isArray(data.archive) ? data.archive : []) {
    const piece = entry && entry.kind === 'product' ? entry.product : entry;
    const tags = piece ? [['archived piece', piece.name, piece.theme]] : [];
    for (const [kind, name, value] of tags) {
      const clean = String(value || '').trim().replace(/\s+/g, ' ');
      if (!clean) continue;
      seenTags.add(clean);
      if (!vocab.has(clean.toLowerCase())) {
        warn(`Theme "${clean}" on ${kind} "${name}" is not in settings.themes, so shoppers cannot filter by it.`);
      }
    }
  }
  themeTagCount = seenTags.size;
}

/* scan HTML for secrets / bad checkout placeholders */
for (const file of walkHtml(ROOT)) {
  const html = readFileSync(file, 'utf8');
  if (/github_pat_|sk_live_|sk_test_|whsec_/i.test(html)) {
    fail(`Possible secret in ${file.replace(ROOT + '/', '')}`);
  }
}

console.log('Validation report');
if (warnings.length) {
  console.log(`Warnings (${warnings.length}):`);
  warnings.forEach((w) => console.log('  ⚠ ' + w));
}
if (failures.length) {
  console.log(`Failures (${failures.length}):`);
  failures.forEach((f) => console.log('  ✖ ' + f));
  process.exit(1);
}
console.log(`OK: ${ids.size} products, ${imageRefs.size} image refs, ${themeTagCount} theme tag(s) checked.`);
process.exit(0);
