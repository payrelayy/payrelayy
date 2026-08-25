import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  chown,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createFileOwnerKemerbetReadinessCohortControlForLinuxTests,
  OwnerKemerbetReadinessCohortRejectedError,
  OwnerKemerbetReadinessCohortUnavailableError,
  PostgresOwnerKemerbetReadinessCohortClaims,
  deriveOwnerKemerbetReadinessCohortFile,
} from './owner-kemerbet-readiness-cohort.js';
import type { OwnerPlayerDepositEligibilityRecord } from './owner-player-deposit-eligibility.js';

const AUTH_USER_ID = '99999999-9999-4999-8999-999999999999';
const REQUEST_ID = '77777777-7777-4777-8777-777777777777';
const CLAIM_ID = '88888888-8888-4888-8888-888888888888';
const OTHER_CLAIM_ID = '88888888-8888-4888-9888-888888888889';
const RECEIPT_ID = '66666666-6666-4666-8666-666666666666';
const REPLAY_RECEIPT_ID = '55555555-5555-4555-8555-555555555555';

function eligiblePlayer(index: number): OwnerPlayerDepositEligibilityRecord {
  return {
    decidedAt: '2026-08-25T09:00:00.000Z',
    decision: 'eligible',
    decisionId: `10000000-0000-4000-8000-00000000000${index}`,
    decisionVersion: index,
    playerAccountId: `00000000-0000-4000-8000-00000000000${index}`,
    playerId: `PLAYER_${index}`,
    playerStatus: 'active',
    platformCode: 'kemerbet',
    reasonCode: 'financial_eligibility_approved',
    validationStatus: 'valid',
  };
}

function exactFive(): OwnerPlayerDepositEligibilityRecord[] {
  return [1, 2, 3, 4, 5].map(eligiblePlayer);
}

const PLAYER_CONTENT = Buffer.from('PLAYER_1\nPLAYER_2\nPLAYER_3\nPLAYER_4\nPLAYER_5\n');
const CLAIM_CONTENT = Buffer.from(`${CLAIM_ID}\n`, 'ascii');

describe('Owner KemerBet readiness-cohort derivation', () => {
  it('derives exactly five eligible identifiers in deterministic account-ID order', () => {
    const file = deriveOwnerKemerbetReadinessCohortFile(exactFive().reverse());

    expect(file.equals(PLAYER_CONTENT)).toBe(true);
  });

  it('ignores unrelated ineligible history when exactly five eligible records remain', () => {
    const history: OwnerPlayerDepositEligibilityRecord[] = [
      ...exactFive(),
      {
        ...eligiblePlayer(6),
        decision: 'revoked',
        reasonCode: 'financial_eligibility_revoked',
      },
    ];

    expect(deriveOwnerKemerbetReadinessCohortFile(history).equals(PLAYER_CONTENT)).toBe(true);
  });

  it('keeps all production file names fixed and the alternate root Linux-test-only', () => {
    const source = readFileSync(
      new URL('./owner-kemerbet-readiness-cohort.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain("const CONTROL_ROOT = '/run/fetanagent-kemerbet-session-control';");
    expect(source).toContain(
      "const RECEIPT_ROOT = '/run/fetanagent-kemerbet-readiness-cohort-receipts';",
    );
    expect(source).toContain(
      'const COMPLETED_CLAIM = `${RECEIPT_ROOT}/kemerbet-readiness-cohort-completed-v1`;',
    );
    expect(source).not.toContain(
      'const COMPLETED_CLAIM = `${CONTROL_ROOT}/kemerbet-readiness-cohort-completed-v1`;',
    );
    expect(source).toContain('kemerbet-readiness-player-ids.stage-v1');
    expect(source).toContain('kemerbet-readiness-cohort-claim.stage-v1');
    expect(source).toContain('kemerbet-readiness-cohort-imported-v1');
    expect(source).toContain('kemerbet-readiness-cohort-completed-v1');
    expect(source).toContain('kemerbet-readiness-cohort-failed-v1');
    expect(source).toContain('kemerbet-readiness-recovery-in-progress-or-failed-v1');
    expect(source).toContain('.kemerbet-readiness-recovery-in-progress-or-failed-v1.installing');
    expect(source).not.toContain('.stage-v1.${requestId}');
    expect(source).toContain("process.env.NODE_ENV !== 'test'");
    expect(source).toContain("process.platform !== 'linux'");
    expect(source).not.toMatch(/console\.(?:debug|error|info|log|warn)/u);
  });

  it.each([
    [
      'a duplicate Player identifier',
      () => {
        const players = exactFive();
        players[4] = { ...players[4]!, playerId: players[0]!.playerId };
        return players;
      },
    ],
    [
      'a duplicate Player-account identifier',
      () => {
        const players = exactFive();
        players[4] = { ...players[4]!, playerAccountId: players[0]!.playerAccountId };
        return players;
      },
    ],
    [
      'an ineligible member of the five records',
      () => {
        const players = exactFive();
        players[4] = {
          ...players[4]!,
          decision: 'revoked',
          reasonCode: 'financial_eligibility_revoked',
        };
        return players;
      },
    ],
    [
      'a noncanonical Player identifier',
      () => {
        const players = exactFive();
        players[4] = { ...players[4]!, playerId: 'PLAYER 5' };
        return players;
      },
    ],
    [
      'a noncanonical Player-account identifier',
      () => {
        const players = exactFive();
        players[4] = {
          ...players[4]!,
          playerAccountId: `A${players[4]!.playerAccountId.slice(1)}`,
        };
        return players;
      },
    ],
    ['six eligible records', () => [...exactFive(), eligiblePlayer(6)]],
  ])('rejects %s', (_label, players) => {
    expect(() => deriveOwnerKemerbetReadinessCohortFile(players())).toThrow(
      OwnerKemerbetReadinessCohortRejectedError,
    );
  });
});

describe('Owner KemerBet readiness-cohort database claim', () => {
  function claimRows(state = 'prepared') {
    return exactFive().map((player, index) => ({
      cohort_already_claimed: false,
      cohort_id: CLAIM_ID,
      cohort_state: state,
      decided_at: new Date(player.decidedAt!),
      decision: player.decision,
      decision_id: player.decisionId,
      decision_version: player.decisionVersion,
      member_ordinal: index + 1,
      platform_code: player.platformCode,
      player_account_id: player.playerAccountId,
      player_id: player.playerId,
      player_status: player.playerStatus,
      reason_code: player.reasonCode,
      validation_status: player.validationStatus,
    }));
  }

  it('parses exactly five globally claimed members and an idempotent export receipt', async () => {
    const claims = new PostgresOwnerKemerbetReadinessCohortClaims({
      query: async (sql, values) => {
        if (sql.includes('prepare_owner_kemerbet_readiness_cohort_claim')) {
          expect(values).toEqual([AUTH_USER_ID, REQUEST_ID]);
          return { rows: claimRows() };
        }
        expect(sql).toContain('advance_owner_kemerbet_readiness_cohort_claim');
        expect(values).toEqual([AUTH_USER_ID, REQUEST_ID, CLAIM_ID, 'exported']);
        return {
          rows: [
            {
              advanced_claim_id: CLAIM_ID,
              advanced_claim_state: 'exported',
              transition_already_recorded: false,
              transitioned_at: new Date('2026-08-25T09:05:00.000Z'),
            },
          ],
        };
      },
    });

    await expect(claims.claim(AUTH_USER_ID, REQUEST_ID)).resolves.toEqual({
      alreadyClaimed: false,
      claimId: CLAIM_ID,
      players: exactFive(),
      state: 'prepared',
    });
    await expect(claims.markExported(AUTH_USER_ID, REQUEST_ID, CLAIM_ID)).resolves.toEqual({
      alreadyRecorded: false,
      claimId: CLAIM_ID,
      state: 'exported',
      transitionedAt: '2026-08-25T09:05:00.000Z',
    });
  });

  it.each(['imported', 'failed_terminal', 'succeeded'])(
    'accepts a valid %s claim replay',
    async (state) => {
      const claims = new PostgresOwnerKemerbetReadinessCohortClaims({
        query: async () => ({ rows: claimRows(state) }),
      });

      await expect(claims.claim(AUTH_USER_ID, REQUEST_ID)).resolves.toMatchObject({ state });
    },
  );

  it.each([
    ['imported', undefined, 'imported'],
    ['imported', undefined, 'succeeded'],
    ['completed', undefined, 'succeeded'],
    ['failed_terminal', 'recheck_failed_cleanup_confirmed', 'failed_terminal'],
  ] as const)(
    'records the %s root receipt with exact state and semantic-replay validation',
    async (event, failureCode, state) => {
      const claims = new PostgresOwnerKemerbetReadinessCohortClaims({
        query: async (sql, values) => {
          expect(sql).toContain('record_owner_kemerbet_readiness_cohort_root_receipt');
          expect(values).toEqual([CLAIM_ID, RECEIPT_ID, event, failureCode ?? null]);
          return {
            rows: [
              {
                recorded_at: new Date('2026-08-25T09:10:00.000Z'),
                recorded_claim_id: CLAIM_ID,
                recorded_claim_state: state,
                recorded_receipt_event: event,
                recorded_receipt_id: REPLAY_RECEIPT_ID,
                receipt_already_recorded: true,
              },
            ],
          };
        },
      });

      await expect(
        claims.recordRootReceipt(CLAIM_ID, RECEIPT_ID, event, failureCode),
      ).resolves.toEqual({
        alreadyRecorded: true,
        claimId: CLAIM_ID,
        event,
        receiptId: REPLAY_RECEIPT_ID,
        state,
        recordedAt: '2026-08-25T09:10:00.000Z',
      });
    },
  );

  it('rejects invalid receipt/failure combinations before querying PostgreSQL', async () => {
    const claims = new PostgresOwnerKemerbetReadinessCohortClaims({
      query: async () => {
        throw new Error('query must not run');
      },
    });

    await expect(
      claims.recordRootReceipt(CLAIM_ID, RECEIPT_ID, 'failed_terminal'),
    ).rejects.toBeInstanceOf(OwnerKemerbetReadinessCohortRejectedError);
    await expect(
      claims.recordRootReceipt(
        CLAIM_ID,
        RECEIPT_ID,
        'completed',
        'recheck_failed_cleanup_confirmed',
      ),
    ).rejects.toBeInstanceOf(OwnerKemerbetReadinessCohortRejectedError);
  });

  it('fails closed on a short, duplicated, or noncanonical database projection', async () => {
    const malformed = claimRows();
    malformed[4] = { ...malformed[4]!, player_id: malformed[0]!.player_id };
    const claims = new PostgresOwnerKemerbetReadinessCohortClaims({
      query: async () => ({ rows: malformed }),
    });
    await expect(claims.claim(AUTH_USER_ID, REQUEST_ID)).rejects.toBeInstanceOf(
      OwnerKemerbetReadinessCohortUnavailableError,
    );
  });

  it('fails closed on a root-receipt event/state mismatch', async () => {
    const claims = new PostgresOwnerKemerbetReadinessCohortClaims({
      query: async () => ({
        rows: [
          {
            recorded_at: new Date('2026-08-25T09:10:00.000Z'),
            recorded_claim_id: CLAIM_ID,
            recorded_claim_state: 'imported',
            recorded_receipt_event: 'completed',
            recorded_receipt_id: RECEIPT_ID,
            receipt_already_recorded: false,
          },
        ],
      }),
    });

    await expect(
      claims.recordRootReceipt(CLAIM_ID, RECEIPT_ID, 'completed'),
    ).rejects.toBeInstanceOf(OwnerKemerbetReadinessCohortUnavailableError);
  });

  it.each([
    [
      'a different receipt identity on a newly recorded event',
      'imported',
      REPLAY_RECEIPT_ID,
      false,
    ],
    [
      'a newly recorded imported event that already reports success',
      'succeeded',
      RECEIPT_ID,
      false,
    ],
  ] as const)('fails closed on %s', async (_label, state, returnedReceiptId, alreadyRecorded) => {
    const claims = new PostgresOwnerKemerbetReadinessCohortClaims({
      query: async () => ({
        rows: [
          {
            recorded_at: new Date('2026-08-25T09:10:00.000Z'),
            recorded_claim_id: CLAIM_ID,
            recorded_claim_state: state,
            recorded_receipt_event: 'imported',
            recorded_receipt_id: returnedReceiptId,
            receipt_already_recorded: alreadyRecorded,
          },
        ],
      }),
    });

    await expect(claims.recordRootReceipt(CLAIM_ID, RECEIPT_ID, 'imported')).rejects.toBeInstanceOf(
      OwnerKemerbetReadinessCohortUnavailableError,
    );
  });

  it('rejects invalid UUID input without querying PostgreSQL', async () => {
    const claims = new PostgresOwnerKemerbetReadinessCohortClaims({
      query: async () => {
        throw new Error('query must not run');
      },
    });
    await expect(claims.claim(AUTH_USER_ID, 'not-a-uuid')).rejects.toBeInstanceOf(
      OwnerKemerbetReadinessCohortRejectedError,
    );
  });
});

interface LinuxBoundary {
  readonly control: ReturnType<typeof createFileOwnerKemerbetReadinessCohortControlForLinuxTests>;
  readonly paths: {
    readonly claim: string;
    readonly claimInstalling: string;
    readonly cohort: string;
    readonly cohortInstalling: string;
    readonly completed: string;
    readonly completedInstalling: string;
    readonly failed: string;
    readonly failedInstalling: string;
    readonly imported: string;
    readonly importedInstalling: string;
  };
  readonly controlRoot: string;
  readonly receiptRoot: string;
  readonly root: string;
}

const linuxRoots: string[] = [];

async function linuxBoundary(): Promise<LinuxBoundary> {
  const root = await mkdtemp(join(tmpdir(), 'fetanagent-readiness-cohort-'));
  linuxRoots.push(root);
  const controlRoot = join(root, 'control');
  const receiptRoot = join(root, 'receipts');
  await mkdir(controlRoot, { mode: 0o700 });
  await mkdir(receiptRoot, { mode: 0o555 });
  await chmod(controlRoot, 0o700);
  await chmod(receiptRoot, 0o555);
  return {
    control: createFileOwnerKemerbetReadinessCohortControlForLinuxTests(controlRoot, receiptRoot),
    controlRoot,
    paths: {
      claim: join(controlRoot, 'kemerbet-readiness-cohort-claim.stage-v1'),
      claimInstalling: join(controlRoot, '.kemerbet-readiness-cohort-claim.stage-v1.installing'),
      cohort: join(controlRoot, 'kemerbet-readiness-player-ids.stage-v1'),
      cohortInstalling: join(controlRoot, '.kemerbet-readiness-player-ids.stage-v1.installing'),
      completed: join(receiptRoot, 'kemerbet-readiness-cohort-completed-v1'),
      completedInstalling: join(receiptRoot, '.kemerbet-readiness-cohort-completed-v1.installing'),
      failed: join(receiptRoot, 'kemerbet-readiness-cohort-failed-v1'),
      failedInstalling: join(receiptRoot, '.kemerbet-readiness-cohort-failed-v1.installing'),
      imported: join(receiptRoot, 'kemerbet-readiness-cohort-imported-v1'),
      importedInstalling: join(receiptRoot, '.kemerbet-readiness-cohort-imported-v1.installing'),
    },
    receiptRoot,
    root,
  };
}

async function writeExact(path: string, content: Buffer, mode: number): Promise<void> {
  await writeFile(path, content, { flag: 'wx', mode });
  await chmod(path, mode);
}

async function mutateReceiptRoot<T>(
  boundary: LinuxBoundary,
  mutation: () => Promise<T>,
): Promise<T> {
  await chmod(boundary.receiptRoot, 0o755);
  try {
    return await mutation();
  } finally {
    await chmod(boundary.receiptRoot, 0o555);
  }
}

async function writeReceiptExact(
  boundary: LinuxBoundary,
  path: string,
  content: Buffer,
  mode: number,
): Promise<void> {
  await mutateReceiptRoot(boundary, async () => writeExact(path, content, mode));
}

async function expectExactFile(path: string, content: Buffer, mode: number): Promise<void> {
  const metadata = await lstat(path);
  expect(metadata.isFile()).toBe(true);
  expect(metadata.isSymbolicLink()).toBe(false);
  expect(metadata.uid).toBe(process.geteuid?.());
  expect(metadata.gid).toBe(process.getegid?.());
  expect(metadata.mode & 0o7777).toBe(mode);
  expect(metadata.nlink).toBe(1);
  expect((await readFile(path)).equals(content)).toBe(true);
}

async function removeIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  });
}

describe.skipIf(process.platform !== 'linux')(
  'Owner KemerBet readiness-cohort Linux filesystem boundary',
  () => {
    afterEach(async () => {
      const roots = linuxRoots.splice(0);
      await Promise.all(roots.map(async (root) => rm(root, { force: true, recursive: true })));
    });

    it('rejects either boundary root nested beneath the other root', async () => {
      const root = await mkdtemp(join(tmpdir(), 'fetanagent-readiness-overlap-'));
      linuxRoots.push(root);
      const controlRoot = join(root, 'control');
      const nestedReceiptRoot = join(controlRoot, 'receipts');
      await mkdir(nestedReceiptRoot, { recursive: true });

      expect(() =>
        createFileOwnerKemerbetReadinessCohortControlForLinuxTests(controlRoot, nestedReceiptRoot),
      ).toThrow(OwnerKemerbetReadinessCohortUnavailableError);
      expect(() =>
        createFileOwnerKemerbetReadinessCohortControlForLinuxTests(nestedReceiptRoot, controlRoot),
      ).toThrow(OwnerKemerbetReadinessCohortUnavailableError);
    });

    it('rejects a descendant whose basename begins with two dots', async () => {
      const root = await mkdtemp(join(tmpdir(), 'fetanagent-readiness-dotdot-name-'));
      linuxRoots.push(root);
      const controlRoot = join(root, 'control');
      const deceptiveReceiptRoot = join(controlRoot, '..receipts');
      await mkdir(deceptiveReceiptRoot, { recursive: true });

      expect(() =>
        createFileOwnerKemerbetReadinessCohortControlForLinuxTests(
          controlRoot,
          deceptiveReceiptRoot,
        ),
      ).toThrow(OwnerKemerbetReadinessCohortUnavailableError);
    });

    it('atomically stages one exact service-owned Player/claim pair and is inode-idempotent', async () => {
      const { control, paths } = await linuxBoundary();

      const first = await control.prepare(exactFive().reverse(), REQUEST_ID, CLAIM_ID);
      const claimIdentity = await lstat(paths.claim);
      const cohortIdentity = await lstat(paths.cohort);

      expect(first).toEqual({
        alreadyPrepared: false,
        identifiersRedacted: true,
        moneyMoved: false,
        playersPrepared: 5,
        transferDisabled: true,
      });
      expect(JSON.stringify(first)).not.toContain(CLAIM_ID);
      expect(JSON.stringify(first)).not.toContain('PLAYER_');
      await expectExactFile(paths.claim, CLAIM_CONTENT, 0o400);
      await expectExactFile(paths.cohort, PLAYER_CONTENT, 0o400);
      await expect(lstat(paths.claimInstalling)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(paths.cohortInstalling)).rejects.toMatchObject({ code: 'ENOENT' });

      await expect(control.prepare(exactFive(), REQUEST_ID, CLAIM_ID)).resolves.toMatchObject({
        alreadyPrepared: true,
      });
      expect((await lstat(paths.claim)).ino).toBe(claimIdentity.ino);
      expect((await lstat(paths.cohort)).ino).toBe(cohortIdentity.ino);
    });

    it('fails closed if a valid root receipt appears after both stage files are sealed', async () => {
      const root = await mkdtemp(join(tmpdir(), 'fetanagent-readiness-prepare-receipt-race-'));
      linuxRoots.push(root);
      const controlRoot = join(root, 'control');
      const receiptRoot = join(root, 'receipts');
      const claim = join(controlRoot, 'kemerbet-readiness-cohort-claim.stage-v1');
      const cohort = join(controlRoot, 'kemerbet-readiness-player-ids.stage-v1');
      const imported = join(receiptRoot, 'kemerbet-readiness-cohort-imported-v1');
      await mkdir(controlRoot, { mode: 0o700 });
      await mkdir(receiptRoot, { mode: 0o555 });
      await chmod(controlRoot, 0o700);
      await chmod(receiptRoot, 0o555);
      const control = createFileOwnerKemerbetReadinessCohortControlForLinuxTests(
        controlRoot,
        receiptRoot,
        async () => {
          await chmod(receiptRoot, 0o755);
          try {
            await writeExact(imported, CLAIM_CONTENT, 0o440);
          } finally {
            await chmod(receiptRoot, 0o555);
          }
        },
      );

      await expect(control.prepare(exactFive(), REQUEST_ID, CLAIM_ID)).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );
      await expectExactFile(claim, CLAIM_CONTENT, 0o400);
      await expectExactFile(cohort, PLAYER_CONTENT, 0o400);
      await expectExactFile(imported, CLAIM_CONTENT, 0o440);
    });

    it('serializes concurrent preparations without taking over a live partial installer', async () => {
      const { control, paths } = await linuxBoundary();

      const receipts = await Promise.all(
        Array.from({ length: 12 }, () =>
          control.prepare(exactFive().reverse(), REQUEST_ID, CLAIM_ID),
        ),
      );

      expect(receipts.filter((candidate) => !candidate.alreadyPrepared)).toHaveLength(1);
      expect(receipts.filter((candidate) => candidate.alreadyPrepared)).toHaveLength(11);
      await expectExactFile(paths.claim, CLAIM_CONTENT, 0o400);
      await expectExactFile(paths.cohort, PLAYER_CONTENT, 0o400);
      await expect(lstat(paths.claimInstalling)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(paths.cohortInstalling)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('serializes conflicting concurrent claims and preserves only the first exact pair', async () => {
      const { control, paths } = await linuxBoundary();

      const first = control.prepare(exactFive(), REQUEST_ID, CLAIM_ID);
      const conflicting = control.prepare(exactFive(), REQUEST_ID, OTHER_CLAIM_ID);

      await expect(first).resolves.toMatchObject({ alreadyPrepared: false });
      await expect(conflicting).rejects.toBeInstanceOf(OwnerKemerbetReadinessCohortRejectedError);
      await expectExactFile(paths.claim, CLAIM_CONTENT, 0o400);
      await expectExactFile(paths.cohort, PLAYER_CONTENT, 0o400);
      await expect(lstat(paths.claimInstalling)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(paths.cohortInstalling)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('recovers a complete one-link claim installer left before its staged link', async () => {
      const { control, paths } = await linuxBoundary();
      await writeExact(paths.claimInstalling, CLAIM_CONTENT, 0o400);

      await expect(control.prepare(exactFive(), REQUEST_ID, CLAIM_ID)).resolves.toMatchObject({
        alreadyPrepared: false,
      });
      await expectExactFile(paths.claim, CLAIM_CONTENT, 0o400);
      await expectExactFile(paths.cohort, PLAYER_CONTENT, 0o400);
      await expect(lstat(paths.claimInstalling)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('recovers a complete two-link cohort installer left after staged linking', async () => {
      const { control, paths } = await linuxBoundary();
      await writeExact(paths.claim, CLAIM_CONTENT, 0o400);
      await writeExact(paths.cohortInstalling, PLAYER_CONTENT, 0o400);
      await link(paths.cohortInstalling, paths.cohort);
      expect((await lstat(paths.cohortInstalling)).nlink).toBe(2);

      await expect(control.prepare(exactFive(), REQUEST_ID, CLAIM_ID)).resolves.toMatchObject({
        alreadyPrepared: false,
      });
      await expectExactFile(paths.cohort, PLAYER_CONTENT, 0o400);
      await expect(lstat(paths.cohortInstalling)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('removes only an exact owned partial installer and safely restages it', async () => {
      const { control, paths } = await linuxBoundary();
      await writeExact(paths.claim, CLAIM_CONTENT, 0o400);
      await writeExact(paths.cohortInstalling, Buffer.from('PLAYER_1\n'), 0o400);

      await expect(control.prepare(exactFive(), REQUEST_ID, CLAIM_ID)).resolves.toMatchObject({
        alreadyPrepared: false,
      });
      await expectExactFile(paths.cohort, PLAYER_CONTENT, 0o400);
      await expect(lstat(paths.cohortInstalling)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('fails closed without mutating an orphan cohort or a mismatched installer', async () => {
      const orphan = await linuxBoundary();
      await writeExact(orphan.paths.cohort, PLAYER_CONTENT, 0o400);

      await expect(
        orphan.control.prepare(exactFive(), REQUEST_ID, CLAIM_ID),
      ).rejects.toBeInstanceOf(OwnerKemerbetReadinessCohortUnavailableError);
      await expect(lstat(orphan.paths.claim)).rejects.toMatchObject({ code: 'ENOENT' });
      await expectExactFile(orphan.paths.cohort, PLAYER_CONTENT, 0o400);

      const mismatch = await linuxBoundary();
      await writeExact(mismatch.paths.claim, CLAIM_CONTENT, 0o400);
      const different = Buffer.from('PLAYER_A\nPLAYER_B\nPLAYER_C\nPLAYER_D\nPLAYER_E\n');
      await writeExact(mismatch.paths.cohortInstalling, different, 0o400);
      await expect(
        mismatch.control.prepare(exactFive(), REQUEST_ID, CLAIM_ID),
      ).rejects.toBeInstanceOf(OwnerKemerbetReadinessCohortRejectedError);
      await expectExactFile(mismatch.paths.cohortInstalling, different, 0o400);
      await expect(lstat(mismatch.paths.cohort)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('fails closed on symlinks, unsafe root mode, and mismatched claim content', async () => {
      const symlinked = await linuxBoundary();
      const target = join(symlinked.root, 'unrelated-target');
      await writeExact(target, Buffer.from('unchanged'), 0o400);
      await symlink(target, symlinked.paths.claimInstalling);
      await expect(
        symlinked.control.prepare(exactFive(), REQUEST_ID, CLAIM_ID),
      ).rejects.toBeInstanceOf(OwnerKemerbetReadinessCohortUnavailableError);
      expect((await readFile(target)).toString()).toBe('unchanged');

      const wrongRoot = await linuxBoundary();
      await chmod(wrongRoot.controlRoot, 0o750);
      await expect(
        wrongRoot.control.prepare(exactFive(), REQUEST_ID, CLAIM_ID),
      ).rejects.toBeInstanceOf(OwnerKemerbetReadinessCohortUnavailableError);

      const mismatch = await linuxBoundary();
      await writeExact(mismatch.paths.claim, Buffer.from(`${OTHER_CLAIM_ID}\n`, 'ascii'), 0o400);
      await expect(
        mismatch.control.prepare(exactFive(), REQUEST_ID, CLAIM_ID),
      ).rejects.toBeInstanceOf(OwnerKemerbetReadinessCohortRejectedError);
      await expect(lstat(mismatch.paths.cohort)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('returns an exact imported receipt for each allowed frozen/consumed stage state', async () => {
      for (const consumed of ['neither', 'claim', 'cohort', 'both'] as const) {
        const boundary = await linuxBoundary();
        const { control, paths } = boundary;
        await control.prepare(exactFive(), REQUEST_ID, CLAIM_ID);
        await chmod(paths.claim, 0o444);
        await chmod(paths.cohort, 0o444);
        if (consumed === 'claim' || consumed === 'both') await unlink(paths.claim);
        if (consumed === 'cohort' || consumed === 'both') await unlink(paths.cohort);
        await writeReceiptExact(boundary, paths.imported, CLAIM_CONTENT, 0o440);

        await expect(control.rootReceipt()).resolves.toEqual({
          claimId: CLAIM_ID,
          event: 'imported',
        });
        await expect(control.completed(CLAIM_ID)).resolves.toBe(false);
      }
    });

    it('returns completed only for an exact marker with every stage artifact absent', async () => {
      const boundary = await linuxBoundary();
      const { control, paths } = boundary;
      await writeReceiptExact(boundary, paths.completed, CLAIM_CONTENT, 0o440);

      await expect(control.rootReceipt()).resolves.toEqual({
        claimId: CLAIM_ID,
        event: 'completed',
      });
      await expect(control.completed(CLAIM_ID)).resolves.toBe(true);
      await expect(control.completed(OTHER_CLAIM_ID)).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortRejectedError,
      );

      const residue = await linuxBoundary();
      await writeReceiptExact(residue, residue.paths.completed, CLAIM_CONTENT, 0o440);
      await writeExact(residue.paths.claim, CLAIM_CONTENT, 0o400);
      await expect(residue.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );
    });

    it('returns retryable_failed only with the exact restored service-owned pair', async () => {
      const boundary = await linuxBoundary();
      const { control, paths } = boundary;
      await control.prepare(exactFive(), REQUEST_ID, CLAIM_ID);
      await writeReceiptExact(boundary, paths.failed, CLAIM_CONTENT, 0o440);

      await expect(control.rootReceipt()).resolves.toEqual({
        claimId: CLAIM_ID,
        event: 'retryable_failed',
      });

      await unlink(paths.cohort);
      await expect(control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );
    });

    it('rejects imported service-owned files, invalid Player content, and claim mismatch', async () => {
      const serviceOwned = await linuxBoundary();
      await serviceOwned.control.prepare(exactFive(), REQUEST_ID, CLAIM_ID);
      await writeReceiptExact(serviceOwned, serviceOwned.paths.imported, CLAIM_CONTENT, 0o440);
      await expect(serviceOwned.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );

      const malformed = await linuxBoundary();
      await writeExact(malformed.paths.claim, CLAIM_CONTENT, 0o444);
      await writeExact(
        malformed.paths.cohort,
        Buffer.from('PLAYER_1\nPLAYER_2\nPLAYER_3\nPLAYER_4\nPLAYER_4\n'),
        0o444,
      );
      await writeReceiptExact(malformed, malformed.paths.imported, CLAIM_CONTENT, 0o440);
      await expect(malformed.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortRejectedError,
      );

      const mismatch = await linuxBoundary();
      await writeExact(mismatch.paths.claim, Buffer.from(`${OTHER_CLAIM_ID}\n`, 'ascii'), 0o444);
      await writeExact(mismatch.paths.cohort, PLAYER_CONTENT, 0o444);
      await writeReceiptExact(mismatch, mismatch.paths.imported, CLAIM_CONTENT, 0o440);
      await expect(mismatch.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortRejectedError,
      );
    });

    it('fails closed on conflicting markers, marker installers, unsafe metadata, and links', async () => {
      const conflict = await linuxBoundary();
      await writeReceiptExact(conflict, conflict.paths.imported, CLAIM_CONTENT, 0o440);
      await writeReceiptExact(conflict, conflict.paths.failed, CLAIM_CONTENT, 0o440);
      await expect(conflict.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );

      const installer = await linuxBoundary();
      await writeReceiptExact(installer, installer.paths.completedInstalling, CLAIM_CONTENT, 0o440);
      await expect(installer.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );

      const wrongMode = await linuxBoundary();
      await writeReceiptExact(wrongMode, wrongMode.paths.completed, CLAIM_CONTENT, 0o400);
      await expect(wrongMode.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );

      const noncanonical = await linuxBoundary();
      await writeReceiptExact(
        noncanonical,
        noncanonical.paths.completed,
        Buffer.from('ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF\n', 'ascii'),
        0o440,
      );
      await expect(noncanonical.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortRejectedError,
      );

      const linked = await linuxBoundary();
      await writeReceiptExact(linked, linked.paths.completed, CLAIM_CONTENT, 0o440);
      await mutateReceiptRoot(linked, async () =>
        link(linked.paths.completed, join(linked.receiptRoot, 'extra-hard-link')),
      );
      await expect(linked.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );

      const symbolic = await linuxBoundary();
      const target = join(symbolic.root, 'marker-target');
      await writeExact(target, CLAIM_CONTENT, 0o440);
      await mutateReceiptRoot(symbolic, async () => symlink(target, symbolic.paths.completed));
      await expect(symbolic.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );
    });

    it('returns undefined only after an exact stable no-marker scan', async () => {
      const { control } = await linuxBoundary();
      await expect(control.rootReceipt()).resolves.toBeUndefined();
    });

    it('rejects an unsafe or non-exact receipt-root namespace', async () => {
      const unsafeMode = await linuxBoundary();
      await chmod(unsafeMode.receiptRoot, 0o755);
      await expect(unsafeMode.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );

      const residue = await linuxBoundary();
      await mutateReceiptRoot(residue, async () =>
        writeExact(join(residue.receiptRoot, 'unexpected'), Buffer.from('fixed'), 0o440),
      );
      await expect(residue.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );

      const legacy = await linuxBoundary();
      await writeExact(
        join(legacy.controlRoot, 'kemerbet-readiness-cohort-completed-v1'),
        CLAIM_CONTENT,
        0o440,
      );
      await expect(legacy.control.rootReceipt()).rejects.toBeInstanceOf(
        OwnerKemerbetReadinessCohortUnavailableError,
      );
    });

    it('cannot reclassify an aggregate receipt through its service-visible directory', async () => {
      const boundary = await linuxBoundary();
      await boundary.control.prepare(exactFive(), REQUEST_ID, CLAIM_ID);
      await chmod(boundary.paths.claim, 0o444);
      await chmod(boundary.paths.cohort, 0o444);
      await writeReceiptExact(boundary, boundary.paths.imported, CLAIM_CONTENT, 0o440);

      expect((await lstat(boundary.receiptRoot)).mode & 0o7777).toBe(0o555);
      if (process.geteuid?.() !== 0) {
        await expect(
          rename(boundary.paths.imported, boundary.paths.completed),
        ).rejects.toMatchObject({ code: 'EACCES' });
        await expect(unlink(boundary.paths.imported)).rejects.toMatchObject({ code: 'EACCES' });
        await expect(
          writeFile(boundary.paths.failed, CLAIM_CONTENT, { flag: 'wx', mode: 0o440 }),
        ).rejects.toMatchObject({ code: 'EACCES' });
        await expect(
          link(boundary.paths.imported, join(boundary.receiptRoot, 'reclassified-hardlink')),
        ).rejects.toMatchObject({ code: 'EACCES' });
        await expect(
          symlink(boundary.paths.imported, join(boundary.receiptRoot, 'reclassified-symlink')),
        ).rejects.toMatchObject({ code: 'EACCES' });
      }
      await expect(boundary.control.rootReceipt()).resolves.toEqual({
        claimId: CLAIM_ID,
        event: 'imported',
      });
      await expect(lstat(boundary.paths.completed)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(boundary.paths.failed)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.skipIf(process.geteuid?.() !== 0)(
      'denies UID 10001 every receipt-directory mutation while preserving marker readability',
      async () => {
        const root = await mkdtemp(join(tmpdir(), 'fetanagent-readiness-receipt-dac-'));
        linuxRoots.push(root);
        const receiptRoot = join(root, 'receipts');
        const imported = join(receiptRoot, 'kemerbet-readiness-cohort-imported-v1');
        await chmod(root, 0o755);
        await mkdir(receiptRoot, { mode: 0o755 });
        await writeFile(imported, CLAIM_CONTENT, { flag: 'wx', mode: 0o440 });
        await chown(imported, 0, 10_001);
        await chmod(imported, 0o440);

        const child = spawnSync(
          process.execPath,
          [
            '-e',
            String.raw`
              const fs = require('node:fs');
              const [root, imported, claim] = process.argv.slice(1);
              if (fs.readFileSync(imported, 'ascii') !== claim + '\n') process.exit(2);
              const attempts = [
                () => fs.renameSync(imported, root + '/kemerbet-readiness-cohort-completed-v1'),
                () => fs.unlinkSync(imported),
                () => fs.writeFileSync(root + '/kemerbet-readiness-cohort-failed-v1', claim + '\n', { flag: 'wx' }),
                () => fs.linkSync(imported, root + '/reclassified-hardlink'),
                () => fs.symlinkSync(imported, root + '/reclassified-symlink'),
              ];
              for (const attempt of attempts) {
                try { attempt(); process.exit(3); }
                catch (error) {
                  if (!error || !['EACCES', 'EPERM', 'EROFS'].includes(error.code)) process.exit(4);
                }
              }
            `,
            receiptRoot,
            imported,
            CLAIM_ID,
          ],
          { encoding: 'utf8', gid: 10_001, uid: 10_001 },
        );

        expect(child.status).toBe(0);
        expect(child.stdout).toBe('');
        expect(child.stderr).toBe('');
        expect(await readFile(imported)).toEqual(CLAIM_CONTENT);
        expect((await lstat(imported)).nlink).toBe(1);
      },
    );

    it('never places request, claim, or Player identifiers into error messages', async () => {
      const { control, paths } = await linuxBoundary();
      await writeExact(paths.claim, Buffer.from(`${OTHER_CLAIM_ID}\n`, 'ascii'), 0o400);

      let failure: unknown;
      try {
        await control.prepare(exactFive(), REQUEST_ID, CLAIM_ID);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(OwnerKemerbetReadinessCohortRejectedError);
      const message = failure instanceof Error ? failure.message : String(failure);
      expect(message).not.toContain(REQUEST_ID);
      expect(message).not.toContain(CLAIM_ID);
      expect(message).not.toContain(OTHER_CLAIM_ID);
      expect(message).not.toContain('PLAYER_');
    });

    it('keeps every marker-install path observable to conflict scans', async () => {
      const boundary = await linuxBoundary();
      const { control, paths } = boundary;
      for (const path of [paths.importedInstalling, paths.failedInstalling]) {
        await writeReceiptExact(boundary, path, CLAIM_CONTENT, 0o440);
        await expect(control.rootReceipt()).rejects.toBeInstanceOf(
          OwnerKemerbetReadinessCohortUnavailableError,
        );
        await mutateReceiptRoot(boundary, async () => removeIfPresent(path));
      }
    });

    it('blocks reconciliation and preparation on a recovery latch or its crash installer', async () => {
      const boundary = await linuxBoundary();
      for (const basename of [
        'kemerbet-readiness-recovery-in-progress-or-failed-v1',
        '.kemerbet-readiness-recovery-in-progress-or-failed-v1.installing',
      ]) {
        const path = join(boundary.receiptRoot, basename);
        await mutateReceiptRoot(boundary, async () =>
          writeExact(
            path,
            Buffer.from('fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n'),
            0o400,
          ),
        );
        await expect(boundary.control.rootReceipt()).rejects.toBeInstanceOf(
          OwnerKemerbetReadinessCohortUnavailableError,
        );
        await expect(
          boundary.control.prepare(exactFive(), REQUEST_ID, CLAIM_ID),
        ).rejects.toBeInstanceOf(OwnerKemerbetReadinessCohortUnavailableError);
        await mutateReceiptRoot(boundary, async () => removeIfPresent(path));
      }
    });
  },
);
