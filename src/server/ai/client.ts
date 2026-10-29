import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';

import type { Env } from '@/server/env';

/**
 * The Claude client, built from the server configuration (null without a key).
 * A key that is not scoped to a workspace must name the workspace on every
 * request (anthropic-workspace-id header), otherwise the API answers 400.
 */
export function claudeClient(config: Pick<Env, 'ANTHROPIC_API_KEY' | 'ANTHROPIC_WORKSPACE_ID'>, options: Omit<ClientOptions, 'apiKey' | 'defaultHeaders'> = {}): Anthropic | null {
  if (!config.ANTHROPIC_API_KEY) return null;
  return new Anthropic({
    ...options,
    apiKey: config.ANTHROPIC_API_KEY,
    defaultHeaders: config.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': config.ANTHROPIC_WORKSPACE_ID } : undefined,
  });
}
