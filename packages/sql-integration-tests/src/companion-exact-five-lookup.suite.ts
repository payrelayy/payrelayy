import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

const ownerGroupRole = 'fetanagent_owner_control';
const bridgeGroupRole = 'fetanagent_companion_device_bridge';
const signerKeyIdPrefix = 'sql-lookup-signer';
const newTables = [
  'agent_platform_companion_http_request_replays',
  'agent_platform_companion_lookup_assignments',
  'agent_platform_companion_lookup_members',
  'agent_platform_companion_lookup_results',
] as const;
const ownerFunctions = [
  'app.issue_agent_platform_companion_exact_five_lookup(uuid,uuid,text)',
  'app.get_agent_platform_companion_exact_five_lookup_status(uuid)',
] as const;
const bridgeFunctions = [
  'app.claim_agent_platform_companion_lookup_assignment(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text)',
  'app.complete_agent_platform_companion_lookup_assignment(text,text,text,jsonb)',
  'app.release_agent_platform_companion_lookup_assignment(text)',
  'app.accept_agent_platform_companion_lookup_result(text,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb,jsonb)',
] as const;

type SqlValue = boolean | Date | number | string | null | Record<string, unknown>;

type PairingIssueRow = {
  readonly expires_at: Date;
  readonly issued_at: Date;
  readonly pairing_id: string;
  readonly pairing_nonce_digest: string;
};

type PairingClaimRow = {
  readonly certificate_body: Record<string, unknown>;
  readonly claim_state: 'claimed';
};

type LookupIssueRow = {
  readonly assignment_id: string;
  readonly assignment_state: string;
  readonly completed_at: Date | null;
  readonly expires_at: Date;
  readonly found_count: number | null;
  readonly issued_at: Date;
  readonly not_found_count: number | null;
  readonly replayed: boolean;
  readonly review_required_count: number | null;
};

type LookupClaimRow = {
  readonly assignment_body: Record<string, unknown> | null;
  readonly claim_state: 'claimed' | 'completed' | 'in_progress' | 'none';
  readonly signed_assignment: Record<string, unknown> | null;
};

const sha = (value: string | Uint8Array): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

function signature(byte: number): string {
  const bytes = Buffer.alloc(64, byte);
  try {
    return bytes.toString('base64url');
  } finally {
    bytes.fill(0);
  }
}

function canonicalNow(): Date {
  const value = new Date();
  value.setMilliseconds(Math.floor(value.getMilliseconds()));
  return value;
}

function timestamp(value: Date): string {
  return value.toISOString();
}

async function queryAsOwnerControl<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  const savepoint = `companion_lookup_owner_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await client.query(`set local role ${ownerGroupRole}`);
    const result = await client.query<T>(query, [...values]);
    await client.query('reset role');
    await client.query(`release savepoint ${savepoint}`);
    return result.rows;
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    throw error;
  }
}

async function deactivateExistingAssociatedKemerBetCustomers(client: Client): Promise<void> {
  await client.query(`
    update app.customers customer
       set status = 'inactive'
     where customer.status = 'active'
       and exists (
         select 1
           from app.player_registration_request_associations association
           join app.customer_platform_players player
             on player.id = association.player_account_id
           join app.platforms platform on platform.id = player.platform_id
          where player.customer_id = customer.id
            and platform.code = 'kemerbet'
       )
  `);
}

async function createEligibleAssociatedPlayer(
  client: Client,
  ownerAuthUserId: string,
  ordinal: number,
): Promise<void> {
  const customer = await client.query<{ readonly id: string }>(
    'insert into app.customers default values returning id::text',
  );
  const registration = await client.query<{ readonly id: string }>(
    `insert into app.player_registration_requests (customer_id, platform_id, player_id)
     select $1::uuid, platform.id, $2::text
       from app.platforms platform
      where platform.code = 'kemerbet'
     returning id::text`,
    [customer.rows[0]!.id, `LOOKUP_SQL_${ordinal}_${randomUUID().slice(0, 8)}`],
  );
  const registrationId = registration.rows[0]!.id;
  await queryAsOwnerControl(
    client,
    `select * from app.review_owner_player_registration_request(
       $1::uuid, $2::uuid, 'exists', 'owner_platform_lookup'
     )`,
    [ownerAuthUserId, registrationId],
  );
  const association = await queryAsOwnerControl<{
    readonly associated_player_account_id: string;
  }>(
    client,
    `select associated_player_account_id::text
       from app.associate_owner_validated_player_registration_request(
         $1::uuid, $2::uuid, 'owner_verified_platform_ownership'
       )`,
    [ownerAuthUserId, registrationId],
  );
  expect(association).toHaveLength(1);
  await queryAsOwnerControl(
    client,
    `select * from app.decide_owner_player_deposit_eligibility(
       $1::uuid, $2::uuid, 'eligible', 'financial_eligibility_approved'
     )`,
    [ownerAuthUserId, association[0]!.associated_player_account_id],
  );
}

async function createExactFivePlayers(client: Client, ownerAuthUserId: string): Promise<void> {
  const activeProfile = await client.query<{ readonly count: number }>(`
    select count(*)::integer
      from app.private_owner_kemerbet_agent_profile_revisions profile
      join app.platform_agent_accounts agent on agent.id = profile.platform_agent_account_id
      join app.platforms platform on platform.id = profile.platform_id
     where platform.code = 'kemerbet'
       and platform.status = 'active'
       and agent.status = 'active'
       and profile.retired_at is null
       and profile.profile_contract_version = 1
  `);
  if (activeProfile.rows[0]?.count === 0) {
    await queryAsOwnerControl(
      client,
      `select * from app.prepare_owner_kemerbet_agent_profile(
         $1::uuid, $2::uuid, 'initial_configuration'
       )`,
      [ownerAuthUserId, randomUUID()],
    );
  } else {
    expect(activeProfile.rows).toEqual([{ count: 1 }]);
  }
  await deactivateExistingAssociatedKemerBetCustomers(client);
  for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
    await createEligibleAssociatedPlayer(client, ownerAuthUserId, ordinal);
  }
}

async function createPairedDevice(
  client: Client,
  ownerAdminId: string,
): Promise<{
  readonly certificateBody: Record<string, unknown>;
  readonly signerId: string;
  readonly signerKeyId: string;
}> {
  const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signerPublicKey = Buffer.from(signer.publicKey.export({ format: 'der', type: 'spki' }));
  const signerId = randomUUID();
  const signerKeyId = `${signerKeyIdPrefix}-${randomUUID().slice(0, 8)}`;
  const signerPublicKeySpki = signerPublicKey.toString('base64url');
  const signerPublicKeyDigest = sha(signerPublicKey);
  signerPublicKey.fill(0);
  await client.query(
    `insert into app.agent_platform_companion_server_signers (
       id, signer_key_id, public_key_spki, public_key_spki_sha256,
       signature_algorithm, signature_encoding, valid_from, valid_until
     ) values (
       $1::uuid, $2::text, $3::text, $4::text,
       'ecdsa-p256-sha256', 'ieee-p1363-base64url',
       clock_timestamp() - interval '5 minutes', clock_timestamp() + interval '730 days'
     )`,
    [signerId, signerKeyId, signerPublicKeySpki, signerPublicKeyDigest],
  );

  const issued = await client.query<PairingIssueRow>(
    `select * from app.issue_agent_platform_companion_pairing(
       $1::uuid, $2::uuid, $3::text, '0.1.5'
     )`,
    [ownerAdminId, randomUUID(), signerKeyId],
  );
  expect(issued.rows).toHaveLength(1);
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const devicePublicKey = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
  const deviceId = `sql-device-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const deviceKeyId = `sql-device-key-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const assessedAt = canonicalNow();
  const pairingBodyDigest = sha(`pairing-body:${randomUUID()}`);
  const claimed = await client.query<PairingClaimRow>(
    `select claim_state, certificate_body
       from app.claim_agent_platform_companion_pairing(
         $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
         $7::text, '0.1.5', $8::timestamptz, $9::timestamptz,
         $10::timestamptz, $11::text
       )`,
    [
      issued.rows[0]!.pairing_id,
      issued.rows[0]!.pairing_nonce_digest,
      pairingBodyDigest,
      deviceId,
      deviceKeyId,
      devicePublicKey.toString('base64url'),
      sha(devicePublicKey),
      issued.rows[0]!.issued_at,
      issued.rows[0]!.expires_at,
      assessedAt,
      signerKeyId,
    ],
  );
  devicePublicKey.fill(0);
  expect(claimed.rows).toHaveLength(1);
  expect(claimed.rows[0]!.claim_state).toBe('claimed');
  const certificateBody = claimed.rows[0]!.certificate_body;
  const certificateBodyDigest = sha(JSON.stringify(certificateBody));
  const certificateSignature = signature(0x31);
  const certificate = {
    contractVersion: 1,
    protocolMode: 'local_companion_no_transfer_v1',
    transcriptVersion: 'agent-platform-companion-certificate-transcript-v1',
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: certificateBodyDigest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId,
    body: certificateBody,
    signature: certificateSignature,
  };
  const completed = await client.query<{ readonly completed: boolean }>(
    `select app.complete_agent_platform_companion_pairing(
       $1::text, $2::text, $3::text, $4::text, $5::jsonb
     ) as completed`,
    [pairingBodyDigest, certificateBodyDigest, signerKeyId, certificateSignature, certificate],
  );
  expect(completed.rows).toEqual([{ completed: true }]);
  return { certificateBody, signerId, signerKeyId };
}

function assignmentEnvelope(
  assignmentBody: Record<string, unknown>,
  signerKeyId: string,
): Record<string, unknown> {
  return {
    contractVersion: 1,
    protocolMode: 'local_companion_no_transfer_v1',
    transcriptVersion: 'agent-platform-companion-lookup-assignment-transcript-v1',
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: sha(JSON.stringify(assignmentBody)),
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId,
    body: assignmentBody,
    signature: signature(0x41),
  };
}

function resultEnvelope(
  assignment: Record<string, unknown>,
  observedAt: Date,
): Record<string, unknown> {
  const assignmentBody = assignment.body as Record<string, unknown>;
  const items = Array.from({ length: 5 }, (_, playerIndex) => ({
    playerIndex,
    playerIdDigest: sha(`redacted-player-${playerIndex}-${randomUUID()}`),
    outcome: playerIndex === 4 ? 'review_required' : 'found',
  }));
  const body = {
    contractVersion: 1,
    protocolMode: 'local_companion_no_transfer_v1',
    resultId: `lookup-result-${randomUUID().replaceAll('-', '')}`,
    assignmentId: assignmentBody.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    requestId: assignmentBody.requestId,
    certificateId: assignmentBody.certificateId,
    deviceId: assignmentBody.deviceId,
    deviceKeyId: assignmentBody.deviceKeyId,
    platformCode: 'kemerbet',
    assignmentKind: 'exact_five_player_lookup',
    lookupMode: 'find_only',
    currencyCode: 'ETB',
    items,
    foundCount: 4,
    notFoundCount: 0,
    reviewRequiredCount: 1,
    observedAt: timestamp(observedAt),
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
    transcriptVersion: 'agent-platform-companion-lookup-result-transcript-v1',
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: sha(JSON.stringify(body)),
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    deviceKeyId: assignmentBody.deviceKeyId,
    body,
    signature: signature(0x51),
  };
}

const claimSql = `
  select * from app.claim_agent_platform_companion_lookup_assignment(
    $1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
    $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::text
  )
`;

const acceptSql = `
  select * from app.accept_agent_platform_companion_lookup_result(
    $1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
    $7::text, $8::text, $9::text, $10::text, $11::text,
    $12::timestamptz, $13::timestamptz, $14::timestamptz, $15::jsonb, $16::jsonb
  )
`;

export function registerCompanionExactFiveLookupSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('signed exact-five companion lookup database boundary', () => {
    it('seals raw lookup state and grants only the reviewed owner and bridge procedures', async () => {
      const client = getClient();
      const tables = await client.query(
        `select relation.relname,
                relation.relrowsecurity,
                relation.relforcerowsecurity,
                has_table_privilege(
                  $1::text, relation.oid,
                  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
                ) as bridge_base_access,
                has_table_privilege(
                  $2::text, relation.oid,
                  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
                ) as owner_base_access
           from pg_class relation
           join pg_namespace namespace on namespace.oid = relation.relnamespace
          where namespace.nspname = 'app' and relation.relname = any($3::text[])
          order by relation.relname`,
        [bridgeGroupRole, ownerGroupRole, [...newTables]],
      );
      expect(tables.rows).toEqual(
        [...newTables].sort().map((relname) => ({
          relname,
          relrowsecurity: true,
          relforcerowsecurity: true,
          bridge_base_access: false,
          owner_base_access: false,
        })),
      );

      const routines = await client.query<{
        readonly bridge_execute: boolean;
        readonly hardened: boolean;
        readonly owner_execute: boolean;
        readonly public_execute: boolean;
        readonly signature: string;
      }>(
        `select routine.oid::regprocedure::text as signature,
                routine.prosecdef
                  and routine.proowner = 'postgres'::regrole
                  and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened,
                has_function_privilege($1::text, routine.oid, 'EXECUTE') as bridge_execute,
                has_function_privilege($2::text, routine.oid, 'EXECUTE') as owner_execute,
                exists (
                  select 1
                    from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) acl
                   where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
                ) as public_execute
           from pg_proc routine
          where routine.oid = any($3::regprocedure[])
          order by signature`,
        [bridgeGroupRole, ownerGroupRole, [...ownerFunctions, ...bridgeFunctions]],
      );
      expect(routines.rows).toHaveLength(6);
      for (const routine of routines.rows) {
        const ownerProcedure = ownerFunctions.includes(
          routine.signature as (typeof ownerFunctions)[number],
        );
        expect(routine).toMatchObject({
          hardened: true,
          public_execute: false,
          owner_execute: ownerProcedure,
          bridge_execute: !ownerProcedure,
        });
      }

      const forbiddenColumns = await client.query<{ readonly count: number }>(
        `select count(*)::integer
           from information_schema.columns
          where table_schema = 'app'
            and table_name = any($1::text[])
            and column_name = any(array[
              'amount', 'amount_minor', 'balance', 'credential', 'notes', 'password',
              'payment_reference', 'settlement_id', 'transfer_id'
            ]::text[])`,
        [[...newTables]],
      );
      expect(forbiddenColumns.rows).toEqual([{ count: 0 }]);
    });

    it('issues, signs, accepts, replays, and redacts one exact-five read-only lookup', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          `select auth_user_id::text
             from app.admin_users
            where id = $1::uuid and role = 'owner' and status = 'active'`,
          [getOwnerAdminId()],
        );
        const ownerAuthUserId = owner.rows[0]!.auth_user_id;
        await createExactFivePlayers(client, ownerAuthUserId);
        const paired = await createPairedDevice(client, getOwnerAdminId());
        const ownerRequestId = randomUUID();
        const issued = await queryAsOwnerControl<LookupIssueRow>(
          client,
          `select * from app.issue_agent_platform_companion_exact_five_lookup(
             $1::uuid, $2::uuid, $3::text
           )`,
          [ownerAuthUserId, ownerRequestId, paired.signerKeyId],
        );
        expect(issued).toHaveLength(1);
        expect(issued[0]).toMatchObject({
          assignment_state: 'pending',
          completed_at: null,
          found_count: null,
          not_found_count: null,
          review_required_count: null,
          replayed: false,
        });
        const replayedIssue = await queryAsOwnerControl<LookupIssueRow>(
          client,
          `select * from app.issue_agent_platform_companion_exact_five_lookup(
             $1::uuid, $2::uuid, $3::text
           )`,
          [ownerAuthUserId, ownerRequestId, paired.signerKeyId],
        );
        expect(replayedIssue[0]).toMatchObject({
          assignment_id: issued[0]!.assignment_id,
          replayed: true,
        });

        const certificateBody = paired.certificateBody;
        const pollAssessedAt = canonicalNow();
        const rejectedPollIssuedAt = new Date(pollAssessedAt.getTime() + 30_001);
        const rejectedPoll = await client.query<LookupClaimRow>(claimSql, [
          sha(`poll-replay-over-skew:${randomUUID()}`),
          sha(`poll-body-over-skew:${randomUUID()}`),
          `poll-request-over-skew-${randomUUID().replaceAll('-', '')}`,
          String(certificateBody.certificateId),
          String(certificateBody.deviceId),
          String(certificateBody.deviceKeyId),
          rejectedPollIssuedAt,
          new Date(rejectedPollIssuedAt.getTime() + 60_000),
          pollAssessedAt,
          paired.signerKeyId,
        ]);
        expect(rejectedPoll.rows).toHaveLength(0);

        const pollIssuedAt = new Date(pollAssessedAt.getTime() + 30_000);
        const pollExpiresAt = new Date(pollIssuedAt.getTime() + 60_000);
        const claimed = await client.query<LookupClaimRow>(claimSql, [
          sha(`poll-replay:${randomUUID()}`),
          sha(`poll-body:${randomUUID()}`),
          `poll-request-${randomUUID().replaceAll('-', '')}`,
          String(certificateBody.certificateId),
          String(certificateBody.deviceId),
          String(certificateBody.deviceKeyId),
          pollIssuedAt,
          pollExpiresAt,
          pollAssessedAt,
          paired.signerKeyId,
        ]);
        expect(claimed.rows).toHaveLength(1);
        expect(claimed.rows[0]!.claim_state).toBe('claimed');
        const assignmentBody = claimed.rows[0]!.assignment_body!;
        expect(assignmentBody).toMatchObject({
          assignmentId: issued[0]!.assignment_id,
          requestId: ownerRequestId,
          assignmentKind: 'exact_five_player_lookup',
          lookupMode: 'find_only',
          currencyCode: 'ETB',
          transferAllowed: false,
          financialActionAllowed: false,
          moneyMovementAllowed: false,
          transferDisabled: true,
          moneyMoved: false,
        });
        expect(assignmentBody.playerIds).toHaveLength(5);
        const assignment = assignmentEnvelope(assignmentBody, paired.signerKeyId);
        const completed = await client.query<{ readonly completed: boolean }>(
          `select app.complete_agent_platform_companion_lookup_assignment(
             $1::text, $2::text, $3::text, $4::jsonb
           ) as completed`,
          [assignment.bodyDigest, paired.signerKeyId, assignment.signature, assignment],
        );
        expect(completed.rows).toEqual([{ completed: true }]);

        const resultAssessedAt = canonicalNow();
        const result = resultEnvelope(assignment, new Date(resultAssessedAt.getTime() + 30_000));
        const resultBody = result.body as Record<string, unknown>;
        const resultIssuedAt = new Date(resultAssessedAt.getTime() + 30_000);
        const resultExpiresAt = new Date(resultIssuedAt.getTime() + 60_000);
        const baseResultValues = [
          sha(`result-http-replay:${randomUUID()}`),
          sha(`result-http-body:${randomUUID()}`),
          `result-request-${randomUUID().replaceAll('-', '')}`,
          sha(`result-replay:${randomUUID()}`),
          String(assignmentBody.assignmentId),
          String(assignment.bodyDigest),
          String(resultBody.resultId),
          String(result.bodyDigest),
          String(certificateBody.certificateId),
          String(certificateBody.deviceId),
          String(certificateBody.deviceKeyId),
          resultIssuedAt,
          resultExpiresAt,
          resultAssessedAt,
          assignment,
          result,
        ] as const;

        const rejectedResultRequestIssuedAt = new Date(resultAssessedAt.getTime() + 30_001);
        expect(
          (
            await client.query(acceptSql, [
              sha(`result-http-replay-over-skew:${randomUUID()}`),
              sha(`result-http-body-over-skew:${randomUUID()}`),
              `result-request-over-skew-${randomUUID().replaceAll('-', '')}`,
              sha(`result-replay-over-skew:${randomUUID()}`),
              ...baseResultValues.slice(4, 11),
              rejectedResultRequestIssuedAt,
              new Date(rejectedResultRequestIssuedAt.getTime() + 60_000),
              resultAssessedAt,
              assignment,
              result,
            ])
          ).rows,
        ).toHaveLength(0);

        const futureObservationResult = resultEnvelope(
          assignment,
          new Date(resultAssessedAt.getTime() + 30_001),
        );
        const futureObservationBody = futureObservationResult.body as Record<string, unknown>;
        expect(
          (
            await client.query(acceptSql, [
              sha(`result-http-replay-future-observation:${randomUUID()}`),
              sha(`result-http-body-future-observation:${randomUUID()}`),
              `result-request-future-observation-${randomUUID().replaceAll('-', '')}`,
              sha(`result-replay-future-observation:${randomUUID()}`),
              String(assignmentBody.assignmentId),
              String(assignment.bodyDigest),
              String(futureObservationBody.resultId),
              String(futureObservationResult.bodyDigest),
              String(certificateBody.certificateId),
              String(certificateBody.deviceId),
              String(certificateBody.deviceKeyId),
              resultIssuedAt,
              resultExpiresAt,
              resultAssessedAt,
              assignment,
              futureObservationResult,
            ])
          ).rows,
        ).toHaveLength(0);

        const replayCountBefore = await client.query<{ readonly count: number }>(
          `select count(*)::integer
             from app.agent_platform_companion_http_request_replays
            where canonical_path = '/v1/companion/device/lookup-results:submit'`,
        );
        const unsafeResult = {
          ...result,
          body: { ...(result.body as Record<string, unknown>), amount: 25 },
        };
        expect(
          (await client.query(acceptSql, [...baseResultValues.slice(0, 15), unsafeResult])).rows,
        ).toHaveLength(0);
        const replayCountAfter = await client.query<{ readonly count: number }>(
          `select count(*)::integer
             from app.agent_platform_companion_http_request_replays
            where canonical_path = '/v1/companion/device/lookup-results:submit'`,
        );
        expect(replayCountAfter.rows).toEqual(replayCountBefore.rows);

        const accepted = await client.query<{
          readonly accepted: boolean;
          readonly replayed: boolean;
        }>(acceptSql, [...baseResultValues]);
        expect(accepted.rows).toEqual([{ accepted: true, replayed: false }]);
        const replayAssessedAt = canonicalNow();
        const replayAccepted = await client.query<{
          readonly accepted: boolean;
          readonly replayed: boolean;
        }>(acceptSql, [
          sha(`result-http-replay:${randomUUID()}`),
          sha(`result-http-body:${randomUUID()}`),
          `result-request-${randomUUID().replaceAll('-', '')}`,
          baseResultValues[3],
          ...baseResultValues.slice(4, 11),
          new Date(replayAssessedAt.getTime() - 100),
          new Date(replayAssessedAt.getTime() + 60_000),
          replayAssessedAt,
          assignment,
          result,
        ]);
        expect(replayAccepted.rows).toEqual([{ accepted: true, replayed: true }]);

        const status = await queryAsOwnerControl<LookupIssueRow>(
          client,
          'select * from app.get_agent_platform_companion_exact_five_lookup_status($1::uuid)',
          [ownerAuthUserId],
        );
        expect(status[0]).toMatchObject({
          assignment_id: issued[0]!.assignment_id,
          assignment_state: 'review_required',
          found_count: 4,
          not_found_count: 0,
          review_required_count: 1,
        });
        const stored = await client.query<{ readonly signed_result: string }>(
          `select signed_result::text
             from app.agent_platform_companion_lookup_results
            where assignment_id = $1::uuid`,
          [issued[0]!.assignment_id],
        );
        expect(stored.rows).toHaveLength(1);
        for (const playerId of assignmentBody.playerIds as string[]) {
          expect(stored.rows[0]!.signed_result).not.toContain(playerId);
        }
        expect(stored.rows[0]!.signed_result).not.toMatch(
          /"amount"|"notes"|"transferAllowed": true/u,
        );
      } finally {
        await client.query('rollback');
      }
    });
  });
}
