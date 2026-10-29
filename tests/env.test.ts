import { afterEach, describe, expect, it } from 'vitest';

import { configStatus, env, resetEnvCache } from '@/server/env';

const KEYS = ['ECOMMERCE_API_URL', 'MEDIA_PUBLIC_BASE_URL', 'ANTHROPIC_API_KEY', 'PUBLISHING_MODE'] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCache();
});

describe('server configuration', () => {
  it('treats empty lines copied from .env.example as not set', () => {
    process.env.ECOMMERCE_API_URL = '';
    process.env.MEDIA_PUBLIC_BASE_URL = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.PUBLISHING_MODE = '';
    resetEnvCache();
    expect(env().ECOMMERCE_API_URL).toBeUndefined();
    expect(env().PUBLISHING_MODE).toBe('disabled');
    expect(configStatus()).toMatchObject({ anthropic: false, ecommerceApi: false, mediaPublicUrl: false });
  });

  it('still rejects a value that is set but invalid, naming the variable only', () => {
    process.env.ECOMMERCE_API_URL = 'not a url';
    resetEnvCache();
    expect(() => env()).toThrow('Invalid configuration: ECOMMERCE_API_URL');
  });
});
