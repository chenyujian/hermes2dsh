import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillNameFromPath, findSkillFiles } from '../src/util.js';
import { scanHermesHome } from '../src/scan.js';
import { buildPlan } from '../src/plan.js';

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

check('skillNameFromPath flattens nested dir', () => {
  const skillsRoot = path.join(hermes, 'skills');
  const nested = path.join(skillsRoot, 'category/nested-demo/SKILL.md');
  assert.equal(skillNameFromPath(nested, skillsRoot), 'nested-demo');
  const flat = path.join(skillsRoot, 'demo-skill/SKILL.md');
  assert.equal(skillNameFromPath(flat, skillsRoot), 'demo-skill');
});

check('findSkillFiles finds both flat and nested', () => {
  const files = findSkillFiles(path.join(hermes, 'skills'));
  const names = files.map((f) => path.basename(path.dirname(f))).sort();
  assert.deepEqual(names, ['demo-skill', 'nested-demo']);
});

check('plan id/origin/flatName never include SKILL.md', () => {
  const tmpDsh = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes2dsh-skill-'));
  try {
    const inventory = scanHermesHome(hermes);
    const plan = buildPlan(inventory, {
      dshHome: tmpDsh,
      preset: 'mvp',
      skillConflict: 'skip',
      workspaceTarget: path.join(tmpDsh, 'workspace'),
    });
    const skills = plan.actions.filter((a) => a.kind === 'skill-copy');
    assert.ok(skills.length >= 2, `expected >=2 skill actions, got ${skills.length}`);
    for (const a of skills) {
      assert.ok(!String(a.id).includes('SKILL.md'), `id has SKILL.md: ${a.id}`);
      assert.ok(!String(a.origin).includes('SKILL.md'), `origin has SKILL.md: ${a.origin}`);
      assert.ok(!String(a.reason).includes('SKILL.md'), `reason has SKILL.md: ${a.reason}`);
      assert.ok(!String(a.flatName).includes('.'), `flatName looks like a file: ${a.flatName}`);
      assert.equal(a.flatName, path.basename(a.dest));
    }
    const nested = skills.find((a) => a.flatName === 'nested-demo');
    assert.ok(nested, 'missing nested-demo action');
    assert.equal(nested.origin, 'category/nested-demo');
    assert.equal(nested.id, 'skill:category/nested-demo');
    assert.equal(nested.status, 'migrate');

    const demo = skills.find((a) => a.flatName === 'demo-skill');
    assert.ok(demo, 'missing demo-skill action');
    assert.equal(demo.origin, 'demo-skill');
    assert.equal(demo.id, 'skill:demo-skill');
  } finally {
    fs.rmSync(tmpDsh, { recursive: true, force: true });
  }
});

check('conflict rename keeps clean flat names', () => {
  const tmpDsh = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes2dsh-skill-'));
  try {
    const destRoot = path.join(tmpDsh, 'skills/hermes-imports');
    fs.mkdirSync(path.join(destRoot, 'demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(destRoot, 'demo-skill/SKILL.md'), '# existing\n');
    const inventory = scanHermesHome(hermes);
    const plan = buildPlan(inventory, {
      dshHome: tmpDsh,
      preset: 'mvp',
      skillConflict: 'rename',
    });
    const demo = plan.actions.find(
      (a) => a.kind === 'skill-copy' && a.origin === 'demo-skill'
    );
    assert.ok(demo);
    assert.equal(demo.status, 'migrate');
    assert.ok(demo.flatName.startsWith('demo-skill'));
    assert.ok(!demo.flatName.includes('SKILL'));
    assert.notEqual(demo.flatName, 'demo-skill');
  } finally {
    fs.rmSync(tmpDsh, { recursive: true, force: true });
  }
});

console.log('skill-flatten: all passed');
