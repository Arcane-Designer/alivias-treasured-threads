# Alivia's Treasured Threads - Storefront 2.0 (staging)

Polished multi-page storefront rebuild for **staging / isolated worktree use only**.
Do not deploy, push, or point live GitHub Pages at this tree until you explicitly promote it.

- **Canonical content:** `data/site.json` (unchanged contract for Alivia's Studio)
- **Admin:** `admin/` preserved; same GitHub magic-key publish flow
- **Reviews:** form → Cloudflare Worker inbox + Web3Forms email (unchanged)
- **Ready inventory:** basket → server-validated Stripe-hosted Checkout in test mode
- **Custom requests:** multi-design form → existing Web3Forms / mailto fallback

Live shop (current): https://arcane-designer.github.io/alivias-treasured-threads/

---

## Customer-facing architecture

| Path | Role |
|------|------|
| `/` | Brand / story home, selected products, compact about + reviews, paths into shop & custom |
| `/shop/` | Finished inventory available now, with optional type and season chips |
| `/shop/<id>/` | Crawlable ready-inventory detail page per canonical `site.json` design id (generated) |
| `/checkout/` | Persisted ready-inventory summary and secure hosted-checkout handoff |
| `/checkout/success/` | Server-verified payment confirmation; clears the basket only after verification |
| `/checkout/cancel/` | Honest cancel state; preserves the basket |
| `/custom/` | Multi-design, per-quantity custom request flow; no payment collection |
| `/product/<id>/` | Noindex compatibility redirects to Shop or the matching Custom selection |
| `/about/` | Real about copy with FAQ/policies at `#faq` |
| `/reviews/` | Dedicated leave-a-note form using the preserved Worker + email flow |
| `/faq/` | Noindex compatibility bridge to `/about/#faq` for old links only |

---

## Design

v4 (2026-08-21, after Alivia's review): the original live-site brand walked back in
at ~80% on top of the v3 architecture. Restored from the live site: the purple/pink/
teal palette (`#8E79DD` / `#FF74D4` / `#4FE4BC`), Dancing Script + Cormorant Garamond
for scripts/headings, the stacked script-over-serif wordmark (the home link; no Home
nav item), stitched dashed borders and "sewn patch" cards with tiny tilts, thread-and-
needle dividers, polka-dot paper, the gingham band, pill buttons with inner stitching,
the purple circle basket FAB with pink count, the stitched basket drawer, lively review
patches (quote mark, pink stars, script names), and the scalloped dark footer.
Kept from v3 (the mature 20%): system-sans body at 16px/1.65, section rhythm and
spacing, photo-led layouts, and slightly deepened text colors for readability.

Structure notes: FAQ content lives on `/about/#faq`; `/faq/` remains only as a
noindex compatibility bridge that redirects there (excluded from the sitemap).
Cross-page anchors like `/custom/?design=<id>#customRequest` are re-scrolled by
`site.js` after data renders, with `scroll-margin-top` clearing the sticky header.

---

## Local preview

Any static server works (`fetch` needs http):

```bash
cd alivia-storefront-2.0
python3 -m http.server 4173
# → http://localhost:4173
```

Studio preview still works: admin writes `att-preview-data` and opens the shop with `?preview=1`.

---

## Page generation

Product HTML is **data-driven**. After editing `data/site.json` (or after Studio publish in a future integrated flow):

```bash
node scripts/generate-pages.mjs
# optional public origin for canonicals + sitemap:
node scripts/generate-pages.mjs --base https://arcane-designer.github.io/alivias-treasured-threads
```

Outputs:

- `shop/<id>/index.html` for every active product, including honest made-to-order pages when finished inventory is unavailable
- `product/<id>/index.html` noindex compatibility redirects
- `sitemap.xml` (all active Shop products plus the dedicated review route)
- `robots.txt`

Zero npm dependencies. Nested product pages use `../../assets` and `../../images` so relative paths stay valid.

### Validation

```bash
node scripts/validate.mjs
```

Checks: JSON schema basics, duplicate ids, generated pages present, relative path depth, accidental checkout placeholders, secret-looking strings, sitemap coverage.

### Staging-only workflow

`.github/workflows/generate-pages.yml` builds an **artifact** on `workflow_dispatch`.
It does **not** deploy Pages or push to `main`. Read the comments in that file before enabling any push automation.

**Migration implications:** either (a) commit generated `product/` pages in the same Studio publish commit, or (b) generate in CI on a staging branch and promote deliberately. If `site.json` gains a product id before generation runs, crawlers get 404 until pages exist.

---

## Stripe Checkout staging boundary

`worker/worker.js` creates Checkout Sessions from canonical `site.json` inventory and prices. The browser sends IDs only. Stripe hosts every payment field; this site never handles card data. D1 reservations block duplicate sale attempts and paid records stay blocked until Alivia marks the corresponding listing sold in Studio.

No credentials are committed. See `worker/.dev.vars.example`, `worker/schema.sql`, and `STRIPE-OPERATIONS.md`. This branch is hard-gated to `PAYMENTS_MODE=test`; live activation requires a separate reviewed change.

---

## Content fields (`data/site.json`)

| Area | Notes |
|------|--------|
| `settings.*` | Brand strings, Instagram, contact email, Web3Forms key, review inbox URL, checkout API URL/flag |
| `products[]` | `id`, `name`, `price` / `priceLabel`, `description`, `images`, `listings`, `badges`, `archived`, `oneOfAKind`, `salePrice`, `priceTiers`, optional `descriptionLink` |
| Optional future | `checkoutUrl` / `paymentLink`, `season`, `itemType`, `tags`; filters already read them when present |
| `reviews[]` | Curated; `show: true` to display |

Admin continues to own writes to this file. Do not put secrets in browser-readable JSON beyond the existing public Web3Forms access key pattern.

---

## Staging / live boundary

| Safe here | Not in this pass |
|-----------|------------------|
| Local static preview | Deploy / `git push` to live Pages |
| Generate + validate scripts | Activating the workflow for production |
| Test-mode hosted Checkout code and fixtures | Stripe account changes, credentials, webhook registration, or live mode |
| Draft policy labels | Invented shipping/returns/legal claims |
| Studio content contract unchanged | Automatic paid-order edits to `site.json` |

Promote only from an isolated worktree after visual QA and `node scripts/validate.mjs`.

---

## Admin compatibility

- Studio still reads/writes `data/site.json` and `images/uploads/`
- Preview: `../` + `?preview=1` + `localStorage att-preview-data`
- Footer 🧵 still links to `admin/`
- Review inbox Worker auth and rate limits unchanged
- No admin code changes required for Storefront 2.0

If product pages must appear the moment Studio publishes, extend the publish commit to run `node scripts/generate-pages.mjs` and include `product/`, `sitemap.xml`, and `robots.txt` (or use the staging artifact workflow and merge deliberately).

---

## Security / quality notes

- DOM updates use escaped text / attribute encoding in generators and client JS
- Review honeypot (`website`) + Worker IP rate limit preserved
- Order form honeypot (`botcheck`) preserved
- External links use `rel="noopener noreferrer"`
- Reduced-motion respected in CSS
- Keyboard-friendly filters, drawer, lightbox
- Images: lazy loading on grids; product main image eager

---

## Restoring / comparing

Keep the previous single-page site on a git tag or branch. This tree is additive architecture (multi-page + generator) with the same data contract.
