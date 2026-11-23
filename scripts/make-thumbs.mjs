#!/usr/bin/env node
/**
 * Make the small (240px) and medium (640px) copies the shop shows in listing
 * rows, cards, and the basket, under images/thumbs/<size>/<same path>.
 *
 * The Studio makes these itself for every photo it uploads, so this is only
 * for photos that arrived some other way (or to rebuild them all). macOS
 * only: it uses the built-in `sips` tool, keeping the repo dependency-free.
 *
 *   node scripts/make-thumbs.mjs           # make any that are missing
 *   node scripts/make-thumbs.mjs --force   # rebuild every copy
 */
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const THUMB_SIZES = { sm: 240, md: 640 };
const QUALITY = { sm: 70, md: 70 };
const force = process.argv.includes('--force');

export function referencedImages(data) {
  const out = new Set();
  const add = (p) => { if (typeof p === 'string' && /^images\/(?!thumbs\/).+\.jpe?g$/i.test(p)) out.add(p); };
  const piece = (p) => { (p.images || []).forEach(add); (p.listings || []).forEach((l) => (l.images || []).forEach(add)); };
  (data.products || []).forEach(piece);
  (data.archive || []).forEach((e) => piece(e && e.kind === 'product' ? e.product || {} : e || {}));
  add(data.settings && data.settings.seasonImage);
  add('images/brand/logo.jpg'); /* the stand-in photo for anything without one */
  return [...out];
}

export function thumbPath(path, size) {
  return 'images/thumbs/' + size + '/' + path.slice('images/'.length);
}

function longEdge(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const nums = [...out.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map((m) => +m[1]);
  return Math.max(...nums);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = JSON.parse(readFileSync(join(ROOT, 'data', 'site.json'), 'utf8'));
  let made = 0, skipped = 0, missing = 0, failed = 0;
  for (const path of referencedImages(data)) {
    const src = join(ROOT, path);
    if (!existsSync(src)) { missing++; console.warn('missing original: ' + path); continue; }
    let edge = null;
    for (const [size, px] of Object.entries(THUMB_SIZES)) {
      const out = join(ROOT, thumbPath(path, size));
      if (!force && existsSync(out)) { skipped++; continue; }
      try {
        mkdirSync(dirname(out), { recursive: true });
        edge = edge || longEdge(src);
        if (edge <= px) copyFileSync(src, out); /* never upscale */
        else execFileSync('sips', ['-Z', String(px), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(QUALITY[size]), src, '--out', out], { stdio: 'ignore' });
        made++;
      } catch (err) {
        failed++;
        console.warn('could not make ' + size + ' copy of ' + path + ': ' + err.message);
      }
    }
  }
  console.log(`thumbnails: ${made} made, ${skipped} already present, ${missing} originals missing, ${failed} failed`);
}
