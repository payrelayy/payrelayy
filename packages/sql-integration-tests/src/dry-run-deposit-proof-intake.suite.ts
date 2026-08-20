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
  role: 'fetanagent_customer_web' | 'fetanagent_player_actions',
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
    [`proof-admission:${telegramUserId}`, telegramIdentityId, payloadHmac(tokenCharacter)],
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

  await client.query(
    `insert into app.telegram_beta_invites (
       token_digest, status, expires_at, issued_by_admin_id, created_at,
       redeemed_telegram_user_id, redeemed_private_chat_id,
       redeemed_customer_id, redeemed_customer_identity_id,
       redeemed_inbound_event_id, redeemed_at
     ) values (
       $1::text, 'redeemed', clock_timestamp() + interval '1 hour',
       $2::uuid, clock_timestamp() - interval '10 minutes',
       $3::bigint, $3::bigint, $4::uuid, $5::uuid, $6::uuid,
       clock_timestamp() - interval '5 minutes'
     )`,
    [
      `sha256-v1:${tokenCharacter.repeat(64)}`,
      issuingAdmin.rows[0]!.id,
      telegramUserId,
      customerId,
      telegramIdentityId,
      admissionEvent.rows[0]!.id,
    ],
  );

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
  externalEventId: string,
  hmacCharacter: string,
): Promise<string> {
  const event = await client.query<{ readonly id: string }>(
    `insert into app.inbound_events (
       channel, external_event_id, customer_identity_id, payload_digest
     ) values ('telegram', $1::text, $2::uuid, $3::text)
     returning id`,
    [externalEventId, actor.telegramIdentityId, payloadHmac(hmacCharacter)],
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
        const firstEvent = await createInboundEvent(
          client,
          fixture.actorA,
          'proof-telegram:103:first',
          '3',
        );
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

        const secondEvent = await createInboundEvent(
          client,
          fixture.actorA,
          'proof-telegram:103:second',
          '4',
        );
        const reused = await captureTelegramProof(client, {
          ...input,
          eventId: secondEvent,
          hmac: payloadHmac('4'),
        });
        expect(reused).toEqual([{ ...first[0]!, request_replayed: true }]);

        const thirdEvent = await createInboundEvent(
          client,
          fixture.actorA,
          'proof-telegram:103:third',
          '5',
        );
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
        const eventId = await createInboundEvent(
          client,
          fixture.actorA,
          'proof-telegram:107:success',
          '7',
        );
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

        const failedEventId = await createInboundEvent(
          client,
          fixture.actorA,
          'proof-telegram:107:failure',
          '8',
        );
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
