import fs from 'node:fs';
import path from 'node:path';
import {
  copyFile,
  ensureDir,
  exists,
  isDir,
  isFile,
  mergeMarkdownSectionsDetailed,
  readText,
  writeText,
} from './util.js';

/**
 * Execute a migration plan.
 * @param {object} plan
 * @param {{ dryRun?: boolean }} opts
 * @returns {{ results: Array, counts: object }}
 */
export function applyPlan(plan, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const results = [];

  for (const action of plan.actions) {
    if (action.status === 'skip' || action.status === 'conflict') {
      results.push({
        id: action.id,
        status: action.status,
        reason: action.reason,
        source: action.source,
        dest: action.dest,
        sources: action.sources,
        sections: action.sections,
        skippedSections: action.skippedSections,
      });
      continue;
    }

    try {
      if (dryRun) {
        results.push({
          id: action.id,
          status: 'migrate',
          dryRun: true,
          reason: action.reason,
          source: action.source,
          sources: action.sources,
          dest: action.dest,
          policy: action.policy,
          sections: action.sections,
          skippedSections: action.skippedSections,
        });
        continue;
      }

      let extra = null;

      switch (action.kind) {
        case 'copy':
          copyFile(action.source, action.dest);
          break;
        case 'copy-dir':
          copyDirRecursive(action.source, action.dest);
          break;
        case 'merge-memory': {
          const sources = (action.sources || []).map((p) => ({
            path: p,
            text: readText(p),
            source: p,
          }));
          const existingText =
            action.dest && isFile(action.dest) ? readText(action.dest) : '';
          const merged = mergeMarkdownSectionsDetailed(sources, { existingText });
          if (merged.text) writeText(action.dest, merged.text);

          const copies = [];
          for (const item of action.alsoCopy || []) {
            if (exists(item.dest)) {
              copies.push({
                source: item.source,
                dest: item.dest,
                status: 'skip',
                reason: 'destination exists',
              });
              continue;
            }
            copyFile(item.source, item.dest);
            copies.push({ source: item.source, dest: item.dest, status: 'copied' });
          }

          extra = {
            sections: merged.kept.map((s) => ({
              key: s.key,
              title: s.title,
              source: s.source,
            })),
            skippedSections: merged.skipped,
            copies,
          };
          break;
        }
        case 'skill-copy':
          if (action.replace) removeDir(action.dest);
          copyDirRecursive(action.source, action.dest);
          break;
        case 'write-config-mapped':
          writeText(action.dest, toYaml(action.data));
          break;
        case 'write-text':
          writeText(action.dest, action.text || '');
          break;
        case 'secrets':
        case 'cron':
        case 'skills':
        case 'meta':
          // no-op kinds when status=migrate shouldn't happen
          break;
        default:
          throw new Error(`Unknown action kind: ${action.kind}`);
      }

      results.push({
        id: action.id,
        status: 'migrated',
        reason: action.reason,
        source: action.source,
        dest: action.dest,
        ...(extra || {}),
      });
    } catch (err) {
      results.push({
        id: action.id,
        status: 'error',
        reason: err.message || String(err),
        source: action.source,
        dest: action.dest,
      });
    }
  }

  const counts = summarize(results);
  return { results, counts };
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  if (!isDir(src)) {
    copyFile(src, dest);
    return;
  }
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDirRecursive(from, to);
    else copyFile(from, to);
  }
}

function toYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') {
    if (typeof obj === 'string') {
      if (obj.includes('\n') || /[:#{}[\],&*?|<>=!%@`]/.test(obj)) {
        return JSON.stringify(obj);
      }
      return obj;
    }
    return String(obj);
  }
  if (Array.isArray(obj)) {
    if (!obj.length) return '[]';
    return obj
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          return `${pad}- ${toYaml(item, indent + 1).trimStart()}`;
        }
        return `${pad}- ${toYaml(item, 0)}`;
      })
      .join('\n');
  }

  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${pad}${k}:`);
      lines.push(toYaml(v, indent + 1));
    } else if (Array.isArray(v)) {
      lines.push(`${pad}${k}:`);
      lines.push(toYaml(v, indent + 1));
    } else {
      lines.push(`${pad}${k}: ${toYaml(v, 0)}`);
    }
  }
  return lines.join('\n') + (indent === 0 ? '\n' : '');
}

function summarize(results) {
  const counts = {
    migrated: 0,
    skipped: 0,
    conflicts: 0,
    errors: 0,
    skippedSections: 0,
  };
  for (const r of results) {
    if (r.status === 'migrate' || r.status === 'migrated') counts.migrated += 1;
    else if (r.status === 'skip') counts.skipped += 1;
    else if (r.status === 'conflict') counts.conflicts += 1;
    else if (r.status === 'error') counts.errors += 1;

    if (Array.isArray(r.skippedSections)) {
      counts.skippedSections += r.skippedSections.length;
    }
  }
  return counts;
}

export { summarize };
