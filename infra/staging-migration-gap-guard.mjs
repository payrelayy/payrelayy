import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = /^\d{14}$/u;
const MIGRATION_FILE = /^(\d{14})_.+\.sql$/u;
const ANSI_COLOR = /\u001b\[[0-9;]*m/gu;
// The 106-file catch-up visible on 6 October 2026 requires a separate reviewed rehearsal.
const UNREHEARSED_BACKLOG_THROUGH = '20261005180558';

export function assessStagingMigrationGap(listOutput, migrationFiles) {
  const localVersions = migrationFiles
    .map((file) => MIGRATION_FILE.exec(file)?.[1])
    .filter((version) => version !== undefined)
    .sort();
  const local = new Set(localVersions);
  if (local.size === 0 || local.size !== localVersions.length) {
    throw new Error('The checked-out migration files are absent or contain duplicate versions.');
  }

  const rows = [];
  for (const line of listOutput.replace(ANSI_COLOR, '').split(/\r?\n/u)) {
    const cells = line.split('|');
    if (cells.length < 3) continue;
    const localVersion = cells[0].replaceAll('`', '').trim();
    const remoteVersion = cells[1].replaceAll('`', '').trim();
    if (
      (localVersion !== '' && !VERSION.test(localVersion)) ||
      (remoteVersion !== '' && !VERSION.test(remoteVersion)) ||
      (localVersion === '' && remoteVersion === '')
    ) {
      continue;
    }
    if (localVersion !== '' && remoteVersion !== '' && localVersion !== remoteVersion) {
      throw new Error('The migration list paired different local and remote versions.');
    }
    rows.push({ localVersion, remoteVersion });
  }
  if (rows.length === 0) {
    throw new Error('The linked migration list did not contain parseable version rows.');
  }

  const listedLocal = rows.map((row) => row.localVersion).filter(Boolean);
  const listedRemote = rows.map((row) => row.remoteVersion).filter(Boolean);
  const remote = new Set(listedRemote);
  if (
    new Set(listedLocal).size !== listedLocal.length ||
    remote.size !== listedRemote.length ||
    remote.size === 0 ||
    listedLocal.length !== local.size ||
    listedLocal.some((version) => !local.has(version)) ||
    localVersions.some((version) => !listedLocal.includes(version)) ||
    listedRemote.some((version) => !local.has(version))
  ) {
    throw new Error('The linked migration list does not match the checked-out canonical files.');
  }

  const latestApplied = [...remote].sort().at(-1);
  const pending = localVersions.filter((version) => !remote.has(version));
  const historicalGaps = pending.filter((version) => version < latestApplied);
  return {
    localCount: local.size,
    remoteCount: remote.size,
    latestApplied,
    pending,
    historicalGaps,
  };
}

export function requireSafeStagingApply(assessment) {
  if (assessment.historicalGaps.length > 0) {
    throw new Error(
      `Staging has ${assessment.historicalGaps.length} unapplied migration(s) older than ` +
        `${assessment.latestApplied}: ${assessment.historicalGaps.join(', ')}. ` +
        'Ordinary db push would skip them. Rehearse and review the complete catch-up first.',
    );
  }
  const unreviewedBacklog = assessment.pending.filter(
    (version) => version <= UNREHEARSED_BACKLOG_THROUGH,
  );
  if (unreviewedBacklog.length > 0) {
    throw new Error(
      `Staging still has ${unreviewedBacklog.length} migrations in the unrehearsed ` +
        `catch-up through ${UNREHEARSED_BACKLOG_THROUGH}. ` +
        'Use a separate reviewed and isolated rehearsal before applying this backlog.',
    );
  }
}

export function requireExactStagingDryRun(dryRunOutput, assessment, migrationFiles) {
  const output = dryRunOutput.replace(ANSI_COLOR, '');
  if (!output.includes('DRY RUN: migrations will *not* be pushed to the database.')) {
    throw new Error('The linked db push output is not a recognized dry run.');
  }

  const filenamesByVersion = new Map(
    migrationFiles.map((file) => [MIGRATION_FILE.exec(file)?.[1], file]),
  );
  const expected = assessment.pending.map((version) => filenamesByVersion.get(version));
  if (expected.some((file) => file === undefined)) {
    throw new Error('The linked ledger has a pending version without a canonical SQL file.');
  }

  const planned = [];
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('•')) continue;
    const match = /^•\s+(\d{14}_.+\.sql)$/u.exec(trimmed);
    if (!match) throw new Error('The linked dry-run migration list has an invalid filename.');
    planned.push(match[1]);
  }
  const headers = output.match(/Would push these migrations:/gu) ?? [];
  if (
    (expected.length > 0 && headers.length !== 1) ||
    (expected.length === 0 && headers.length > 0) ||
    planned.length !== expected.length ||
    planned.some((file, index) => file !== expected[index])
  ) {
    throw new Error(
      'The linked dry-run migration order does not match the canonical pending ledger.',
    );
  }
  return planned.length;
}

async function main() {
  const mode = process.argv[2];
  const dryRunPath = process.argv[3];
  if (process.argv.length !== 4 || !['plan', 'apply'].includes(mode)) {
    throw new Error('Expected a plan or apply mode and one dry-run output file.');
  }
  const migrationsDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../supabase/migrations',
  );
  const files = await readdir(migrationsDirectory);
  let listOutput = '';
  for await (const chunk of process.stdin) listOutput += chunk;
  const assessment = assessStagingMigrationGap(listOutput, files);
  const plannedCount = requireExactStagingDryRun(
    await readFile(dryRunPath, 'utf8'),
    assessment,
    files,
  );
  console.log(
    `Staging ledger: ${assessment.remoteCount}/${assessment.localCount} canonical migrations applied; ` +
      `${assessment.pending.length} pending; ${plannedCount} in the exact dry-run order; ` +
      `${assessment.historicalGaps.length} older than ${assessment.latestApplied}.`,
  );
  if (mode === 'apply') requireSafeStagingApply(assessment);
  else {
    if (assessment.historicalGaps.length > 0) {
      console.warn(
        `::warning::Ordinary staging apply would skip older migrations: ` +
          assessment.historicalGaps.join(', '),
      );
    }
    const unrehearsedCount = assessment.pending.filter(
      (version) => version <= UNREHEARSED_BACKLOG_THROUGH,
    ).length;
    if (unrehearsedCount > 0) {
      console.warn(
        `::warning::Staging apply is held for ${unrehearsedCount} unrehearsed backlog migrations.`,
      );
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : 'Migration guard failed.'}`);
    process.exitCode = 1;
  }
}
