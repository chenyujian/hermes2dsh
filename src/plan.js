import path from 'node:path';
import { exists, loadMappings } from './util.js';

/**
 * Build a migration plan from a Hermes inventory + CLI options.
 * Each action: { id, kind, status: 'migrate'|'skip'|'conflict', source?, dest?, reason?, data? }
 */
export function buildPlan(inventory, options) {
  const { paths: pathMap, models } = loadMappings();
  const dshHome = options.dshHome;
  const preset = options.preset || 'mvp';
  const conflictPolicy = options.skillConflict || 'skip';
  const includeSecrets = Boolean(options.secrets);
  const workspaceTarget = options.workspaceTarget || null;

  const actions = [];
  const add = (a) => actions.push(a);

  if (!inventory.exists) {
    add({
      id: 'hermes-home',
      kind: 'meta',
      status: 'skip',
      reason: inventory.notes[0] || 'Hermes home missing',
    });
    return { actions, pathMap, models, dshHome, preset };
  }

  // SOUL.md
  if (inventory.soul) {
    const dest = path.join(
      dshHome,
      (pathMap.soul && pathMap.soul.dest) || 'agent-presets/hermes-soul.md'
    );
    const status = exists(dest) && conflictPolicy === 'skip' ? 'conflict' : 'migrate';
    add({
      id: 'soul',
      kind: 'copy',
      status: status === 'conflict' ? 'conflict' : 'migrate',
      source: inventory.soul.path,
      dest,
      reason:
        status === 'conflict'
          ? `dest exists (policy=${conflictPolicy}); will ${conflictPolicy === 'overwrite' ? 'overwrite' : conflictPolicy === 'rename' ? 'rename' : 'skip'}`
          : (pathMap.soul && pathMap.soul.note) || 'Copy SOUL.md as agent preset',
      policy: conflictPolicy,
    });
    // Fix: for soul, treat overwrite/rename as migrate with policy
    const last = actions[actions.length - 1];
    if (exists(dest)) {
      if (conflictPolicy === 'skip') {
        last.status = 'conflict';
        last.reason = `dest exists; skipped (policy=skip)`;
      } else if (conflictPolicy === 'rename') {
        last.status = 'migrate';
        last.dest = uniquePath(dest);
        last.reason = `dest exists; renaming to ${path.basename(last.dest)}`;
      } else {
        last.status = 'migrate';
        last.reason = 'dest exists; will overwrite';
      }
    }
  } else {
    add({
      id: 'soul',
      kind: 'copy',
      status: 'skip',
      reason: 'SOUL.md not found in Hermes home',
    });
  }

  // Memories
  if (inventory.memories.length) {
    const destDir = path.join(
      dshHome,
      (pathMap.memory && pathMap.memory.dest_dir) || 'hermes-imports/memory/'
    );
    add({
      id: 'memory',
      kind: 'merge-memory',
      status: 'migrate',
      sources: inventory.memories.map((m) => m.path),
      dest: path.join(destDir, 'MERGED.md'),
      alsoCopy: inventory.memories.map((m) => ({
        source: m.path,
        dest: path.join(destDir, path.basename(m.path)),
      })),
      reason:
        (pathMap.memory && pathMap.memory.note) ||
        'Merge MEMORY.md + USER.md with section dedupe',
    });
  } else {
    add({
      id: 'memory',
      kind: 'merge-memory',
      status: 'skip',
      reason: 'No memories/MEMORY.md or USER.md found',
    });
  }

  // Skills
  if (!inventory.skills.length) {
    add({
      id: 'skills',
      kind: 'skills',
      status: 'skip',
      reason: 'No skills/**/SKILL.md found',
    });
  } else {
    const destRoot = path.join(
      dshHome,
      (pathMap.skills && pathMap.skills.dest_dir) || 'skills/hermes-imports/'
    );
    for (const skill of inventory.skills) {
      let destDir = path.join(destRoot, skill.name);
      let status = 'migrate';
      let reason = `Copy skill "${skill.name}"`;
      let finalDest = destDir;

      if (exists(destDir)) {
        if (conflictPolicy === 'skip') {
          status = 'conflict';
          reason = `skill "${skill.name}" already exists at ${destDir}; skipped`;
        } else if (conflictPolicy === 'rename') {
          finalDest = uniquePath(destDir);
          reason = `skill "${skill.name}" exists; renaming to ${path.basename(finalDest)}`;
        } else {
          reason = `skill "${skill.name}" exists; will overwrite`;
        }
      }

      add({
        id: `skill:${skill.name}`,
        kind: 'skill-copy',
        status,
        source: skill.dir,
        dest: finalDest,
        skillFile: skill.path,
        reason,
        policy: conflictPolicy,
      });
    }
  }

  // AGENTS.md
  if (workspaceTarget) {
    if (inventory.agentsMd) {
      const dest = path.join(workspaceTarget, 'AGENTS.md');
      let status = 'migrate';
      let reason = 'Copy AGENTS.md into --workspace-target';
      let finalDest = dest;
      if (exists(dest)) {
        if (conflictPolicy === 'skip') {
          status = 'conflict';
          reason = 'AGENTS.md exists in workspace-target; skipped';
        } else if (conflictPolicy === 'rename') {
          finalDest = uniquePath(dest);
          reason = `AGENTS.md exists; renaming to ${path.basename(finalDest)}`;
        } else {
          reason = 'AGENTS.md exists; will overwrite';
        }
      }
      add({
        id: 'agents-md',
        kind: 'copy',
        status,
        source: inventory.agentsMd.path,
        dest: finalDest,
        reason,
      });
    } else {
      add({
        id: 'agents-md',
        kind: 'copy',
        status: 'skip',
        reason: 'AGENTS.md not found (checked Hermes home / workspace / cwd)',
      });
    }
  } else {
    add({
      id: 'agents-md',
      kind: 'copy',
      status: 'skip',
      reason: 'No --workspace-target; AGENTS.md not copied',
    });
  }

  // config.yaml → mapped yaml (never overwrite settings.yaml)
  if (inventory.config) {
    const dest = path.join(
      dshHome,
      (pathMap.config && pathMap.config.dest) ||
        'hermes-imports/config-mapped.yaml'
    );
    const mapped = mapConfig(inventory.config.safeKeys, models);
    add({
      id: 'config',
      kind: 'write-config-mapped',
      status: 'migrate',
      source: inventory.config.path,
      dest,
      data: mapped,
      reason:
        (pathMap.config && pathMap.config.note) ||
        'Map non-secret config keys; does NOT touch settings.yaml',
      omittedSecrets: inventory.config.secretKeys,
    });
  } else {
    add({
      id: 'config',
      kind: 'write-config-mapped',
      status: 'skip',
      reason: 'config.yaml not found',
    });
  }

  // Secrets
  if (!inventory.secrets.length) {
    add({
      id: 'secrets',
      kind: 'secrets',
      status: 'skip',
      reason: 'No .env / auth.json / weixin/ found',
    });
  } else if (!includeSecrets) {
    add({
      id: 'secrets',
      kind: 'secrets',
      status: 'skip',
      reason:
        'Secrets present but --secrets not set; listing only. Re-scan Weixin in DSH after migrate.',
      listed: inventory.secrets.map((s) => s.rel),
    });
  } else {
    const destDir = path.join(
      dshHome,
      (pathMap.secrets && pathMap.secrets.dest_dir) || 'hermes-imports/secrets/'
    );
    for (const s of inventory.secrets) {
      if (s.kind === 'file') {
        add({
          id: `secret:${s.rel}`,
          kind: 'copy',
          status: 'migrate',
          source: s.path,
          dest: path.join(destDir, path.basename(s.rel)),
          reason: 'Copy secret file (--secrets enabled)',
        });
      } else if (s.kind === 'dir') {
        add({
          id: `secret:${s.rel}`,
          kind: 'copy-dir',
          status: 'migrate',
          source: s.path,
          dest: path.join(destDir, 'weixin'),
          reason:
            'Copy weixin/ tokens (--secrets). Prefer re-scanning iLink QR in DSH.',
        });
      }
    }
  }

  // Cron
  if (!inventory.cron.length) {
    add({
      id: 'cron',
      kind: 'cron',
      status: 'skip',
      reason: 'No cron/ files found',
    });
  } else if (preset === 'mvp') {
    add({
      id: 'cron',
      kind: 'cron',
      status: 'skip',
      reason: `MVP preset: cron/ skipped (${inventory.cron.length} file(s)). Use --preset full to copy raw for manual review.`,
      listed: inventory.cron.map((c) => c.rel),
    });
  } else {
    const destDir = path.join(
      dshHome,
      (pathMap.cron && pathMap.cron.dest_dir) || 'hermes-imports/cron/'
    );
    for (const c of inventory.cron) {
      add({
        id: `cron:${c.rel}`,
        kind: 'copy',
        status: 'migrate',
        source: c.path,
        dest: path.join(destDir, path.relative(path.join(inventory.hermesHome, 'cron'), c.path)),
        reason: 'Full preset: raw cron copy for manual review (no auto schedule map)',
      });
    }
  }

  return { actions, pathMap, models, dshHome, preset };
}

function uniquePath(p) {
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  let i = 2;
  let candidate;
  do {
    candidate = path.join(dir, `${base}-${i}${ext}`);
    i += 1;
  } while (exists(candidate));
  return candidate;
}

function mapConfig(safeKeys, models) {
  const out = {
    _meta: {
      generator: 'hermes2dsh@0.1.0',
      note: 'Best-effort mapped config. Review before merging into DSH settings.yaml. v0.1 never overwrites settings.yaml.',
    },
    mapped: {},
    unmapped: {},
  };

  for (const [k, v] of Object.entries(safeKeys || {})) {
    if (k === 'model' || k === 'model_name' || k === 'default_model') {
      const hint = resolveModel(String(v), models);
      out.mapped[k] = v;
      out.mapped[`${k}_dsh_hint`] = hint;
    } else if (['temperature', 'max_tokens', 'top_p', 'system'].includes(k)) {
      out.mapped[k] = v;
    } else {
      out.unmapped[k] = v;
    }
  }
  return out;
}

function resolveModel(name, models) {
  if (!models) return 'deepseek-chat';
  if (models[name]) return models[name];
  for (const [pattern, target] of Object.entries(models)) {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (name.startsWith(prefix)) return target;
    }
  }
  return models.default || 'deepseek-chat';
}
