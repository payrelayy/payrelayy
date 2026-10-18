import { randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { createPilotPrerequisites } from './private-live-money-pilot.suite.js';

type SqlValue = boolean | number | string | null;

const PAYMENT_SWITCHES = [
  'cbe_birr_authoritative_verification',
  'deposit_execution',
  'payment_verification',
  'private_live_deposit_pilot',
  'telebirr_authoritative_verification',
] as const;
const VERIFIER_FUNCTIONS = [
  'app.lease_routine_cbe_birr_verification(uuid)',
  'app.record_routine_cbe_birr_verification(uuid,uuid,text,text,bigint,text,timestamp with time zone,text,text,text,smallint)',
  'app.release_routine_cbe_birr_verification(uuid,uuid,text)',
] as const;
const PRIVATE_FUNCTIONS = [
  'app.capture_routine_cbe_birr_candidate(uuid,text,text,text,text,text,smallint,smallint,text)',
  'app.close_routine_cbe_birr_candidate_for_review(uuid,text)',
  'app.routine_cbe_birr_verifier_session_allowed()',
  'app.set_routine_cbe_birr_processing_mode(text,text)',
] as const;
const DIGEST = `sha256:${'d'.repeat(64)}`;
const TOPOLOGY = 'cbe_birr_vat_customer_receipt_credit_account_v2';

let savepointSequence = 0;

async function withSavepoint<T>(client: Client, action: () => Promise<T>): Promise<T> {
  const savepoint = `cbe_ledger_${++savepointSequence}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    const value = await action();
    await client.query(`release savepoint ${savepoint}`);
    return value;
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    throw error;
  }
}

async function asRole<T extends QueryResultRow>(
  client: Client,
  role: string,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  return withSavepoint(client, async () => {
    await client.query(`set local role ${role}`);
    const rows = (await client.query<T>(query, [...values])).rows;
    await client.query('reset role');
    return rows;
  });
}

async function expectFailure(
  client: Client,
  query: string,
  values: readonly SqlValue[],
  pattern: RegExp,
): Promise<void> {
  let failure: unknown;
  try {
    await withSavepoint(client, () => client.query(query, [...values]));
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toMatch(pattern);
}

async function moneyRows(client: Client): Promise<unknown> {
  const rows = await client.query(`select
      (select count(*)::text from app.deposit_intents) as intents,
      (select count(*)::text from app.provider_payment_evidence) as evidence,
      (select count(*)::text from app.deposit_payment_claims) as claims,
      (select count(*)::text from app.deposit_jobs) as jobs,
      (select count(*)::text from app.deposit_execution_attempts) as attempts`);
  return rows.rows[0];
}

async function recordInbound(client: Client, telegramUserId: string): Promise<string> {
  const updateId = String(9_100_000_000 + Math.floor(Math.random() * 1_000_000_000));
  const rows = await asRole<{ readonly inbound_event_id: string }>(
    client,
    'fetanagent_player_actions',
    `select inbound_event_id
       from app.record_public_telegram_action_inbound_event(
         $1::bigint, $2::bigint, $2::bigint, $3::text, 'en'::text
       )`,
    [updateId, telegramUserId, `hmac-sha256-v1:${'a'.repeat(64)}`],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.inbound_event_id;
}

/** Creates a lookup-protected CBE Birr receiver through the reviewed Owner rotation path. */
async function seedLookupProtectedReceiver(
  client: Client,
  ownerAdminId: string,
): Promise<{ readonly id: string; readonly version: number; readonly lookupCiphertext: string }> {
  await client.query(
    `update app.feature_switches set mode = 'disabled', settings = '{}'::jsonb
      where feature_key = any($1::text[])`,
    [[...PAYMENT_SWITCHES]],
  );
  const owner = await client.query<{ readonly auth_user_id: string }>(
    `select auth_user_id from app.admin_users where id = $1::uuid and role = 'owner'`,
    [ownerAdminId],
  );
  const authUserId = owner.rows[0]!.auth_user_id;
  const active = await client.query(
    `select 1 from app.receiver_accounts receiver
       join app.payment_providers provider on provider.id = receiver.provider_id
      where provider.code = 'cbe_birr' and receiver.status = 'active'`,
  );
  const legacyCiphertext = `receiver-v1.cbe_birr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(16)}`;
  const legacy = await asRole<{ readonly revision: number }>(
    client,
    'fetanagent_owner_control',
    `select * from app.rotate_owner_receiver_account(
       $1::uuid, $2::uuid, 'cbe_birr', 'Synthetic CBE Ledger Receiver',
       $3::text, $4::text, '***6789', 1::smallint, 1::smallint, 1::smallint, $5::text
     )`,
    [
      authUserId,
      randomUUID(),
      legacyCiphertext,
      'a'.repeat(64),
      active.rows.length === 0 ? 'initial_configuration' : 'account_rotation',
    ],
  );
  expect(legacy).toHaveLength(1);
  // The v2 Owner function is ungranted in production; grant it only inside this transaction.
  await client.query(`grant execute on function
    app.rotate_owner_cbe_birr_receiver_lookup_v2(
      uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text
    ) to fetanagent_owner_control`);
  const receiverId = randomUUID();
  const lookupCiphertext = `cbe-receiver-v2.${'D'.repeat(16)}.${'E'.repeat(22)}.${'F'.repeat(16)}`;
  const upgraded = await asRole<{ readonly revision: number }>(
    client,
    'fetanagent_owner_control',
    `select * from app.rotate_owner_cbe_birr_receiver_lookup_v2(
       $1::uuid, $2::uuid, $3::uuid, $4::integer, 'Synthetic CBE Ledger Receiver',
       $5::text, $6::text, '***6789', $7::text, $8::text, '***6789', 'protection_upgrade'
     )`,
    [
      authUserId,
      randomUUID(),
      receiverId,
      legacy[0]!.revision + 1,
      legacyCiphertext,
      'a'.repeat(64),
      lookupCiphertext,
      'b'.repeat(64),
    ],
  );
  expect(upgraded).toHaveLength(1);
  return { id: receiverId, version: upgraded[0]!.revision, lookupCiphertext };
}

type CandidateRow = {
  readonly candidate_id: string;
  readonly candidate_status: string;
  readonly provider_code: string;
  readonly request_replayed: boolean;
  readonly submitted_at: Date;
};

function captureValues(
  eventId: string,
  playerId: string,
  fingerprint: string,
  masked = '***AB12',
): readonly SqlValue[] {
  return [
    eventId,
    playerId,
    'cbe_birr',
    `v2.cbe_birr.${'G'.repeat(16)}.${'H'.repeat(22)}.${'I'.repeat(22)}`,
    fingerprint,
    masked,
    `hmac-sha256-v1:${fingerprint}`,
  ];
}

const CAPTURE_SQL = `select * from app.capture_routine_cbe_birr_candidate(
  $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
  2::smallint, 2::smallint, $7::text
)`;

async function capture(
  client: Client,
  eventId: string,
  playerId: string,
  fingerprint: string,
): Promise<CandidateRow> {
  const rows = await client.query<CandidateRow>(CAPTURE_SQL, [
    ...captureValues(eventId, playerId, fingerprint),
  ]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0]!;
}

type LeaseRow = {
  readonly attempt_number: number;
  readonly candidate_id: string;
  readonly lease_token: string;
  readonly receiver_lookup_ciphertext: string;
  readonly receiver_revision_id: string;
  readonly submitted_at: Date;
  readonly verification_mode: string;
};

async function lease(client: Client): Promise<readonly LeaseRow[]> {
  return (
    await client.query<LeaseRow>(
      'select * from app.lease_routine_cbe_birr_verification($1::uuid)',
      [randomUUID()],
    )
  ).rows;
}

const RECORD_SQL = `select * from app.record_routine_cbe_birr_verification(
  $1::uuid, $2::uuid, $3::text, $4::text, $5::bigint, $6::text, $7::timestamptz,
  $8::text, $9::text, $10::text, $11::smallint
)`;

function recordValues(
  leased: LeaseRow,
  overrides: Partial<{
    outcome: string;
    reason: string;
    amount: number | null;
    currency: string | null;
    occurredAt: Date | null;
    precision: string | null;
    digest: string | null;
  }> = {},
): readonly SqlValue[] {
  // The synthetic receiver becomes active just before the candidate, so the default receipt
  // time is the submission instant: after activation and inside the freshness window.
  const occurredAt =
    overrides.occurredAt === undefined ? leased.submitted_at : overrides.occurredAt;
  return [
    leased.candidate_id,
    leased.lease_token,
    overrides.outcome ?? 'verified',
    overrides.reason ?? 'exact_receipt',
    overrides.amount === undefined ? 10_000 : overrides.amount,
    overrides.currency === undefined ? 'ETB' : overrides.currency,
    occurredAt === null ? null : occurredAt.toISOString(),
    overrides.precision === undefined ? 'minute' : overrides.precision,
    overrides.digest === undefined ? DIGEST : overrides.digest,
    TOPOLOGY,
    2,
  ];
}

async function dryRun(client: Client): Promise<void> {
  await client.query(`select * from app.set_routine_cbe_birr_processing_mode(
    'dry_run', 'operator_dry_run')`);
}

export function registerRoutineCbeBirrVerificationLedgerSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('routine CBE Birr verification ledger', () => {
    it('installs a disabled, private, dry-run-only verifier boundary', async () => {
      const client = getClient();
      const control = await client.query(
        `select mode, change_reason from app.routine_cbe_birr_processing_control`,
      );
      expect(control.rows).toEqual([{ mode: 'disabled', change_reason: 'initial_installation' }]);

      const tables = await client.query<{
        readonly relation: string;
        readonly forced: boolean;
        readonly privileged: boolean;
      }>(`
        select relation.relname as relation,
               relation.relrowsecurity and relation.relforcerowsecurity as forced,
               exists (
                 select 1 from unnest(array[
                   'anon', 'authenticated', 'service_role', 'fetanagent_player_actions',
                   'fetanagent_player_actions_runtime', 'fetanagent_owner_control',
                   'fetanagent_routine_cbe_birr_verifier',
                   'fetanagent_routine_cbe_birr_verifier_runtime'
                 ]) role_name
                  where has_table_privilege(role_name, relation.oid,
                    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               ) as privileged
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app' and relation.relname like 'routine_cbe_birr_%'
           and relation.relkind = 'r'
         order by relation.relname`);
      expect(tables.rows).toEqual([
        { relation: 'routine_cbe_birr_candidates', forced: true, privileged: false },
        { relation: 'routine_cbe_birr_processing_control', forced: true, privileged: false },
        { relation: 'routine_cbe_birr_verification_results', forced: true, privileged: false },
      ]);

      const roles = await client.query(`
        select role.rolname, role.rolcanlogin, role.rolinherit, role.rolconnlimit,
               role.rolsuper or role.rolcreatedb or role.rolcreaterole
                 or role.rolreplication or role.rolbypassrls as elevated
          from pg_roles role
         where role.rolname like 'fetanagent_routine_cbe_birr_verifier%'
         order by role.rolname`);
      expect(roles.rows).toEqual([
        {
          rolname: 'fetanagent_routine_cbe_birr_verifier',
          rolcanlogin: false,
          rolinherit: false,
          rolconnlimit: 2,
          elevated: false,
        },
        {
          rolname: 'fetanagent_routine_cbe_birr_verifier_runtime',
          rolcanlogin: false,
          rolinherit: false,
          rolconnlimit: 1,
          elevated: false,
        },
      ]);
      const membership = await client.query(`
        select member.rolname as member_role, granted.rolname as group_role,
               membership.inherit_option, membership.set_option, membership.admin_option
          from pg_auth_members membership
          join pg_roles member on member.oid = membership.member
          join pg_roles granted on granted.oid = membership.roleid
         where member.rolname like 'fetanagent_routine_cbe_birr_verifier%'
            or granted.rolname like 'fetanagent_routine_cbe_birr_verifier%'
         order by member_role, group_role`);
      expect(membership.rows).toEqual([
        {
          member_role: 'fetanagent_routine_cbe_birr_verifier_runtime',
          group_role: 'fetanagent_routine_cbe_birr_verifier',
          inherit_option: true,
          set_option: false,
          admin_option: false,
        },
      ]);

      const executable = await client.query<{ readonly signature: string }>(`
        select routine.oid::regprocedure::text as signature
          from pg_proc routine
          join pg_namespace namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'app'
           and has_function_privilege('fetanagent_routine_cbe_birr_verifier', routine.oid,
             'EXECUTE')
         order by signature`);
      expect(executable.rows.map((row) => row.signature)).toEqual([...VERIFIER_FUNCTIONS]);

      const routines = await client.query<{
        readonly signature: string;
        readonly hardened: boolean;
        readonly foreign_execute: boolean;
      }>(
        `select routine.oid::regprocedure::text as signature,
                routine.prosecdef and routine.proowner = 'postgres'::regrole
                  and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened,
                exists (
                  select 1 from aclexplode(coalesce(routine.proacl,
                    acldefault('f', routine.proowner))) acl
                   where acl.privilege_type = 'EXECUTE'
                     and acl.grantee not in (routine.proowner,
                       'fetanagent_routine_cbe_birr_verifier'::regrole)
                ) as foreign_execute
           from pg_proc routine
          where routine.oid = any($1::regprocedure[])
          order by signature`,
        [[...VERIFIER_FUNCTIONS, ...PRIVATE_FUNCTIONS]],
      );
      expect(routines.rows).toHaveLength(VERIFIER_FUNCTIONS.length + PRIVATE_FUNCTIONS.length);
      expect(routines.rows.every((row) => row.hardened && !row.foreign_execute)).toBe(true);
      const privateGrants = await client.query(
        `select count(*)::integer as count from pg_proc routine
          where routine.oid = any($1::regprocedure[])
            and (has_function_privilege('fetanagent_routine_cbe_birr_verifier', routine.oid, 'EXECUTE')
              or has_function_privilege('fetanagent_player_actions_runtime', routine.oid, 'EXECUTE')
              or has_function_privilege('fetanagent_owner_control_runtime', routine.oid, 'EXECUTE')
              or has_function_privilege('anon', routine.oid, 'EXECUTE'))`,
        [[...PRIVATE_FUNCTIONS]],
      );
      expect(privateGrants.rows).toEqual([{ count: 0 }]);
    });

    it('records CBE Birr candidates only in dry run and never creates money rows', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const fixture = await createPilotPrerequisites(client);
        const receiver = await seedLookupProtectedReceiver(client, getOwnerAdminId());
        const before = await moneyRows(client);
        const firstEvent = await recordInbound(client, '89710000001');

        await expectFailure(
          client,
          CAPTURE_SQL,
          captureValues(firstEvent, fixture.playerIds[0]!, '1'.repeat(64)),
          /intake is unavailable/u,
        );
        const changed = await client.query(`select * from app.set_routine_cbe_birr_processing_mode(
          'dry_run', 'operator_dry_run')`);
        expect(changed.rows).toEqual([{ mode: 'dry_run', changed: true }]);
        const unchanged =
          await client.query(`select * from app.set_routine_cbe_birr_processing_mode(
          'dry_run', 'operator_dry_run')`);
        expect(unchanged.rows).toEqual([{ mode: 'dry_run', changed: false }]);
        await expectFailure(
          client,
          `select * from app.set_routine_cbe_birr_processing_mode('live', 'operator_dry_run')`,
          [],
          /request is invalid/u,
        );

        const first = await capture(client, firstEvent, fixture.playerIds[0]!, '1'.repeat(64));
        expect(first).toMatchObject({
          candidate_status: 'queued',
          provider_code: 'cbe_birr',
          request_replayed: false,
        });
        const replay = await capture(client, firstEvent, fixture.playerIds[0]!, '1'.repeat(64));
        expect(replay).toMatchObject({ candidate_id: first.candidate_id, request_replayed: true });
        await expectFailure(
          client,
          CAPTURE_SQL,
          captureValues(firstEvent, fixture.playerIds[0]!, '2'.repeat(64)),
          /replay conflicts/u,
        );

        const stored = await client.query(
          `select receiver_account_id, receiver_account_version, verification_mode, status,
                  attempt_count, submitted_at = next_attempt_at as due_now
             from app.routine_cbe_birr_candidates where id = $1::uuid`,
          [first.candidate_id],
        );
        expect(stored.rows).toEqual([
          {
            receiver_account_id: receiver.id,
            receiver_account_version: receiver.version,
            verification_mode: 'dry_run',
            status: 'queued',
            attempt_count: 0,
            due_now: true,
          },
        ]);

        for (const fingerprint of ['3'.repeat(64), '4'.repeat(64)]) {
          await capture(
            client,
            await recordInbound(client, '89710000001'),
            fixture.playerIds[0]!,
            fingerprint,
          );
        }
        await expectFailure(
          client,
          CAPTURE_SQL,
          captureValues(
            await recordInbound(client, '89710000001'),
            fixture.playerIds[0]!,
            '5'.repeat(64),
          ),
          /temporarily unavailable/u,
        );
        await expectFailure(
          client,
          CAPTURE_SQL,
          captureValues(
            await recordInbound(client, '89710000002'),
            'UNKNOWN-PLAYER',
            '6'.repeat(64),
          ),
          /unavailable|not currently eligible/u,
        );

        const audit = await client.query<{ readonly safe: boolean }>(
          `select bool_and(audit.metadata::text not like '%' || candidate.reference_fingerprint || '%'
                   and audit.metadata::text not like '%AB12%') as safe
             from app.audit_events audit
             join app.routine_cbe_birr_candidates candidate on candidate.id = audit.resource_id
            where audit.action = 'deposit.routine_cbe_birr_candidate_received'`,
        );
        expect(audit.rows).toEqual([{ safe: true }]);
        expect(await moneyRows(client)).toEqual(before);
        await expectFailure(
          client,
          `update app.routine_cbe_birr_candidates set player_account_id = player_account_id,
                  submitted_at = submitted_at - interval '1 minute'
            where id = $1::uuid`,
          [first.candidate_id],
          /identity is immutable/u,
        );
      } finally {
        await client.query('rollback');
      }
    });

    it('leases one candidate and rechecks every server-owned fact before a verified result', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const fixture = await createPilotPrerequisites(client);
        const receiver = await seedLookupProtectedReceiver(client, getOwnerAdminId());
        await dryRun(client);
        const before = await moneyRows(client);
        const player = fixture.playerIds[0]!;

        await capture(client, await recordInbound(client, '89720000001'), player, '7'.repeat(64));
        const [leased] = await lease(client);
        expect(leased).toMatchObject({
          attempt_number: 1,
          receiver_lookup_ciphertext: receiver.lookupCiphertext,
          receiver_revision_id: receiver.id,
          verification_mode: 'dry_run',
        });
        expect(await lease(client)).toEqual([]);

        await expectFailure(
          client,
          RECORD_SQL,
          [randomUUID(), leased!.lease_token, ...recordValues(leased!).slice(2)],
          /candidate is unavailable/u,
        );
        await expectFailure(
          client,
          RECORD_SQL,
          [leased!.candidate_id, randomUUID(), ...recordValues(leased!).slice(2)],
          /lease is not current/u,
        );
        await expectFailure(
          client,
          RECORD_SQL,
          recordValues(leased!, { reason: 'pdf_layout_drift' }),
          /result is invalid/u,
        );
        const verified = await client.query(RECORD_SQL, [...recordValues(leased!)]);
        expect(verified.rows).toEqual([
          {
            candidate_id: leased!.candidate_id,
            outcome: 'verified',
            reason_code: 'exact_receipt',
            verification_mode: 'dry_run',
            request_replayed: false,
          },
        ]);
        const replay = await client.query(RECORD_SQL, [...recordValues(leased!)]);
        expect(replay.rows[0]).toMatchObject({ outcome: 'verified', request_replayed: true });
        await expectFailure(
          client,
          RECORD_SQL,
          recordValues(leased!, { digest: `sha256:${'e'.repeat(64)}` }),
          /replay conflicts/u,
        );

        // A second claimant of the same CBE reference cannot become a second verified result.
        await capture(client, await recordInbound(client, '89720000002'), player, '7'.repeat(64));
        const [duplicate] = await lease(client);
        const duplicateResult = await client.query(RECORD_SQL, [...recordValues(duplicate!)]);
        expect(duplicateResult.rows[0]).toMatchObject({
          outcome: 'review',
          reason_code: 'duplicate_reference',
        });

        const cases: readonly {
          readonly fingerprint: string;
          readonly overrides: Parameters<typeof recordValues>[1];
          readonly expected: { readonly outcome: string; readonly reason_code: string };
        }[] = [
          {
            fingerprint: '8'.repeat(64),
            overrides: { amount: 2_000 },
            expected: { outcome: 'review', reason_code: 'amount_out_of_range' },
          },
          {
            fingerprint: '9'.repeat(64),
            overrides: {
              occurredAt: null,
              precision: null,
              outcome: 'review',
              reason: 'pdf_unreadable',
              amount: null,
              currency: null,
              digest: null,
            },
            expected: { outcome: 'review', reason_code: 'pdf_unreadable' },
          },
          {
            fingerprint: 'a'.repeat(64),
            overrides: { outcome: 'rejected', reason: 'receiver_mismatch' },
            expected: { outcome: 'rejected', reason_code: 'receiver_mismatch' },
          },
        ];
        for (const testCase of cases) {
          await capture(
            client,
            await recordInbound(client, '89720000003'),
            player,
            testCase.fingerprint,
          );
          const [current] = await lease(client);
          const result = await client.query(RECORD_SQL, [
            ...recordValues(current!, testCase.overrides),
          ]);
          expect(result.rows[0]).toMatchObject(testCase.expected);
        }

        // A displayed minute that straddles the five-minute clock allowance needs review; the
        // same instant with second precision is inside the window.
        for (const [fingerprint, precision, outcome] of [
          ['b'.repeat(64), 'minute', 'review'],
          ['c'.repeat(64), 'second', 'verified'],
        ] as const) {
          await capture(client, await recordInbound(client, '89720000004'), player, fingerprint);
          const [current] = await lease(client);
          const occurredAt = new Date(current!.submitted_at.getTime() + 4 * 60_000 + 30_000);
          const result = await client.query(RECORD_SQL, [
            ...recordValues(current!, { occurredAt, precision }),
          ]);
          expect(result.rows[0]).toMatchObject({ outcome });
        }
        await capture(client, await recordInbound(client, '89720000005'), player, 'f'.repeat(64));
        const [stale] = await lease(client);
        const staleResult = await client.query(RECORD_SQL, [
          ...recordValues(stale!, {
            occurredAt: new Date(stale!.submitted_at.getTime() - 61 * 60_000),
          }),
        ]);
        expect(staleResult.rows[0]).toMatchObject({
          outcome: 'review',
          reason_code: 'receipt_outside_freshness_window',
        });
        // A payment shown before the snapshotted receiver revision became active cannot be
        // attributed to that revision, even inside the one-hour window.
        await capture(client, await recordInbound(client, '89720000006'), player, 'e'.repeat(64));
        const [early] = await lease(client);
        const earlyResult = await client.query(RECORD_SQL, [
          ...recordValues(early!, {
            occurredAt: new Date(early!.submitted_at.getTime() - 30 * 60_000),
            precision: 'second',
          }),
        ]);
        expect(earlyResult.rows[0]).toMatchObject({
          outcome: 'review',
          reason_code: 'receiver_revision_inactive',
        });

        const verifiedCount = await client.query(
          `select count(*)::integer as count from app.routine_cbe_birr_verification_results
            where outcome = 'verified'`,
        );
        expect(verifiedCount.rows).toEqual([{ count: 2 }]);
        await expectFailure(
          client,
          `update app.routine_cbe_birr_verification_results set reason_code = reason_code`,
          [],
          /immutable/u,
        );
        expect(await moneyRows(client)).toEqual(before);
      } finally {
        await client.query('rollback');
      }
    });

    it('backs off provider failures, bounds attempts, and closes expired candidates', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const fixture = await createPilotPrerequisites(client);
        await seedLookupProtectedReceiver(client, getOwnerAdminId());
        await dryRun(client);
        const player = fixture.playerIds[0]!;
        const candidate = await capture(
          client,
          await recordInbound(client, '89730000001'),
          player,
          '1'.repeat(64),
        );

        const releaseSql = `select * from app.release_routine_cbe_birr_verification(
          $1::uuid, $2::uuid, $3::text)`;
        for (let attempt = 1; attempt <= 6; attempt += 1) {
          const [leased] = await lease(client);
          expect(leased).toMatchObject({
            candidate_id: candidate.candidate_id,
            attempt_number: attempt,
          });
          const released = await client.query<{
            readonly candidate_status: string;
            readonly next_attempt_at: Date | null;
          }>(releaseSql, [leased!.candidate_id, leased!.lease_token, 'provider_unavailable']);
          if (attempt < 6) {
            expect(released.rows[0]!.candidate_status).toBe('queued');
            const delayMs = released.rows[0]!.next_attempt_at!.getTime() - Date.now();
            expect(delayMs).toBeGreaterThan(30_000 * 2 ** (attempt - 1) - 5_000);
            expect(await lease(client)).toEqual([]);
            await client.query(
              `update app.routine_cbe_birr_candidates set next_attempt_at = submitted_at
                where id = $1::uuid`,
              [candidate.candidate_id],
            );
          } else {
            expect(released.rows[0]).toMatchObject({
              candidate_status: 'review',
              next_attempt_at: null,
            });
          }
        }
        const exhausted = await client.query(
          `select outcome, reason_code, attempt_number from app.routine_cbe_birr_verification_results
            where candidate_id = $1::uuid`,
          [candidate.candidate_id],
        );
        expect(exhausted.rows).toEqual([
          { outcome: 'review', reason_code: 'provider_unavailable', attempt_number: 6 },
        ]);

        // A candidate that waited past the one-hour window is closed for review, not verified.
        const template = await client.query<Record<string, unknown>>(
          `select * from app.routine_cbe_birr_candidates where id = $1::uuid`,
          [candidate.candidate_id],
        );
        const source = template.rows[0]!;
        const expired = await client.query<{ readonly id: string }>(
          `insert into app.routine_cbe_birr_candidates (
             submitting_customer_id, origin_identity_id, origin_channel, origin_request_key,
             semantic_input_hmac, platform_id, player_account_id,
             player_deposit_eligibility_decision_id, payment_provider_id, provider_code,
             reference_ciphertext, reference_fingerprint, reference_masked,
             reference_encryption_key_version, reference_profile_version,
             receiver_account_id, receiver_account_version, submitted_at,
             verification_mode, next_attempt_at
           ) select submitting_customer_id, origin_identity_id, origin_channel, $2::uuid,
                    semantic_input_hmac, platform_id, player_account_id,
                    player_deposit_eligibility_decision_id, payment_provider_id, provider_code,
                    reference_ciphertext, $3::text, reference_masked,
                    reference_encryption_key_version, reference_profile_version,
                    receiver_account_id, receiver_account_version,
                    clock_timestamp() - interval '2 hours', verification_mode,
                    clock_timestamp() - interval '2 hours'
               from app.routine_cbe_birr_candidates where id = $1::uuid
           returning id`,
          [String(source.id), randomUUID(), '2'.repeat(64)],
        );
        expect(await lease(client)).toEqual([]);
        const closed = await client.query(
          `select candidate.status, result.outcome, result.reason_code
             from app.routine_cbe_birr_candidates candidate
             join app.routine_cbe_birr_verification_results result
               on result.candidate_id = candidate.id
            where candidate.id = $1::uuid`,
          [expired.rows[0]!.id],
        );
        expect(closed.rows).toEqual([
          { status: 'review', outcome: 'review', reason_code: 'verification_window_expired' },
        ]);

        await capture(client, await recordInbound(client, '89730000002'), player, '3'.repeat(64));
        await client.query(`select * from app.set_routine_cbe_birr_processing_mode(
          'disabled', 'operator_stop')`);
        expect(await lease(client)).toEqual([]);
        await expect(
          asRole(
            client,
            'fetanagent_routine_cbe_birr_verifier',
            'select count(*) from app.routine_cbe_birr_candidates',
          ),
        ).rejects.toThrow(/permission denied/u);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
