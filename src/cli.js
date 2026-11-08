import os from 'node:os';
import path from 'node:path';
import { expandHome, confirm } from './util.js';
import { scanHermesHome } from './scan.js';
import { buildPlan } from './plan.js';
import { applyPlan } from './apply.js';
import { printReport } from './report.js';

const VERSION = '0.1.0';

export async function run(argv) {
  const { command, options, help, version } = parseArgs(argv);

  if (version) {
    console.log(`hermes2dsh ${VERSION}`);
    return 0;
  }

  if (help || !command) {
    printHelp();
    return help ? 0 : 1;
  }

  if (command !== 'preview' && command !== 'apply') {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }

  const opts = {
    hermesHome: expandHome(options.hermesHome || path.join(os.homedir(), '.hermes')),
    dshHome: expandHome(options.dshHome || path.join(os.homedir(), '.dsh')),
    workspaceTarget: options.workspaceTarget
      ? expandHome(options.workspaceTarget)
      : null,
    skillConflict: options.skillConflict || 'skip',
    secrets: Boolean(options.secrets),
    yes: Boolean(options.yes),
    preset: options.preset || 'mvp',
  };

  if (!['skip', 'overwrite', 'rename'].includes(opts.skillConflict)) {
    throw new Error(
      `--skill-conflict must be skip|overwrite|rename (got ${opts.skillConflict})`
    );
  }
  if (!['mvp', 'full'].includes(opts.preset)) {
    throw new Error(`--preset must be mvp|full (got ${opts.preset})`);
  }

  const inventory = scanHermesHome(opts.hermesHome, { cwd: process.cwd() });
  const plan = buildPlan(inventory, opts);

  if (command === 'preview') {
    const applyResult = applyPlan(plan, { dryRun: true });
    printReport({
      mode: 'preview',
      options: opts,
      inventory,
      plan,
      applyResult,
    });
    return inventory.exists ? 0 : 0; // graceful even when missing
  }

  // apply
  const previewResult = applyPlan(plan, { dryRun: true });
  printReport({
    mode: 'preview (before apply)',
    options: opts,
    inventory,
    plan,
    applyResult: previewResult,
  });

  if (!inventory.exists) {
    console.log('Nothing to apply.');
    return 0;
  }

  if (!opts.yes) {
    const ok = await confirm('Proceed with writing files? [y/N] ');
    if (!ok) {
      console.log('Aborted. No files written.');
      return 0;
    }
  }

  const applyResult = applyPlan(plan, { dryRun: false });
  printReport({
    mode: 'apply',
    options: opts,
    inventory,
    plan,
    applyResult,
  });

  return applyResult.counts.errors ? 1 : 0;
}

function parseArgs(argv) {
  const options = {};
  let command = null;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      help = true;
    } else if (a === '-V' || a === '--version') {
      version = true;
    } else if (a === '--hermes-home') {
      options.hermesHome = argv[++i];
    } else if (a === '--dsh-home') {
      options.dshHome = argv[++i];
    } else if (a === '--workspace-target') {
      options.workspaceTarget = argv[++i];
    } else if (a === '--skill-conflict') {
      options.skillConflict = argv[++i];
    } else if (a === '--secrets') {
      options.secrets = true;
    } else if (a === '--yes' || a === '-y') {
      options.yes = true;
    } else if (a === '--preset') {
      options.preset = argv[++i];
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown flag: ${a}`);
    } else if (!command) {
      command = a;
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }

  return { command, options, help, version };
}

function printHelp() {
  console.log(`hermes2dsh v${VERSION} — migrate Hermes Agent → DSH

Usage:
  hermes2dsh preview [flags]
  hermes2dsh apply   [flags]

Flags:
  --hermes-home <path>       Default: ~/.hermes
  --dsh-home <path>          Default: ~/.dsh
  --workspace-target <path>  Where to write AGENTS.md
  --skill-conflict <mode>    skip | overwrite | rename (default: skip)
  --secrets                  Also copy .env / auth.json / weixin tokens
  --yes, -y                  Skip apply confirmation
  --preset <mvp|full>        mvp skips cron; full copies cron raw (default: mvp)
  -h, --help                 Show help
  -V, --version              Show version

Examples:
  hermes2dsh preview
  hermes2dsh apply --yes
  hermes2dsh preview --hermes-home ./fixtures/sample-hermes --dsh-home ./tmp-dsh
`);
}
