import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import type { Client, QueryResultRow } from 'pg';

type ActorFixture = {
  readonly authUserId: string;
  readonly customerId: string;
  readonly telegramIdentityId: string;
};

type ProofFixture = {
  readonly actorA: ActorFixture;
  readonly actorB: ActorFixture;
  readonly alternatePlayerAccountId: string;
  readonly alternatePlayerId: string;
  readonly playerAccountId: string;
  readonly playerId: string;
  readonly playerOwnerCustomerId: string;
};

type ProofRow = {
  readonly deposit_proof_request_id: string;
  readonly proof_status: string;
  readonly provider_code: string;
  readonly request_replayed: boolean;
  readonly submitted_at: Date;
};

type ProofStatusRow = Omit<ProofRow, 'request_replayed'>;

type CbeBirrProofPreflightRow = {
  readonly proof_request_id: string;
  readonly preflight_version: string;
  readonly eligibility: 'blocked';
  readonly blocker_code:
    | 'instruction_binding_unavailable'
    | 'receiver_revision_unavailable'
    | 'instruction_time_window_review_required'
    | 'receiver_revision_retired_at_submission'
    | 'receiver_v2_instruction_bound_metadata_only';
  readonly lease_allowed: false;
  readonly protected_material_allowed: false;
};

type CbeBirrCandidatePreleaseRow = {
  readonly candidate_id: string;
  readonly preflight_version: 'cbe-birr-candidate-prelease-v1';
  readonly eligibility: 'blocked';
  readonly blocker_code:
    'receiver_v2_candidate_bound_metadata_only' | 'candidate_lineage_review_required';
  readonly lease_allowed: false;
  readonly protected_material_allowed: false;
};

type FinancialLedgerSnapshot = {
  readonly cbe_shadow_jobs: number;
  readonly cbe_shadow_results: number;
  readonly deposit_execution_attempts: number;
  readonly deposit_intents: number;
  readonly deposit_jobs: number;
  readonly deposit_payment_claims: number;
  readonly deposit_review_cases: number;
  readonly deposit_state_events: number;
  readonly deposit_submission_files: number;
  readonly deposit_submissions: number;
  readonly deposit_verification_attempts: number;
  readonly execution_reconciliations: number;
  readonly provider_payment_evidence: number;
};

let savepointSequence = 0;

const payloadHmac = (hexCharacter: string): string => `hmac-sha256-v1:${hexCharacter.repeat(64)}`;

const referenceCiphertext = (
  providerCode: 'cbe_birr' | 'telebirr',
  nonceCharacter: string,
  tagCharacter: string,
): string =>
  `v2.${providerCode}.${nonceCharacter.repeat(16)}.${tagCharacter.repeat(22)}.syntheticref`;

async function withSavepoint<T>(client: Client, body: () => Promise<T>): Promise<T> {
  savepointSequence += 1;
  const savepointName = `dry_run_proof_${savepointSequence}`;
  await client.query(`savepoint ${savepointName}`);

  try {
    const result = await body();
    await client.query(`release savepoint ${savepointName}`);
    return result;
  } catch (error) {
    try {
      await client.query(`rollback to savepoint ${savepointName}`);
    } catch {
      // Preserve the original database or assertion error.
    }
    try {
      await client.query(`release savepoint ${savepointName}`);
    } catch {
      // Preserve the original database or assertion error.
    }
    throw error;
  }
}

async function withRollback(client: Client, body: () => Promise<void>): Promise<void> {
  await client.query('begin');
  let bodyError: unknown;

  try {
    await body();
  } catch (error) {
    bodyError = error;
  }

  try {
    await client.query('rollback');
  } catch (rollbackError) {
    if (bodyError === undefined) {
      throw rollbackError;
    }
  }

  if (bodyError !== undefined) {
    throw bodyError;
  }
}

async function queryAsRole<T extends QueryResultRow>(
  client: Client,
  role:
    | 'fetanagent_cbe_birr_candidate_prelease'
    | 'fetanagent_cbe_birr_proof_preflight'
    | 'fetanagent_cbe_birr_shadow_worker'
    | 'fetanagent_customer_web'
    | 'fetanagent_player_actions',
  query: string,
  values: readonly (number | string | null)[] = [],
): Promise<readonly T[]> {
  return withSavepoint(client, async () => {
    await client.query(`set local role ${role}`);
    const result = await client.query<T>(query, [...values]);
    await client.query('reset role');
    return result.rows;
  });
}

async function createActor(
  client: Client,
  seed: string,
  telegramUserId: number,
  tokenCharacter: string,
): Promise<ActorFixture> {
  const authUserId = `70000000-0000-4000-8000-${seed.padStart(12, '0')}`;
  const customer = await client.query<{ readonly id: string }>(
    `insert into app.customers (status) values ('active') returning id`,
  );
  const customerId = customer.rows[0]!.id;

  const telegramIdentity = await client.query<{ readonly id: string }>(
    `insert into app.customer_identities (
       customer_id, identity_kind, external_subject, status
     ) values ($1::uuid, 'telegram', $2::text, 'active')
     returning id`,
    [customerId, telegramUserId.toString()],
  );
  const telegramIdentityId = telegramIdentity.rows[0]!.id;

  await client.query(
    `insert into app.telegram_identities (
       customer_identity_id, telegram_user_id, private_chat_id, preferred_locale
     ) values ($1::uuid, $2::bigint, $2::bigint, 'en')`,
    [telegramIdentityId, telegramUserId],
  );
  await client.query(
    `insert into app.bot_conversations (telegram_identity_id)
     values ($1::uuid)`,
    [telegramIdentityId],
  );

  const admissionEvent = await client.query<{ readonly id: string }>(
    `insert into app.inbound_events (
       channel, external_event_id, customer_identity_id, payload_digest
     ) values ('telegram', $1::text, $2::uuid, $3::text)
     returning id`,
    [`update:${telegramUserId}`, telegramIdentityId, payloadHmac(tokenCharacter)],
  );
  const issuingAdmin = await client.query<{ readonly id: string }>(`
    select admin_user.id
      from app.admin_users admin_user
     where admin_user.role = 'owner'
       and admin_user.status = 'active'
     order by admin_user.id
     limit 1
  `);
  expect(issuingAdmin.rows).toHaveLength(1);

  const tokenDigest = `sha256-v1:${createHash('sha256')
    .update(`dry-run-proof-invite:${seed}`, 'utf8')
    .digest('hex')}`;

  await client.query(
    `insert into app.telegram_beta_invites (
       token_digest, expires_at, issued_by_admin_id, created_at
     ) values (
       $1::text, clock_timestamp() + interval '1 hour',
       $2::uuid, clock_timestamp() - interval '10 minutes'
     )`,
    [tokenDigest, issuingAdmin.rows[0]!.id],
  );
  const redeemedInvite = await client.query<{ readonly token_digest: string }>(
    `update app.telegram_beta_invites
        set status = 'redeemed',
            redeemed_telegram_user_id = $2::bigint,
            redeemed_private_chat_id = $2::bigint,
            redeemed_customer_id = $3::uuid,
            redeemed_customer_identity_id = $4::uuid,
            redeemed_inbound_event_id = $5::uuid,
            redeemed_at = clock_timestamp() - interval '5 minutes'
      where token_digest = $1::text
        and status = 'active'
      returning token_digest`,
    [tokenDigest, telegramUserId, customerId, telegramIdentityId, admissionEvent.rows[0]!.id],
  );
  expect(redeemedInvite.rows).toHaveLength(1);

  await client.query(`insert into auth.users (id, email) values ($1::uuid, $2::text)`, [
    authUserId,
    `${seed}@dry-run-proof.invalid`,
  ]);
  const webIdentity = await client.query<{ readonly id: string }>(
    `insert into app.customer_identities (
       customer_id, identity_kind, external_subject, status
     ) values ($1::uuid, 'supabase_auth', $2::text, 'active')
     returning id`,
    [customerId, authUserId],
  );
  await client.query(
    `insert into app.customer_auth_identities (
       customer_identity_id, customer_id, auth_user_id
     ) values ($1::uuid, $2::uuid, $3::uuid)`,
    [webIdentity.rows[0]!.id, customerId, authUserId],
  );

  return { authUserId, customerId, telegramIdentityId };
}

async function createEligiblePlayer(
  client: Client,
  ownerCustomerId: string,
  playerId: string,
): Promise<string> {
  await client.query(`set local session_replication_role = replica`);
  const player = await client.query<{ readonly id: string }>(
    `insert into app.customer_platform_players (
       customer_id, platform_id, player_id, status, validation_status,
       last_validated_at, last_validation_reason_code
     )
     select $1::uuid, platform.id, $2::text, 'active', 'valid',
            clock_timestamp(), 'dry_run_proof_fixture'
       from app.platforms platform
      where platform.code = 'kemerbet'
     returning id`,
    [ownerCustomerId, playerId],
  );
  await client.query(`set local session_replication_role = origin`);

  const playerAccountId = player.rows[0]!.id;
  await client.query(
    `insert into app.player_deposit_eligibility_decisions (
       player_account_id, decision_version, decision, reason_code, actor_kind,
       player_account_updated_at_snapshot, decided_at, created_at
     )
     select player_account.id, 1, 'eligible', 'financial_eligibility_approved', 'system',
            player_account.updated_at, statement_timestamp(), statement_timestamp()
       from app.customer_platform_players player_account
      where player_account.id = $1::uuid`,
    [playerAccountId],
  );
  return playerAccountId;
}

async function createFixture(client: Client, seed: string): Promise<ProofFixture> {
  const targetOwner = await client.query<{ readonly id: string }>(
    `insert into app.customers (status) values ('active') returning id`,
  );
  const playerOwnerCustomerId = targetOwner.rows[0]!.id;
  const playerId = `PROOF${seed}A`;
  const alternatePlayerId = `PROOF${seed}B`;
  const playerAccountId = await createEligiblePlayer(client, playerOwnerCustomerId, playerId);
  const alternatePlayerAccountId = await createEligiblePlayer(
    client,
    playerOwnerCustomerId,
    alternatePlayerId,
  );

  const numericSeed = Number.parseInt(seed, 10);
  const actorA = await createActor(client, `${seed}1`, 980_000_000 + numericSeed * 10 + 1, 'a');
  const actorB = await createActor(client, `${seed}2`, 980_000_000 + numericSeed * 10 + 2, 'b');

  return {
    actorA,
    actorB,
    alternatePlayerAccountId,
    alternatePlayerId,
    playerAccountId,
    playerId,
    playerOwnerCustomerId,
  };
}

async function createInboundEvent(
  client: Client,
  actor: ActorFixture,
  telegramUpdateId: number,
  hmacCharacter: string,
): Promise<string> {
  const event = await client.query<{ readonly id: string }>(
    `insert into app.inbound_events (
       channel, external_event_id, customer_identity_id, payload_digest
     ) values ('telegram', $1::text, $2::uuid, $3::text)
     returning id`,
    [`update:${telegramUpdateId}`, actor.telegramIdentityId, payloadHmac(hmacCharacter)],
  );
  return event.rows[0]!.id;
}

async function captureTelegramProof(
  client: Client,
  input: {
    readonly eventId: string;
    readonly fingerprint: string;
    readonly hmac: string;
    readonly masked: string;
    readonly playerId: string;
    readonly providerCode: 'cbe_birr' | 'telebirr';
    readonly referenceCiphertext?: string;
    readonly referenceKeyVersion?: number | null;
    readonly referenceProfileVersion?: number | null;
  },
): Promise<readonly ProofRow[]> {
  return queryAsRole<ProofRow>(
    client,
    'fetanagent_player_actions',
    `select *
       from app.capture_telegram_dry_run_deposit_proof(
         $1::uuid, $2::text, $3::text, $4::text, $5::text,
         $6::text, $7::smallint, $8::smallint, $9::text
       )`,
    [
      input.eventId,
      input.playerId,
      input.providerCode,
      input.referenceCiphertext ?? referenceCiphertext(input.providerCode, 'n', 't'),
      input.fingerprint,
      input.masked,
      input.referenceKeyVersion === undefined ? 2 : input.referenceKeyVersion,
      input.referenceProfileVersion === undefined ? 2 : input.referenceProfileVersion,
      input.hmac,
    ],
  );
}

async function captureWebProof(
  client: Client,
  input: {
    readonly actorAuthUserId: string;
    readonly fingerprint: string;
    readonly masked: string;
    readonly playerId: string;
    readonly providerCode: 'cbe_birr' | 'telebirr';
    readonly referenceCiphertext?: string;
    readonly referenceKeyVersion?: number | null;
    readonly referenceProfileVersion?: number | null;
    readonly requestKey: string;
  },
): Promise<readonly ProofRow[]> {
  return queryAsRole<ProofRow>(
    client,
    'fetanagent_customer_web',
    `select *
       from app.capture_customer_web_dry_run_deposit_proof(
         $1::uuid, $2::uuid, $3::text, $4::text, $5::text,
         $6::text, $7::text, $8::smallint, $9::smallint
       )`,
    [
      input.actorAuthUserId,
      input.requestKey,
      input.playerId,
      input.providerCode,
      input.referenceCiphertext ?? referenceCiphertext(input.providerCode, 'w', 'x'),
      input.fingerprint,
      input.masked,
      input.referenceKeyVersion === undefined ? 2 : input.referenceKeyVersion,
      input.referenceProfileVersion === undefined ? 2 : input.referenceProfileVersion,
    ],
  );
}

async function getTelegramProofStatus(
  client: Client,
  eventId: string | null,
  proofRequestId: string | null,
): Promise<readonly ProofStatusRow[]> {
  return queryAsRole<ProofStatusRow>(
    client,
    'fetanagent_player_actions',
    `select * from app.get_telegram_customer_deposit_proof($1::uuid, $2::uuid)`,
    [eventId, proofRequestId],
  );
}

async function createAdditionalTelegramIdentity(
  client: Client,
  actor: ActorFixture,
  telegramUserId: number,
): Promise<ActorFixture> {
  const identity = await client.query<{ readonly id: string }>(
    `insert into app.customer_identities (
       customer_id, identity_kind, external_subject, status
     ) values ($1::uuid, 'telegram', $2::text, 'active') returning id`,
    [actor.customerId, telegramUserId.toString()],
  );
  const telegramIdentityId = identity.rows[0]!.id;
  await client.query(
    `insert into app.telegram_identities (
       customer_identity_id, telegram_user_id, private_chat_id, preferred_locale
     ) values ($1::uuid, $2::bigint, $2::bigint, 'en')`,
    [telegramIdentityId, telegramUserId],
  );
  await client.query(`insert into app.bot_conversations (telegram_identity_id) values ($1::uuid)`, [
    telegramIdentityId,
  ]);
  return { ...actor, telegramIdentityId };
}

async function readFinancialLedgerSnapshot(client: Client): Promise<FinancialLedgerSnapshot> {
  const result = await client.query<FinancialLedgerSnapshot>(`
    select
      (select count(*)::integer from app.deposit_intents) as deposit_intents,
      (select count(*)::integer from app.deposit_submissions) as deposit_submissions,
      (select count(*)::integer from app.deposit_submission_files) as deposit_submission_files,
      (select count(*)::integer from app.provider_payment_evidence)
        as provider_payment_evidence,
      (select count(*)::integer from app.deposit_verification_attempts)
        as deposit_verification_attempts,
      (select count(*)::integer from app.deposit_payment_claims) as deposit_payment_claims,
      (select count(*)::integer from app.deposit_review_cases) as deposit_review_cases,
      (select count(*)::integer from app.deposit_jobs) as deposit_jobs,
      (select count(*)::integer from app.deposit_state_events) as deposit_state_events,
      (select count(*)::integer from app.cbe_birr_shadow_verification_jobs) as cbe_shadow_jobs,
      (select count(*)::integer from app.cbe_birr_shadow_verification_results)
        as cbe_shadow_results,
      (select count(*)::integer from app.deposit_execution_attempts)
        as deposit_execution_attempts,
      (select count(*)::integer from app.execution_reconciliations)
        as execution_reconciliations
  `);
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

export function registerDryRunDepositProofIntakeSqlTests(getClient: () => Client): void {
  describe('private Telegram dry-run deposit proof tracking', () => {
    it('isolates the CBE candidate prelease function to a metadata-only NOLOGIN role', async () => {
      const client = getClient();
      const boundary = await client.query<{
        readonly hardened: boolean;
        readonly output_names: readonly string[];
        readonly public_execute: boolean;
        readonly role_can_login: boolean;
        readonly role_has_table_access: boolean;
        readonly role_has_only_function: boolean;
        readonly unrelated_roles_can_execute: boolean;
        readonly source: string;
      }>(`
        select procedure.prosecdef
                 and procedure.provolatile = 's'
                 and procedure.proowner = 'postgres'::regrole
                 and procedure.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
                   as hardened,
               procedure.proargnames[(procedure.pronargs + 1):] as output_names,
               exists (
                 select 1
                   from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
                  where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
               ) as public_execute,
               role.rolcanlogin as role_can_login,
               has_table_privilege(role.rolname, 'app.routine_cbe_birr_candidates', 'select')
                 or has_table_privilege(role.rolname, 'app.cbe_birr_instruction_proof_bindings', 'select')
                 or has_table_privilege(role.rolname, 'app.cbe_birr_receiver_lookup_revisions', 'select')
                 or has_table_privilege(role.rolname, 'app.deposit_proof_requests', 'select')
                   as role_has_table_access,
               (
                 select count(*) = 1
                   from pg_proc candidate
                   join pg_namespace namespace on namespace.oid = candidate.pronamespace
                  where namespace.nspname = 'app'
                    and has_function_privilege(role.rolname, candidate.oid, 'execute')
               ) and has_function_privilege(role.rolname, procedure.oid, 'execute')
                 as role_has_only_function,
               exists (
                 select 1 from unnest(array[
                   'anon', 'authenticated', 'service_role', 'fetanagent_api',
                   'fetanagent_api_runtime', 'fetanagent_player_actions',
                   'fetanagent_customer_web', 'fetanagent_cbe_birr_shadow_worker'
                 ]) denied(role_name)
                 where has_function_privilege(denied.role_name, procedure.oid, 'execute')
               ) as unrelated_roles_can_execute,
               procedure.prosrc as source
          from pg_proc procedure
          cross join pg_roles role
         where procedure.oid = 'app.preflight_routine_cbe_birr_candidate(uuid)'::regprocedure
           and role.rolname = 'fetanagent_cbe_birr_candidate_prelease'
      `);
      expect(boundary.rows).toHaveLength(1);
      const profile = boundary.rows[0]!;
      expect({ ...profile, source: undefined }).toEqual({
        hardened: true,
        output_names: [
          'candidate_id',
          'preflight_version',
          'eligibility',
          'blocker_code',
          'lease_allowed',
          'protected_material_allowed',
        ],
        public_execute: false,
        role_can_login: false,
        role_has_table_access: false,
        role_has_only_function: true,
        unrelated_roles_can_execute: false,
        source: undefined,
      });
      expect(profile.source).not.toMatch(
        /candidate_reference_ciphertext|lookup_ciphertext|account_reference_ciphertext|lookup_fingerprint|account_reference_fingerprint|\bfor\s+(?:no\s+)?key\s+update\b|\bfor\s+update\b|\bfor\s+share\b|\b(?:insert|update|delete|merge|truncate|execute|perform)\b/iu,
      );
    });

    it('preflights v2 CBE Birr proofs without leasing or exposing protected material', async () => {
      const client = getClient();
      const boundary = await client.query<{
        readonly hardened: boolean;
        readonly output_names: readonly string[];
        readonly public_execute: boolean;
        readonly preflight_role_can_login: boolean;
        readonly preflight_role_has_table_access: boolean;
        readonly preflight_role_has_legacy_lease: boolean;
        readonly preflight_role_has_only_function: boolean;
        readonly unrelated_roles_can_execute: boolean;
        readonly source: string;
      }>(`
        select procedure.prosecdef
                 and procedure.provolatile = 's'
                 and procedure.proowner = 'postgres'::regrole
                 and procedure.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
                   as hardened,
               procedure.proargnames[(procedure.pronargs + 1):] as output_names,
               exists (
                 select 1
                   from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
                  where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
               ) as public_execute,
               role.rolcanlogin as preflight_role_can_login,
               has_table_privilege(role.rolname, 'app.deposit_proof_requests', 'select')
                 or has_table_privilege(role.rolname, 'app.receiver_accounts', 'select')
                 or has_table_privilege(role.rolname, 'app.provider_payment_evidence', 'select')
                 or has_table_privilege(role.rolname, 'app.deposit_payment_claims', 'select')
                 or has_table_privilege(role.rolname, 'app.deposit_jobs', 'select')
                   as preflight_role_has_table_access,
               has_function_privilege(
                 role.rolname,
                 'app.lease_cbe_birr_shadow_verification_job(uuid,integer)', 'execute'
               ) as preflight_role_has_legacy_lease,
               (
                 select count(*) = 1
                   from pg_proc candidate
                   join pg_namespace namespace on namespace.oid = candidate.pronamespace
                  where namespace.nspname = 'app'
                    and has_function_privilege(role.rolname, candidate.oid, 'execute')
               ) and has_function_privilege(role.rolname, procedure.oid, 'execute')
                 as preflight_role_has_only_function,
               exists (
                 select 1 from unnest(array[
                   'anon', 'authenticated', 'service_role', 'fetanagent_api',
                   'fetanagent_api_runtime', 'fetanagent_player_actions',
                   'fetanagent_customer_web', 'fetanagent_cbe_birr_shadow_worker'
                 ]) denied(role_name)
                 where has_function_privilege(denied.role_name, procedure.oid, 'execute')
               ) as unrelated_roles_can_execute,
               procedure.prosrc as source
          from pg_proc procedure
          cross join pg_roles role
         where procedure.oid = 'app.preflight_cbe_birr_proof_request(uuid)'::regprocedure
           and role.rolname = 'fetanagent_cbe_birr_proof_preflight'
      `);
      expect(boundary.rows).toHaveLength(1);
      const profile = boundary.rows[0]!;
      expect({ ...profile, source: undefined }).toEqual({
        hardened: true,
        output_names: [
          'proof_request_id',
          'preflight_version',
          'eligibility',
          'blocker_code',
          'lease_allowed',
          'protected_material_allowed',
        ],
        public_execute: false,
        preflight_role_can_login: false,
        preflight_role_has_table_access: false,
        preflight_role_has_legacy_lease: false,
        preflight_role_has_only_function: true,
        unrelated_roles_can_execute: false,
        source: undefined,
      });
      expect(profile.source).not.toMatch(
        /candidate_reference_ciphertext|candidate_reference_fingerprint|account_reference_ciphertext|verification_reference_ciphertext|account_reference_fingerprint|\bfor\s+(?:no\s+)?key\s+update\b|\bfor\s+update\b|\bfor\s+share\b|\b(?:insert|update|delete|merge|truncate|execute|perform)\b/iu,
      );

      await withRollback(client, async () => {
        const fixture = await createFixture(client, '130');
        const cbeEvent = await createInboundEvent(client, fixture.actorA, 9_130_000_001, 'c');
        const cbeProof = (
          await captureTelegramProof(client, {
            eventId: cbeEvent,
            fingerprint: 'c'.repeat(64),
            hmac: payloadHmac('c'),
            masked: '***A130',
            playerId: fixture.playerId,
            providerCode: 'cbe_birr',
          })
        )[0]!;
        const before = await client.query<{ readonly xmin: string }>(
          `select proof.xmin::text as xmin from app.deposit_proof_requests proof
            where proof.id = $1::uuid`,
          [cbeProof.deposit_proof_request_id],
        );
        const beforeFinancial = await readFinancialLedgerSnapshot(client);
        const first = await queryAsRole<CbeBirrProofPreflightRow>(
          client,
          'fetanagent_cbe_birr_proof_preflight',
          'select * from app.preflight_cbe_birr_proof_request($1::uuid)',
          [cbeProof.deposit_proof_request_id],
        );
        const replay = await queryAsRole<CbeBirrProofPreflightRow>(
          client,
          'fetanagent_cbe_birr_proof_preflight',
          'select * from app.preflight_cbe_birr_proof_request($1::uuid)',
          [cbeProof.deposit_proof_request_id],
        );
        expect(replay).toEqual(first);
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
          proof_request_id: cbeProof.deposit_proof_request_id,
          preflight_version: 'cbe-birr-proof-preflight-v2',
          eligibility: 'blocked',
          lease_allowed: false,
          protected_material_allowed: false,
        });
        expect(first[0]!.blocker_code).toBe('instruction_binding_unavailable');
        expect(Object.keys(first[0]!).sort()).toEqual(
          [
            'proof_request_id',
            'preflight_version',
            'eligibility',
            'blocker_code',
            'lease_allowed',
            'protected_material_allowed',
          ].sort(),
        );

        const telebirrEvent = await createInboundEvent(client, fixture.actorA, 9_130_000_002, 'd');
        const telebirrProof = (
          await captureTelegramProof(client, {
            eventId: telebirrEvent,
            fingerprint: 'd'.repeat(64),
            hmac: payloadHmac('d'),
            masked: '***B130',
            playerId: fixture.playerId,
            providerCode: 'telebirr',
          })
        )[0]!;
        expect(
          await queryAsRole<CbeBirrProofPreflightRow>(
            client,
            'fetanagent_cbe_birr_proof_preflight',
            'select * from app.preflight_cbe_birr_proof_request($1::uuid)',
            [telebirrProof.deposit_proof_request_id],
          ),
        ).toEqual([]);

        expect(
          await queryAsRole<CbeBirrProofPreflightRow>(
            client,
            'fetanagent_cbe_birr_proof_preflight',
            'select * from app.preflight_cbe_birr_proof_request($1::uuid)',
            ['99999999-9999-4999-8999-999999999999'],
          ),
        ).toEqual([]);
        await expect(
          queryAsRole(
            client,
            'fetanagent_cbe_birr_proof_preflight',
            'select * from app.preflight_cbe_birr_proof_request(null::uuid)',
          ),
        ).rejects.toThrow('The CBE Birr proof preflight request is invalid.');
        await expect(
          queryAsRole(
            client,
            'fetanagent_cbe_birr_proof_preflight',
            'select * from app.deposit_proof_requests limit 1',
          ),
        ).rejects.toThrow(/permission denied|row-level security/u);
        await expect(
          queryAsRole(
            client,
            'fetanagent_cbe_birr_shadow_worker',
            'select * from app.preflight_cbe_birr_proof_request($1::uuid)',
            [cbeProof.deposit_proof_request_id],
          ),
        ).rejects.toThrow(/permission denied/u);

        await client.query('savepoint cbe_preflight_switch');
        try {
          await client.query(`update app.feature_switches set mode = 'dry_run'
            where feature_key = 'cbe_birr_authoritative_verification'`);
          await expect(
            queryAsRole(
              client,
              'fetanagent_cbe_birr_proof_preflight',
              'select * from app.preflight_cbe_birr_proof_request($1::uuid)',
              [cbeProof.deposit_proof_request_id],
            ),
          ).rejects.toThrow('requires verification to remain disabled');
        } finally {
          await client.query('rollback to savepoint cbe_preflight_switch');
          await client.query('release savepoint cbe_preflight_switch');
        }

        expect(
          await client.query<{ readonly xmin: string }>(
            `select proof.xmin::text as xmin from app.deposit_proof_requests proof
            where proof.id = $1::uuid`,
            [cbeProof.deposit_proof_request_id],
          ),
        ).toEqual(before);
        expect(await readFinancialLedgerSnapshot(client)).toEqual(beforeFinancial);
      });
    });

    it('binds a CBE proof to one exact v2 receiver instruction without granting a lease', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '131');
        const owner = await client.query<{ readonly auth_user_id: string }>(
          `select auth_user_id from app.admin_users
            where role = 'owner' and status = 'active' limit 1`,
        );
        const provider = await client.query<{
          readonly id: string;
          readonly next_version: number;
        }>(`
          select provider.id,
                 coalesce(max(receiver.version), 0)::integer + 1 as next_version
            from app.payment_providers provider
            left join app.receiver_accounts receiver
              on receiver.provider_id = provider.id
           where provider.code = 'cbe_birr'
           group by provider.id
        `);
        expect(owner.rows).toHaveLength(1);
        expect(provider.rows).toHaveLength(1);
        const providerId = provider.rows[0]!.id;
        const receiverRevisionId = randomUUID();
        const rotationRequestId = randomUUID();
        const legacyFingerprint = createHash('sha256').update(rotationRequestId).digest('hex');
        const lookupFingerprint = createHash('sha256').update(receiverRevisionId).digest('hex');
        const receiver = await client.query<{
          readonly receiver_revision_id: string;
          readonly revision: number;
        }>(
          `select * from app.rotate_owner_cbe_birr_receiver_lookup_v2(
            $1::uuid, $2::uuid, $3::uuid, $4::integer, 'Synthetic SQL Receiver',
            $5::text, $6::text, '***0001', $7::text, $8::text, '***0001',
            'account_rotation'
          )`,
          [
            owner.rows[0]!.auth_user_id,
            rotationRequestId,
            receiverRevisionId,
            provider.rows[0]!.next_version,
            `receiver-v1.cbe_birr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(16)}`,
            legacyFingerprint,
            `cbe-receiver-v2.${'D'.repeat(16)}.${'E'.repeat(22)}.${'F'.repeat(16)}`,
            lookupFingerprint,
          ],
        );
        expect(receiver.rows).toMatchObject([{ receiver_revision_id: receiverRevisionId }]);

        const instructionEvent = await createInboundEvent(
          client,
          fixture.actorA,
          9_131_000_000,
          '0',
        );
        const instructionSql = `select instruction_id as id, issued_at, expires_at,
                                       request_replayed
                                  from app.issue_telegram_cbe_birr_dry_run_instruction(
                                    $1::uuid, $2::text, $3::text
                                  )`;
        const instructionValues = [instructionEvent, fixture.playerId, payloadHmac('0')];
        const instruction = await client.query<{
          readonly id: string;
          readonly issued_at: Date;
          readonly expires_at: Date;
          readonly request_replayed: boolean;
        }>(instructionSql, instructionValues);
        expect(instruction.rows).toHaveLength(1);
        expect(instruction.rows[0]!.request_replayed).toBe(false);
        expect(
          instruction.rows[0]!.expires_at.getTime() - instruction.rows[0]!.issued_at.getTime(),
        ).toBe(3_600_000);
        expect(Object.keys(instruction.rows[0]!).sort()).toEqual([
          'expires_at',
          'id',
          'issued_at',
          'request_replayed',
        ]);
        expect((await client.query(instructionSql, instructionValues)).rows).toMatchObject([
          { id: instruction.rows[0]!.id, request_replayed: true },
        ]);
        await expect(
          withSavepoint(client, async () => {
            await client.query(
              `update app.customer_identities set status = 'inactive'
                where id = $1::uuid`,
              [fixture.actorA.telegramIdentityId],
            );
            await client.query(instructionSql, instructionValues);
          }),
        ).rejects.toThrow(/customer is inactive/u);
        await expect(
          withSavepoint(client, async () => {
            await client.query(instructionSql, [
              instructionEvent,
              fixture.playerId,
              payloadHmac('1'),
            ]);
          }),
        ).rejects.toThrow(/conflicts with its receipt/u);
        await expect(
          withSavepoint(client, async () => {
            await client.query(instructionSql, [
              instructionEvent,
              fixture.alternatePlayerId,
              payloadHmac('0'),
            ]);
          }),
        ).rejects.toThrow(/conflicts with its receipt/u);
        expect(
          await queryAsRole(client, 'fetanagent_player_actions', instructionSql, instructionValues),
        ).toMatchObject([{ id: instruction.rows[0]!.id, request_replayed: true }]);
        await expect(
          queryAsRole(
            client,
            'fetanagent_player_actions',
            'select * from app.telegram_cbe_birr_dry_run_instruction_receipts limit 1',
          ),
        ).rejects.toThrow(/permission denied|row-level security/u);
        const event = await createInboundEvent(client, fixture.actorA, 9_131_000_001, 'e');
        const proof = (
          await captureTelegramProof(client, {
            eventId: event,
            fingerprint: 'e'.repeat(64),
            hmac: payloadHmac('e'),
            masked: '***A131',
            playerId: fixture.playerId,
            providerCode: 'cbe_birr',
          })
        )[0]!;
        const proofId = proof.deposit_proof_request_id;
        const instructionId = instruction.rows[0]!.id;
        const preflightSql = 'select * from app.preflight_cbe_birr_proof_request($1::uuid)';
        const beforeFinancial = await readFinancialLedgerSnapshot(client);
        expect(
          await queryAsRole<CbeBirrProofPreflightRow>(
            client,
            'fetanagent_cbe_birr_proof_preflight',
            preflightSql,
            [proofId],
          ),
        ).toMatchObject([{ blocker_code: 'instruction_binding_unavailable' }]);
        const candidateSql = 'select * from app.enqueue_routine_cbe_birr_candidate($1::uuid)';
        await expect(
          withSavepoint(client, async () => client.query(candidateSql, [proofId])),
        ).rejects.toThrow(/candidate lineage is unavailable/u);

        const insertBindingSql = `insert into app.cbe_birr_instruction_proof_bindings (
          proof_request_id, instruction_id, submitting_customer_id,
          player_account_id, payment_provider_id, origin_channel,
          receiver_revision_id, receiver_version, receiver_rotation_request_id
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'telegram',
          $6::uuid, $7::integer, $8::uuid
        )`;
        const bindingValues = [
          proofId,
          instructionId,
          fixture.actorA.customerId,
          fixture.playerAccountId,
          providerId,
          receiverRevisionId,
          receiver.rows[0]!.revision,
          rotationRequestId,
        ];
        await expect(
          withSavepoint(client, async () => {
            await client.query(insertBindingSql, [
              ...bindingValues.slice(0, 6),
              receiver.rows[0]!.revision + 1,
              rotationRequestId,
            ]);
          }),
        ).rejects.toThrow(/foreign key/u);
        await expect(
          withSavepoint(client, async () => {
            await client.query(insertBindingSql, [
              ...bindingValues.slice(0, 2),
              fixture.actorB.customerId,
              ...bindingValues.slice(3),
            ]);
          }),
        ).rejects.toThrow(/foreign key/u);
        await client.query(insertBindingSql, bindingValues);

        const bound = await queryAsRole<CbeBirrProofPreflightRow>(
          client,
          'fetanagent_cbe_birr_proof_preflight',
          preflightSql,
          [proofId],
        );
        expect(bound).toEqual([
          {
            proof_request_id: proofId,
            preflight_version: 'cbe-birr-proof-preflight-v2',
            eligibility: 'blocked',
            blocker_code: 'receiver_v2_instruction_bound_metadata_only',
            lease_allowed: false,
            protected_material_allowed: false,
          },
        ]);
        expect(JSON.stringify(bound)).not.toContain(receiverRevisionId);
        const candidate = await client.query<{
          readonly candidate_id: string;
          readonly already_recorded: boolean;
        }>(candidateSql, [proofId]);
        expect(candidate.rows).toHaveLength(1);
        expect(candidate.rows[0]!.already_recorded).toBe(false);
        expect(Object.keys(candidate.rows[0]!).sort()).toEqual([
          'already_recorded',
          'candidate_id',
        ]);
        expect((await client.query(candidateSql, [proofId])).rows).toEqual([
          { candidate_id: candidate.rows[0]!.candidate_id, already_recorded: true },
        ]);
        const candidatePreleaseSql =
          'select * from app.preflight_routine_cbe_birr_candidate($1::uuid)';
        const candidateId = candidate.rows[0]!.candidate_id;
        const candidatePrelease = await queryAsRole<CbeBirrCandidatePreleaseRow>(
          client,
          'fetanagent_cbe_birr_candidate_prelease',
          candidatePreleaseSql,
          [candidateId],
        );
        expect(candidatePrelease).toEqual([
          {
            candidate_id: candidateId,
            preflight_version: 'cbe-birr-candidate-prelease-v1',
            eligibility: 'blocked',
            blocker_code: 'receiver_v2_candidate_bound_metadata_only',
            lease_allowed: false,
            protected_material_allowed: false,
          },
        ]);
        expect(JSON.stringify(candidatePrelease)).not.toContain(receiverRevisionId);
        expect(
          await queryAsRole(
            client,
            'fetanagent_cbe_birr_candidate_prelease',
            candidatePreleaseSql,
            ['99999999-9999-4999-8999-999999999999'],
          ),
        ).toEqual([]);
        await expect(
          queryAsRole(
            client,
            'fetanagent_cbe_birr_candidate_prelease',
            'select * from app.preflight_routine_cbe_birr_candidate(null::uuid)',
          ),
        ).rejects.toThrow(/candidate prelease request is invalid/u);
        await expect(
          queryAsRole(
            client,
            'fetanagent_cbe_birr_candidate_prelease',
            'select * from app.cbe_birr_receiver_lookup_revisions limit 1',
          ),
        ).rejects.toThrow(/permission denied|row-level security/u);
        await expect(
          queryAsRole(client, 'fetanagent_player_actions', candidatePreleaseSql, [candidateId]),
        ).rejects.toThrow(/permission denied/u);
        await client.query('savepoint cbe_candidate_live_telebirr');
        try {
          await client.query(
            `update app.feature_switches set mode = 'live'
              where feature_key in ('payment_verification', 'deposit_execution')`,
          );
          const liveInstructionEvent = await createInboundEvent(
            client,
            fixture.actorA,
            9_131_000_009,
            '9',
          );
          const liveInstruction = await queryAsRole<{
            readonly id: string;
            readonly request_replayed: boolean;
          }>(client, 'fetanagent_player_actions', instructionSql, [
            liveInstructionEvent,
            fixture.playerId,
            payloadHmac('9'),
          ]);
          expect(liveInstruction).toMatchObject([{ request_replayed: false }]);
          const liveProofEvent = await createInboundEvent(
            client,
            fixture.actorA,
            9_131_000_010,
            '8',
          );
          const liveProofSql = `select * from app.capture_telegram_cbe_birr_bound_dry_run_proof(
            $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text,
            $7::smallint, $8::smallint, $9::text
          )`;
          const liveProof = await queryAsRole<ProofRow>(
            client,
            'fetanagent_player_actions',
            liveProofSql,
            [
              liveInstruction[0]!.id,
              liveProofEvent,
              fixture.playerId,
              referenceCiphertext('cbe_birr', 'n', 't'),
              '8'.repeat(64),
              '***A138',
              2,
              2,
              payloadHmac('8'),
            ],
          );
          expect(liveProof).toMatchObject([
            { provider_code: 'cbe_birr', proof_status: 'proof_received', request_replayed: false },
          ]);
          expect(
            await queryAsRole<CbeBirrProofPreflightRow>(
              client,
              'fetanagent_cbe_birr_proof_preflight',
              preflightSql,
              [liveProof[0]!.deposit_proof_request_id],
            ),
          ).toMatchObject([
            {
              blocker_code: 'receiver_v2_instruction_bound_metadata_only',
              lease_allowed: false,
              protected_material_allowed: false,
            },
          ]);
          expect(await readFinancialLedgerSnapshot(client)).toEqual(beforeFinancial);
          const telebirrDryRunEvent = await createInboundEvent(
            client,
            fixture.actorA,
            9_131_000_011,
            '7',
          );
          await expect(
            captureTelegramProof(client, {
              eventId: telebirrDryRunEvent,
              fingerprint: '7'.repeat(64),
              hmac: payloadHmac('7'),
              masked: '***A137',
              playerId: fixture.playerId,
              providerCode: 'telebirr',
            }),
          ).rejects.toThrow(/every financial switch disabled/u);
          const unboundCbeEvent = await createInboundEvent(
            client,
            fixture.actorA,
            9_131_000_013,
            '5',
          );
          await expect(
            captureTelegramProof(client, {
              eventId: unboundCbeEvent,
              fingerprint: '5'.repeat(64),
              hmac: payloadHmac('5'),
              masked: '***A135',
              playerId: fixture.playerId,
              providerCode: 'cbe_birr',
            }),
          ).rejects.toThrow(/every financial switch disabled/u);
          await expect(
            queryAsRole(
              client,
              'fetanagent_player_actions',
              `select * from app.capture_telegram_cbe_birr_no_money_proof(
                $1::uuid, $2::text, $3::text, $4::text, $5::text,
                $6::text, $7::smallint, $8::smallint, $9::text
              )`,
              [
                unboundCbeEvent,
                fixture.playerId,
                'cbe_birr',
                referenceCiphertext('cbe_birr', 'n', 't'),
                '5'.repeat(64),
                '***A135',
                2,
                2,
                payloadHmac('5'),
              ],
            ),
          ).rejects.toThrow(/permission denied/u);
          expect((await client.query(candidateSql, [proofId])).rows).toEqual([
            { candidate_id: candidate.rows[0]!.candidate_id, already_recorded: true },
          ]);
          expect(
            await queryAsRole<CbeBirrCandidatePreleaseRow>(
              client,
              'fetanagent_cbe_birr_candidate_prelease',
              candidatePreleaseSql,
              [candidateId],
            ),
          ).toEqual(candidatePrelease);
        } finally {
          await client.query('rollback to savepoint cbe_candidate_live_telebirr');
          await client.query('release savepoint cbe_candidate_live_telebirr');
        }
        await client.query('savepoint cbe_candidate_verification_off');
        try {
          await client.query(
            `update app.feature_switches set mode = 'dry_run'
              where feature_key = 'cbe_birr_authoritative_verification'`,
          );
          const blockedInstructionEvent = await createInboundEvent(
            client,
            fixture.actorA,
            9_131_000_012,
            '6',
          );
          await expect(
            withSavepoint(client, async () =>
              client.query(instructionSql, [
                blockedInstructionEvent,
                fixture.playerId,
                payloadHmac('6'),
              ]),
            ),
          ).rejects.toThrow(/requires verification disabled/u);
          await expect(
            withSavepoint(client, async () => client.query(candidateSql, [proofId])),
          ).rejects.toThrow(/requires CBE verification disabled/u);
          await expect(
            queryAsRole(client, 'fetanagent_cbe_birr_candidate_prelease', candidatePreleaseSql, [
              candidateId,
            ]),
          ).rejects.toThrow(/requires verification disabled/u);
        } finally {
          await client.query('rollback to savepoint cbe_candidate_verification_off');
          await client.query('release savepoint cbe_candidate_verification_off');
        }
        const storedCandidate = await client.query<{
          readonly proof_request_id: string;
          readonly contract_version: number;
        }>(
          `select proof_request_id, contract_version
             from app.routine_cbe_birr_candidates
            where id = $1::uuid`,
          [candidate.rows[0]!.candidate_id],
        );
        expect(storedCandidate.rows).toEqual([{ proof_request_id: proofId, contract_version: 1 }]);
        await expect(
          withSavepoint(client, async () =>
            client.query(
              `update app.routine_cbe_birr_candidates set contract_version = 1
                where id = $1::uuid`,
              [candidate.rows[0]!.candidate_id],
            ),
          ),
        ).rejects.toThrow(/candidate lineage is immutable/u);
        await expect(
          queryAsRole(client, 'fetanagent_player_actions', candidateSql, [proofId]),
        ).rejects.toThrow(/permission denied/u);
        await expect(
          queryAsRole(
            client,
            'fetanagent_cbe_birr_proof_preflight',
            'select * from app.routine_cbe_birr_candidates limit 1',
          ),
        ).rejects.toThrow(/permission denied|row-level security/u);
        await expect(
          withSavepoint(client, async () => {
            await client.query(
              `update app.cbe_birr_instruction_proof_bindings
                  set receiver_version = receiver_version + 1
                where proof_request_id = $1::uuid`,
              [proofId],
            );
          }),
        ).rejects.toThrow(/immutable/u);
        await expect(
          queryAsRole(
            client,
            'fetanagent_cbe_birr_proof_preflight',
            'select * from app.cbe_birr_instruction_proof_bindings limit 1',
          ),
        ).rejects.toThrow(/permission denied|row-level security/u);

        const lateEvent = await createInboundEvent(client, fixture.actorA, 9_131_000_002, 'f');
        const lateProof = (
          await captureTelegramProof(client, {
            eventId: lateEvent,
            fingerprint: 'f'.repeat(64),
            hmac: payloadHmac('f'),
            masked: '***A132',
            playerId: fixture.playerId,
            providerCode: 'cbe_birr',
          })
        )[0]!;
        const lateProofId = lateProof.deposit_proof_request_id;
        const lateInstruction = await client.query<{ readonly id: string }>(
          `with proof as (
             select submitted_at from app.deposit_proof_requests where id = $7::uuid
           )
           insert into app.cbe_birr_payment_instructions (
             submitting_customer_id, player_account_id, payment_provider_id,
             provider_code, origin_channel, receiver_revision_id,
             receiver_version, receiver_rotation_request_id, issued_at, expires_at
           )
           select $1::uuid, $2::uuid, $3::uuid, 'cbe_birr', 'telegram',
                  $4::uuid, $5::integer, $6::uuid,
                  proof.submitted_at - interval '1 minute',
                  proof.submitted_at + interval '59 minutes'
             from proof
           returning id`,
          [
            fixture.actorA.customerId,
            fixture.playerAccountId,
            providerId,
            receiverRevisionId,
            receiver.rows[0]!.revision,
            rotationRequestId,
            lateProofId,
          ],
        );
        await client.query(insertBindingSql, [
          lateProofId,
          lateInstruction.rows[0]!.id,
          ...bindingValues.slice(2),
        ]);
        expect(
          await queryAsRole<CbeBirrProofPreflightRow>(
            client,
            'fetanagent_cbe_birr_proof_preflight',
            preflightSql,
            [lateProofId],
          ),
        ).toMatchObject([
          {
            blocker_code: 'instruction_time_window_review_required',
            lease_allowed: false,
            protected_material_allowed: false,
          },
        ]);
        await expect(
          withSavepoint(client, async () => client.query(candidateSql, [lateProofId])),
        ).rejects.toThrow(/candidate lineage is unavailable/u);

        const nextInstructionSql = `with issued as (select clock_timestamp() as instant)
          insert into app.cbe_birr_payment_instructions (
            submitting_customer_id, player_account_id, payment_provider_id,
            provider_code, origin_channel, receiver_revision_id,
            receiver_version, receiver_rotation_request_id, issued_at, expires_at
          )
          select $2::uuid, original.player_account_id, original.payment_provider_id,
                 original.provider_code, original.origin_channel,
                 original.receiver_revision_id, original.receiver_version,
                 original.receiver_rotation_request_id,
                 issued.instant, issued.instant + interval '1 hour'
            from app.cbe_birr_payment_instructions original cross join issued
           where original.id = $1::uuid
          returning id`;
        const atomicInstruction = await client.query<{ readonly id: string }>(nextInstructionSql, [
          instructionId,
          fixture.actorA.customerId,
        ]);
        const atomicEvent = await createInboundEvent(client, fixture.actorA, 9_131_000_003, '1');
        const atomicSql = `select * from app.capture_telegram_cbe_birr_bound_dry_run_proof(
          $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text,
          $7::smallint, $8::smallint, $9::text
        )`;
        await expect(
          withSavepoint(client, async () => {
            await client.query(atomicSql, [
              lateInstruction.rows[0]!.id,
              lateEvent,
              fixture.playerId,
              referenceCiphertext('cbe_birr', 'n', 't'),
              'f'.repeat(64),
              '***A132',
              2,
              2,
              payloadHmac('f'),
            ]);
          }),
        ).rejects.toThrow(/lineage needs review/u);
        const atomicValues = [
          atomicInstruction.rows[0]!.id,
          atomicEvent,
          fixture.playerId,
          referenceCiphertext('cbe_birr', 'n', 't'),
          '1'.repeat(64),
          '***A133',
          2,
          2,
          payloadHmac('1'),
        ];
        const atomicProof = await client.query<ProofRow>(atomicSql, atomicValues);
        expect(atomicProof.rows).toMatchObject([
          { provider_code: 'cbe_birr', proof_status: 'proof_received', request_replayed: false },
        ]);
        expect(
          await queryAsRole<CbeBirrProofPreflightRow>(
            client,
            'fetanagent_cbe_birr_proof_preflight',
            preflightSql,
            [atomicProof.rows[0]!.deposit_proof_request_id],
          ),
        ).toMatchObject([
          {
            blocker_code: 'receiver_v2_instruction_bound_metadata_only',
            lease_allowed: false,
            protected_material_allowed: false,
          },
        ]);
        expect((await client.query<ProofRow>(atomicSql, atomicValues)).rows).toMatchObject([
          {
            deposit_proof_request_id: atomicProof.rows[0]!.deposit_proof_request_id,
            request_replayed: true,
          },
        ]);

        const wrongInstruction = await client.query<{ readonly id: string }>(nextInstructionSql, [
          instructionId,
          fixture.actorB.customerId,
        ]);
        const wrongEvent = await createInboundEvent(client, fixture.actorA, 9_131_000_004, '2');
        await expect(
          withSavepoint(client, async () => {
            await client.query(atomicSql, [
              wrongInstruction.rows[0]!.id,
              wrongEvent,
              fixture.playerId,
              referenceCiphertext('cbe_birr', 'n', 't'),
              '2'.repeat(64),
              '***A134',
              2,
              2,
              payloadHmac('2'),
            ]);
          }),
        ).rejects.toThrow(/does not match this proof/u);
        expect(
          (
            await client.query<{ readonly count: number }>(
              `select count(*)::integer as count from app.deposit_proof_requests
                where submitting_customer_id = $1::uuid
                  and candidate_reference_fingerprint = $2::text`,
              [fixture.actorA.customerId, '2'.repeat(64)],
            )
          ).rows[0]!.count,
        ).toBe(0);

        const unboundEvent = await createInboundEvent(client, fixture.actorA, 9_131_000_005, '3');
        const unboundProof = await captureTelegramProof(client, {
          eventId: unboundEvent,
          fingerprint: '3'.repeat(64),
          hmac: payloadHmac('3'),
          masked: '***A135',
          playerId: fixture.playerId,
          providerCode: 'cbe_birr',
        });
        await expect(
          withSavepoint(client, async () => {
            await client.query(atomicSql, [
              atomicInstruction.rows[0]!.id,
              unboundEvent,
              fixture.playerId,
              referenceCiphertext('cbe_birr', 'n', 't'),
              '3'.repeat(64),
              '***A135',
              2,
              2,
              payloadHmac('3'),
            ]);
          }),
        ).rejects.toThrow(/earlier unbound/u);
        expect(
          await queryAsRole<CbeBirrProofPreflightRow>(
            client,
            'fetanagent_cbe_birr_proof_preflight',
            preflightSql,
            [unboundProof[0]!.deposit_proof_request_id],
          ),
        ).toMatchObject([{ blocker_code: 'instruction_binding_unavailable' }]);
        expect(
          await queryAsRole(client, 'fetanagent_player_actions', atomicSql, atomicValues),
        ).toMatchObject([{ request_replayed: true }]);
        const replacementRequestId = randomUUID();
        const replacementRevisionId = randomUUID();
        await client.query(
          `select * from app.rotate_owner_cbe_birr_receiver_lookup_v2(
            $1::uuid, $2::uuid, $3::uuid, $4::integer, 'Synthetic Rotated SQL Receiver',
            $5::text, $6::text, '***0002', $7::text, $8::text, '***0002',
            'account_rotation'
          )`,
          [
            owner.rows[0]!.auth_user_id,
            replacementRequestId,
            replacementRevisionId,
            receiver.rows[0]!.revision + 1,
            `receiver-v1.cbe_birr.${'G'.repeat(16)}.${'H'.repeat(22)}.${'I'.repeat(16)}`,
            createHash('sha256').update(replacementRequestId).digest('hex'),
            `cbe-receiver-v2.${'J'.repeat(16)}.${'K'.repeat(22)}.${'L'.repeat(16)}`,
            createHash('sha256').update(replacementRevisionId).digest('hex'),
          ],
        );
        expect(
          await queryAsRole<CbeBirrCandidatePreleaseRow>(
            client,
            'fetanagent_cbe_birr_candidate_prelease',
            candidatePreleaseSql,
            [candidateId],
          ),
        ).toEqual([
          {
            ...candidatePrelease[0],
            blocker_code: 'candidate_lineage_review_required',
          },
        ]);
        expect(await readFinancialLedgerSnapshot(client)).toEqual(beforeFinancial);
      });
    });

    it('exposes only the four safe status fields through the isolated Player-action role', async () => {
      const client = getClient();
      const procedure = await client.query<{
        readonly direct_grantees: readonly string[];
        readonly hardened: boolean;
        readonly output_names: readonly string[];
        readonly public_execute: boolean;
        readonly stable: boolean;
      }>(`
        select procedure.prosecdef
                 and procedure.proowner = 'postgres'::regrole
                 and procedure.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]
                   as hardened,
               procedure.provolatile = 's' as stable,
               procedure.proargnames[3:6] as output_names,
               exists (
                 select 1
                   from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
                  where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
               ) as public_execute,
               coalesce((
                 select array_agg(role.rolname::text order by role.rolname)::text[]
                   from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
                   join pg_roles role on role.oid = acl.grantee
                  where acl.grantee <> procedure.proowner and acl.privilege_type = 'EXECUTE'
               ), array[]::text[]) as direct_grantees
          from pg_proc procedure
         where procedure.oid = 'app.get_telegram_customer_deposit_proof(uuid,uuid)'::regprocedure
      `);
      expect(procedure.rows).toEqual([
        {
          direct_grantees: ['fetanagent_player_actions'],
          hardened: true,
          output_names: [
            'deposit_proof_request_id',
            'provider_code',
            'proof_status',
            'submitted_at',
          ],
          public_execute: false,
          stable: true,
        },
      ]);
      const privileges = await client.query<{ readonly allowed: boolean }>(`
        select has_function_privilege(
                 role_name, 'app.get_telegram_customer_deposit_proof(uuid,uuid)', 'EXECUTE'
               ) as allowed
          from unnest(array[
            'anon', 'authenticated', 'service_role', 'fetanagent_api', 'fetanagent_api_runtime',
            'fetanagent_customer_web', 'fetanagent_customer_web_runtime', 'fetanagent_worker',
            'fetanagent_beta_admission', 'fetanagent_nonce_retention', 'fetanagent_owner_control',
            'fetanagent_deposit_executor', 'fetanagent_verification_settlement'
          ]) role_name
      `);
      expect(privileges.rows.every((row) => !row.allowed)).toBe(true);
      await withRollback(client, async () => {
        await expect(
          queryAsRole(
            client,
            'fetanagent_customer_web',
            `select * from app.get_telegram_customer_deposit_proof(null::uuid, null::uuid)`,
          ),
        ).rejects.toMatchObject({ code: '42501' });
      });
    });

    it('returns one owned proof after capture replay and leaves all state unchanged during repeated reads', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '120');
        const captureEvent = await createInboundEvent(client, fixture.actorA, 9_120_000_001, 'a');
        const input = {
          eventId: captureEvent,
          fingerprint: 'a'.repeat(64),
          hmac: payloadHmac('a'),
          masked: '***A120',
          playerId: fixture.playerId,
          providerCode: 'telebirr' as const,
        };
        const proof = (await captureTelegramProof(client, input))[0]!;
        expect(await captureTelegramProof(client, input)).toEqual([
          { ...proof, request_replayed: true },
        ]);
        const duplicateEvent = await createInboundEvent(client, fixture.actorA, 9_120_000_002, 'b');
        expect(
          await captureTelegramProof(client, {
            ...input,
            eventId: duplicateEvent,
            hmac: payloadHmac('b'),
          }),
        ).toEqual([{ ...proof, request_replayed: true }]);
        const statusEvent = await createInboundEvent(client, fixture.actorA, 9_120_000_003, 'c');
        const beforeFinancial = await readFinancialLedgerSnapshot(client);
        const readTrackingState = async () =>
          client.query(`
            select
              (select jsonb_agg(to_jsonb(snapshot_row) order by id)
                 from app.deposit_proof_requests snapshot_row) as proofs,
              (select jsonb_agg(to_jsonb(snapshot_row) order by origin_inbound_event_id)
                 from app.telegram_dry_run_deposit_proof_receipts snapshot_row) as receipts,
              (select jsonb_agg(to_jsonb(snapshot_row) order by id)
                 from app.inbound_events snapshot_row) as inbounds,
              (select jsonb_agg(to_jsonb(snapshot_row) order by id)
                 from app.bot_conversations snapshot_row) as conversations,
              (select count(*)::integer from app.audit_events) as audits,
              (select jsonb_agg(to_jsonb(snapshot_row) order by feature_key)
                 from app.feature_switches snapshot_row) as switches
          `);
        const beforeTracking = await readTrackingState();
        const expected = [
          {
            deposit_proof_request_id: proof.deposit_proof_request_id,
            proof_status: 'proof_received',
            provider_code: 'telebirr',
            submitted_at: proof.submitted_at,
          },
        ];
        for (const eventId of [statusEvent, statusEvent, captureEvent, duplicateEvent]) {
          expect(
            await getTelegramProofStatus(client, eventId, proof.deposit_proof_request_id),
          ).toEqual(expected);
        }
        expect(await readFinancialLedgerSnapshot(client)).toEqual(beforeFinancial);
        expect((await readTrackingState()).rows).toEqual(beforeTracking.rows);
      });
    });

    it('hides foreign, missing, web-origin, unbound, and same-customer other-identity proofs identically', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '121');
        const captureEvent = await createInboundEvent(client, fixture.actorA, 9_121_000_001, 'a');
        const proof = (
          await captureTelegramProof(client, {
            eventId: captureEvent,
            fingerprint: 'a'.repeat(64),
            hmac: payloadHmac('a'),
            masked: '***A121',
            playerId: fixture.playerId,
            providerCode: 'cbe_birr',
          })
        )[0]!;
        const ownerEvent = await createInboundEvent(client, fixture.actorA, 9_121_000_002, 'b');
        const foreignEvent = await createInboundEvent(client, fixture.actorB, 9_121_000_003, 'c');
        const additionalIdentity = await createAdditionalTelegramIdentity(
          client,
          fixture.actorA,
          981_210_004,
        );
        const otherIdentityEvent = await createInboundEvent(
          client,
          additionalIdentity,
          9_121_000_004,
          'd',
        );
        const uninvitedForeignIdentity = await createAdditionalTelegramIdentity(
          client,
          fixture.actorB,
          981_210_005,
        );
        const uninvitedForeignEvent = await createInboundEvent(
          client,
          uninvitedForeignIdentity,
          9_121_000_005,
          'e',
        );
        const webProof = (
          await captureWebProof(client, {
            actorAuthUserId: fixture.actorA.authUserId,
            fingerprint: 'b'.repeat(64),
            masked: '***B121',
            playerId: fixture.playerId,
            providerCode: 'telebirr',
            requestKey: '78000000-0000-4000-8000-000000000121',
          })
        )[0]!;
        const unboundProof = await client.query<ProofRow>(
          `select * from app.create_or_reuse_dry_run_deposit_proof(
             $1::uuid, 'telegram', $2::text, 'telebirr', $3::text,
             $4::text, '***C121', 2::smallint, 2::smallint
           )`,
          [
            fixture.actorA.customerId,
            fixture.playerId,
            referenceCiphertext('telebirr', 'u', 'v'),
            'c'.repeat(64),
          ],
        );
        for (const [eventId, proofId] of [
          [foreignEvent, proof.deposit_proof_request_id],
          [uninvitedForeignEvent, proof.deposit_proof_request_id],
          [otherIdentityEvent, proof.deposit_proof_request_id],
          [ownerEvent, '78000000-0000-4000-8000-999999999999'],
          [ownerEvent, webProof.deposit_proof_request_id],
          [ownerEvent, unboundProof.rows[0]!.deposit_proof_request_id],
        ] as const) {
          expect(await getTelegramProofStatus(client, eventId, proofId)).toEqual([]);
        }
        expect(
          await getTelegramProofStatus(client, ownerEvent, proof.deposit_proof_request_id),
        ).toEqual([
          {
            deposit_proof_request_id: proof.deposit_proof_request_id,
            proof_status: 'proof_received',
            provider_code: 'cbe_birr',
            submitted_at: proof.submitted_at,
          },
        ]);
      });
    });

    it('rejects invalid, wrong-channel, non-Telegram, and deactivated actors with the same generic error', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '122');
        const captureEvent = await createInboundEvent(client, fixture.actorA, 9_122_000_001, 'a');
        const proof = (
          await captureTelegramProof(client, {
            eventId: captureEvent,
            fingerprint: 'a'.repeat(64),
            hmac: payloadHmac('a'),
            masked: '***A122',
            playerId: fixture.playerId,
            providerCode: 'telebirr',
          })
        )[0]!;
        const statusEvent = await createInboundEvent(client, fixture.actorA, 9_122_000_002, 'b');
        const invalidEvents = await client.query<{ readonly id: string }>(
          `insert into app.inbound_events (
             channel, external_event_id, customer_identity_id, payload_digest
           ) values
             ('customer_web', 'proof-status-wrong-channel', $1::uuid, $2::text),
             ('telegram', 'update:9122000003', null, $2::text),
             ('telegram', 'update:9122000004',
               (select customer_identity_id from app.customer_auth_identities where auth_user_id = $3::uuid),
               $2::text)
           returning id`,
          [fixture.actorA.telegramIdentityId, payloadHmac('c'), fixture.actorA.authUserId],
        );
        const genericError = {
          code: 'P0001',
          message: 'The Telegram deposit proof status request is unavailable.',
        };
        for (const eventId of [
          null,
          '78000000-0000-4000-8000-999999999998',
          ...invalidEvents.rows.map((row) => row.id),
        ]) {
          await expect(
            getTelegramProofStatus(client, eventId, proof.deposit_proof_request_id),
          ).rejects.toMatchObject(genericError);
        }
        await expect(getTelegramProofStatus(client, statusEvent, null)).rejects.toMatchObject(
          genericError,
        );
        for (const [relation, actorId] of [
          ['customer_identities', fixture.actorA.telegramIdentityId],
          ['customers', fixture.actorA.customerId],
        ] as const) {
          await client.query(`update app.${relation} set status = 'inactive' where id = $1::uuid`, [
            actorId,
          ]);
          for (const eventId of [statusEvent, captureEvent]) {
            await expect(
              getTelegramProofStatus(client, eventId, proof.deposit_proof_request_id),
            ).rejects.toMatchObject(genericError);
          }
          await client.query(`update app.${relation} set status = 'active' where id = $1::uuid`, [
            actorId,
          ]);
        }
      });
    });

    it('requires the exact Telegram subject, private chat, and original processed receipt binding', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '123');
        const captureEvent = await createInboundEvent(client, fixture.actorA, 9_123_000_001, 'a');
        const proof = (
          await captureTelegramProof(client, {
            eventId: captureEvent,
            fingerprint: 'a'.repeat(64),
            hmac: payloadHmac('a'),
            masked: '***A123',
            playerId: fixture.playerId,
            providerCode: 'telebirr',
          })
        )[0]!;
        const statusEvent = await createInboundEvent(client, fixture.actorA, 9_123_000_002, 'b');
        for (const mutation of [
          `update app.customer_identities set external_subject = 'malformed-subject' where id = $1::uuid`,
          `update app.telegram_identities set private_chat_id = 981230009 where customer_identity_id = $1::uuid`,
        ]) {
          await client.query('savepoint malformed_tracking_identity');
          // Inject corrupt fixtures as the disposable superuser; production bindings remain immutable.
          await client.query('set local session_replication_role = replica');
          await client.query(mutation, [fixture.actorA.telegramIdentityId]);
          await client.query('set local session_replication_role = origin');
          await expect(
            getTelegramProofStatus(client, statusEvent, proof.deposit_proof_request_id),
          ).rejects.toMatchObject({ code: 'P0001' });
          await client.query('rollback to savepoint malformed_tracking_identity');
          await client.query('release savepoint malformed_tracking_identity');
        }
        await client.query('set local session_replication_role = replica');
        await client.query(
          `update app.inbound_events set processed_at = null where id = $1::uuid`,
          [captureEvent],
        );
        await client.query('set local session_replication_role = origin');
        expect(
          await getTelegramProofStatus(client, statusEvent, proof.deposit_proof_request_id),
        ).toEqual([]);
      });
    });
  });

  describe('private amount-free dry-run deposit proof intake', () => {
    it('pins the private schema, exact wrappers, disabled switch, and least-privilege ACLs', async () => {
      const client = getClient();
      const switchRows = await client.query<{
        readonly feature_key: string;
        readonly mode: string;
      }>(`
        select feature_key, mode::text
          from app.feature_switches
         where feature_key in (
           'cbe_birr_authoritative_verification',
           'deposit_execution',
           'payment_verification',
           'telebirr_authoritative_verification'
         )
         order by feature_key
      `);
      expect(switchRows.rows).toEqual([
        { feature_key: 'cbe_birr_authoritative_verification', mode: 'disabled' },
        { feature_key: 'deposit_execution', mode: 'disabled' },
        { feature_key: 'payment_verification', mode: 'disabled' },
        { feature_key: 'telebirr_authoritative_verification', mode: 'disabled' },
      ]);

      const relations = await client.query<{
        readonly non_owner_acl_entries: number;
        readonly policies: number;
        readonly relforcerowsecurity: boolean;
        readonly relname: string;
        readonly relrowsecurity: boolean;
      }>(`
        select relation.relname,
               relation.relrowsecurity,
               relation.relforcerowsecurity,
               (select count(*)::integer
                  from pg_policy policy
                 where policy.polrelid = relation.oid) as policies,
               (select count(*)::integer
                  from aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
                 where acl.grantee <> relation.relowner) as non_owner_acl_entries
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app'
           and relation.relname in (
             'customer_web_dry_run_deposit_proof_receipts',
             'deposit_proof_requests',
             'telegram_dry_run_deposit_proof_receipts'
           )
         order by relation.relname
      `);
      expect(relations.rows).toEqual([
        {
          non_owner_acl_entries: 0,
          policies: 0,
          relforcerowsecurity: true,
          relname: 'customer_web_dry_run_deposit_proof_receipts',
          relrowsecurity: true,
        },
        {
          non_owner_acl_entries: 0,
          policies: 0,
          relforcerowsecurity: true,
          relname: 'deposit_proof_requests',
          relrowsecurity: true,
        },
        {
          non_owner_acl_entries: 0,
          policies: 0,
          relforcerowsecurity: true,
          relname: 'telegram_dry_run_deposit_proof_receipts',
          relrowsecurity: true,
        },
      ]);

      const proofColumns = await client.query<{ readonly column_name: string }>(`
        select column_name
          from information_schema.columns
         where table_schema = 'app'
           and table_name = 'deposit_proof_requests'
         order by ordinal_position
      `);
      expect(proofColumns.rows.map((row) => row.column_name)).toEqual([
        'id',
        'submitting_customer_id',
        'origin_channel',
        'platform_id',
        'player_account_id',
        'player_deposit_eligibility_decision_id',
        'payment_provider_id',
        'provider_code',
        'input_kind',
        'candidate_reference_ciphertext',
        'candidate_reference_fingerprint',
        'candidate_reference_masked',
        'reference_encryption_key_version',
        'reference_profile_version',
        'status',
        'submitted_at',
        'created_at',
      ]);
      expect(
        proofColumns.rows.some((row) =>
          /(?:amount|receiver|evidence|claim|job|raw_reference)/u.test(row.column_name),
        ),
      ).toBe(false);

      const wrappers = await client.query<{
        readonly direct_grantees: readonly string[];
        readonly output_names: readonly string[];
        readonly public_execute: boolean;
        readonly signature: string;
        readonly hardened: boolean;
      }>(`
        select procedure.oid::regprocedure::text as signature,
               procedure.proargnames[(procedure.pronargs + 1):] as output_names,
               procedure.prosecdef
                 and procedure.proowner = 'postgres'::regrole
                 and procedure.proconfig =
                   array['search_path=pg_catalog, app, pg_temp']::text[] as hardened,
               exists (
                 select 1
                   from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
                  where acl.grantee = 0
                    and acl.privilege_type = 'EXECUTE'
               ) as public_execute,
               coalesce((
                 select array_agg(role.rolname::text order by role.rolname)::text[]
                   from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
                   join pg_roles role on role.oid = acl.grantee
                  where acl.privilege_type = 'EXECUTE'
                    and acl.grantee <> procedure.proowner
               ), array[]::text[]) as direct_grantees
          from pg_proc procedure
         where procedure.oid in (
           'app.capture_telegram_dry_run_deposit_proof(uuid,text,text,text,text,text,smallint,smallint,text)'::regprocedure,
           'app.capture_customer_web_dry_run_deposit_proof(uuid,uuid,text,text,text,text,text,smallint,smallint)'::regprocedure
         )
         order by signature
      `);
      expect(wrappers.rows).toEqual([
        {
          direct_grantees: ['fetanagent_customer_web'],
          hardened: true,
          output_names: [
            'deposit_proof_request_id',
            'provider_code',
            'proof_status',
            'submitted_at',
            'request_replayed',
          ],
          public_execute: false,
          signature:
            'app.capture_customer_web_dry_run_deposit_proof(uuid,uuid,text,text,text,text,text,smallint,smallint)',
        },
        {
          direct_grantees: ['fetanagent_player_actions'],
          hardened: true,
          output_names: [
            'deposit_proof_request_id',
            'provider_code',
            'proof_status',
            'submitted_at',
            'request_replayed',
          ],
          public_execute: false,
          signature:
            'app.capture_telegram_dry_run_deposit_proof(uuid,text,text,text,text,text,smallint,smallint,text)',
        },
      ]);

      const internalExecute = await client.query<{ readonly allowed: boolean }>(`
        select has_function_privilege(role_name, procedure_name::regprocedure, 'EXECUTE') as allowed
          from unnest(array['fetanagent_player_actions', 'fetanagent_customer_web']) role_name
          cross join unnest(array[
            'app.require_dry_run_deposit_proof_switches_disabled()',
            'app.resolve_dry_run_deposit_proof_boundary(text,text)',
            'app.create_or_reuse_dry_run_deposit_proof(uuid,text,text,text,text,text,text,smallint,smallint)',
            'app.enforce_telegram_dry_run_proof_receipt_binding()',
            'app.require_telegram_dry_run_proof_receipt_result()'
          ]) procedure_name
      `);
      expect(internalExecute.rows.every((row) => !row.allowed)).toBe(true);
    });

    it('fails closed unless all four financial switches remain disabled', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '101');
        const beforeProofs = await client.query<{ readonly count: number }>(
          `select count(*)::integer as count from app.deposit_proof_requests`,
        );
        await client.query(
          `update app.feature_switches
              set mode = 'dry_run'
            where feature_key = 'payment_verification'`,
        );

        await expect(
          captureWebProof(client, {
            actorAuthUserId: fixture.actorA.authUserId,
            fingerprint: '1'.repeat(64),
            masked: '***A101',
            playerId: fixture.playerId,
            providerCode: 'cbe_birr',
            requestKey: '71000000-0000-4000-8000-000000000101',
          }),
        ).rejects.toThrow('requires every financial switch disabled');

        const afterProofs = await client.query<{ readonly count: number }>(
          `select count(*)::integer as count from app.deposit_proof_requests`,
        );
        expect(afterProofs.rows).toEqual(beforeProofs.rows);
      });
    });

    it('rejects provider-envelope, prefix, and exact version mismatches', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '106');
        const baseInput = {
          actorAuthUserId: fixture.actorA.authUserId,
          fingerprint: '7'.repeat(64),
          masked: '***A106',
          playerId: fixture.playerId,
          providerCode: 'cbe_birr' as const,
        };

        await expect(
          captureWebProof(client, {
            ...baseInput,
            referenceCiphertext: referenceCiphertext('telebirr', 'w', 'x'),
            requestKey: '76000000-0000-4000-8000-000000000106',
          }),
        ).rejects.toThrow('protected dry-run deposit proof is invalid');

        await expect(
          captureWebProof(client, {
            ...baseInput,
            referenceCiphertext: `v1.cbe_birr.${'w'.repeat(16)}.${'x'.repeat(22)}.syntheticref`,
            requestKey: '76000000-0000-4000-8000-000000000107',
          }),
        ).rejects.toThrow('protected dry-run deposit proof is invalid');

        await expect(
          captureWebProof(client, {
            ...baseInput,
            referenceCiphertext: `v2.${'w'.repeat(16)}.${'x'.repeat(22)}.syntheticref`,
            requestKey: '76000000-0000-4000-8000-000000000108',
          }),
        ).rejects.toThrow('protected dry-run deposit proof is invalid');

        await expect(
          captureWebProof(client, {
            ...baseInput,
            referenceCiphertext: `v2.cbe_birr.extra.${'w'.repeat(16)}.${'x'.repeat(22)}.syntheticref`,
            requestKey: '76000000-0000-4000-8000-000000000109',
          }),
        ).rejects.toThrow('protected dry-run deposit proof is invalid');

        await expect(
          captureWebProof(client, {
            ...baseInput,
            referenceCiphertext: `v2.cbe_birr.${'w'.repeat(16)}.${'x'.repeat(22)}.short`,
            requestKey: '76000000-0000-4000-8000-000000000116',
          }),
        ).rejects.toThrow('protected dry-run deposit proof is invalid');

        await expect(
          captureWebProof(client, {
            ...baseInput,
            referenceCiphertext: `v2.cbe_birr.${'w'.repeat(16)}.${'x'.repeat(22)}.${'z'.repeat(44)}`,
            requestKey: '76000000-0000-4000-8000-000000000117',
          }),
        ).rejects.toThrow('protected dry-run deposit proof is invalid');

        for (const [requestKey, versionOverrides] of [
          ['76000000-0000-4000-8000-000000000110', { referenceKeyVersion: 1 }],
          ['76000000-0000-4000-8000-000000000111', { referenceProfileVersion: 3 }],
          ['76000000-0000-4000-8000-000000000112', { referenceKeyVersion: null }],
          ['76000000-0000-4000-8000-000000000113', { referenceProfileVersion: null }],
        ] as const) {
          await expect(
            captureWebProof(client, {
              ...baseInput,
              ...versionOverrides,
              requestKey,
            }),
          ).rejects.toThrow('protected dry-run deposit proof is invalid');
        }

        await expect(
          captureWebProof(client, {
            ...baseInput,
            masked: '***A-06',
            requestKey: '76000000-0000-4000-8000-000000000114',
          }),
        ).rejects.toThrow('protected dry-run deposit proof is invalid');

        const exactArguments = [
          fixture.actorA.authUserId,
          '76000000-0000-4000-8000-000000000115',
          fixture.playerId,
          'cbe_birr',
          referenceCiphertext('cbe_birr', 'w', 'x'),
          baseInput.fingerprint,
          baseInput.masked,
          2,
        ] as const;
        await expect(
          queryAsRole(
            client,
            'fetanagent_customer_web',
            `select *
               from app.capture_customer_web_dry_run_deposit_proof(
                 $1::uuid, $2::uuid, $3::text, $4::text, $5::text,
                 $6::text, $7::text, $8::smallint
               )`,
            exactArguments,
          ),
        ).rejects.toThrow('does not exist');
        await expect(
          queryAsRole(
            client,
            'fetanagent_customer_web',
            `select *
               from app.capture_customer_web_dry_run_deposit_proof(
                 $1::uuid, $2::uuid, $3::text, $4::text, $5::text,
                 $6::text, $7::text, $8::smallint, 2::smallint, 2::smallint
               )`,
            exactArguments,
          ),
        ).rejects.toThrow('does not exist');

        const proofCount = await client.query<{ readonly count: number }>(
          `select count(*)::integer as count
             from app.deposit_proof_requests
            where submitting_customer_id = $1::uuid`,
          [fixture.actorA.customerId],
        );
        expect(proofCount.rows).toEqual([{ count: 0 }]);
      });
    });

    it('captures a cross-customer global eligible destination without ownership reassignment or financial writes', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '102');
        const beforeFinancial = await readFinancialLedgerSnapshot(client);
        const result = await captureWebProof(client, {
          actorAuthUserId: fixture.actorA.authUserId,
          fingerprint: '2'.repeat(64),
          masked: '***A102',
          playerId: fixture.playerId,
          providerCode: 'telebirr',
          requestKey: '72000000-0000-4000-8000-000000000102',
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          proof_status: 'proof_received',
          provider_code: 'telebirr',
          request_replayed: false,
        });
        expect(result[0]!.submitted_at).toBeInstanceOf(Date);

        const proof = await client.query<{
          readonly input_kind: string;
          readonly origin_channel: string;
          readonly player_account_id: string;
          readonly player_owner_customer_id: string;
          readonly provider_code: string;
          readonly status: string;
          readonly submitting_customer_id: string;
        }>(
          `select proof_request.submitting_customer_id,
                  proof_request.origin_channel,
                  proof_request.player_account_id,
                  proof_request.provider_code,
                  proof_request.input_kind,
                  proof_request.status,
                  player_account.customer_id as player_owner_customer_id
             from app.deposit_proof_requests proof_request
             join app.customer_platform_players player_account
               on player_account.id = proof_request.player_account_id
            where proof_request.id = $1::uuid`,
          [result[0]!.deposit_proof_request_id],
        );
        expect(proof.rows).toEqual([
          {
            input_kind: 'direct_transaction_id',
            origin_channel: 'customer_web',
            player_account_id: fixture.playerAccountId,
            player_owner_customer_id: fixture.playerOwnerCustomerId,
            provider_code: 'telebirr',
            status: 'proof_received',
            submitting_customer_id: fixture.actorA.customerId,
          },
        ]);
        expect(fixture.actorA.customerId).not.toBe(fixture.playerOwnerCustomerId);

        const playerOwner = await client.query<{ readonly customer_id: string }>(
          `select customer_id
             from app.customer_platform_players
            where id = $1::uuid`,
          [fixture.playerAccountId],
        );
        expect(playerOwner.rows).toEqual([{ customer_id: fixture.playerOwnerCustomerId }]);
        expect(await readFinancialLedgerSnapshot(client)).toEqual(beforeFinancial);
      });
    });

    it('makes Telegram origin replay exact and rejects a conflicting origin or destination', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '103');
        const firstEvent = await createInboundEvent(client, fixture.actorA, 9_103_000_001, '3');
        const input = {
          eventId: firstEvent,
          fingerprint: '3'.repeat(64),
          hmac: payloadHmac('3'),
          masked: '***A103',
          playerId: fixture.playerId,
          providerCode: 'cbe_birr' as const,
        };
        const first = await captureTelegramProof(client, input);
        const replay = await captureTelegramProof(client, input);

        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
          proof_status: 'proof_received',
          provider_code: 'cbe_birr',
          request_replayed: false,
        });
        expect(replay).toEqual([{ ...first[0]!, request_replayed: true }]);

        await expect(
          captureTelegramProof(client, { ...input, providerCode: 'telebirr' }),
        ).rejects.toThrow('conflicts with its receipt');

        await client.query(
          `insert into app.player_deposit_eligibility_decisions (
             player_account_id, decision_version, decision, reason_code, actor_kind,
             player_account_updated_at_snapshot, decided_at, created_at
           )
           select player_account.id, 2, 'eligible', 'financial_eligibility_approved', 'system',
                  player_account.updated_at, statement_timestamp(), statement_timestamp()
             from app.customer_platform_players player_account
            where player_account.id = $1::uuid`,
          [fixture.playerAccountId],
        );

        const secondEvent = await createInboundEvent(client, fixture.actorA, 9_103_000_002, '4');
        const reused = await captureTelegramProof(client, {
          ...input,
          eventId: secondEvent,
          hmac: payloadHmac('4'),
        });
        expect(reused).toEqual([{ ...first[0]!, request_replayed: true }]);

        const thirdEvent = await createInboundEvent(client, fixture.actorA, 9_103_000_003, '5');
        await expect(
          captureTelegramProof(client, {
            ...input,
            eventId: thirdEvent,
            hmac: payloadHmac('5'),
            playerId: fixture.alternatePlayerId,
          }),
        ).rejects.toThrow('conflicts with an existing destination');

        const counts = await client.query<{
          readonly audit_events: number;
          readonly proofs: number;
          readonly receipts: number;
        }>(
          `select
             (select count(*)::integer
                from app.deposit_proof_requests proof_request
               where proof_request.submitting_customer_id = $1::uuid) as proofs,
             (select count(*)::integer
                from app.telegram_dry_run_deposit_proof_receipts receipt
               where receipt.submitting_customer_id = $1::uuid) as receipts,
             (select count(*)::integer
                from app.audit_events audit_event
               where audit_event.actor_customer_id = $1::uuid
                 and audit_event.action = 'deposit.dry_run_proof_received') as audit_events`,
          [fixture.actorA.customerId],
        );
        expect(counts.rows).toEqual([{ audit_events: 1, proofs: 1, receipts: 2 }]);
      });
    });

    it('atomically binds Telegram proof receipts to processed events and blocks competing results', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '107');
        const beforeFinancial = await readFinancialLedgerSnapshot(client);
        const eventId = await createInboundEvent(client, fixture.actorA, 9_107_000_001, '7');
        await client.query(
          `update app.inbound_events
              set processing_error_code = 'synthetic_retry'
            where id = $1::uuid`,
          [eventId],
        );

        const input = {
          eventId,
          fingerprint: '7'.repeat(64),
          hmac: payloadHmac('7'),
          masked: '***A107',
          playerId: fixture.playerId,
          providerCode: 'telebirr' as const,
        };
        const first = await captureTelegramProof(client, input);
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
          proof_status: 'proof_received',
          provider_code: 'telebirr',
          request_replayed: false,
        });

        const binding = await client.query<{
          readonly processed_at: string;
          readonly processed_matches_receipt: boolean;
          readonly processing_error_code: string | null;
          readonly receipt_created_at: string;
        }>(
          `select inbound_event.processed_at::text as processed_at,
                  receipt.created_at::text as receipt_created_at,
                  inbound_event.processed_at = receipt.created_at
                    as processed_matches_receipt,
                  inbound_event.processing_error_code
             from app.inbound_events inbound_event
             join app.telegram_dry_run_deposit_proof_receipts receipt
               on receipt.origin_inbound_event_id = inbound_event.id
            where inbound_event.id = $1::uuid`,
          [eventId],
        );
        expect(binding.rows).toHaveLength(1);
        expect(binding.rows[0]).toMatchObject({
          processed_matches_receipt: true,
          processing_error_code: null,
        });
        expect(binding.rows[0]!.processed_at).toBe(binding.rows[0]!.receipt_created_at);

        const replay = await captureTelegramProof(client, input);
        expect(replay).toEqual([{ ...first[0]!, request_replayed: true }]);
        const bindingAfterReplay = await client.query<{
          readonly processed_at: string;
          readonly processed_matches_receipt: boolean;
          readonly processing_error_code: string | null;
          readonly receipt_created_at: string;
        }>(
          `select inbound_event.processed_at::text as processed_at,
                  receipt.created_at::text as receipt_created_at,
                  inbound_event.processed_at = receipt.created_at
                    as processed_matches_receipt,
                  inbound_event.processing_error_code
             from app.inbound_events inbound_event
             join app.telegram_dry_run_deposit_proof_receipts receipt
               on receipt.origin_inbound_event_id = inbound_event.id
            where inbound_event.id = $1::uuid`,
          [eventId],
        );
        expect(bindingAfterReplay.rows).toEqual(binding.rows);

        await expect(
          withSavepoint(client, async () => {
            await client.query(
              `insert into app.inbound_event_consumptions (
                 origin_inbound_event_id,
                 customer_identity_id,
                 customer_id,
                 conversation_id,
                 consumer_kind,
                 semantic_input_hmac,
                 outcome,
                 outcome_reason_code,
                 conversation_version_before,
                 conversation_version_after
               )
               select $1::uuid,
                      customer_identity.id,
                      customer_identity.customer_id,
                      conversation.id,
                      'issue_player_registration_capability',
                      $2::text,
                      'completed',
                      'capability_issued',
                      conversation.version,
                      conversation.version
                 from app.customer_identities customer_identity
                 join app.bot_conversations conversation
                   on conversation.telegram_identity_id = customer_identity.id
                where customer_identity.id = $3::uuid`,
              [eventId, input.hmac, fixture.actorA.telegramIdentityId],
            );
          }),
        ).rejects.toThrow('already a dry-run deposit proof');

        await expect(
          withSavepoint(client, async () => {
            await client.query(
              `insert into app.telegram_live_deposit_request_receipts (
                 origin_inbound_event_id,
                 customer_identity_id,
                 customer_id,
                 conversation_id,
                 request_kind,
                 semantic_input_hmac,
                 deposit_intent_id,
                 player_id,
                 expected_amount_minor,
                 conversation_version
               )
               select $1::uuid,
                      customer_identity.id,
                      customer_identity.customer_id,
                      conversation.id,
                      'open_intent',
                      $2::text,
                      '77000000-0000-4000-8000-000000000107'::uuid,
                      $3::text,
                      25::bigint,
                      conversation.version
                 from app.customer_identities customer_identity
                 join app.bot_conversations conversation
                   on conversation.telegram_identity_id = customer_identity.id
                where customer_identity.id = $4::uuid`,
              [eventId, input.hmac, fixture.playerId, fixture.actorA.telegramIdentityId],
            );
          }),
        ).rejects.toThrow('already a dry-run deposit proof');

        const competingResults = await client.query<{
          readonly action_receipts: number;
          readonly live_deposit_receipts: number;
        }>(
          `select
             (select count(*)::integer
                from app.inbound_event_consumptions consumption
               where consumption.origin_inbound_event_id = $1::uuid) as action_receipts,
             (select count(*)::integer
                from app.telegram_live_deposit_request_receipts live_receipt
               where live_receipt.origin_inbound_event_id = $1::uuid) as live_deposit_receipts`,
          [eventId],
        );
        expect(competingResults.rows).toEqual([{ action_receipts: 0, live_deposit_receipts: 0 }]);

        const failedEventId = await createInboundEvent(client, fixture.actorA, 9_107_000_002, '8');
        await expect(
          captureTelegramProof(client, {
            ...input,
            eventId: failedEventId,
            hmac: payloadHmac('8'),
            playerId: fixture.alternatePlayerId,
          }),
        ).rejects.toThrow('conflicts with an existing destination');

        const failedState = await client.query<{
          readonly audit_events: number;
          readonly processed_at: Date | null;
          readonly proof_receipts: number;
          readonly proofs: number;
        }>(
          `select inbound_event.processed_at,
                  (select count(*)::integer
                     from app.telegram_dry_run_deposit_proof_receipts receipt
                    where receipt.origin_inbound_event_id = inbound_event.id) as proof_receipts,
                  (select count(*)::integer
                     from app.deposit_proof_requests proof_request
                    where proof_request.submitting_customer_id = $2::uuid) as proofs,
                  (select count(*)::integer
                     from app.audit_events audit_event
                    where audit_event.actor_customer_id = $2::uuid
                      and audit_event.action = 'deposit.dry_run_proof_received') as audit_events
             from app.inbound_events inbound_event
            where inbound_event.id = $1::uuid`,
          [failedEventId, fixture.actorA.customerId],
        );
        expect(failedState.rows).toEqual([
          { audit_events: 1, processed_at: null, proof_receipts: 0, proofs: 1 },
        ]);
        expect(await readFinancialLedgerSnapshot(client)).toEqual(beforeFinancial);
      });
    });

    it('keeps candidate fingerprints provider-separated and customer-web request keys exact', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '104');
        const sharedFingerprint = '4'.repeat(64);
        const cbeInput = {
          actorAuthUserId: fixture.actorA.authUserId,
          fingerprint: sharedFingerprint,
          masked: '***A104',
          playerId: fixture.playerId,
          providerCode: 'cbe_birr' as const,
          requestKey: '74000000-0000-4000-8000-000000000104',
        };
        const cbe = await captureWebProof(client, cbeInput);
        const telebirr = await captureWebProof(client, {
          ...cbeInput,
          providerCode: 'telebirr',
          requestKey: '74000000-0000-4000-8000-000000000105',
        });
        const cbeReplay = await captureWebProof(client, cbeInput);

        expect(cbe[0]!.deposit_proof_request_id).not.toBe(telebirr[0]!.deposit_proof_request_id);
        expect(cbe[0]).toMatchObject({ provider_code: 'cbe_birr', request_replayed: false });
        expect(telebirr[0]).toMatchObject({
          provider_code: 'telebirr',
          request_replayed: false,
        });
        expect(cbeReplay).toEqual([{ ...cbe[0]!, request_replayed: true }]);

        await expect(
          captureWebProof(client, {
            ...cbeInput,
            fingerprint: '5'.repeat(64),
          }),
        ).rejects.toThrow('conflicts with its receipt');

        const providers = await client.query<{ readonly provider_code: string }>(
          `select payment_provider.code as provider_code
             from app.deposit_proof_requests proof_request
             join app.payment_providers payment_provider
               on payment_provider.id = proof_request.payment_provider_id
            where proof_request.submitting_customer_id = $1::uuid
              and proof_request.candidate_reference_fingerprint = $2::text
            order by payment_provider.code`,
          [fixture.actorA.customerId, sharedFingerprint],
        );
        expect(providers.rows).toEqual([
          { provider_code: 'cbe_birr' },
          { provider_code: 'telebirr' },
        ]);
      });
    });

    it('allows cross-customer unverified proofs without creating a global payment claim', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '105');
        const beforeFinancial = await readFinancialLedgerSnapshot(client);
        const sharedFingerprint = '6'.repeat(64);
        const first = await captureWebProof(client, {
          actorAuthUserId: fixture.actorA.authUserId,
          fingerprint: sharedFingerprint,
          masked: '***A105',
          playerId: fixture.playerId,
          providerCode: 'telebirr',
          requestKey: '75000000-0000-4000-8000-000000000105',
        });
        const second = await captureWebProof(client, {
          actorAuthUserId: fixture.actorB.authUserId,
          fingerprint: sharedFingerprint,
          masked: '***A105',
          playerId: fixture.playerId,
          providerCode: 'telebirr',
          requestKey: '75000000-0000-4000-8000-000000000106',
        });

        expect(first[0]!.deposit_proof_request_id).not.toBe(second[0]!.deposit_proof_request_id);
        const proofOwners = await client.query<{ readonly submitting_customer_id: string }>(
          `select proof_request.submitting_customer_id
             from app.deposit_proof_requests proof_request
             join app.payment_providers payment_provider
               on payment_provider.id = proof_request.payment_provider_id
            where payment_provider.code = 'telebirr'
              and proof_request.candidate_reference_fingerprint = $1::text
              and proof_request.submitting_customer_id in ($2::uuid, $3::uuid)
            order by proof_request.submitting_customer_id`,
          [sharedFingerprint, fixture.actorA.customerId, fixture.actorB.customerId],
        );
        expect(proofOwners.rows.map((row) => row.submitting_customer_id).sort()).toEqual(
          [fixture.actorA.customerId, fixture.actorB.customerId].sort(),
        );
        expect(await readFinancialLedgerSnapshot(client)).toEqual(beforeFinancial);
      });
    });
  });
}
