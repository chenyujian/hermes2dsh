import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanHermesHome } from '../src/scan.js';
import { buildPlan } from '../src/plan.js';
import { applyPlan } from '../src/apply.js';
import { readText } from '../src/util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hermes = path.join(root, 'fixtures/sample-hermes');

function check(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

check('mvp preset skips cron with listing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h2d-cron-'));
  try {
    const plan = buildPlan(scanHermesHome(hermes), {
      dshHome: tmp,
      preset: 'mvp',
      skillConflict: 'skip',
    });
    const cron = plan.actions.filter((a) => String(a.id).startsWith('cron'));
    assert.equal(cron.length, 1);
    assert.equal(cron[0].status, 'skip');
    assert.match(cron[0].reason, /MVP preset/);
    assert.ok(cron[0].listed?.some((r) => r.includes('daily.yaml')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check('full preset plans raw copies + guide', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h2d-cron-'));
  try {
    const plan = buildPlan(scanHermesHome(hermes), {
      dshHome: tmp,
      preset: 'full',
      skillConflict: 'skip',
    });
    const guide = plan.actions.find((a) => a.id === 'cron:guide');
    assert.ok(guide);
    assert.equal(guide.kind, 'write-text');
    assert.equal(guide.status, 'migrate');
    assert.match(guide.text, /Not auto-mapped/);

    const daily = plan.actions.find((a) => a.id === 'cron:cron/daily.yaml');
    const weekly = plan.actions.find((a) => a.id === 'cron:cron/jobs/weekly.yaml');
    assert.ok(daily && weekly);
    assert.equal(daily.status, 'migrate');
    assert.equal(weekly.status, 'migrate');
    assert.equal(daily.origin, 'daily.yaml');
    assert.equal(weekly.origin, 'jobs/weekly.yaml');
    assert.ok(daily.dest.endsWith(path.join('hermes-imports', 'cron', 'daily.yaml')));
    assert.ok(weekly.dest.endsWith(path.join('hermes-imports', 'cron', 'jobs', 'weekly.yaml')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check('full apply writes nested cron + guide; conflict skips existing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h2d-cron-'));
  try {
    const opts = { dshHome: tmp, preset: 'full', skillConflict: 'skip' };
    const inventory = scanHermesHome(hermes);
    const plan1 = buildPlan(inventory, opts);
    const r1 = applyPlan(plan1, { dryRun: false });
    assert.equal(r1.counts.error || 0, 0);

    const dailyDest = path.join(tmp, 'hermes-imports/cron/daily.yaml');
    const weeklyDest = path.join(tmp, 'hermes-imports/cron/jobs/weekly.yaml');
    const guideDest = path.join(tmp, 'hermes-imports/cron/README-hermes-import.md');
    assert.ok(fs.existsSync(dailyDest));
    assert.ok(fs.existsSync(weeklyDest));
    assert.ok(fs.existsSync(guideDest));
    assert.match(readText(dailyDest), /morning-brief/);
    assert.match(readText(weeklyDest), /weekly-review/);
    assert.match(readText(guideDest), /hermes2dsh/);

    // second plan: dest exists → conflict skip
    const plan2 = buildPlan(inventory, opts);
    const daily2 = plan2.actions.find((a) => a.id === 'cron:cron/daily.yaml');
    assert.equal(daily2.status, 'conflict');
    const guide2 = plan2.actions.find((a) => a.id === 'cron:guide');
    assert.ok(!guide2, 'guide should not be re-planned when file exists');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check('full overwrite refreshes cron copies', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h2d-cron-'));
  try {
    const inventory = scanHermesHome(hermes);
    applyPlan(
      buildPlan(inventory, { dshHome: tmp, preset: 'full', skillConflict: 'skip' }),
      { dryRun: false }
    );
    const dest = path.join(tmp, 'hermes-imports/cron/daily.yaml');
    fs.writeFileSync(dest, 'schedule: stale\n');
    const plan = buildPlan(inventory, {
      dshHome: tmp,
      preset: 'full',
      skillConflict: 'overwrite',
    });
    const daily = plan.actions.find((a) => a.id === 'cron:cron/daily.yaml');
    assert.equal(daily.status, 'migrate');
    assert.equal(daily.replace, true);
    applyPlan(plan, { dryRun: false });
    assert.match(readText(dest), /morning-brief/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log('cron-full: all passed');
