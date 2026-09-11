import { readFileSync } from 'node:fs';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const applicationRoles = [
  'fetanagent_beta_admission_runtime',
  'fetanagent_customer_web_runtime',
  'fetanagent_owner_control_runtime',
  'fetanagent_player_actions_runtime',
] as const;
const sql = readFileSync(
  new URL('../../../infra/sql/staging-runtimes-enable-continuous.sql', import.meta.url),
  'utf8',
)
  .replace(/^\\.*$/gm, '')
  .replace(/^begin transaction isolation level read committed;\s*$/m, '')
  .replace(/^commit;\s*$/m, '');

async function prepare(client: Client): Promise<void> {
  for (const role of applicationRoles) {
    // These names are fixed source constants in the isolated disposable database.
    await client.query(`alter role ${role} login password 'synthetic-continuity-test-only'`);
    await client.query(`do $test$ begin execute format(
      'alter role ${role} valid until %L', clock_timestamp() + interval '24 hours'
    ); end $test$`);
  }
}

async function installArmedDryRunPilotFixture(
  client: Client,
): Promise<{ readonly configurationDigest: string; readonly pilotRevisionId: string }> {
  const configurationDigest = `sha256:${'a'.repeat(64)}`;
  await client.query("set local session_replication_role = 'replica'");
  const pilot = await client.query<{ readonly id: string }>(
    `
    insert into app.private_live_deposit_pilot_revisions (
      prepare_request_key,
      prepare_request_digest,
      configuration_digest,
      status,
      platform_id,
      platform_agent_account_id,
      platform_agent_label_snapshot,
      platform_agent_updated_at_snapshot,
      minimum_amount_minor,
      maximum_per_deposit_minor,
      maximum_per_player_minor,
      maximum_aggregate_minor,
      maximum_reservation_count,
      active_from,
      expires_at,
      created_by_admin_id,
      armed_by_admin_id,
      armed_at
    ) values (
      pg_catalog.gen_random_uuid(),
      $1::text,
      $2::text,
      'armed',
      pg_catalog.gen_random_uuid(),
      pg_catalog.gen_random_uuid(),
      'continuous-availability-test-agent',
      pg_catalog.clock_timestamp(),
      2500,
      2500,
      2500,
      12500,
      5,
      pg_catalog.clock_timestamp() - interval '3 hours',
      pg_catalog.clock_timestamp() - interval '1 hour',
      pg_catalog.gen_random_uuid(),
      pg_catalog.gen_random_uuid(),
      pg_catalog.clock_timestamp()
    )
    returning id
  `,
    [`sha256:${'b'.repeat(64)}`, configurationDigest],
  );
  expect(pilot.rows).toHaveLength(1);
  const pilotRevisionId = pilot.rows[0]!.id;
  await client.query(`
    update app.feature_switches
       set mode = 'disabled', settings = '{}'::jsonb
     where feature_key in (
       'payment_verification',
       'deposit_execution',
       'withdrawal_validation',
       'withdrawal_collection',
       'cbe_birr_authoritative_verification',
       'telebirr_authoritative_verification'
     )
  `);
  await client.query(
    `
    update app.feature_switches
       set mode = 'dry_run',
           settings = pg_catalog.jsonb_build_object(
             'contract_version', 1,
             'pilot_revision_id', $1::uuid,
             'configuration_digest', $2::text
           )
     where feature_key = 'private_live_deposit_pilot'
  `,
    [pilotRevisionId, configurationDigest],
  );
  await client.query("set local session_replication_role = 'origin'");
  return { configurationDigest, pilotRevisionId };
}

async function snapshot(client: Client): Promise<unknown> {
  const result = await client.query(`
    select jsonb_build_object(
      'roles', (select jsonb_agg(
        (to_jsonb(role) - 'rolpassword') ||
          jsonb_build_object('password_fingerprint', md5(coalesce(role.rolpassword, '')))
        order by role.rolname)
        from pg_authid role where role.rolname like 'fetanagent_%'),
      'memberships', (select jsonb_agg(to_jsonb(membership) order by roleid, member, grantor)
        from pg_auth_members membership),
      'switches', (select jsonb_agg(to_jsonb(switch) order by feature_key)
        from app.feature_switches switch),
      'pilots', (select jsonb_agg(to_jsonb(pilot) order by id)
        from app.private_live_deposit_pilot_revisions pilot)
    ) as snapshot
  `);
  return result.rows[0].snapshot;
}

export function registerStagingContinuousAvailabilitySqlTests(getClient: () => Client): void {
  describe('continuous non-financial staging availability', () => {
    it('changes only four login expiry fields, preserves credentials and authority, and is idempotent', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await prepare(client);
        const before = (await snapshot(client)) as {
          roles: Array<{ rolname: string; rolvaliduntil: string | null }>;
        };
        await client.query(sql);
        const after = await snapshot(client);
        const expected = structuredClone(before);
        for (const role of expected.roles) {
          if (applicationRoles.includes(role.rolname as (typeof applicationRoles)[number])) {
            role.rolvaliduntil = 'infinity';
          }
        }
        expect(after).toEqual(expected);
        await client.query(sql);
        expect(await snapshot(client)).toEqual(after);
      } finally {
        await client.query('rollback');
      }
    });

    it('accepts the exact expired armed dry-run pilot while changing no authority', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await prepare(client);
        await installArmedDryRunPilotFixture(client);
        const before = (await snapshot(client)) as {
          roles: Array<{ rolname: string; rolvaliduntil: string | null }>;
        };
        await client.query(sql);
        const after = await snapshot(client);
        const expected = structuredClone(before);
        for (const role of expected.roles) {
          if (applicationRoles.includes(role.rolname as (typeof applicationRoles)[number])) {
            role.rolvaliduntil = 'infinity';
          }
        }
        expect(after).toEqual(expected);
        await client.query(sql);
        expect(await snapshot(client)).toEqual(after);
      } finally {
        await client.query('rollback');
      }
    });

    it('ignores an unrelated non-financial feature switch', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await prepare(client);
        await client.query(`
          insert into app.feature_switches (feature_key, mode, settings)
          values ('synthetic_nonfinancial_test', 'live', '{"fixture":true}'::jsonb)
        `);
        await expect(client.query(sql)).resolves.toBeDefined();
      } finally {
        await client.query('rollback');
      }
    });

    for (const [name, mutation, bypassSwitchImmutability] of [
      ['expired login', "alter role fetanagent_player_actions_runtime valid until '2000-01-01'"],
      [
        'near-expiry login',
        `do $test$ begin execute format(
        'alter role fetanagent_player_actions_runtime valid until %L', now() + interval '2 minutes'
      ); end $test$`,
      ],
      ['disabled login', 'alter role fetanagent_beta_admission_runtime nologin'],
      ['administrative login', 'alter role fetanagent_owner_control_runtime createdb'],
      ['wrong connection limit', 'alter role fetanagent_customer_web_runtime connection limit 3'],
      ['extra membership', 'grant fetanagent_beta_admission to fetanagent_player_actions_runtime'],
      [
        'missing membership',
        'revoke fetanagent_player_actions from fetanagent_player_actions_runtime',
      ],
      ['enabled executor', 'alter role fetanagent_deposit_executor_runtime login'],
      ['enabled verifier', 'alter role fetanagent_trusted_telebirr_verifier_runtime login'],
      [
        'enabled financial switch',
        "update app.feature_switches set mode = 'live' where feature_key = 'deposit_execution'",
      ],
      [
        'dry-run real-money switch',
        "update app.feature_switches set mode = 'dry_run' where feature_key = 'payment_verification'",
      ],
      [
        'live pilot switch',
        "update app.feature_switches set mode = 'live' where feature_key = 'private_live_deposit_pilot'",
        true,
      ],
      [
        'unbound dry-run pilot',
        `update app.feature_switches
            set mode = 'dry_run',
                settings = jsonb_build_object(
                  'contract_version', 1,
                  'pilot_revision_id', gen_random_uuid(),
                  'configuration_digest', 'sha256:${'c'.repeat(64)}'
                )
          where feature_key = 'private_live_deposit_pilot'`,
        true,
      ],
      [
        'disabled pilot with nonempty settings',
        `update app.feature_switches
            set mode = 'disabled', settings = '{"unexpected":true}'::jsonb
          where feature_key = 'private_live_deposit_pilot'`,
        true,
      ],
      [
        'disabled real-money switch with nonempty settings',
        `update app.feature_switches
            set mode = 'disabled', settings = '{"unexpected":true}'::jsonb
          where feature_key = 'payment_verification'`,
        true,
      ],
      [
        'missing financial switch',
        "delete from app.feature_switches where feature_key = 'telebirr_authoritative_verification'",
        true,
      ],
      [
        'missing pilot switch',
        "delete from app.feature_switches where feature_key = 'private_live_deposit_pilot'",
        true,
      ],
    ] as const) {
      it(`rejects ${name} without making partial lifetime changes`, async () => {
        const client = getClient();
        await client.query('begin');
        try {
          await prepare(client);
          if (bypassSwitchImmutability) {
            await client.query("set local session_replication_role = 'replica'");
          }
          await client.query(mutation);
          if (bypassSwitchImmutability) {
            await client.query("set local session_replication_role = 'origin'");
          }
          const before = await snapshot(client);
          await client.query('savepoint availability_attempt');
          await expect(client.query(sql)).rejects.toThrow();
          await client.query('rollback to savepoint availability_attempt');
          expect(await snapshot(client)).toEqual(before);
        } finally {
          await client.query('rollback');
        }
      });
    }

    for (const [name, mutation] of [
      [
        'armed pilot with the wrong revision ID',
        `update app.feature_switches
            set settings = jsonb_set(settings, '{pilot_revision_id}', to_jsonb(gen_random_uuid()))
          where feature_key = 'private_live_deposit_pilot'`,
      ],
      [
        'armed pilot with the wrong configuration digest',
        `update app.feature_switches
            set settings = jsonb_set(
              settings,
              '{configuration_digest}',
              to_jsonb('sha256:${'d'.repeat(64)}'::text)
            )
          where feature_key = 'private_live_deposit_pilot'`,
      ],
      [
        'armed pilot with the wrong contract version',
        `update app.feature_switches
            set settings = jsonb_set(settings, '{contract_version}', '2'::jsonb)
          where feature_key = 'private_live_deposit_pilot'`,
      ],
      [
        'armed pilot with an extra manifest field',
        `update app.feature_switches
            set settings = settings || '{"unexpected":true}'::jsonb
          where feature_key = 'private_live_deposit_pilot'`,
      ],
    ] as const) {
      it(`rejects ${name} without making partial lifetime changes`, async () => {
        const client = getClient();
        await client.query('begin');
        try {
          await prepare(client);
          await installArmedDryRunPilotFixture(client);
          await client.query("set local session_replication_role = 'replica'");
          await client.query(mutation);
          await client.query("set local session_replication_role = 'origin'");
          const before = await snapshot(client);
          await client.query('savepoint availability_attempt');
          await expect(client.query(sql)).rejects.toThrow();
          await client.query('rollback to savepoint availability_attempt');
          expect(await snapshot(client)).toEqual(before);
        } finally {
          await client.query('rollback');
        }
      });
    }
  });
}
