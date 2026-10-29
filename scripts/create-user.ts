// Creates a dashboard user: npm run user:create -- --email you@example.com --name "Your name"
// The password is typed in a hidden prompt (or read from stdin when piped); it is stored as an argon2 hash only.
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import { loadLocalEnv } from './load-env';

loadLocalEnv();

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'owner' } } });
if (!values.email || !values.name) {
  console.error('Usage: npm run user:create -- --email you@example.com --name "Your name" [--role owner|editor]');
  process.exit(1);
}

async function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const output = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  output._writeToOutput = (text: string) => output.output.write(text.includes(question) ? text : '');
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const { createUserAccount, MIN_PASSWORD_LENGTH } = await import('../src/server/auth/core');
const { closeDb, getDb } = await import('../src/server/db');

const password = await askHidden(`Password (at least ${MIN_PASSWORD_LENGTH} characters): `);
try {
  const user = await createUserAccount(getDb(), { email: values.email, name: values.name, password, role: values.role === 'editor' ? 'editor' : 'owner' });
  console.log(`User ${user.email} created.`);
} catch (error) {
  console.error(`Could not create the user: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
