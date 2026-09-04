import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const groupRole = 'fetanagent_companion_device_bridge';
const runtimeRole = 'fetanagent_companion_device_bridge_runtime';
const ownerIssueFunction = 'app.issue_agent_platform_companion_pairing(uuid,uuid,text,text)';
const ownerRevokeFunction = 'app.revoke_agent_platform_companion_device(uuid,uuid,uuid,text)';
const bridgeFunctions = [
  'app.claim_agent_platform_companion_pairing(uuid,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text)',
  'app.complete_agent_platform_companion_pairing(text,text,text,text,jsonb)',
  'app.release_agent_platform_companion_pairing(text)',
  'app.claim_agent_platform_companion_lookup_assignment(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text)',
  'app.complete_agent_platform_companion_lookup_assignment(text,text,text,jsonb)',
  'app.release_agent_platform_companion_lookup_assignment(text)',
  'app.accept_agent_platform_companion_lookup_result(text,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb,jsonb)',
] as const;
const tables = [
  'agent_platform_companion_device_revocations',
  'agent_platform_companion_enrollment_certificates',
  'agent_platform_companion_pairing_challenges',
  'agent_platform_companion_server_signer_revocations',
  'agent_platform_companion_server_signers',
] as const;

type IssuedRow = {
  readonly expires_at: Date;
  readonly issued_at: Date;
  readonly minimum_companion_version: string;
  readonly pairing_id: string;
  readonly pairing_nonce_digest: string;
  readonly replayed: boolean;
  readonly server_signing_public_key_spki: string;
  readonly server_signing_public_key_spki_sha256: string;
  readonly signer_key_id: string;
};

type ClaimRow = {
  readonly certificate_body: Record<string, unknown> | null;
  readonly claim_state: 'claimed' | 'completed' | 'in_progress';
  readonly signed_certificate: Record<string, unknown> | null;
};

function sha(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function signature(byte: number): string {
  const bytes = Buffer.alloc(64, byte);
  try {
    return bytes.toString('base64url');
  } finally {
    bytes.fill(0);
  }
}

async function withRollback(client: Client, body: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await body();
  } finally {
    await client.query('rollback');
  }
}

export function registerCompanionDevicePairingSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('provider-neutral Windows companion pairing database boundary', () => {
    it('creates one dormant, non-settable, function-only runtime edge', async () => {
      const client = getClient();
      const roles = await client.query(`
        select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
               rolreplication, rolbypassrls, rolconnlimit,
               rolvaliduntil = 'infinity'::timestamptz as continuous_lifetime
          from pg_roles
         where rolname in ('${groupRole}', '${runtimeRole}')
         order by rolname
      `);
      expect(roles.rows).toEqual([
        {
          rolname: groupRole,
          rolcanlogin: false,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolconnlimit: 2,
          continuous_lifetime: true,
        },
        {
          rolname: runtimeRole,
          rolcanlogin: false,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolconnlimit: 1,
          continuous_lifetime: true,
        },
      ]);

      const memberships = await client.query(`
        select granted.rolname as group_role, member.rolname as member_role,
               membership.inherit_option, membership.set_option, membership.admin_option
          from pg_auth_members membership
          join pg_roles granted on granted.oid = membership.roleid
          join pg_roles member on member.oid = membership.member
         where granted.rolname in ('${groupRole}', '${runtimeRole}')
            or member.rolname in ('${groupRole}', '${runtimeRole}')
      `);
      expect(memberships.rows).toEqual([
        {
          group_role: groupRole,
          member_role: runtimeRole,
          inherit_option: true,
          set_option: false,
          admin_option: false,
        },
      ]);

      const routines = await client.query(`
        select routine.oid::regprocedure::text as signature,
               routine.prosecdef
                 and routine.proowner = 'postgres'::regrole
                 and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened
          from pg_proc routine
          join pg_namespace namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'app'
           and has_function_privilege('${groupRole}', routine.oid, 'EXECUTE')
         order by signature
      `);
      expect(routines.rows).toEqual(
        [...bridgeFunctions].sort().map((signature) => ({ signature, hardened: true })),
      );
      expect(
        await client.query(`select
          has_function_privilege('fetanagent_owner_control', '${ownerIssueFunction}', 'EXECUTE')
            as issue_allowed,
          has_function_privilege('fetanagent_owner_control', '${ownerRevokeFunction}', 'EXECUTE')
            as revoke_allowed,
          has_function_privilege('${groupRole}', '${ownerIssueFunction}', 'EXECUTE')
            as bridge_can_issue
        `),
      ).toMatchObject({
        rows: [{ issue_allowed: true, revoke_allowed: true, bridge_can_issue: false }],
      });
    });

    it('forces RLS, exposes no base storage, and defines no financial authority column', async () => {
      const client = getClient();
      const rls = await client.query(
        `select relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
           from pg_class relation
           join pg_namespace namespace on namespace.oid = relation.relnamespace
          where namespace.nspname = 'app' and relation.relname = any($1::text[])
          order by relation.relname`,
        [[...tables]],
      );
      expect(rls.rows).toEqual(
        [...tables].sort().map((relname) => ({
          relname,
          relrowsecurity: true,
          relforcerowsecurity: true,
        })),
      );
      const boundary = await client.query(`
        select
          exists (
            select 1 from pg_class relation
            join pg_namespace namespace on namespace.oid = relation.relnamespace
            where namespace.nspname = 'app'
              and relation.relkind in ('r','p','v','m','f')
              and has_table_privilege(
                '${groupRole}', relation.oid,
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
              )
          ) as base_access,
          exists (
            select 1 from information_schema.columns
            where table_schema = 'app'
              and table_name = any(array[${tables.map((name) => `'${name}'`).join(',')}])
              and column_name ~ '(amount|balance|transfer|settlement|player|credential|password)'
          ) as financial_column,
          exists (
            select 1 from information_schema.columns
            where table_schema = 'app'
              and table_name = 'agent_platform_companion_pairing_challenges'
              and column_name = 'pairing_nonce'
          ) as raw_nonce_column
      `);
      expect(boundary.rows).toEqual([
        { base_access: false, financial_column: false, raw_nonce_column: false },
      ]);
    });

    it('issues once, permanently binds one device key, recovers a lost response, and revokes it', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const signerPublicKey = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }));
        const signerId = randomUUID();
        const signerKeyId = `sql-companion-signer-${randomUUID().slice(0, 8)}`;
        const signerPublicKeySpki = signerPublicKey.toString('base64url');
        const signerPublicKeyDigest = sha(signerPublicKey);
        signerPublicKey.fill(0);
        await client.query(
          `insert into app.agent_platform_companion_server_signers (
             id, signer_key_id, public_key_spki, public_key_spki_sha256,
             signature_algorithm, signature_encoding, valid_from, valid_until
           ) values ($1::uuid, $2::text, $3::text, $4::text,
             'ecdsa-p256-sha256', 'ieee-p1363-base64url',
             clock_timestamp() - interval '5 minutes', clock_timestamp() + interval '730 days')`,
          [signerId, signerKeyId, signerPublicKeySpki, signerPublicKeyDigest],
        );

        const requestId = randomUUID();
        const ownerAdminId = getOwnerAdminId();
        const issueValues = [ownerAdminId, requestId, signerKeyId, '0.1.4'] as const;
        const issueSql = `select * from app.issue_agent_platform_companion_pairing(
          $1::uuid, $2::uuid, $3::text, $4::text
        )`;
        const issued = await client.query<IssuedRow>(issueSql, [...issueValues]);
        expect(issued.rows).toHaveLength(1);
        expect(issued.rows[0]).toMatchObject({
          signer_key_id: signerKeyId,
          minimum_companion_version: '0.1.4',
          replayed: false,
          server_signing_public_key_spki: signerPublicKeySpki,
          server_signing_public_key_spki_sha256: signerPublicKeyDigest,
        });
        const replay = await client.query<IssuedRow>(issueSql, [...issueValues]);
        expect(replay.rows[0]).toMatchObject({
          pairing_id: issued.rows[0]!.pairing_id,
          replayed: true,
        });

        const devicePair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const devicePublicKey = Buffer.from(
          devicePair.publicKey.export({ format: 'der', type: 'spki' }),
        );
        const devicePublicKeySpki = devicePublicKey.toString('base64url');
        const devicePublicKeyDigest = sha(devicePublicKey);
        devicePublicKey.fill(0);
        const bodyDigest = sha(`sql-companion-request:${randomUUID()}`);
        const deviceId = `sql-companion-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
        const deviceKeyId = `sql-companion-key-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
        const assessedAt = new Date();
        assessedAt.setMilliseconds(Math.floor(assessedAt.getMilliseconds()));
        const claimValues = [
          issued.rows[0]!.pairing_id,
          issued.rows[0]!.pairing_nonce_digest,
          bodyDigest,
          deviceId,
          deviceKeyId,
          devicePublicKeySpki,
          devicePublicKeyDigest,
          '0.1.4',
          issued.rows[0]!.issued_at,
          issued.rows[0]!.expires_at,
          assessedAt,
          signerKeyId,
        ] as const;
        const claimSql = `select * from app.claim_agent_platform_companion_pairing(
          $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
          $7::text, $8::text, $9::timestamptz, $10::timestamptz,
          $11::timestamptz, $12::text
        )`;
        const wrongDigest = [...claimValues];
        wrongDigest[6] = sha(`wrong-device-key:${randomUUID()}`);
        expect((await client.query<ClaimRow>(claimSql, wrongDigest)).rows).toHaveLength(0);

        const claimed = await client.query<ClaimRow>(claimSql, [...claimValues]);
        expect(claimed.rows).toHaveLength(1);
        expect(claimed.rows[0]!.claim_state).toBe('claimed');
        const certificateBody = claimed.rows[0]!.certificate_body!;
        expect(certificateBody).toMatchObject({
          pairingId: issued.rows[0]!.pairing_id,
          pairingConsumed: true,
          deviceId,
          deviceKeyId,
          devicePlatform: 'windows',
          companionVersion: '0.1.4',
          depositAllowed: false,
          transferAllowed: false,
          settlementAllowed: false,
          moneyMovementAllowed: false,
          transferDisabled: true,
        });
        expect(certificateBody).not.toHaveProperty('lookupAllowed');
        expect((await client.query<ClaimRow>(claimSql, [...claimValues])).rows).toEqual([
          { claim_state: 'in_progress', certificate_body: null, signed_certificate: null },
        ]);
        expect(
          (
            await client.query<{ readonly released: boolean }>(
              'select app.release_agent_platform_companion_pairing($1::text) as released',
              [bodyDigest],
            )
          ).rows,
        ).toEqual([{ released: true }]);
        const reclaimed = await client.query<ClaimRow>(claimSql, [...claimValues]);
        expect(reclaimed.rows[0]).toMatchObject({
          claim_state: 'claimed',
          certificate_body: certificateBody,
        });

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
          [bodyDigest, certificateBodyDigest, signerKeyId, certificateSignature, certificate],
        );
        expect(completed.rows).toEqual([{ completed: true }]);
        const recovered = await client.query<ClaimRow>(claimSql, [...claimValues]);
        expect(recovered.rows).toEqual([
          {
            claim_state: 'completed',
            certificate_body: certificateBody,
            signed_certificate: certificate,
          },
        ]);

        const certificateId = String(certificateBody.certificateId);
        const revocationRequestId = randomUUID();
        const revoked = await client.query(
          `select * from app.revoke_agent_platform_companion_device(
             $1::uuid, $2::uuid, $3::uuid, 'owner_requested'
           )`,
          [ownerAdminId, certificateId, revocationRequestId],
        );
        expect(revoked.rows).toMatchObject([
          { certificate_id: certificateId, reason: 'owner_requested', replayed: false },
        ]);
        expect((await client.query<ClaimRow>(claimSql, [...claimValues])).rows).toHaveLength(0);
      });
    });

    it('rejects an unprovisioned runtime session even though the group grant is inherited', async () => {
      const client = getClient();
      let failure: unknown;
      try {
        await client.query(`set session authorization ${runtimeRole}`);
        await client.query(`select app.release_agent_platform_companion_pairing($1::text)`, [
          sha(`unprovisioned:${randomUUID()}`),
        ]);
      } catch (error) {
        failure = error;
      } finally {
        await client.query('reset session authorization');
      }
      expect(failure).toBeInstanceOf(Error);
      expect(failure instanceof Error ? failure.message : String(failure)).toMatch(
        /session is not currently authorized/iu,
      );
    });
  });
}
