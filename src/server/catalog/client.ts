import { z } from 'zod';

import type { ProductFact } from '@/server/content/types';

/**
 * Read-only access to Euro Digital's product data through the e-commerce
 * backend's public API (GET merchant/products, merchant/products/{id}). This
 * app never writes to it and never copies the catalogue: a product's facts are
 * fetched when a draft uses it and stored with that draft only.
 *
 * The API gives prices tax-exclusive (HT) with the tax rate; posts show the
 * price the customer pays (TTC), computed the same way as the website.
 */
const apiProduct = z.object({
  id: z.number(),
  name: z.string(),
  sku: z.string().nullable().optional(),
  price: z.number(),
  compare_at_price: z.number().nullable().optional(),
  tax_rate: z.number(),
  in_stock: z.boolean().optional(),
  brand: z.string().nullable().optional(),
  condition_label: z.string().nullable().optional(),
  warranty_months: z.number().nullable().optional(),
  image: z.string().nullable().optional(),
});
export type CatalogProduct = z.infer<typeof apiProduct>;

export type CatalogConfig = { baseUrl: string | undefined; storefrontUrl?: string; fetchImpl?: typeof fetch; locale?: string };

export class CatalogUnavailableError extends Error {}

const ttc = (ht: number, rate: number) => Math.round(ht * (1 + rate / 100) * 100) / 100;

async function get(config: CatalogConfig, path: string): Promise<unknown> {
  if (!config.baseUrl) throw new CatalogUnavailableError('ECOMMERCE_API_URL is not configured');
  const response = await (config.fetchImpl ?? fetch)(`${config.baseUrl.replace(/\/+$/, '')}/${path}`, {
    headers: { Accept: 'application/json', 'Accept-Language': config.locale ?? 'fr' },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new CatalogUnavailableError(`Catalogue API answered ${response.status}`);
  return response.json();
}

export async function searchProducts(config: CatalogConfig, search: string, limit = 12): Promise<CatalogProduct[]> {
  const params = new URLSearchParams({ per_page: String(Math.min(limit, 50)) });
  if (search.trim()) params.set('search', search.trim().slice(0, 100));
  const data = z.object({ data: z.array(apiProduct) }).parse(await get(config, `merchant/products?${params}`));
  return data.data;
}

export async function getProduct(config: CatalogConfig, id: number): Promise<CatalogProduct> {
  const data = z.object({ data: apiProduct }).parse(await get(config, `merchant/products/${id}`));
  return data.data;
}

export function toFact(product: CatalogProduct, storefrontUrl?: string): ProductFact {
  const priceTtc = product.price > 0 ? ttc(product.price, product.tax_rate) : null;
  const compareAtTtc = product.compare_at_price && product.compare_at_price > product.price ? ttc(product.compare_at_price, product.tax_rate) : null;
  return {
    productId: product.id,
    name: product.name,
    sku: product.sku ?? null,
    priceTtc,
    compareAtTtc,
    inStock: product.in_stock ?? null,
    condition: product.condition_label ?? null,
    warrantyMonths: product.warranty_months ?? null,
    url: storefrontUrl ? `${storefrontUrl.replace(/\/+$/, '')}/fr/products/${product.id}` : null,
    fetchedAt: new Date().toISOString(),
  };
}

/** Facts for the products a request names (missing or failing ones are reported, never guessed). */
export async function factsFor(config: CatalogConfig, ids: number[]): Promise<{ facts: ProductFact[]; missing: number[] }> {
  const facts: ProductFact[] = [];
  const missing: number[] = [];
  for (const id of [...new Set(ids)].slice(0, 5)) {
    try {
      facts.push(toFact(await getProduct(config, id), config.storefrontUrl));
    } catch {
      missing.push(id);
    }
  }
  return { facts, missing };
}
