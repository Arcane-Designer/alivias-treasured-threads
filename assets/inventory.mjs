/* Public sold state contains exact piece IDs and opaque sale versions only. */
export function inventoryKey(product, listing) {
  return listing ? `listing:${product.id}:${listing.id}` : `oneoff:${product.id}`;
}

export function applySales(catalog, sales) {
  const byKey = new Map(sales.map(sale => [sale.inventoryKey, sale.saleVersion]));
  let changed = false;
  for (const product of catalog.products || []) {
    if (product.archived) continue;
    const pieces = product.oneOfAKind ? [product] : (product.listings || []);
    for (const piece of pieces) {
      const version = byKey.get(inventoryKey(product, product.oneOfAKind ? null : piece));
      if (!version || piece.availableAfterSale === version) continue;
      if (!piece.sold || piece.stripeSaleVersion !== version) changed = true;
      piece.sold = true;
      piece.stripeSaleVersion = version;
    }
  }
  return changed;
}

export function setSold(piece, sold) {
  piece.sold = !!sold;
  // An explicit Studio action acknowledges this specific sale, not future sales.
  if (!sold && piece.stripeSaleVersion) piece.availableAfterSale = piece.stripeSaleVersion;
}

export async function fetchSales(catalog, fetcher = fetch) {
  const settings = catalog.settings || {};
  const local = /^(localhost|127\.0\.0\.1)$/.test(globalThis.location?.hostname || '');
  const base = String((local && settings.checkoutTestApiUrl) || settings.checkoutApiUrl || settings.reviewInboxUrl || '').replace(/\/+$/, '');
  if (!base || settings.checkoutEnabled !== true) return [];
  const response = await fetcher(base + '/inventory/sold', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Sold status is temporarily unavailable');
  const body = await response.json();
  if (!Array.isArray(body.sales) || body.sales.some(s => typeof s.inventoryKey !== 'string' || !/^[a-f0-9]{64}$/.test(s.saleVersion))) throw new Error('Invalid sold status');
  return body.sales;
}
