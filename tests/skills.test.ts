import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from '@/server/ai/prompt';
import { hookFormulas, loadSkill, SKILL_NAMES, skillPath, skillsFor } from '@/server/skills/registry';
import { pythonToolRunner, runSkillChecks } from '@/server/skills/tools';

const SUPPORT_FILES: Record<string, string[]> = {
  'ig-reel': ['hookscore.py', 'beats.py', 'hooks.json'],
  'ig-caption': ['caption.py'],
  'ig-human': ['humanize.py', 'detect.py', 'slop.json'],
  'ig-viral': ['swipe.py'],
  'ig-profile': ['rubric.json'],
};

describe('installed skills', () => {
  it('has all 13 skills with their supporting scripts and resources, matching upstream', () => {
    for (const name of SKILL_NAMES) {
      expect(existsSync(skillPath(name)), name).toBe(true);
      const head = readFileSync(skillPath(name), 'utf8').split('\n').slice(0, 4).join('\n');
      expect(head).toMatch(new RegExp(`name: ${name}`));
      for (const file of SUPPORT_FILES[name] ?? []) expect(existsSync(skillPath(name, file)), `${name}/${file}`).toBe(true);
    }
    // The installer's own verification (copies equal upstream except the documented path substitution).
    expect(execFileSync(process.execPath, ['scripts/install-skills.mjs', '--check'], { encoding: 'utf8' })).toMatch(/Verified 13 skills/);
    expect(existsSync(join('.claude', 'skills', 'LICENSE-instagram-agent-skill'))).toBe(true);
  });

  it('reads the project-local voice profile, never the global one', () => {
    for (const name of SKILL_NAMES) expect(loadSkill(name)).not.toContain('~/.claude/instagram');
    expect(loadSkill('ig-reel')).toContain('.claude/instagram/voice.md');
    expect(existsSync(join('.claude', 'instagram', 'voice.md'))).toBe(true);
  });

  it('builds the backend prompt from the skills with the adaptation note and the 26 hook formulas', () => {
    expect(hookFormulas().split('\n')).toHaveLength(26);
    const prompt = buildSystemPrompt({ businessContext: 'Euro Digital sells computers in Morocco.', voice: 'voice', skills: skillsFor('reel', 'general') });
    expect(prompt).toContain('<skill name="ig-reel">');
    expect(prompt).toContain('You cannot read or write files and cannot run tools');
    expect(prompt).toContain('Never invent prices');
  });
});

describe('skill tools (real Python scripts)', () => {
  const run = pythonToolRunner(process.env.PYTHON_BIN ?? 'python3');

  it('cleans, lints and scores a caption, scores hooks and times a script', async () => {
    const checks = await runSkillChecks(run, {
      caption: 'Delve into our curated selection — ThinkPad T480, 14 pouces.',
      hashtags: ['#thinkpad', '#maroc'],
      hooks: ['Nobody tells you a 2018 ThinkPad still beats most new budget laptops.', 'Hey guys, today I wanted to talk about laptops'],
      scriptLines: ['Nobody tells you a 2018 ThinkPad still beats most new budget laptops.', 'Battery cycles first. Then the hinge.'],
      keywords: ['thinkpad'],
    });
    if (checks.unavailable.length === 5) {
      console.warn('Python not available: skill tools skipped');
      return;
    }
    expect(checks.unavailable).toEqual([]);
    expect(checks.humanized?.text).not.toContain('—'); // em dash removed
    expect(checks.humanized?.text.toLowerCase()).not.toContain('delve into');
    expect((checks.caption as { hashtags: string[] }).hashtags).toEqual(['#thinkpad', '#maroc']);
    const hooks = checks.hooks as { score: number }[];
    expect(hooks[0]!.score).toBeGreaterThan(hooks[1]!.score);
    expect((checks.beats as { beats: unknown[] }).beats).toHaveLength(2);
  });

  it('passes the model text only as data on stdin', async () => {
    const hostile = '"; import os; os.system("echo pwned") #\n$(whoami)';
    const result = (await run('ig-human', 'humanize.py', [], hostile)) as { text: string } | null;
    if (result === null) return;
    expect(result.text).toContain('os.system'); // treated as text, returned cleaned, never executed
  });
});
