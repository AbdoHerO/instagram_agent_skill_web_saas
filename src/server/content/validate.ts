import type { DraftKind } from './workflow';
import type { ContentPayload, ValidationIssue } from './types';

export const HASHTAG_LIMIT = 5; // Instagram cap since 18 December 2025 (checked by ig-caption too)
export const CAPTION_LIMIT = 2200;

const PLACEHOLDER = /\{\{[^}]*\}\}/;
const PRICE = /(\d[\d\s.,]*)\s*(?:mad|dh|dhs|درهم)\b/giu;
const PERCENT = /-?\d+(?:[.,]\d+)?\s*%/g;
const RISKY_CLAIMS: { pattern: RegExp; code: string; message: string }[] = [
  { pattern: /\b(garantie|warranty|ضمان)\b/iu, code: 'warranty_claim', message: 'Mentions a warranty: check it matches the product data.' },
  { pattern: /\b(livraison (gratuite|offerte|en \d+)|free delivery|delivered in|توصيل مجاني)\b/iu, code: 'delivery_claim', message: 'Mentions delivery terms: only state what the shop confirms.' },
  { pattern: /\b(stock limité|limited stock|dernières? pièces?|last units?|كمية محدودة)\b/iu, code: 'stock_claim', message: 'Mentions limited stock: only if the product data says so.' },
  { pattern: /\b(le moins cher|meilleur prix|cheapest|best price|imbattable|الأرخص)\b/iu, code: 'superlative_claim', message: 'Superlative price claim without proof.' },
  { pattern: /\b(avis clients?|testimonial|★|⭐)\b/iu, code: 'review_claim', message: 'Looks like a review or testimonial: only real, sourced ones.' },
];

function textOf(payload: ContentPayload): string {
  return [
    payload.caption,
    payload.cta,
    payload.altText,
    ...payload.hooks.map((h) => h.text),
    ...payload.script.flatMap((s) => [s.line, s.onScreen]),
    ...payload.slides.flatMap((s) => [s.heading, s.body]),
    ...payload.storyFrames.map((f) => f.text),
  ].join('\n');
}

function numbersIn(value: string): number[] {
  return [...value.matchAll(/\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(/[\s.](?=\d{3}\b)/g, '').replace(',', '.')));
}

/**
 * Checks every version before it can be approved. Blocking issues must be
 * fixed by editing; the rest are warnings for the reviewer. Prices and
 * percentages must match the product data snapshot attached to the draft.
 */
export function validateContent(kind: DraftKind, payload: ContentPayload, hasMedia: boolean): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const all = textOf(payload);

  if (PLACEHOLDER.test(all)) {
    issues.push({ code: 'placeholder', message: 'Contains {{…}} placeholders: replace them with confirmed information.', blocking: true });
  }
  for (const item of payload.needsVerification) {
    issues.push({ code: 'needs_verification', message: `${item.field}: ${item.reason}`, blocking: true });
  }
  if (payload.hashtags.length > HASHTAG_LIMIT) {
    issues.push({ code: 'hashtags', message: `${payload.hashtags.length} hashtags: Instagram allows ${HASHTAG_LIMIT}.`, blocking: true });
  }
  const captionWithTags = [payload.caption, payload.hashtags.join(' ')].join('\n\n').trim();
  if (captionWithTags.length > CAPTION_LIMIT) {
    issues.push({ code: 'caption_length', message: `Caption is ${captionWithTags.length} characters; the limit is ${CAPTION_LIMIT}.`, blocking: true });
  }
  if ((kind === 'feed_image' || kind === 'reel') && !payload.caption.trim()) {
    issues.push({ code: 'caption_empty', message: 'A feed post or Reel needs a caption.', blocking: true });
  }
  if ((kind === 'feed_image' || kind === 'reel') && !hasMedia) {
    issues.push({ code: 'media_missing', message: kind === 'reel' ? 'Attach the Reel video (MP4) before scheduling.' : 'Attach the image (JPEG) before scheduling.', blocking: false });
  }

  // Prices: every amount in MAD must be a price from the product data.
  const knownPrices = payload.productFacts.flatMap((f) => [f.priceTtc, f.compareAtTtc]).filter((p): p is number => p !== null);
  for (const match of all.matchAll(PRICE)) {
    const amounts = numbersIn(match[1] ?? '');
    const amount = amounts[0];
    if (amount === undefined) continue;
    if (!knownPrices.some((p) => Math.abs(p - amount) < 0.5)) {
      issues.push({ code: 'unverified_price', message: `"${match[0].trim()}" is not a price from the product data.`, blocking: true });
    }
  }
  // Percentages: allowed only when the product data shows that saving.
  const knownSavings = payload.productFacts
    .filter((f) => f.priceTtc !== null && f.compareAtTtc !== null && f.compareAtTtc > f.priceTtc)
    .map((f) => Math.floor(((f.compareAtTtc! - f.priceTtc!) / f.compareAtTtc!) * 100));
  for (const match of all.matchAll(PERCENT)) {
    const value = Math.abs(numbersIn(match[0])[0] ?? NaN);
    if (!knownSavings.some((s) => Math.abs(s - value) <= 1)) {
      issues.push({ code: 'unverified_discount', message: `"${match[0].trim()}" is not a discount shown in the product data.`, blocking: true });
    }
  }
  for (const claim of RISKY_CLAIMS) {
    if (!claim.pattern.test(all)) continue;
    const supported = claim.code === 'warranty_claim' && payload.productFacts.some((f) => f.warrantyMonths);
    if (!supported) issues.push({ code: claim.code, message: claim.message, blocking: false });
  }
  return issues;
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.blocking);
}
