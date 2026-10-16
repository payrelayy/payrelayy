import { createHash, randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { createPairedDevice } from './companion-exact-five-lookup.suite.js';
import { createPilotPrerequisites } from './private-live-money-pilot.suite.js';

const sha = (value: string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const opaque = (prefix: string): string => `${prefix}${randomUUID().replaceAll('-', '')}`;
const signature = Buffer.alloc(64, 0x31).toString('base64url');

function canonicalNow(): Date {
  const now = new Date();
  now.setMilliseconds(Math.floor(now.getMilliseconds()));
  return now;
}

function playerDigest(playerId: string): string {
  const fields = [
    'fetanagent:agent-platform-companion:kemerbet-player-id:v1',
    '2',
    'platformCode',
    'string:kemerbet',
    'playerId',
    `string:${playerId}`,
  ];
  const bytes = Buffer.concat(
    fields.map((field) => {
      const content = Buffer.from(field, 'utf8');
      const length = Buffer.alloc(4);
      length.writeUInt32BE(content.length);
      return Buffer.concat([length, content]);
    }),
  );
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function asPlayerActions<T extends QueryResultRow>(
  client: Client,
  sql: string,
  values: readonly string[],
): Promise<readonly T[]> {
  const savepoint = `player_validation_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await client.query('set local role fetanagent_player_actions');
    const rows = (await client.query<T>(sql, [...values])).rows;
    await client.query('reset role');
    await client.query(`release savepoint ${savepoint}`);
    return rows;
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    throw error;
  }
}

async function inbound(client: Client, updateId: string, userId: string): Promise<string> {
  const rows = await asPlayerActions<{ inbound_event_id: string }>(
    client,
    `select inbound_event_id from app.record_public_telegram_action_inbound_event(
       $1::bigint, $2::bigint, $2::bigint, $3::text, 'en'::text
     )`,
    [updateId, userId, `hmac-sha256-v1:${'b'.repeat(64)}`],
  );
  return rows[0]!.inbound_event_id;
}

async function requestValidation(
  client: Client,
  eventId: string,
  playerId: string,
): Promise<string> {
  const rows = await asPlayerActions<{ request_id: string }>(
    client,
    'select request_id from app.request_telegram_player_validation($1::uuid, $2::text)',
    [eventId, playerId],
  );
  return rows[0]!.request_id;
}

type Claim = {
  readonly claim_state: string;
  readonly assignment_body: Record<string, unknown> | null;
  readonly signed_assignment: Record<string, unknown> | null;
};

async function claim(
  client: Client,
  certificate: Record<string, unknown>,
  signerKeyId: string,
  replayIdentity = sha(opaque('poll')),
): Promise<readonly Claim[]> {
  const now = canonicalNow();
  return (
    await client.query<Claim>(
      `select * from app.claim_telegram_player_validation_assignment(
        $1::text,$2::text,$3::text,$4::text,$5::text,$6::text,
        $7::timestamptz,$8::timestamptz,$9::timestamptz,$10::text
      )`,
      [
        replayIdentity,
        sha(opaque('poll-body')),
        opaque('pollRequest'),
        certificate.certificateId,
        certificate.deviceId,
        certificate.deviceKeyId,
        now,
        new Date(now.getTime() + 60_000),
        now,
        signerKeyId,
      ],
    )
  ).rows;
}

function assignmentEnvelope(body: Record<string, unknown>, signerKeyId: string) {
  return {
    contractVersion: 1,
    protocolMode: 'local_companion_no_transfer_v1',
    transcriptVersion: 'agent-platform-companion-player-validation-assignment-transcript-v1',
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: sha(JSON.stringify(body)),
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId,
    body,
    signature,
  };
}

function resultEnvelope(
  assignment: ReturnType<typeof assignmentEnvelope>,
  outcome: 'found' | 'review_required',
) {
  const body = {
    contractVersion: 1,
    protocolMode: 'local_companion_no_transfer_v1',
    resultId: opaque('result'),
    assignmentId: assignment.body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    validationRequestId: assignment.body.validationRequestId,
    certificateId: assignment.body.certificateId,
    deviceId: assignment.body.deviceId,
    deviceKeyId: assignment.body.deviceKeyId,
    platformCode: 'kemerbet',
    assignmentKind: 'single_telegram_player_validation',
    lookupMode: 'find_only',
    currencyCode: 'ETB',
    playerIdDigest: playerDigest(String(assignment.body.playerId)),
    outcome,
    evidenceKind: outcome === 'found' ? 'exact_id_empty_etb_form' : 'inconclusive',
    observedAt: canonicalNow().toISOString(),
    accountMutationAllowed: false,
    balanceMutationAllowed: false,
    providerMutationAllowed: false,
    paymentAllowed: false,
    depositAllowed: false,
    withdrawAllowed: false,
    transferAllowed: false,
    settlementAllowed: false,
    finalActionAllowed: false,
    financialActionAllowed: false,
    moneyMovementAllowed: false,
    transferDisabled: true,
    identifiersRedacted: true,
    moneyMoved: false,
  };
  return {
    contractVersion: 1,
    protocolMode: 'local_companion_no_transfer_v1',
    transcriptVersion: 'agent-platform-companion-player-validation-result-transcript-v1',
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: sha(JSON.stringify(body)),
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    deviceKeyId: assignment.body.deviceKeyId,
    body,
    signature,
  };
}

async function accept(
  client: Client,
  assignment: ReturnType<typeof assignmentEnvelope>,
  result: ReturnType<typeof resultEnvelope>,
  atomically = false,
): Promise<readonly { accepted: boolean; replayed: boolean; finalization_state?: string }[]> {
  const now = canonicalNow();
  return (
    await client.query<{ accepted: boolean; replayed: boolean; finalization_state?: string }>(
      `select * from app.${
        atomically
          ? 'accept_and_finalize_telegram_player_validation_result'
          : 'accept_telegram_player_validation_result'
      }(
        $1::text,$2::text,$3::text,$4::text,$5::text,$6::text,
        $7::text,$8::text,$9::text,$10::text,$11::text,
        $12::timestamptz,$13::timestamptz,$14::timestamptz,$15::jsonb,$16::jsonb
      )`,
      [
        sha(opaque('result-http')),
        sha(opaque('result-body')),
        opaque('resultRequest'),
        sha(JSON.stringify(result)),
        assignment.body.assignmentId,
        assignment.bodyDigest,
        result.body.resultId,
        result.bodyDigest,
        assignment.body.certificateId,
        assignment.body.deviceId,
        assignment.body.deviceKeyId,
        now,
        new Date(now.getTime() + 60_000),
        now,
        assignment,
        result,
      ],
    )
  ).rows;
}

async function acceptedFound(
  client: Client,
  certificate: Record<string, unknown>,
  signerKeyId: string,
  updateId: string,
  userId: string,
  playerId: string,
): Promise<{ readonly eventId: string; readonly requestId: string }> {
  const eventId = await inbound(client, updateId, userId);
  const requestId = await requestValidation(client, eventId, playerId);
  const claimed = await claim(client, certificate, signerKeyId);
  expect(claimed).toHaveLength(1);
  expect(claimed[0]!.claim_state).toBe('claimed');
  const assignment = assignmentEnvelope(claimed[0]!.assignment_body!, signerKeyId);
  const complete = await client.query<{ completed: boolean }>(
    'select app.complete_telegram_player_validation_assignment($1::text,$2::jsonb) as completed',
    [assignment.bodyDigest, assignment],
  );
  expect(complete.rows).toEqual([{ completed: true }]);
  expect(await accept(client, assignment, resultEnvelope(assignment, 'found'))).toEqual([
    { accepted: true, replayed: false },
  ]);
  return { eventId, requestId };
}

export function registerTelegramPlayerValidationStateSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('dormant one-use Telegram Player validation state', () => {
    it('grants only the atomic signed Find surface to the bridge, never direct finalization', async () => {
      const client = getClient();
      const digest = await client.query<{ digest: string }>(
        'select app.telegram_player_validation_player_digest($1::text) as digest',
        ['28379330'],
      );
      expect(digest.rows[0]!.digest).toBe(playerDigest('28379330'));
      const acl = await client.query<{
        bridge_allowed: boolean;
        old_accept_denied: boolean;
        anon_denied: boolean;
        authenticated_denied: boolean;
        player_actions_denied: boolean;
        public_denied: boolean;
      }>(`
        select not has_function_privilege(
          'fetanagent_companion_device_bridge_runtime',
          'app.accept_telegram_player_validation_result(text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,jsonb)',
          'EXECUTE'
        ) as old_accept_denied,
        bool_and(has_function_privilege(
          'fetanagent_companion_device_bridge_runtime', signature, 'EXECUTE'
        )) as bridge_allowed,
        bool_and(not has_function_privilege('anon', signature, 'EXECUTE')) as anon_denied,
        bool_and(not has_function_privilege('authenticated', signature, 'EXECUTE'))
          as authenticated_denied,
        bool_and(not has_function_privilege(
          'fetanagent_player_actions_runtime', signature, 'EXECUTE'
        )) as player_actions_denied,
        bool_and(not exists (
          select 1 from pg_proc procedure
          cross join lateral aclexplode(coalesce(
            procedure.proacl, acldefault('f', procedure.proowner)
          )) privilege
          where procedure.oid = signature and privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )) as public_denied
        from unnest(array[
          'app.claim_telegram_player_validation_assignment(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text)'::regprocedure,
          'app.complete_telegram_player_validation_assignment(text,jsonb)'::regprocedure,
          'app.release_telegram_player_validation_assignment(text)'::regprocedure,
          'app.accept_and_finalize_telegram_player_validation_result(text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,jsonb)'::regprocedure
        ]) as granted(signature)
      `);
      expect(acl.rows).toEqual([
        {
          bridge_allowed: true,
          old_accept_denied: true,
          anon_denied: true,
          authenticated_denied: true,
          player_actions_denied: true,
          public_denied: true,
        },
      ]);
      const rls = await client.query<{ rls: boolean }>(`
        select relrowsecurity and relforcerowsecurity as rls
        from pg_class where oid = 'app.telegram_player_validation_results'::regclass
      `);
      expect(rls.rows).toEqual([{ rls: true }]);
      const selectionAcl = await client.query<{ allowed: boolean; rls: boolean }>(`
        select not has_function_privilege(
          'fetanagent_companion_device_bridge_runtime',
          'app.finalize_telegram_player_validation(uuid)', 'EXECUTE') as allowed,
          relrowsecurity and relforcerowsecurity as rls
        from pg_class
        where oid = 'app.telegram_player_validation_finalizations'::regclass
      `);
      expect(selectionAcl.rows).toEqual([{ allowed: true, rls: true }]);
    });

    it('atomically selects an exact signed Find, replays once, and leaves money ledgers untouched', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const paired = await createPairedDevice(client, getOwnerAdminId());
        const eventId = await inbound(client, '89660000018', '89650000018');
        const requestId = await requestValidation(client, eventId, 'ATOMIC-PLAYER-SQL');
        const before = (
          await client.query(`select
            (select count(*)::text from app.deposit_intents) as intents,
            (select count(*)::text from app.deposit_jobs) as jobs`)
        ).rows;
        const claimed = await claim(client, paired.certificateBody, paired.signerKeyId);
        expect(claimed[0]?.claim_state).toBe('claimed');
        const assignment = assignmentEnvelope(claimed[0]!.assignment_body!, paired.signerKeyId);
        expect(
          (
            await client.query(
              'select app.complete_telegram_player_validation_assignment($1::text,$2::jsonb) as completed',
              [assignment.bodyDigest, assignment],
            )
          ).rows,
        ).toEqual([{ completed: true }]);
        const found = resultEnvelope(assignment, 'found');
        expect(await accept(client, assignment, found, true)).toEqual([
          { accepted: true, replayed: false, finalization_state: 'selected' },
        ]);
        expect(await accept(client, assignment, found, true)).toEqual([
          { accepted: true, replayed: true, finalization_state: 'already_selected' },
        ]);
        expect(
          (
            await client.query<{ player_id: string }>(
              `select player.player_id
                 from app.telegram_player_selections selection
                 join app.customer_platform_players player
                   on player.id = selection.player_account_id
                where selection.origin_inbound_event_id = $1::uuid`,
              [eventId],
            )
          ).rows,
        ).toEqual([{ player_id: 'ATOMIC-PLAYER-SQL' }]);
        expect(
          (
            await client.query(
              `select (select count(*)::text from app.deposit_intents) as intents,
                      (select count(*)::text from app.deposit_jobs) as jobs`,
            )
          ).rows,
        ).toEqual(before);
        expect(
          (
            await client.query<{ status: string }>(
              'select status from app.telegram_player_validation_requests where id=$1::uuid',
              [requestId],
            )
          ).rows,
        ).toEqual([{ status: 'validated' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('does not notify a pending Find even after delivery is enabled', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query(`update app.telegram_player_validation_notification_cutover
          set enabled_at = pg_catalog.clock_timestamp()
          where singleton = true`);
        const eventId = await inbound(client, '89660000018', '89650000018');
        await requestValidation(client, eventId, 'PENDING-PLAYER-SQL');
        expect(
          (await client.query('select * from app.claim_telegram_player_validation_notification()'))
            .rows,
        ).toEqual([]);
        expect(
          (
            await client.query(
              'select count(*)::text as count from app.telegram_player_validation_notifications',
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('keeps bot results off by default, then leases one signed selection after an explicit cutover', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const acl = await client.query<{
          bridge_denied: boolean;
          player_actions_allowed: boolean;
          anon_denied: boolean;
          table_rls: boolean;
        }>(`
          select not has_function_privilege(
                   'fetanagent_companion_device_bridge_runtime',
                   'app.claim_telegram_player_validation_notification()', 'EXECUTE'
                 ) as bridge_denied,
                 has_function_privilege(
                   'fetanagent_player_actions_runtime',
                   'app.claim_telegram_player_validation_notification()', 'EXECUTE'
                 ) as player_actions_allowed,
                 not has_function_privilege(
                   'anon', 'app.claim_telegram_player_validation_notification()', 'EXECUTE'
                 ) as anon_denied,
                 relrowsecurity and relforcerowsecurity as table_rls
            from pg_class
           where oid = 'app.telegram_player_validation_notifications'::regclass
        `);
        expect(acl.rows).toEqual([
          {
            bridge_denied: true,
            player_actions_allowed: true,
            anon_denied: true,
            table_rls: true,
          },
        ]);
        const paired = await createPairedDevice(client, getOwnerAdminId());
        const eventId = await inbound(client, '89660000019', '89650000019');
        const requestId = await requestValidation(client, eventId, 'NOTIFY-PLAYER-SQL');
        const claimed = await claim(client, paired.certificateBody, paired.signerKeyId);
        const assignment = assignmentEnvelope(claimed[0]!.assignment_body!, paired.signerKeyId);
        await client.query(
          'select app.complete_telegram_player_validation_assignment($1::text,$2::jsonb)',
          [assignment.bodyDigest, assignment],
        );
        expect(await accept(client, assignment, resultEnvelope(assignment, 'found'), true)).toEqual(
          [{ accepted: true, replayed: false, finalization_state: 'selected' }],
        );
        expect(
          (await client.query('select * from app.claim_telegram_player_validation_notification()'))
            .rows,
        ).toEqual([]);
        expect(
          (
            await client.query(
              'select count(*)::text as count from app.telegram_player_validation_notifications',
            )
          ).rows,
        ).toEqual([{ count: '0' }]);

        await client.query(`update app.telegram_player_validation_notification_cutover
          set enabled_at = pg_catalog.clock_timestamp() - interval '1 minute'
          where singleton = true`);
        const delivery = (
          await client.query<{
            notification_id: string;
            notification_lease_token: string;
            notification_private_chat_id: string;
            notification_outcome_code: string;
          }>('select * from app.claim_telegram_player_validation_notification()')
        ).rows;
        expect(delivery).toHaveLength(1);
        expect(delivery[0]).toMatchObject({
          notification_private_chat_id: '89650000019',
          notification_outcome_code: 'selected',
        });
        expect(
          (
            await client.query(
              `select app.complete_telegram_player_validation_notification(
                 $1::uuid,$2::uuid,'sent',42::bigint) as accepted`,
              [delivery[0]!.notification_id, delivery[0]!.notification_lease_token],
            )
          ).rows,
        ).toEqual([{ accepted: true }]);
        expect(
          (
            await client.query(
              `select app.complete_telegram_player_validation_notification(
                 $1::uuid,$2::uuid,'sent',42::bigint) as accepted`,
              [delivery[0]!.notification_id, delivery[0]!.notification_lease_token],
            )
          ).rows,
        ).toEqual([{ accepted: true }]);
        expect(
          (await client.query('select * from app.claim_telegram_player_validation_notification()'))
            .rows,
        ).toEqual([]);
        expect(
          (
            await client.query(
              'select validation_request_id from app.telegram_player_validation_notifications',
            )
          ).rows,
        ).toEqual([{ validation_request_id: requestId }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('reports an inconclusive signed Find as review, never as an approved Player', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const paired = await createPairedDevice(client, getOwnerAdminId());
        const eventId = await inbound(client, '89660000020', '89650000020');
        await requestValidation(client, eventId, 'INCONCLUSIVE-SQL');
        const claimed = await claim(client, paired.certificateBody, paired.signerKeyId);
        const assignment = assignmentEnvelope(claimed[0]!.assignment_body!, paired.signerKeyId);
        await client.query(
          'select app.complete_telegram_player_validation_assignment($1::text,$2::jsonb)',
          [assignment.bodyDigest, assignment],
        );
        expect(
          await accept(client, assignment, resultEnvelope(assignment, 'review_required'), true),
        ).toEqual([{ accepted: true, replayed: false, finalization_state: 'review_required' }]);
        await client.query(`update app.telegram_player_validation_notification_cutover
          set enabled_at = pg_catalog.clock_timestamp() - interval '1 minute'
          where singleton = true`);
        expect(
          (
            await client.query<{
              notification_outcome_code: string;
            }>('select * from app.claim_telegram_player_validation_notification()')
          ).rows[0]?.notification_outcome_code,
        ).toBe('review_required');
        expect(
          (
            await client.query(
              'select count(*)::text as count from app.telegram_player_selections where origin_inbound_event_id=$1::uuid',
              [eventId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('does not send an old selection result after a newer Player request', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query(`update app.telegram_player_validation_notification_cutover
          set enabled_at = pg_catalog.clock_timestamp()
          where singleton = true`);
        const paired = await createPairedDevice(client, getOwnerAdminId());
        const oldEvent = await inbound(client, '89660000021', '89650000021');
        await requestValidation(client, oldEvent, 'OLD-NOTIFY-PLAYER');
        const claimed = await claim(client, paired.certificateBody, paired.signerKeyId);
        const assignment = assignmentEnvelope(claimed[0]!.assignment_body!, paired.signerKeyId);
        await client.query(
          'select app.complete_telegram_player_validation_assignment($1::text,$2::jsonb)',
          [assignment.bodyDigest, assignment],
        );
        expect(await accept(client, assignment, resultEnvelope(assignment, 'found'), true)).toEqual(
          [{ accepted: true, replayed: false, finalization_state: 'selected' }],
        );
        const newerEvent = await inbound(client, '89660000022', '89650000021');
        await requestValidation(client, newerEvent, 'NEW-NOTIFY-PLAYER');
        expect(
          (await client.query('select * from app.claim_telegram_player_validation_notification()'))
            .rows,
        ).toEqual([]);
      } finally {
        await client.query('rollback');
      }
    });

    it('stores one current signed result without changing the selected Player or money ledgers', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const fixture = await createPilotPrerequisites(client);
        const paired = await createPairedDevice(client, getOwnerAdminId());
        const userId = '89650000001';
        const selectEvent = await inbound(client, '89660000001', userId);
        await asPlayerActions(
          client,
          'select * from app.save_telegram_player_selection($1::uuid,$2::text)',
          [selectEvent, fixture.playerIds[0]!],
        );
        const before = (
          await client.query(`select
          (select count(*)::text from app.deposit_intents) as intents,
          (select count(*)::text from app.deposit_jobs) as jobs`)
        ).rows;
        const validationEvent = await inbound(client, '89660000002', userId);
        const requestId = await requestValidation(client, validationEvent, 'NEW-PLAYER-SQL');
        const claimed = await claim(client, paired.certificateBody, paired.signerKeyId);
        expect(claimed).toHaveLength(1);
        expect(claimed[0]!.claim_state).toBe('claimed');
        expect(claimed[0]!.assignment_body).toMatchObject({
          validationRequestId: requestId,
          playerId: 'NEW-PLAYER-SQL',
          transferAllowed: false,
          moneyMoved: false,
        });
        const assignment = assignmentEnvelope(claimed[0]!.assignment_body!, paired.signerKeyId);
        const complete = await client.query<{ completed: boolean }>(
          'select app.complete_telegram_player_validation_assignment($1::text,$2::jsonb) as completed',
          [assignment.bodyDigest, assignment],
        );
        expect(complete.rows).toEqual([{ completed: true }]);
        const result = resultEnvelope(assignment, 'found');
        const wrongBody = {
          ...result.body,
          playerIdDigest: playerDigest('DIFFERENT-PLAYER'),
        };
        const wrongResult = {
          ...result,
          body: wrongBody,
          bodyDigest: sha(JSON.stringify(wrongBody)),
        };
        expect(await accept(client, assignment, wrongResult)).toEqual([]);
        expect(await accept(client, assignment, result)).toEqual([
          { accepted: true, replayed: false },
        ]);
        expect(await accept(client, assignment, result)).toEqual([
          { accepted: true, replayed: true },
        ]);
        const request = await client.query<{ status: string }>(
          'select status from app.telegram_player_validation_requests where id=$1::uuid',
          [requestId],
        );
        expect(request.rows).toEqual([{ status: 'validated' }]);
        const selected = await asPlayerActions<{ selected_player_id: string }>(
          client,
          'select selected_player_id from app.get_telegram_saved_player_selection($1::uuid)',
          [validationEvent],
        );
        expect(selected).toEqual([{ selected_player_id: fixture.playerIds[0] }]);
        expect(
          (
            await client.query(`select
          (select count(*)::text from app.deposit_intents) as intents,
          (select count(*)::text from app.deposit_jobs) as jobs`)
          ).rows,
        ).toEqual(before);
      } finally {
        await client.query('rollback');
      }
    });

    it('rejects a late result after a newer Telegram request supersedes it', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const paired = await createPairedDevice(client, getOwnerAdminId());
        const userId = '89650000002';
        const firstEvent = await inbound(client, '89660000003', userId);
        const oldRequest = await requestValidation(client, firstEvent, 'OLD-PLAYER-SQL');
        const claimed = await claim(client, paired.certificateBody, paired.signerKeyId);
        const assignment = assignmentEnvelope(claimed[0]!.assignment_body!, paired.signerKeyId);
        await client.query(
          'select app.complete_telegram_player_validation_assignment($1::text,$2::jsonb)',
          [assignment.bodyDigest, assignment],
        );
        const nextEvent = await inbound(client, '89660000004', userId);
        await requestValidation(client, nextEvent, 'NEW-PLAYER-SQL');
        expect(await accept(client, assignment, resultEnvelope(assignment, 'found'))).toEqual([]);
        expect(
          (
            await client.query(
              'select status from app.telegram_player_validation_requests where id=$1::uuid',
              [oldRequest],
            )
          ).rows,
        ).toEqual([{ status: 'superseded' }]);
        expect(
          (
            await client.query(
              'select count(*)::text as count from app.telegram_player_validation_results',
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('selects one neutral beneficiary for several Telegram identities, but never overrides revocation', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const paired = await createPairedDevice(client, getOwnerAdminId());
        const before = (
          await client.query(`select
            (select count(*)::text from app.deposit_intents) as intents,
            (select count(*)::text from app.deposit_jobs) as jobs`)
        ).rows;
        const first = await acceptedFound(
          client,
          paired.certificateBody,
          paired.signerKeyId,
          '89660000005',
          '89650000003',
          'SHARED-PLAYER-SQL',
        );
        const firstFinalization = await client.query<{
          finalization_state: string;
          selected_player_id: string;
        }>('select * from app.finalize_telegram_player_validation($1::uuid)', [first.requestId]);
        expect(firstFinalization.rows).toEqual([
          { finalization_state: 'selected', selected_player_id: 'SHARED-PLAYER-SQL' },
        ]);
        expect(
          (
            await client.query('select * from app.finalize_telegram_player_validation($1::uuid)', [
              first.requestId,
            ])
          ).rows,
        ).toEqual([
          { finalization_state: 'already_selected', selected_player_id: 'SHARED-PLAYER-SQL' },
        ]);
        const second = await acceptedFound(
          client,
          paired.certificateBody,
          paired.signerKeyId,
          '89660000006',
          '89650000004',
          'SHARED-PLAYER-SQL',
        );
        const secondFinalization = await client.query(
          'select * from app.finalize_telegram_player_validation($1::uuid)',
          [second.requestId],
        );
        expect(secondFinalization.rows).toEqual([
          { finalization_state: 'selected', selected_player_id: 'SHARED-PLAYER-SQL' },
        ]);
        const selections = await client.query<{
          player_account_id: string;
          selected_count: string;
        }>(`select selection.player_account_id,
             count(*)::text as selected_count
          from app.telegram_player_selections selection
          join app.customer_platform_players player
            on player.id = selection.player_account_id
         where player.player_id = 'SHARED-PLAYER-SQL'
         group by selection.player_account_id`);
        expect(selections.rows).toHaveLength(1);
        expect(selections.rows[0]!.selected_count).toBe('2');
        const playerAccountId = selections.rows[0]!.player_account_id;
        const provenance = await client.query<{
          beneficiary_customer_id: string;
          player_customer_id: string;
          identity_count: string;
        }>(
          `select origin.beneficiary_customer_id,
            player.customer_id as player_customer_id,
            (select count(*)::text from app.customer_identities identity
              where identity.customer_id = origin.beneficiary_customer_id) as identity_count
          from app.telegram_player_validation_created_beneficiaries origin
          join app.customer_platform_players player
            on player.id = origin.player_account_id
          where origin.player_account_id = $1::uuid`,
          [playerAccountId],
        );
        expect(provenance.rows).toHaveLength(1);
        expect(provenance.rows[0]!.beneficiary_customer_id).toBe(
          provenance.rows[0]!.player_customer_id,
        );
        expect(provenance.rows[0]!.identity_count).toBe('0');

        await client.query(
          `insert into app.player_deposit_eligibility_decisions (
            player_account_id, decision_version, decision, reason_code, actor_kind,
            player_account_updated_at_snapshot, decided_at, created_at
          ) values ($1::uuid, 2, 'revoked', 'financial_eligibility_revoked', 'system',
                    now(), now(), now())`,
          [playerAccountId],
        );
        const third = await acceptedFound(
          client,
          paired.certificateBody,
          paired.signerKeyId,
          '89660000007',
          '89650000005',
          'SHARED-PLAYER-SQL',
        );
        expect(
          (
            await client.query('select * from app.finalize_telegram_player_validation($1::uuid)', [
              third.requestId,
            ])
          ).rows,
        ).toEqual([{ finalization_state: 'review_required', selected_player_id: null }]);
        expect(
          (
            await client.query<{ status: string }>(
              'select status from app.telegram_player_validation_requests where id=$1::uuid',
              [third.requestId],
            )
          ).rows,
        ).toEqual([{ status: 'review_required' }]);
        expect(
          (
            await client.query<{ count: string }>(
              'select count(*)::text as count from app.telegram_player_validation_finalizations',
            )
          ).rows,
        ).toEqual([{ count: '2' }]);
        expect(
          (
            await client.query(`select
              (select count(*)::text from app.deposit_intents) as intents,
              (select count(*)::text from app.deposit_jobs) as jobs`)
          ).rows,
        ).toEqual(before);
      } finally {
        await client.query('rollback');
      }
    });

    it('does not select a signed result after the Telegram account asks for a newer ID', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const paired = await createPairedDevice(client, getOwnerAdminId());
        const old = await acceptedFound(
          client,
          paired.certificateBody,
          paired.signerKeyId,
          '89660000008',
          '89650000006',
          'OLD-SIGNED-PLAYER',
        );
        const newEvent = await inbound(client, '89660000009', '89650000006');
        await requestValidation(client, newEvent, 'NEW-WANTED-PLAYER');
        expect(
          (
            await client.query<{ status: string }>(
              'select status from app.telegram_player_validation_requests where id=$1::uuid',
              [old.requestId],
            )
          ).rows,
        ).toEqual([{ status: 'superseded' }]);
        expect(
          (
            await client.query('select * from app.finalize_telegram_player_validation($1::uuid)', [
              old.requestId,
            ])
          ).rows,
        ).toEqual([]);
        expect(
          (
            await client.query<{ count: string }>(
              'select count(*)::text as count from app.telegram_player_selections',
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
