---
name: hermes2dsh
description: Migrate Hermes Agent (~/.hermes) data into DeepSeek Harness / DSH (~/.dsh) using the hermes2dsh CLI — preview dry-run first, then apply. Use when the user asks to import Hermes, migrate from Hermes to DSH, copy SOUL/memories/skills into ~/.dsh, or run hermes2dsh.
whenToUse: User wants Hermes → DSH migration, hermes2dsh preview/apply, or importing SOUL/memory/skills/cron from ~/.hermes.
---

# hermes2dsh — Hermes → DSH migration

## Goal
Move Hermes Agent user data into DSH without overwriting `~/.dsh/settings.yaml` and without copying secrets unless the user opts in.

## CLI (preferred)
Plugin root ships the CLI at `bin/hermes2dsh.js` (also `npx hermes2dsh` / global `hermes2dsh` after npm install).

```bash
# dry-run
node ${PLUGIN_ROOT}/bin/hermes2dsh.js preview

# write after confirm
node ${PLUGIN_ROOT}/bin/hermes2dsh.js apply

# non-interactive
node ${PLUGIN_ROOT}/bin/hermes2dsh.js apply --yes

# include cron raw copies
node ${PLUGIN_ROOT}/bin/hermes2dsh.js preview --preset full
```

If `${PLUGIN_ROOT}` is unavailable, run from the cloned repo:

```bash
node ./bin/hermes2dsh.js preview --hermes-home ~/.hermes --dsh-home ~/.dsh
```

## Flags (do not invent others)
| Flag | Default | Notes |
| --- | --- | --- |
| `--hermes-home` | `~/.hermes` | |
| `--dsh-home` | `~/.dsh` | |
| `--workspace-target` | unset | required to copy `AGENTS.md` |
| `--skill-conflict` | `skip` | `skip` \| `overwrite` \| `rename` |
| `--secrets` | off | copies `.env` / `auth.json` / `weixin/` only when set |
| `--preset` | `mvp` | `full` also stages `cron/` under `hermes-imports/cron/` |
| `--yes` / `-y` | off | skip apply confirmation |

## What lands where
- `SOUL.md` → `~/.dsh/agent-presets/hermes-soul.md` (wire into active agent manually if needed)
- memories → `~/.dsh/hermes-imports/memory/` (+ `MERGED.md` section-deduped)
- skills → `~/.dsh/skills/hermes-imports/<flat-name>/`
- config non-secrets → `hermes-imports/config-mapped.yaml` (**never** `settings.yaml`)
- cron (`--preset full`) → `hermes-imports/cron/` + `README-hermes-import.md` (manual DSH schedule rebuild)

## Safety checklist before apply
1. Run **preview** and read conflicts.
2. Do **not** pass `--secrets` unless the user explicitly asked.
3. Remind: Weixin / iLink should be **re-scanned inside DSH** even if tokens were copied.
4. Never edit `~/.dsh/settings.yaml` yourself as part of this skill.

## Suggested agent flow
1. Confirm Hermes home exists (`~/.hermes` or user path).
2. Run preview; summarize migrated / skipped / conflicts in plain language.
3. Ask before apply (unless user already said `--yes`).
4. After apply, point to `hermes-imports/` and the cron README when `--preset full`.
