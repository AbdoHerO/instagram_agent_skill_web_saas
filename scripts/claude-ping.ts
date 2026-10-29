// Sends ONE short text request to Claude to check the API key and model: `npm run ai:ping`.
// No retries, low effort, at most 512 output tokens. It does not touch the database,
// Meta or publishing, and never prints the API key.
import Anthropic from '@anthropic-ai/sdk';

import { loadLocalEnv } from './load-env';

loadLocalEnv();

const { env } = await import('../src/server/env');
const { claudeClient } = await import('../src/server/ai/client');

const config = env();
if (!config.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Add it to .env.local (never to .env.example or Git).');
  process.exit(1);
}

const MAX_TOKENS = 512;
console.log(`Model: ${config.CLAUDE_MODEL} | effort: low | max output: ${MAX_TOKENS} tokens | retries: none`);
console.log(`Workspace header: ${config.ANTHROPIC_WORKSPACE_ID ?? 'none (the key must be scoped to a workspace)'}`);
console.log(`Publishing mode: ${config.PUBLISHING_MODE} (not used by this check)`);

const client = claudeClient(config, { maxRetries: 0, timeout: 60_000 })!;
try {
  const response = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: 'In one short sentence, say hello to the Euro Digital marketing team.' }],
  });
  if (response.stop_reason === 'refusal') {
    console.error('Claude declined the request (stop reason: refusal). The key works.');
    process.exit(1);
  }
  const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(' ').trim();
  console.log(`Reply: ${text.slice(0, 300) || '(no text: the output limit was reached while thinking)'}`);
  console.log(`Stop reason: ${response.stop_reason} | tokens in: ${response.usage.input_tokens}, out: ${response.usage.output_tokens}`);
  console.log(`Request ID: ${response._request_id ?? 'n/a'}`);
  console.log('Claude API: OK');
} catch (error) {
  const apiMessage = error instanceof Anthropic.APIError ? (error.error as { error?: { message?: string } } | undefined)?.error?.message : undefined;
  const workspaceHint = apiMessage?.includes('anthropic-workspace-id') || apiMessage?.startsWith('Workspace ')
    ? ' Set ANTHROPIC_WORKSPACE_ID in .env to the workspace ID (wrkspc_…) shown in the Claude Console under Settings > Workspaces, or use a key scoped to one workspace.'
    : '';
  const message = error instanceof Anthropic.AuthenticationError ? 'The API key was refused (401). Use a standard API key from the Claude Console (API keys page).'
    : error instanceof Anthropic.PermissionDeniedError ? `The key is not allowed to use this API or model (403). ${apiMessage ?? ''}`
    : error instanceof Anthropic.NotFoundError ? `Model "${config.CLAUDE_MODEL}" is not available to this key (404). Check CLAUDE_MODEL.`
    : error instanceof Anthropic.RateLimitError ? 'Rate limited (429). Wait a minute before trying again.'
    : error instanceof Anthropic.APIConnectionError ? 'Could not reach the Anthropic API (network or proxy).'
    : error instanceof Anthropic.APIError ? `Anthropic API error (${error.status ?? 'unknown'}): ${apiMessage ?? 'no details'}`
    : `Unexpected error: ${error instanceof Error ? error.name : 'unknown'}`;
  console.error(message + workspaceHint);
  process.exit(1);
}
