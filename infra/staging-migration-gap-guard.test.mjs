import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessStagingMigrationGap,
  requireExactStagingDryRun,
  requireReviewedCbeStagingCatchUp,
  requireSafeStagingApply,
} from './staging-migration-gap-guard.mjs';

const files = [
  '20260912233000_older.sql',
  '20260913000000_applied.sql',
  '20260915190000_latest.sql',
  '20260916000000_newer.sql',
];

const linkedList = `
 Local          | Remote         | Time (UTC)
----------------|----------------|---------------------
  \`20260912233000\` | \` \`              | \`2026-09-12 23:30:00\`
  \`20260913000000\` | \`20260913000000\` | \`2026-09-13 00:00:00\`
  \`20260915190000\` | \`20260915190000\` | \`2026-09-15 19:00:00\`
  \`20260916000000\` | \` \`              | \`2026-09-16 00:00:00\`
`;

test('reports both older and newer gaps, but refuses an ordinary apply with older gaps', () => {
  const assessment = assessStagingMigrationGap(linkedList, files);
  assert.deepEqual(assessment, {
    localCount: 4,
    remoteCount: 2,
    latestApplied: '20260915190000',
    pending: ['20260912233000', '20260916000000'],
    historicalGaps: ['20260912233000'],
  });
  assert.throws(() => requireSafeStagingApply(assessment), /Ordinary db push would skip them/u);
});

test('requires the linked dry run to list every pending migration in ledger order', () => {
  const assessment = assessStagingMigrationGap(linkedList, files);
  const preview = `DRY RUN: migrations will *not* be pushed to the database.
Would push these migrations:
 • 20260912233000_older.sql
 • 20260916000000_newer.sql
Finished supabase db push.`;
  assert.equal(requireExactStagingDryRun(preview, assessment, files), 2);
  assert.throws(
    () =>
      requireExactStagingDryRun(
        preview.replace(' • 20260912233000_older.sql\n', ''),
        assessment,
        files,
      ),
    /does not match/u,
  );
  assert.throws(
    () =>
      requireExactStagingDryRun(
        preview.replace(
          ' • 20260912233000_older.sql\n • 20260916000000_newer.sql',
          ' • 20260916000000_newer.sql\n • 20260912233000_older.sql',
        ),
        assessment,
        files,
      ),
    /does not match/u,
  );
  assert.throws(
    () =>
      requireExactStagingDryRun(
        preview.replace('DRY RUN: migrations will *not* be pushed to the database.', ''),
        assessment,
        files,
      ),
    /not a recognized dry run/u,
  );
});

test('refuses the unrehearsed catch-up even after the older gap is filled', () => {
  const withoutGap = linkedList.replace(
    '`20260912233000` | ` `',
    '`20260912233000` | `20260912233000`',
  );
  const assessment = assessStagingMigrationGap(withoutGap, files);
  assert.deepEqual(assessment.historicalGaps, []);
  assert.deepEqual(assessment.pending, ['20260916000000']);
  assert.throws(() => requireSafeStagingApply(assessment), /unrehearsed catch-up/u);
});

test('allows a later migration once the catch-up is complete', () => {
  const laterFiles = [...files, '20261006000000_later.sql'];
  const completeList = linkedList
    .replace('`20260912233000` | ` `', '`20260912233000` | `20260912233000`')
    .replace('`20260916000000` | ` `', '`20260916000000` | `20260916000000`');
  const assessment = assessStagingMigrationGap(
    `${completeList}  \`20261006000000\` | \` \` | \`2026-10-06 00:00:00\`\n`,
    laterFiles,
  );
  assert.deepEqual(assessment.historicalGaps, []);
  assert.deepEqual(assessment.pending, ['20261006000000']);
  assert.doesNotThrow(() => requireSafeStagingApply(assessment));
});

test('the separately reviewed CBE catch-up rejects ledger or migration-set drift', () => {
  const reviewed = {
    localCount: 272,
    remoteCount: 87,
    latestApplied: '20260915190000',
    pending: [
      ...Array.from({ length: 184 }, (_, index) => `20261001${String(index).padStart(6, '0')}`),
      '20261018170000',
    ],
    historicalGaps: ['20260912233000', '20260914030000', '20260914123000', '20260914165043'],
  };
  assert.doesNotThrow(() => requireReviewedCbeStagingCatchUp(reviewed));
  for (const drift of [
    { remoteCount: 88 },
    { localCount: 273 },
    { latestApplied: '20260915190001' },
    { pending: reviewed.pending.slice(1) },
    { historicalGaps: reviewed.historicalGaps.slice(1) },
  ]) {
    assert.throws(
      () => requireReviewedCbeStagingCatchUp({ ...reviewed, ...drift }),
      /differs from the reviewed CBE catch-up snapshot/u,
    );
  }
});

test('fails closed on missing rows, remote-only history, or ambiguous output', () => {
  assert.throws(() => assessStagingMigrationGap('No version table', files), /parseable/u);
  assert.throws(
    () => assessStagingMigrationGap(linkedList.replace(/.*20260912233000.*\n/u, ''), files),
    /does not match/u,
  );
  assert.throws(
    () =>
      assessStagingMigrationGap(
        `${linkedList}  \` \` | \`20260917000000\` | \`2026-09-17 00:00:00\`\n`,
        files,
      ),
    /does not match/u,
  );
});
