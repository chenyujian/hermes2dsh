#!/usr/bin/env node
/**
 * Assemble / run a pipeline role for one slice.
 *
 * Usage:
 *   node dev/scripts/run-role.mjs --role reviewer --slice 03
 *   node dev/scripts/run-role.mjs --role reviewer --slice 03 --call   # needs DEEPSEEK_API_KEY
 *   node dev/scripts/run-role.mjs --role reviewer --slice 03 --local  # heuristic gate (default)
 *
 * reviewer --local writes dev/out/review-NN.md from checklists + git grep heuristics.
 * reviewer --call  sends assembled prompt to CodePlan/DeepSeek and saves the model body.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const role = arg('--role', 'reviewer');
const sliceRaw = arg('--slice', '03');
const slicePad = String(Number.parseInt(String(sliceRaw), 10) || 0).padStart(2, '0');
const doCall = process.argv.includes('--call');
const forceLocal = process.argv.includes('--local') || !doCall;

const rolePath = path.join(root, 'dev/prompts/roles', `${role}.md`);
if (!fs.existsSync(rolePath)) {
  console.error(`Unknown role prompt: ${rolePath}`);
  process.exit(1);
}

const promptsDir = path.join(root, 'dev/prompts');
const sliceFile = fs
  .readdirSync(promptsDir)
  .find((f) => f.startsWith(`${slicePad}-`) && f.endsWith('.md'));
if (!sliceFile) {
  console.error(`No slice prompt matching ${slicePad}-*.md in dev/prompts`);
  process.exit(1);
}

const slicePath = path.join(promptsDir, sliceFile);
const sliceBody = fs.readFileSync(slicePath, 'utf8');
const roleBody = fs.readFileSync(rolePath, 'utf8');

const allow = [...sliceBody.matchAll(/^- ((?:src|test|fixtures|mappings|dev\/prompts)\/[\w./*-]+)/gm)].map(
  (m) => m[1]
);

function git(args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

const diffPaths = allow.length
  ? allow
      .map((p) => p.replace(/\*\*.*$/, '').replace(/\*$/, ''))
      .filter((p) => fs.existsSync(path.join(root, p)) || p.includes('/'))
  : ['src', 'test', 'mappings'];

const diff = git(['diff', 'HEAD', '--', ...diffPaths.filter((p) => !p.includes('*'))]);
const diffAll = git(['diff', 'HEAD']);
const status = git(['status', '--short']);

const outDir = path.join(root, 'dev/out');
fs.mkdirSync(outDir, { recursive: true });

const requestPath = path.join(outDir, `review-${slicePad}.request.md`);
const reviewPath = path.join(outDir, `review-${slicePad}.md`);

if (role === 'reviewer') {
  const assembled = [
    roleBody,
    '',
    '## Slice prompt',
    sliceBody,
    '',
    '## git status',
    '```',
    status.stdout || '(clean)',
    '```',
    '',
    '## git diff (workspace)',
    '```diff',
    (diffAll.stdout || diff.stdout || '(no diff)').slice(0, 120000),
    '```',
    '',
    '## Allowlist from slice',
    allow.length ? allow.map((a) => `- ${a}`).join('\n') : '(none parsed)',
  ].join('\n');

  fs.writeFileSync(requestPath, assembled);
  console.log('Wrote', path.relative(root, requestPath));

  if (doCall && !forceLocal) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.error('Missing DEEPSEEK_API_KEY for --call');
      process.exit(1);
    }
    const model = process.env.DS_MODEL || 'deepseek-v4.1-flash';
    const base = (process.env.DS_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
    const body = {
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: roleBody },
        { role: 'user', content: assembled },
      ],
    };
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('Model error', res.status, await res.text());
      process.exit(1);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    fs.writeFileSync(reviewPath, text.trim() + '\n');
    console.log('Wrote', path.relative(root, reviewPath));
    if (/^## Verdict\s*\nFAIL/m.test(text) || /\nFAIL\s*$/m.test(text.split('Verdict')[1] || '')) {
      process.exit(2);
    }
    process.exit(0);
  }

  // --local heuristic gate (Architect/Grok side; no model tokens)
  const blockers = [];
  const warnings = [];
  const checklist = {
    secrets: true,
    settings: true,
    cli: true,
    allowlist: true,
    deps: true,
    tests: true,
  };

  const diffText = diffAll.stdout || '';
  if (/(api[_-]?key|sk-[a-zA-Z0-9]{10,}|ark-[a-f0-9-]{20,})/i.test(diffText) &&
      !/secretKeyHint|api_key|omitted secret/i.test(diffText)) {
    // only flag if it looks like a literal assignment of a long token
    if (/:\s*['\"]?(sk-|ark-)[a-zA-Z0-9_-]{16,}/.test(diffText)) {
      blockers.push('Possible hardcoded secret token in diff');
      checklist.secrets = false;
    }
  }

  if (/settings\.yaml/.test(diffText) && /writeText|copyFile|writeFileSync/.test(diffText)) {
    if (!/Does NOT overwrite|settings\.yaml/.test(diffText)) {
      warnings.push('Diff mentions settings.yaml near write calls — confirm no overwrite');
    }
  }
  if (/~\/\.dsh\/settings\.yaml|dshHome.*settings\.yaml/.test(diffText) &&
      /writeFileSync|writeText\(/.test(diffText)) {
    blockers.push('Looks like code may write ~/.dsh/settings.yaml');
    checklist.settings = false;
  }

  const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  if (/\"dependencies\"\s*:\s*\{[^}]+\}/s.test(pkg)) {
    blockers.push('package.json has runtime dependencies (must stay zero-dep)');
    checklist.deps = false;
  }

  // skill naming regression quick scan on current src
  const planSrc = fs.readFileSync(path.join(root, 'src/plan.js'), 'utf8');
  if (/path\.relative\(skillsRoot,\s*skill\.path\)/.test(planSrc)) {
    blockers.push('plan.js still derives skill origin from skill.path (SKILL.md) — use skill.dir');
    checklist.allowlist = false;
  }

  const testDir = path.join(root, 'test');
  if (!fs.existsSync(testDir) || fs.readdirSync(testDir).length === 0) {
    warnings.push('No tests under test/');
    checklist.tests = false;
  } else if (slicePad === '03' && !fs.existsSync(path.join(testDir, 'cron-full.mjs'))) {
    blockers.push('slice 03 missing test/cron-full.mjs');
    checklist.tests = false;
  } else if (slicePad === '02' && !fs.existsSync(path.join(testDir, 'skill-flatten.mjs'))) {
    blockers.push('slice 02 missing test/skill-flatten.mjs');
    checklist.tests = false;
  }

  // run unit tests quickly
  const testRun = spawnSync('npm', ['test'], { cwd: root, encoding: 'utf8' });
  if (testRun.status !== 0) {
    blockers.push('npm test failed');
    checklist.tests = false;
    warnings.push((testRun.stdout || testRun.stderr || '').split('\n').slice(-20).join('\n'));
  }

  const verdict = blockers.length ? 'FAIL' : warnings.length ? 'PASS_WITH_WARN' : 'PASS';
  const sliceName = sliceFile.replace(/\.md$/, '');
  const body = `# Review ${slicePad} — ${sliceName}

## Verdict
${verdict}

## Blockers
${blockers.length ? blockers.map((b) => `- ${b}`).join('\n') : '- none'}

## Warnings
${warnings.length ? warnings.map((w) => `- ${w}`).join('\n') : '- none'}

## Checklist
- [${checklist.secrets ? 'x' : ' '}] secrets default-off / no key in diff
- [${checklist.settings ? 'x' : ' '}] no settings.yaml overwrite
- [${checklist.cli ? 'x' : ' '}] CLI flags compatible
- [${checklist.allowlist ? 'x' : ' '}] changes within allowlist
- [${checklist.deps ? 'x' : ' '}] no new npm deps
- [${checklist.tests ? 'x' : ' '}] tests cover slice acceptance

## Follow-ups
${blockers.length ? blockers.map((b) => `- Fix: ${b}`).join('\n') : '- none'}

---
_Generated by \`run-role.mjs --role reviewer --local\` on ${new Date().toISOString()}_
`;
  fs.writeFileSync(reviewPath, body);
  console.log('Wrote', path.relative(root, reviewPath));
  console.log('Verdict:', verdict);
  process.exit(blockers.length ? 2 : 0);
}

console.error(`Role "${role}" assemble-only is not implemented beyond reviewer yet.`);
process.exit(1);
