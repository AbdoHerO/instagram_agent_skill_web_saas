import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Secrets at rest. Meta tokens are encrypted with AES-256-GCM before they reach
 * the database ("v1.<iv>.<tag>.<ciphertext>", base64url); session and OAuth
 * state tokens are stored only as SHA-256 hashes.
 */
const VERSION = 'v1';

function keyFrom(base64Key: string | undefined): Buffer {
  if (!base64Key) throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return key;
}

export function encryptSecret(plaintext: string, base64Key: string | undefined): string {
  const key = keyFrom(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(packed: string, base64Key: string | undefined): string {
  const [version, iv, tag, ciphertext] = packed.split('.');
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error('Unsupported secret format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(base64Key), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
