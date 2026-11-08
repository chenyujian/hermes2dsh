/**
 * Pretty-print a migration report to stdout.
 */
export function printReport({ mode, options, inventory, plan, applyResult }) {
  const lines = [];
  const hr = '─'.repeat(56);

  lines.push('');
  lines.push(`hermes2dsh v0.1 — ${mode}`);
  lines.push(hr);
  lines.push(`Hermes home : ${options.hermesHome}`);
  lines.push(`DSH home    : ${options.dshHome}`);
  lines.push(`Preset      : ${options.preset}`);
  lines.push(`Skill conflict policy : ${options.skillConflict}`);
  lines.push(`Secrets     : ${options.secrets ? 'yes' : 'no (skipped if present)'}`);
  if (options.workspaceTarget) {
    lines.push(`Workspace   : ${options.workspaceTarget}`);
  }
  lines.push(hr);

  if (!inventory.exists) {
    lines.push('');
    lines.push('⚠  Hermes home not found — nothing to migrate.');
    for (const n of inventory.notes || []) {
      lines.push(`   ${n}`);
    }
    lines.push('');
    lines.push('Summary: migrated=0  skipped=1  conflicts=0');
    lines.push('');
    console.log(lines.join('\n'));
    return;
  }

  lines.push('');
  lines.push('Inventory');
  lines.push(
    `  SOUL.md     : ${inventory.soul ? 'yes' : 'no'}`
  );
  lines.push(
    `  memories    : ${inventory.memories.length} file(s)`
  );
  lines.push(
    `  skills      : ${inventory.skills.length} skill(s)`
  );
  lines.push(
    `  AGENTS.md   : ${inventory.agentsMd ? inventory.agentsMd.rel : 'no'}`
  );
  lines.push(
    `  config.yaml : ${inventory.config ? 'yes' : 'no'}`
  );
  lines.push(
    `  secrets     : ${inventory.secrets.length} item(s)`
  );
  lines.push(
    `  cron        : ${inventory.cron.length} file(s)`
  );

  lines.push('');
  lines.push('Actions');
  for (const a of plan.actions) {
    const icon =
      a.status === 'migrate'
        ? '→'
        : a.status === 'skip'
          ? '·'
          : a.status === 'conflict'
            ? '!'
            : '?';
    const dest = a.dest ? ` → ${a.dest}` : '';
    const src = a.source ? pathShort(a.source, options.hermesHome) : a.id;
    lines.push(`  ${icon} [${a.status}] ${a.id}: ${a.reason || ''}`);
    if (a.source || a.dest) {
      lines.push(`      ${src}${dest}`);
    }
    if (a.listed && a.listed.length) {
      for (const item of a.listed.slice(0, 8)) {
        lines.push(`      - ${item}`);
      }
      if (a.listed.length > 8) {
        lines.push(`      - … +${a.listed.length - 8} more`);
      }
    }
    if (a.omittedSecrets && a.omittedSecrets.length) {
      lines.push(
        `      (omitted secret keys from config: ${a.omittedSecrets.join(', ')})`
      );
    }
  }

  const counts = applyResult?.counts || countFromPlan(plan);
  lines.push('');
  lines.push(hr);
  lines.push(
    `Summary: migrated=${counts.migrated}  skipped=${counts.skipped}  conflicts=${counts.conflicts}` +
      (counts.errors ? `  errors=${counts.errors}` : '')
  );
  if (mode === 'preview') {
    lines.push('Dry-run only — no files written. Run `hermes2dsh apply` to write.');
  }
  lines.push(
    'Note: Weixin / iLink tokens should be re-scanned in DSH after migration.'
  );
  lines.push('');

  console.log(lines.join('\n'));
}

function countFromPlan(plan) {
  const counts = { migrated: 0, skipped: 0, conflicts: 0, errors: 0 };
  for (const a of plan.actions) {
    if (a.status === 'migrate') counts.migrated += 1;
    else if (a.status === 'skip') counts.skipped += 1;
    else if (a.status === 'conflict') counts.conflicts += 1;
  }
  return counts;
}

function pathShort(p, home) {
  if (home && p.startsWith(home)) {
    return p.slice(home.length).replace(/^[\\/]/, '') || '.';
  }
  return p;
}
