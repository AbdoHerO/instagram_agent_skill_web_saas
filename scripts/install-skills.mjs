#!/usr/bin/env node
// Installs the 13 Instagram skills from vendor/instagram-agent-skill into this
// project's .claude/skills/ (project-local, never ~/.claude/skills).
//
// The upstream files in vendor/ are never modified. The installed copies are
// identical to upstream except for ONE documented substitution in SKILL.md
// files: the global data folder "~/.claude/instagram/" becomes the project-local
// ".claude/instagram/" (voice.md, swipe.md, log.md, plan.md), so this project
// never reads or overwrites another project's voice profile.
//
// Usage: node scripts/install-skills.mjs [--check]
//   --check  verify the installed copies against upstream, change nothing.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = join(root, 'vendor', 'instagram-agent-skill');
const target = join(root, '.claude', 'skills');
const check = process.argv.includes('--check');

export const SKILLS = [
  'ig-reel', 'ig-viral', 'ig-caption', 'ig-carousel', 'ig-story', 'ig-profile', 'ig-plan',
  'ig-human', 'ig-comment', 'ig-reply', 'ig-dm', 'ig-repurpose', 'ig-audit',
];
const GLOBAL_DIR = '~/.claude/instagram/';
const LOCAL_DIR = '.claude/instagram/';

/** The installed form of an upstream file (the path substitution, SKILL.md only). */
export function adapt(file, content) {
  return file.endsWith('SKILL.md') ? content.split(GLOBAL_DIR).join(LOCAL_DIR) : content;
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 16);

if (!existsSync(join(upstream, 'skills'))) {
  console.error('vendor/instagram-agent-skill/skills not found. Clone the upstream repository first (see docs/claude-skills.md).');
  process.exit(1);
}

const problems = [];
const manifest = [];
for (const skill of SKILLS) {
  const from = join(upstream, 'skills', skill);
  const to = join(target, skill);
  if (!existsSync(join(from, 'SKILL.md'))) {
    problems.push(`${skill}: missing upstream SKILL.md`);
    continue;
  }
  if (!check) {
    rmSync(to, { recursive: true, force: true });
    mkdirSync(to, { recursive: true });
    cpSync(from, to, { recursive: true });
  }
  for (const source of files(from)) {
    const rel = relative(from, source);
    const installed = join(to, rel);
    const expected = adapt(rel, readFileSync(source, 'utf8'));
    if (!check) writeFileSync(installed, expected);
    if (!existsSync(installed)) {
      problems.push(`${skill}/${rel}: not installed`);
      continue;
    }
    const actual = readFileSync(installed, 'utf8');
    if (actual !== expected) problems.push(`${skill}/${rel}: differs from upstream (beyond the documented path substitution)`);
    manifest.push(`${skill}/${rel.replaceAll('\\', '/')}  ${sha(readFileSync(source))}`);
  }
}

if (!check) {
  writeFileSync(join(target, 'LICENSE-instagram-agent-skill'), readFileSync(join(upstream, 'LICENSE')));
  writeFileSync(
    join(target, 'SOURCE.md'),
    [
      '# Instagram skills: source',
      '',
      'Installed by `node scripts/install-skills.mjs` from `vendor/instagram-agent-skill`',
      '(https://github.com/Jakeschincariol/instagram-agent-skill, MIT, (c) 2026 Jake Schincariol;',
      'see LICENSE-instagram-agent-skill). Do not edit these copies: change upstream and re-run the script.',
      '',
      `Only change from upstream: in SKILL.md files, \`${GLOBAL_DIR}\` is replaced by \`${LOCAL_DIR}\``,
      '(project-local voice, swipe, log and plan files). Upstream files (sha256, first 16 hex):',
      '',
      '```',
      ...manifest,
      '```',
      '',
    ].join('\n'),
  );
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`${check ? 'Verified' : 'Installed'} ${SKILLS.length} skills (${manifest.length} files) in .claude/skills/`);
