# Claude skills

Source: <https://github.com/Jakeschincariol/instagram-agent-skill> (MIT, © 2026 Jake Schincariol), commit recorded in
`vendor/.instagram-agent-skill.commit`. The repository is a set of 13 Claude skills, 6 Python tools and 3 JSON resources.
It is **not** a web application, a publishing backend or an autonomous agent; the README says so itself ("These skills
do not post to Instagram"). This project adds that infrastructure separately.

## Where things are

| Path | What |
|---|---|
| `vendor/instagram-agent-skill/` | Upstream files, unmodified (README, LICENSE, `skills/`, `templates/voice.md`) |
| `.claude/skills/ig-*/` | The 13 installed skills (project-local, not `~/.claude/skills`) with their scripts and JSON |
| `.claude/skills/SOURCE.md` | Provenance and the sha256 of every upstream file |
| `.claude/skills/LICENSE-instagram-agent-skill` | The MIT licence |
| `.claude/instagram/voice.md` | Euro Digital's voice profile (from `templates/voice.md`), project-local |

Skills: `ig-reel`, `ig-viral`, `ig-caption`, `ig-carousel`, `ig-story`, `ig-profile`, `ig-plan`, `ig-human`, `ig-comment`,
`ig-reply`, `ig-dm`, `ig-repurpose`, `ig-audit`. Tools: `ig-reel/hookscore.py`, `ig-reel/beats.py`,
`ig-caption/caption.py`, `ig-human/humanize.py`, `ig-human/detect.py`, `ig-viral/swipe.py` (standard library only, no network).

## Install / verify

```powershell
npm run skills:install     # copies vendor/…/skills/ig-* to .claude/skills (re-run after updating vendor/)
npm run skills:check       # verifies every installed file against upstream
```

## The one adaptation: project-local data folder

Upstream skills read and write `~/.claude/instagram/` (voice.md, swipe.md, log.md, plan.md), a global folder shared by
every project. To keep this project isolated, the installer replaces that string with `.claude/instagram/` in the
installed `SKILL.md` copies only (Claude Code runs with the project root as working directory). Nothing else changes;
`skills:check` fails if anything else differs. Your global voice file, if any, is never read or overwritten.

## Using the skills in Claude Code

Open Claude Code **in `E:\Euro Digital\agent_ai_intg`** (a new session: skills are discovered at start-up). Type `/` to
see `/ig-reel`, `/ig-caption`, … The commands in the skills use `python3`, which works on this PC (Python 3.14 through
the Python Install Manager).

## Using the skills in the web application

Claude Code skills are not available to API calls by themselves. The backend (`src/server/skills`, `src/server/ai`):

- loads the relevant `SKILL.md` texts (`skillsFor()`: e.g. a Reel uses ig-reel + ig-caption + ig-human) and the 26 hook
  formulas from `hooks.json` into the system prompt, with an adaptation note: no file access, no tools, no questions,
  no posting, return the JSON fields;
- runs the real tools after generation (`humanize.py --json` to clean the caption, `caption.py`, `detect.py`,
  `hookscore.py`, `beats.py`) and shows their results on the draft. A tool exit code 1 means "not ready / flagged"
  and its report is kept.

Not used by the app (Claude Code only): `ig-viral` (manual research in your own browser), `ig-comment`, `ig-reply`,
`ig-dm` (no messaging or commenting is automated), `ig-profile`, `ig-audit`.
