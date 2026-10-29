import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

import { skillPath, type SkillName } from './registry';

/**
 * Runs the skills' own Python tools (standard library only, no network) on a
 * text, with fixed arguments: the model's output is only ever passed on stdin
 * as data, never as a command or code. Returns null when Python or the script
 * is unavailable, so generation still works and the UI says the check did not run.
 */
export type ToolRunner = (skill: SkillName, script: string, args: string[], input: string) => Promise<unknown | null>;

/** The environment for the tools: the usual variables (the Windows launcher needs them), never a secret. */
function toolEnv(): NodeJS.ProcessEnv {
  const safe = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|CREDENTIAL/i.test(key)));
  return { ...safe, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } as unknown as NodeJS.ProcessEnv;
}

export function pythonToolRunner(pythonBin: string, timeoutMs = 15_000): ToolRunner {
  return (skill, script, args, input) =>
    new Promise((resolve) => {
      const path = skillPath(skill, script);
      if (!existsSync(path)) return resolve(null);
      const child = execFile(
        pythonBin,
        ['-I', path, '-', '--json', ...args],
        { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: toolEnv() },
        (error, stdout) => {
          // Exit 1 is a verdict ("not ready" / "flagged") with a full JSON report; only other failures count.
          if (error && (error as { code?: unknown }).code !== 1) return resolve(null);
          try {
            resolve(JSON.parse(stdout));
          } catch {
            resolve(null);
          }
        },
      );
      child.stdin?.end(Buffer.from(input, 'utf8'));
    });
}

export type SkillChecks = {
  humanized?: { text: string; report: unknown } | null;
  detect?: unknown | null;
  caption?: unknown | null;
  hooks?: unknown | null;
  beats?: unknown | null;
  ran: string[];
  unavailable: string[];
};

/**
 * The checks the skills document: clean the caption (ig-human/humanize.py), lint
 * it against the feed truncation and hashtag cap (ig-caption/caption.py), score
 * it (ig-human/detect.py), score the hooks (ig-reel/hookscore.py) and time a
 * Reel script (ig-reel/beats.py).
 */
export async function runSkillChecks(run: ToolRunner, input: { caption: string; hashtags: string[]; hooks: string[]; scriptLines: string[]; keywords: string[] }): Promise<SkillChecks> {
  const result: SkillChecks = { ran: [], unavailable: [] };
  const note = (name: string, value: unknown | null) => (value === null ? result.unavailable.push(name) : result.ran.push(name));

  if (input.caption.trim()) {
    const humanized = (await run('ig-human', 'humanize.py', [], input.caption)) as { text: string; report: unknown } | null;
    result.humanized = humanized;
    note('humanize', humanized);
    const cleaned = humanized?.text?.trimEnd() ?? input.caption;
    const full = [cleaned, input.hashtags.join(' ')].filter(Boolean).join('\n\n');
    result.caption = await run('ig-caption', 'caption.py', input.keywords.length ? ['--keywords', input.keywords.join(',')] : [], full);
    note('caption', result.caption);
    result.detect = await run('ig-human', 'detect.py', [], cleaned);
    note('detect', result.detect);
  }
  if (input.hooks.length) {
    result.hooks = await run('ig-reel', 'hookscore.py', [], input.hooks.join('\n'));
    note('hookscore', result.hooks);
  }
  if (input.scriptLines.length) {
    result.beats = await run('ig-reel', 'beats.py', [], input.scriptLines.join('\n'));
    note('beats', result.beats);
  }
  return result;
}
