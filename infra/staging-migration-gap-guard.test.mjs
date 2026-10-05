import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessStagingMigrationGap,
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
