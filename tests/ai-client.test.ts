import { describe, expect, it } from 'vitest';

import { claudeClient } from '@/server/ai/client';

/** Records the request headers and answers like the Messages API; nothing leaves the machine. */
function recordingFetch() {
  const headers: Headers[] = [];
  const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    headers.push(new Headers(init?.headers));
    return new Response(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Hello' }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, headers };
}

const ping = { model: 'claude-opus-5-5', max_tokens: 16, messages: [{ role: 'user' as const, content: 'Hi' }] };

describe('Claude client', () => {
  it('is not created without a key', () => {
    expect(claudeClient({ ANTHROPIC_API_KEY: undefined, ANTHROPIC_WORKSPACE_ID: undefined })).toBeNull();
  });

  it('names the workspace on every request when ANTHROPIC_WORKSPACE_ID is set', async () => {
    const recorder = recordingFetch();
    const client = claudeClient({ ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_WORKSPACE_ID: 'wrkspc_01Test' }, { fetch: recorder.fetch, maxRetries: 0 })!;
    await client.messages.create(ping);
    expect(recorder.headers[0]!.get('anthropic-workspace-id')).toBe('wrkspc_01Test');
  });

  it('sends no workspace header for a key scoped to one workspace', async () => {
    const recorder = recordingFetch();
    const client = claudeClient({ ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_WORKSPACE_ID: undefined }, { fetch: recorder.fetch, maxRetries: 0 })!;
    await client.messages.create(ping);
    expect(recorder.headers[0]!.has('anthropic-workspace-id')).toBe(false);
  });
});
