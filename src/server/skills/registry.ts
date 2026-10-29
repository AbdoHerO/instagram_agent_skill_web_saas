import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The installed Instagram skills (.claude/skills, see docs/claude-skills.md),
 * read by the backend. Claude Code skills are not available to API calls by
 * themselves: the app loads each SKILL.md and passes it to Claude with an
 * explicit adaptation note (no file access, no tools, no posting).
 */
export const SKILL_NAMES = [
  'ig-reel', 'ig-viral', 'ig-caption', 'ig-carousel', 'ig-story', 'ig-profile', 'ig-plan',
  'ig-human', 'ig-comment', 'ig-reply', 'ig-dm', 'ig-repurpose', 'ig-audit',
] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export const SKILLS_DIR = join(process.cwd(), '.claude', 'skills');
export const VOICE_FILE = join(process.cwd(), '.claude', 'instagram', 'voice.md');

export function skillPath(name: SkillName, file = 'SKILL.md'): string {
  return join(SKILLS_DIR, name, file);
}

const cache = new Map<string, string>();

/** A skill's instructions without the YAML front matter. */
export function loadSkill(name: SkillName): string {
  const path = skillPath(name);
  const hit = cache.get(path);
  if (hit) return hit;
  if (!existsSync(path)) throw new Error(`Skill ${name} is not installed (run npm run skills:install)`);
  const body = readFileSync(path, 'utf8').replace(/^---[\s\S]*?\n---\s*\n/, '').trim();
  cache.set(path, body);
  return body;
}

/** The 26 hook formulas (names and templates) from ig-reel/hooks.json, as a compact list for the prompt. */
export function hookFormulas(): string {
  const path = skillPath('ig-reel', 'hooks.json');
  if (!existsSync(path)) return '';
  const data = JSON.parse(readFileSync(path, 'utf8')) as { hooks?: { name?: string; template?: string; best_for?: string; trap?: string }[] };
  return (data.hooks ?? [])
    .map((f, i) => `${i + 1}. ${f.name ?? ''}: ${f.template ?? ''}${f.best_for ? ` (for: ${f.best_for})` : ''}${f.trap ? ` (trap: ${f.trap})` : ''}`)
    .join('\n');
}

export function loadVoiceFile(): string {
  return existsSync(VOICE_FILE) ? readFileSync(VOICE_FILE, 'utf8') : '';
}

/** Which skills shape each kind of request. ig-human and ig-caption check every caption. */
export function skillsFor(kind: string, purpose: string): SkillName[] {
  const base: Record<string, SkillName[]> = {
    reel: ['ig-reel', 'ig-caption', 'ig-human'],
    feed_image: ['ig-caption', 'ig-human'],
    carousel: ['ig-carousel', 'ig-caption', 'ig-human'],
    story: ['ig-story', 'ig-human'],
    plan: ['ig-plan'],
    idea: ['ig-reel', 'ig-human'],
  };
  const skills = new Set<SkillName>(base[kind] ?? ['ig-caption', 'ig-human']);
  if (purpose === 'repurpose') skills.add('ig-repurpose');
  return [...skills];
}
