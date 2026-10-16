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
): Promise<readonly { accepted: boolean; replayed: boolean }[]> {
  const now = canonicalNow();
  return (
    await client.query<{ accepted: boolean; replayed: boolean }>(
      `select * from app.accept_telegram_player_validation_result(
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

export function registerTelegramPlayerValidationStateSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('dormant one-use Telegram Player validation state', () => {
    it('matches the signed contract Player digest and exposes no runtime ACL', async () => {
      const client = getClient();
      const digest = await client.query<{ digest: string }>(
        'select app.telegram_player_validation_player_digest($1::text) as digest',
        ['28379330'],
      );
      expect(digest.rows[0]!.digest).toBe(playerDigest('28379330'));
      const acl = await client.query<{ allowed: boolean; rls: boolean }>(`
        select not has_function_privilege(
          'fetanagent_companion_device_bridge_runtime',
          'app.accept_telegram_player_validation_result(text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,jsonb)',
          'EXECUTE') as allowed,
          relrowsecurity and relforcerowsecurity as rls
        from pg_class where oid = 'app.telegram_player_validation_results'::regclass
      `);
      expect(acl.rows).toEqual([{ allowed: true, rls: true }]);
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
  });
}
