---
name: hermes-import
description: Preview or apply Hermes → DSH migration via hermes2dsh
argument-hint: "[preview|apply] [--preset full] [--yes]"
---

Run the bundled migrator. Default to **preview** unless the user clearly wants apply.

```bash
node ${PLUGIN_ROOT}/bin/hermes2dsh.js ${ARGUMENTS:-preview}
```

Rules:
- If arguments are empty, use `preview`.
- Never add `--secrets` unless the user explicitly requested secrets.
- After preview, summarize migrated / skipped / conflicts; ask before `apply`.
- Remind Weixin re-scan in DSH after any secrets or channel migration.
