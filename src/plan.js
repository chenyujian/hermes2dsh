import path from 'node:path';
import {
  exists,
  isFile,
  loadMappings,
  mergeMarkdownSectionsDetailed,
  readText,
} from './util.js';

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

  // Memories — merged section-by-section (## / §), duplicates skipped.
  if (inventory.memories.length) {
    const destDir = path.join(
      dshHome,
      (pathMap.memory && pathMap.memory.dest_dir) || 'hermes-imports/memory/'
    );
    const dest = path.join(destDir, 'MERGED.md');

    const sources = inventory.memories.map((m) => ({
      path: m.path,
      text: safeRead(m.path),
      source: m.path,
    }));
    const existingText = isFile(dest) ? safeRead(dest) : '';
    const merged = mergeMarkdownSectionsDetailed(sources, { existingText });

    const alsoCopy = inventory.memories.map((m) => {
      const target = path.join(destDir, path.basename(m.path));
      return { source: m.path, dest: target, exists: exists(target) };
    });

    const hasNewContent = merged.kept.length > 0 || merged.newPreambleLines > 0;
    let status = 'migrate';
    let reason;

    if (!hasNewContent) {
      status = merged.skipped.length ? 'conflict' : 'skip';
      reason = merged.skipped.length
        ? `All ${merged.skipped.length} memory section(s) already present in ${path.basename(
            dest
          )}; nothing to merge`
        : 'Memory sources contained no mergeable content';
    } else {
      const skippedNote = merged.skipped.length
        ? `; skipped ${merged.skipped.length} already-present section(s)`
        : '';
      const base =
        (pathMap.memory && pathMap.memory.note) ||
        'Merge MEMORY.md + USER.md by ##/§ section';
      reason = `${base} (${merged.kept.length} kept${skippedNote})`;
    }

    add({
      id: 'memory',
      kind: 'merge-memory',
      status,
      sources: inventory.memories.map((m) => m.path),
      dest,
      alsoCopy,
      sections: merged.kept.map((s) => ({
        key: s.key,
        title: s.title,
        source: s.source,
      })),
      skippedSections: merged.skipped,
      reason,
    });
  } else {
    add({
      id: 'memory',
      kind: 'merge-memory',
      status: 'skip',
      reason: 'No memories/MEMORY.md or USER.md found',
    });
  }

  // Skills — nested skills/<cat>/<name>/SKILL.md are flattened to
  // <dest_dir>/<name>/. Flat-name collisions follow --skill-conflict.
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
    const skillsRoot = path.join(inventory.hermesHome || '', 'skills');
    const usedNames = new Map();

    inventory.skills.forEach((skill, idx) => {
      // Origin = skill directory under skills/, never include SKILL.md filename
      const origin =
        skill.dir && skillsRoot
          ? path.relative(skillsRoot, skill.dir).split(path.sep).join('/') ||
            skill.name ||
            `skill-${idx + 1}`
          : skill.name || `skill-${idx + 1}`;
      const leaf =
        skill.name ||
        path.basename(String(skill.dir || '')) ||
        'unnamed-skill';

      let destName = leaf;
      let status = 'migrate';
      let replace = false;
      let reason = `Flatten skill "${origin}" -> ${path.basename(destRoot)}/${destName}/`;

      const prior = usedNames.get(destName);
      const destExists = exists(path.join(destRoot, destName));

      if (prior !== undefined || destExists) {
        if (conflictPolicy === 'skip') {
          status = 'conflict';
          reason = prior !== undefined
            ? `skill "${origin}" flattens to "${destName}" which is already taken by "${prior}"; skipped`
            : `skill "${origin}" target ${destName}/ already exists; skipped (policy=skip)`;
        } else if (conflictPolicy === 'rename') {
          destName = uniqueName(destRoot, leaf, usedNames);
          reason = `skill "${origin}" flat name "${leaf}" exists; renaming to ${destName}/`;
        } else {
          replace = true;
          reason = `skill "${origin}" flat name "${leaf}" exists; will overwrite`;
        }
      }

      usedNames.set(destName, origin);

      add({
        id: `skill:${origin}`,
        kind: 'skill-copy',
        status,
        source: skill.dir,
        dest: path.join(destRoot, destName),
        skillFile: skill.path,
        origin,
        flatName: destName,
        replace,
        reason,
        policy: conflictPolicy,
      });
    });
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

function safeRead(p) {
  try {
    return readText(p);
  } catch {
    return '';
  }
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

function uniqueName(root, base, used) {
  let i = 2;
  let candidate = `${base}-${i}`;
  while (used.has(candidate) || exists(path.join(root, candidate))) {
    i += 1;
    candidate = `${base}-${i}`;
  }
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
