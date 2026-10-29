import { z } from 'zod';

import { LANGUAGES } from '@/server/content/types';

/** What the AI Content Studio sends. Validated before anything reaches Claude. */
export const PURPOSES = ['general', 'product_launch', 'education', 'comparison', 'promotion', 'repurpose', 'weekly_plan'] as const;
export const REQUEST_KINDS = ['reel', 'feed_image', 'carousel', 'story', 'plan', 'idea'] as const;

export const generationRequestSchema = z.object({
  kind: z.enum(REQUEST_KINDS),
  purpose: z.enum(PURPOSES).default('general'),
  topic: z.string().trim().min(3, 'Describe the topic in a few words').max(2000),
  language: z.enum(LANGUAGES).default('fr'),
  productIds: z.array(z.coerce.number().int().positive()).max(5).default([]),
  sourceMaterial: z.string().max(20_000).default(''),
  keywords: z.string().max(300).default(''),
  extraInstructions: z.string().max(1000).default(''),
});
export type GenerationRequest = z.infer<typeof generationRequestSchema>;

/**
 * The structured output Claude must return (JSON schema enforced by the API,
 * parsed again here). Every field is present; unused sections are empty.
 */
export const generatedContentSchema = z.object({
  title: z.string().describe('Short internal title for the draft (not posted)'),
  hooks: z.array(z.object({ text: z.string(), formula: z.string().describe('Name of the hook formula used, or "none"') })),
  caption: z.string().describe('Caption body without hashtags; first line must work within ~125 characters'),
  cta: z.string().describe('One call to action'),
  hashtags: z.array(z.string()).describe('At most 5 hashtags, each starting with #'),
  altText: z.string().describe('Image description for accessibility (feed images), else empty'),
  script: z.array(z.object({ line: z.string(), onScreen: z.string() })).describe('Reel lines in speaking order, with on-screen text'),
  slides: z.array(z.object({ heading: z.string(), body: z.string() })).describe('Carousel slides, cover first'),
  storyFrames: z.array(z.object({ text: z.string(), sticker: z.string() })).describe('Story frames in order'),
  plan: z.array(z.object({ day: z.string(), format: z.string(), idea: z.string(), time: z.string() })).describe('Weekly plan rows'),
  notes: z.string().describe('Notes for the reviewer: what to film or design, what to check'),
  needsVerification: z.array(z.object({ field: z.string(), reason: z.string() })).describe('Every fact you needed but were not given'),
});
export type GeneratedContent = z.infer<typeof generatedContentSchema>;
