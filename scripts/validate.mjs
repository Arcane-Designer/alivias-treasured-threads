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

/* generated product pages */
const productRoot = join(ROOT, 'product');
if (!existsSync(productRoot)) {
  fail('product/ directory missing. Run: node scripts/generate-pages.mjs');
} else {
  for (const id of ids) {
    const page = join(productRoot, id, 'index.html');
    if (!existsSync(page)) {
      fail(`Missing generated page: product/${id}/index.html`);
      continue;
    }
    const html = readFileSync(page, 'utf8');
    if (!html.includes(`data-product-id="${id}"`)) {
      fail(`product/${id}/index.html missing data-product-id`);
    }
    /* nested depth: assets must be ../../assets */
    if (!html.includes('href="../../assets/site.css"')) {
      fail(`product/${id}/index.html broken CSS relative path`);
    }
    if (!html.includes('src="../../assets/site.js"')) {
      fail(`product/${id}/index.html broken JS relative path`);
    }
    if (!html.includes('href="../../shop/"')) {
      fail(`product/${id}/index.html missing shop link at ../../shop/`);
    }
    /* no secrets in browser */
    if (/github_pat_|sk_live|sk_test|whsec_/i.test(html)) {
      fail(`product/${id}/index.html appears to contain a secret`);
    }
  }
  /* orphan product dirs */
  for (const name of readdirSync(productRoot)) {
    if (!ids.has(name)) warn(`Orphan product dir not in site.json: product/${name}`);
  }
}

/* top-level pages */
for (const rel of ['index.html', 'shop/index.html', 'custom/index.html', 'about/index.html', 'faq/index.html']) {
  if (!existsSync(join(ROOT, rel))) fail(`Missing page: ${rel}`);
}

/* sitemap / robots */
if (!existsSync(join(ROOT, 'sitemap.xml'))) fail('sitemap.xml missing. Run generate-pages');
else {
  const sm = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  if (!sm.includes('<urlset')) fail('sitemap.xml invalid');
  for (const id of ids) {
    const p = (data.products || []).find((x) => x.id === id);
    if (p && !p.archived && !sm.includes(`/product/${id}/`)) {
      fail(`sitemap missing active product ${id}`);
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
console.log(`OK: ${ids.size} products, ${imageRefs.size} image refs checked.`);
process.exit(0);
