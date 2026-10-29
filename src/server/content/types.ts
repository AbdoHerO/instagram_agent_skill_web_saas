import { z } from 'zod';

/**
 * The content of one draft version. The AI service produces it (structured
 * output), people edit it, and an approval covers its exact hash.
 */
export const LANGUAGES = ['fr', 'ar', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const productFactSchema = z.object({
  productId: z.number().int(),
  name: z.string(),
  sku: z.string().nullable(),
  priceTtc: z.number().nullable(),
  compareAtTtc: z.number().nullable(),
  inStock: z.boolean().nullable(),
  condition: z.string().nullable(),
  warrantyMonths: z.number().nullable(),
  url: z.string().nullable(),
  fetchedAt: z.string(),
});
export type ProductFact = z.infer<typeof productFactSchema>;

export const contentPayloadSchema = z.object({
  language: z.enum(LANGUAGES),
  hooks: z.array(z.object({ text: z.string(), formula: z.string() })).default([]),
  caption: z.string().default(''),
  cta: z.string().default(''),
  hashtags: z.array(z.string()).default([]),
  altText: z.string().default(''),
  script: z.array(z.object({ line: z.string(), onScreen: z.string() })).default([]),
  slides: z.array(z.object({ heading: z.string(), body: z.string() })).default([]),
  storyFrames: z.array(z.object({ text: z.string(), sticker: z.string() })).default([]),
  plan: z.array(z.object({ day: z.string(), format: z.string(), idea: z.string(), time: z.string() })).default([]),
  notes: z.string().default(''),
  needsVerification: z.array(z.object({ field: z.string(), reason: z.string() })).default([]),
  productFacts: z.array(productFactSchema).default([]),
});
export type ContentPayload = z.infer<typeof contentPayloadSchema>;

export type ValidationIssue = { code: string; message: string; blocking: boolean };

export type VersionValidation = {
  issues: ValidationIssue[];
  /** Results of the installed skill tools (advisory), when Python was available. */
  tools?: Record<string, unknown>;
  checkedAt: string;
};
