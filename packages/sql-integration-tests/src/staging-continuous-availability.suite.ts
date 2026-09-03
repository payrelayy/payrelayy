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
  .replace(/^begin;\s*$/m, '')
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
        from app.feature_switches switch)
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

    for (const [name, mutation] of [
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
        'missing financial switch',
        "delete from app.feature_switches where feature_key = 'telebirr_authoritative_verification'",
      ],
    ] as const) {
      it(`rejects ${name} without making partial lifetime changes`, async () => {
        const client = getClient();
        await client.query('begin');
        try {
          await prepare(client);
          await client.query(mutation);
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
