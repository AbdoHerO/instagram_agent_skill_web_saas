// Minimal .env.local loader for the CLI scripts and the worker (Next.js loads it for the web app).
// Existing environment variables win; values are never printed.
import { existsSync, readFileSync } from 'node:fs';

export function loadLocalEnv(files = ['.env.local', '.env']): void {
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || line.trimStart().startsWith('#')) continue;
      const [, key, raw] = match as unknown as [string, string, string];
      const value = raw.replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
