# Alivia's Treasured Threads 🧵

Handmade-with-love shop site + **Alivia's Studio**, a built-in admin where Alivia manages
products, photos, listings, and prices herself — no code, no Nathan required (after setup).

- **Live shop:** https://arcane-designer.github.io/alivias-treasured-threads/
- **Alivia's Studio (admin):** https://arcane-designer.github.io/alivias-treasured-threads/admin/
  (also reachable from the tiny 🧵 in the site footer)

## How it works

The whole site is static and free, hosted on GitHub Pages:

- `data/site.json` — the single source of truth: shop settings + every product, photo path,
  listing, and price. **The public site reads it, the Studio writes it.**
- `admin/` — Alivia's Studio. It talks directly to the GitHub API with a repo-scoped token
  ("magic key"). Publishing = one commit to `main` (new photos + updated `site.json`), and
  GitHub Pages redeploys automatically in ~1 minute.
- Every publish is a git commit, so **every change Alivia ever makes can be undone** with a
  revert. Photos are compressed in the browser (max 1400px JPEG) before upload.

```
website/
├── index.html            ← the shop
├── assets/site.css/.js   ← shop styles + behavior (basket, modal, lightbox…)
├── admin/                ← Alivia's Studio (login, editor, publish)
├── data/site.json        ← ALL shop content lives here
└── images/
    ├── products/  available/  brand/   ← original photos
    └── uploads/   ← photos Alivia adds from the Studio land here
```

## One-time setup for Alivia (Nathan does this)

### 1. Make her "magic key" (a fine-grained GitHub token)

1. Go to **github.com → Settings → Developer settings →
   [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)**
   (do this signed in to the **Arcane-Designer** account, since it owns the repo).
2. Fill in:
   - **Name:** `Alivia's Studio`
   - **Expiration:** custom → pick the longest allowed (set a reminder to renew).
   - **Repository access:** *Only select repositories* → `alivias-treasured-threads`
   - **Permissions → Repository permissions → Contents: Read and write** (leave the rest alone)
3. Generate and copy the `github_pat_…` string.
4. On **Alivia's device**, open the Studio, paste it in, tap *Unlock my studio*. Done —
   it stays signed in on that device. Repeat the paste on each device she uses.

If the key ever leaks or expires, just delete it on GitHub and make a new one — the shop
itself is never at risk (the key can only edit this one repo's files).

### 2. Make the order form deliver (pick one, both live in Studio → Shop Settings)

- **Best: Web3Forms (free).** Sign up at [web3forms.com](https://web3forms.com) with the email
  that should receive orders → copy the **access key** → paste it into *Shop Settings →
  Web3Forms key* → Publish. Orders now email automatically with a summary of the
  shopper's basket.
- **Fallback: plain email.** Set *Shop Settings → contact email* to a real address. Without a
  Web3Forms key, the form opens the shopper's own email app pre-filled instead.
- With neither set, the form politely tells shoppers to DM on Instagram.

## What Alivia can do in the Studio

- **Add a product** (name, price or "custom order," description, photos, sticker badges)
- **Mark a product one-of-a-kind** (bundles, single finished pieces) — it becomes its own
  listing: shoppers add it straight to their basket and it skips the custom-order menu
- **Add ready-to-ship listings** to any product, each with its own name + photos
- **Mark listings sold** (shows a cute SOLD sticker on the shop) or delete them
- **Hide/unhide whole products** (archive keeps them saved, just off the shop)
- **Edit anything** — prices, wording, photo order (first photo = cover), product order
- **Preview before publishing** (👀 Preview shows the draft shop in a new tab)
- **Publish** — changes go live in about a minute 🎉

Unfinished edits auto-save on her device and are offered back next time she opens the Studio.

## Restoring the old site (v1)

Three independent safety nets:

1. **Git tag/branch** — the pre-refresh site is `v1` (tag) and `v1-original` (branch):
   ```bash
   git checkout main && git revert --no-edit v1..main && git push
   # or, nuclear option (rewrites history):
   git push origin v1-original:main --force
   ```
2. **Folder backup** — a plain copy of the old site sits next to this folder:
   `ATT Brand/website-v1-backup/`
3. **Every Studio publish is its own commit** — `git revert <sha>` undoes any single update.

## Local development

Any static server works — data loads via `fetch`, so `file://` won't:

```bash
cd website && python3 -m http.server 4173   # → http://localhost:4173
```

To point the Studio at a scratch branch while testing (instead of live `main`):
`localStorage.setItem('att-studio-branch', 'my-test-branch')` on the admin page
(and create that branch on GitHub first). Remove the key to go back to `main`.
