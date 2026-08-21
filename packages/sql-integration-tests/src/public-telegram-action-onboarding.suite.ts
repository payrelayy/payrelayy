import { describe, expect, it } from 'vitest';
import type { Client, QueryResultRow } from 'pg';

type PublicInboundRow = {
  readonly inbound_event_already_recorded: boolean;
  readonly inbound_event_id: string;
  readonly received_at: Date;
};

type PublicIdentityGraphRow = {
  readonly conversation_id: string;
  readonly conversation_state: { readonly kind: 'idle'; readonly v: 1 };
  readonly conversation_version: string;
  readonly customer_id: string;
  readonly customer_identity_id: string;
  readonly private_chat_id: string;
  readonly telegram_user_id: string;
};

let savepointSequence = 0;

const payloadHmac = (hexCharacter: string): string => `hmac-sha256-v1:${hexCharacter.repeat(64)}`;
const inviteDigest = (hexCharacter: string): string => `sha256-v1:${hexCharacter.repeat(64)}`;

async function withSavepoint<T>(client: Client, body: () => Promise<T>): Promise<T> {
  savepointSequence += 1;
  const savepointName = `public_telegram_action_${savepointSequence}`;
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
    if (bodyError === undefined) throw rollbackError;
  }

  if (bodyError !== undefined) throw bodyError;
}

async function queryAsPlayerActions<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly (number | string | null)[] = [],
): Promise<readonly T[]> {
  return withSavepoint(client, async () => {
    await client.query('set local role fetanagent_player_actions');
    const result = await client.query<T>(query, [...values]);
    await client.query('reset role');
    return result.rows;
  });
}

async function queryAsBetaAdmission<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly (number | string | null)[] = [],
): Promise<readonly T[]> {
  return withSavepoint(client, async () => {
    await client.query('set local role fetanagent_beta_admission');
    const result = await client.query<T>(query, [...values]);
    await client.query('reset role');
    return result.rows;
  });
}

async function recordPublicAction(
  client: Client,
  input: {
    readonly chatId: number;
    readonly payload: string;
    readonly updateId: number;
    readonly userId: number;
    readonly locale?: string | null;
  },
): Promise<readonly PublicInboundRow[]> {
  return queryAsPlayerActions<PublicInboundRow>(
    client,
    `select inbound_event_id, received_at, inbound_event_already_recorded
       from app.record_public_telegram_action_inbound_event(
         $1::bigint, $2::bigint, $3::bigint, $4::text, $5::text
       )`,
    [
      input.updateId,
      input.userId,
      input.chatId,
      input.payload,
      input.locale === undefined ? 'en' : input.locale,
    ],
  );
}

async function redeemBetaInvite(
  client: Client,
  input: {
    readonly chatId: number;
    readonly invite: string;
    readonly payload: string;
    readonly updateId: number;
    readonly userId: number;
  },
): Promise<readonly PublicInboundRow[]> {
  return queryAsBetaAdmission<PublicInboundRow>(
    client,
    `select inbound_event_id, received_at, inbound_event_already_recorded
       from app.redeem_telegram_beta_invite(
         $1::bigint, $2::bigint, $3::bigint, $4::text, $5::text, 'en'::text
       )`,
    [input.updateId, input.userId, input.chatId, input.invite, input.payload],
  );
}

export function registerPublicTelegramActionOnboardingSqlTests(getClient: () => Client): void {
  describe('public Telegram action onboarding', () => {
    it('creates only minimal HMAC-bound identity, conversation, event, and audit lineage', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const userId = 8_810_000_001;
        const hmac = payloadHmac('a');
        const rows = await recordPublicAction(client, {
          chatId: userId,
          payload: hmac,
          updateId: 8_820_000_001,
          userId,
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ inbound_event_already_recorded: false });
        expect(rows[0]!.inbound_event_id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
        );
        expect(rows[0]!.received_at).toBeInstanceOf(Date);

        const lineage = await client.query<{
          readonly audit_action: string;
          readonly audit_metadata: { readonly channel: string; readonly onboarding: string };
          readonly conversation_state: { readonly kind: 'idle'; readonly v: 1 };
          readonly conversation_version: string;
          readonly customer_display_name: string | null;
          readonly customer_id: string;
          readonly customer_status: string;
          readonly event_payload_digest: string;
          readonly event_processed_at: Date | null;
          readonly identity_external_subject: string;
          readonly identity_status: string;
          readonly preferred_locale: string;
          readonly telegram_first_name: string | null;
          readonly telegram_last_name: string | null;
          readonly telegram_username: string | null;
        }>(
          `select customer.id as customer_id,
                  customer.status::text as customer_status,
                  customer.display_name as customer_display_name,
                  customer_identity.status::text as identity_status,
                  customer_identity.external_subject as identity_external_subject,
                  telegram_identity.username as telegram_username,
                  telegram_identity.first_name as telegram_first_name,
                  telegram_identity.last_name as telegram_last_name,
                  telegram_identity.preferred_locale,
                  conversation.state as conversation_state,
                  conversation.version::text as conversation_version,
                  inbound_event.payload_digest as event_payload_digest,
                  inbound_event.processed_at as event_processed_at,
                  audit_event.action as audit_action,
                  audit_event.metadata as audit_metadata
             from app.inbound_events inbound_event
             join app.customer_identities customer_identity
               on customer_identity.id = inbound_event.customer_identity_id
             join app.customers customer
               on customer.id = customer_identity.customer_id
             join app.telegram_identities telegram_identity
               on telegram_identity.customer_identity_id = customer_identity.id
             join app.bot_conversations conversation
               on conversation.telegram_identity_id = customer_identity.id
             join app.audit_events audit_event
               on audit_event.resource_type = 'customer_identity'
              and audit_event.resource_id = customer_identity.id
              and audit_event.action = 'customer.telegram_public_action_identity_created'
            where inbound_event.id = $1::uuid`,
          [rows[0]!.inbound_event_id],
        );

        expect(lineage.rows).toHaveLength(1);
        expect(lineage.rows[0]).toMatchObject({
          audit_action: 'customer.telegram_public_action_identity_created',
          audit_metadata: { channel: 'telegram', onboarding: 'public_action' },
          conversation_version: '0',
          customer_display_name: null,
          customer_status: 'active',
          event_payload_digest: hmac,
          event_processed_at: null,
          identity_external_subject: userId.toString(),
          identity_status: 'active',
          preferred_locale: 'en',
          telegram_first_name: null,
          telegram_last_name: null,
          telegram_username: null,
        });
        expect(lineage.rows[0]!.conversation_state).toEqual({ kind: 'idle', v: 1 });

        const financial = await client.query<{
          readonly deposit_intents: string;
          readonly deposit_proofs: string;
          readonly player_accounts: string;
        }>(
          `select
             (select count(*)::text from app.deposit_intents deposit_intent
               where deposit_intent.customer_id = $1::uuid) as deposit_intents,
             (select count(*)::text from app.deposit_proof_requests proof_request
               where proof_request.submitting_customer_id = $1::uuid) as deposit_proofs,
             (select count(*)::text from app.customer_platform_players player_account
               where player_account.customer_id = $1::uuid) as player_accounts`,
          [lineage.rows[0]!.customer_id],
        );
        expect(financial.rows).toEqual([
          { deposit_intents: '0', deposit_proofs: '0', player_accounts: '0' },
        ]);
      });
    });

    it('redeems a fresh beta invite into the exact same minimal public identity without money or pilot authority', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const userId = 8_810_000_010;
        const publicUpdateId = 8_820_000_010;
        const inviteUpdateId = 8_820_000_011;
        const tokenDigest = inviteDigest('1');
        const publicReceipt = await recordPublicAction(client, {
          chatId: userId,
          payload: payloadHmac('1'),
          updateId: publicUpdateId,
          userId,
        });
        expect(publicReceipt).toHaveLength(1);
        const before = await client.query<PublicIdentityGraphRow>(
          `select customer.id as customer_id,
                  customer_identity.id as customer_identity_id,
                  telegram_identity.telegram_user_id::text as telegram_user_id,
                  telegram_identity.private_chat_id::text as private_chat_id,
                  conversation.id as conversation_id,
                  conversation.state as conversation_state,
                  conversation.version::text as conversation_version
             from app.customer_identities customer_identity
             join app.customers customer
               on customer.id = customer_identity.customer_id
             join app.telegram_identities telegram_identity
               on telegram_identity.customer_identity_id = customer_identity.id
             join app.bot_conversations conversation
               on conversation.telegram_identity_id = customer_identity.id
            where customer_identity.identity_kind = 'telegram'
              and customer_identity.external_subject = $1::text`,
          [userId.toString()],
        );
        expect(before.rows).toHaveLength(1);
        expect(before.rows[0]!.conversation_state).toEqual({ kind: 'idle', v: 1 });
        expect(before.rows[0]!.conversation_version).toBe('0');

        const owner = await client.query<{ readonly id: string }>(
          `select admin_user.id
             from app.admin_users admin_user
            where admin_user.role = 'owner'
              and admin_user.status = 'active'`,
        );
        expect(owner.rows).toHaveLength(1);
        await client.query(
          `insert into app.telegram_beta_invites (
             token_digest, expires_at, issued_by_admin_id
           ) values ($1::text, clock_timestamp() + interval '1 hour', $2::uuid)`,
          [tokenDigest, owner.rows[0]!.id],
        );

        const redeemed = await redeemBetaInvite(client, {
          chatId: userId,
          invite: tokenDigest,
          payload: payloadHmac('2'),
          updateId: inviteUpdateId,
          userId,
        });
        expect(redeemed).toHaveLength(1);
        expect(redeemed[0]).toMatchObject({ inbound_event_already_recorded: false });
        await expect(
          redeemBetaInvite(client, {
            chatId: userId,
            invite: tokenDigest,
            payload: payloadHmac('2'),
            updateId: inviteUpdateId,
            userId,
          }),
        ).resolves.toEqual([{ ...redeemed[0]!, inbound_event_already_recorded: true }]);

        const after = await client.query<
          PublicIdentityGraphRow & {
            readonly beta_audits: string;
            readonly customer_identities: string;
            readonly customers: string;
            readonly deposit_intents: string;
            readonly inbound_events: string;
            readonly pilot_memberships: string;
            readonly player_accounts: string;
            readonly redeemed_invites: string;
          }
        >(
          `select customer.id as customer_id,
                  customer_identity.id as customer_identity_id,
                  telegram_identity.telegram_user_id::text as telegram_user_id,
                  telegram_identity.private_chat_id::text as private_chat_id,
                  conversation.id as conversation_id,
                  conversation.state as conversation_state,
                  conversation.version::text as conversation_version,
                  (select count(*)::text from app.customers scoped_customer
                    where scoped_customer.id = customer.id) as customers,
                  (select count(*)::text from app.customer_identities scoped_identity
                    where scoped_identity.customer_id = customer.id) as customer_identities,
                  (select count(*)::text from app.inbound_events inbound_event
                    where inbound_event.customer_identity_id = customer_identity.id) as inbound_events,
                  (select count(*)::text from app.telegram_beta_invites invite
                    where invite.status = 'redeemed'
                      and invite.redeemed_customer_identity_id = customer_identity.id) as redeemed_invites,
                  (select count(*)::text from app.audit_events audit_event
                    where audit_event.action = 'customer.telegram_beta_invite_redeemed'
                      and audit_event.resource_id = customer_identity.id) as beta_audits,
                  (select count(*)::text from app.customer_platform_players player_account
                    where player_account.customer_id = customer.id) as player_accounts,
                  (select count(*)::text from app.deposit_intents deposit_intent
                    where deposit_intent.customer_id = customer.id) as deposit_intents,
                  (select count(*)::text from app.private_live_deposit_pilot_customers pilot_customer
                    where pilot_customer.customer_id = customer.id) as pilot_memberships
             from app.customer_identities customer_identity
             join app.customers customer
               on customer.id = customer_identity.customer_id
             join app.telegram_identities telegram_identity
               on telegram_identity.customer_identity_id = customer_identity.id
             join app.bot_conversations conversation
               on conversation.telegram_identity_id = customer_identity.id
            where customer_identity.id = $1::uuid`,
          [before.rows[0]!.customer_identity_id],
        );
        expect(after.rows).toEqual([
          {
            ...before.rows[0]!,
            beta_audits: '1',
            customer_identities: '1',
            customers: '1',
            deposit_intents: '0',
            inbound_events: '2',
            pilot_memberships: '0',
            player_accounts: '0',
            redeemed_invites: '1',
          },
        ]);

        const secondDigest = inviteDigest('2');
        await client.query(
          `insert into app.telegram_beta_invites (
             token_digest, expires_at, issued_by_admin_id
           ) values ($1::text, clock_timestamp() + interval '1 hour', $2::uuid)`,
          [secondDigest, owner.rows[0]!.id],
        );
        await expect(
          redeemBetaInvite(client, {
            chatId: userId,
            invite: secondDigest,
            payload: payloadHmac('3'),
            updateId: inviteUpdateId + 1,
            userId,
          }),
        ).rejects.toThrow('The Telegram beta admission is not accepted.');

        const rejectedSecondInvite = await client.query<{
          readonly events: string;
          readonly status: string;
        }>(
          `select invite.status,
                  (select count(*)::text from app.inbound_events inbound_event
                    where inbound_event.channel = 'telegram'
                      and inbound_event.external_event_id = $2::text) as events
             from app.telegram_beta_invites invite
            where invite.token_digest = $1::text`,
          [secondDigest, `update:${inviteUpdateId + 1}`],
        );
        expect(rejectedSecondInvite.rows).toEqual([{ events: '0', status: 'active' }]);
      });
    });

    it('rejects adoption after the public identity graph is no longer minimal', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const userId = 8_810_000_020;
        const inviteUpdateId = 8_820_000_021;
        const tokenDigest = inviteDigest('3');
        await recordPublicAction(client, {
          chatId: userId,
          payload: payloadHmac('4'),
          updateId: 8_820_000_020,
          userId,
        });

        const owner = await client.query<{ readonly id: string }>(
          `select admin_user.id
             from app.admin_users admin_user
            where admin_user.role = 'owner'
              and admin_user.status = 'active'`,
        );
        expect(owner.rows).toHaveLength(1);
        await client.query(
          `update app.customers customer
              set display_name = 'nonminimal-public-identity'
            where customer.id = (
              select customer_identity.customer_id
                from app.customer_identities customer_identity
               where customer_identity.identity_kind = 'telegram'
                 and customer_identity.external_subject = $1::text
            )`,
          [userId.toString()],
        );
        await client.query(
          `insert into app.telegram_beta_invites (
             token_digest, expires_at, issued_by_admin_id
           ) values ($1::text, clock_timestamp() + interval '1 hour', $2::uuid)`,
          [tokenDigest, owner.rows[0]!.id],
        );

        await expect(
          redeemBetaInvite(client, {
            chatId: userId,
            invite: tokenDigest,
            payload: payloadHmac('5'),
            updateId: inviteUpdateId,
            userId,
          }),
        ).rejects.toThrow('The Telegram beta admission is not accepted.');

        const state = await client.query<{
          readonly events: string;
          readonly status: string;
        }>(
          `select invite.status,
                  (select count(*)::text from app.inbound_events inbound_event
                    where inbound_event.channel = 'telegram'
                      and inbound_event.external_event_id = $2::text) as events
             from app.telegram_beta_invites invite
            where invite.token_digest = $1::text`,
          [tokenDigest, `update:${inviteUpdateId}`],
        );
        expect(state.rows).toEqual([{ events: '0', status: 'active' }]);
      });
    });

    it('replays the exact receipt and rejects digest or immutable-scope substitution', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const input = {
          chatId: 8_810_000_002,
          payload: payloadHmac('b'),
          updateId: 8_820_000_002,
          userId: 8_810_000_002,
        } as const;
        const first = await recordPublicAction(client, input);
        const replay = await recordPublicAction(client, input);

        expect(first).toHaveLength(1);
        expect(replay).toHaveLength(1);
        expect(replay[0]).toMatchObject({
          inbound_event_already_recorded: true,
          inbound_event_id: first[0]!.inbound_event_id,
        });
        expect(replay[0]!.received_at.getTime()).toBe(first[0]!.received_at.getTime());

        await expect(
          recordPublicAction(client, { ...input, payload: payloadHmac('c') }),
        ).rejects.toThrow('The public Telegram action is unavailable.');
        await expect(
          recordPublicAction(client, {
            ...input,
            chatId: 8_810_000_003,
            userId: 8_810_000_003,
          }),
        ).rejects.toThrow('The public Telegram action is unavailable.');

        const counts = await client.query<{
          readonly audits: string;
          readonly customers: string;
          readonly events: string;
        }>(
          `select
             (select count(*)::text from app.customer_identities identity
               where identity.identity_kind = 'telegram'
                 and identity.external_subject = $1::text) as customers,
             (select count(*)::text from app.inbound_events inbound_event
               where inbound_event.channel = 'telegram'
                 and inbound_event.external_event_id = $2::text) as events,
             (select count(*)::text from app.audit_events audit_event
               where audit_event.action = 'customer.telegram_public_action_identity_created'
                 and audit_event.actor_customer_id = (
                   select identity.customer_id
                     from app.customer_identities identity
                    where identity.identity_kind = 'telegram'
                      and identity.external_subject = $1::text
                 )) as audits`,
          [input.userId.toString(), `update:${input.updateId}`],
        );
        expect(counts.rows).toEqual([{ audits: '1', customers: '1', events: '1' }]);
      });
    });

    it('allows an exact old receipt replay but blocks every new update after deactivation', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const input = {
          chatId: 8_810_000_004,
          payload: payloadHmac('d'),
          updateId: 8_820_000_004,
          userId: 8_810_000_004,
        } as const;
        const first = await recordPublicAction(client, input);

        await client.query(
          `update app.customers customer
              set status = 'blocked'
            where customer.id = (
              select customer_identity.customer_id
                from app.customer_identities customer_identity
               where customer_identity.identity_kind = 'telegram'
                 and customer_identity.external_subject = $1::text
            )`,
          [input.userId.toString()],
        );

        const replay = await recordPublicAction(client, input);
        expect(replay).toEqual([{ ...first[0]!, inbound_event_already_recorded: true }]);

        await expect(
          recordPublicAction(client, {
            ...input,
            payload: payloadHmac('e'),
            updateId: input.updateId + 1,
          }),
        ).rejects.toThrow('The public Telegram action is unavailable.');

        const events = await client.query<{ readonly count: string }>(
          `select count(*)::text as count
             from app.inbound_events inbound_event
            where inbound_event.customer_identity_id = (
              select customer_identity.id
                from app.customer_identities customer_identity
               where customer_identity.identity_kind = 'telegram'
                 and customer_identity.external_subject = $1::text
            )`,
          [input.userId.toString()],
        );
        expect(events.rows).toEqual([{ count: '1' }]);
      });
    });

    it.each([
      ['negative update', -1, 8_810_000_005, 8_810_000_005, payloadHmac('f'), 'en'],
      ['non-private chat', 8_820_000_005, 8_810_000_005, 8_810_000_006, payloadHmac('f'), 'en'],
      ['uppercase HMAC', 8_820_000_005, 8_810_000_005, 8_810_000_005, payloadHmac('F'), 'en'],
      ['non-English locale', 8_820_000_005, 8_810_000_005, 8_810_000_005, payloadHmac('f'), 'am'],
      ['null locale', 8_820_000_005, 8_810_000_005, 8_810_000_005, payloadHmac('f'), null],
    ] as const)(
      'rejects %s without creating identity or event state',
      async (_caseName, updateId, userId, chatId, hmac, locale) => {
        const client = getClient();
        await withRollback(client, async () => {
          await expect(
            recordPublicAction(client, {
              chatId,
              locale,
              payload: hmac,
              updateId,
              userId,
            }),
          ).rejects.toThrow('The public Telegram action is unavailable.');

          const state = await client.query<{
            readonly events: string;
            readonly identities: string;
          }>(
            `select
             (select count(*)::text from app.customer_identities identity
               where identity.identity_kind = 'telegram'
                 and identity.external_subject = $1::text) as identities,
             (select count(*)::text from app.inbound_events inbound_event
               where inbound_event.channel = 'telegram'
                 and inbound_event.external_event_id = $2::text) as events`,
            [userId.toString(), `update:${updateId}`],
          );
          expect(state.rows).toEqual([{ events: '0', identities: '0' }]);
        });
      },
    );

    it('exposes exactly the public recorder to Player-actions and no identity base tables', async () => {
      const client = getClient();
      const privilege = await client.query<{
        readonly admitted_group: boolean;
        readonly api_group: boolean;
        readonly authenticated: boolean;
        readonly base_table_access: boolean;
        readonly player_group: boolean;
        readonly player_runtime: boolean;
        readonly public_role: boolean;
      }>(`
        select
          pg_catalog.has_function_privilege(
            'fetanagent_player_actions',
            'app.record_public_telegram_action_inbound_event(bigint,bigint,bigint,text,text)',
            'EXECUTE'
          ) as player_group,
          pg_catalog.has_function_privilege(
            'fetanagent_player_actions_runtime',
            'app.record_public_telegram_action_inbound_event(bigint,bigint,bigint,text,text)',
            'EXECUTE'
          ) as player_runtime,
          pg_catalog.has_function_privilege(
            'fetanagent_player_actions',
            'app.record_admitted_telegram_private_inbound_event(bigint,bigint,bigint,text,text)',
            'EXECUTE'
          ) as admitted_group,
          pg_catalog.has_function_privilege(
            'fetanagent_api',
            'app.record_public_telegram_action_inbound_event(bigint,bigint,bigint,text,text)',
            'EXECUTE'
          ) as api_group,
          pg_catalog.has_function_privilege(
            'authenticated',
            'app.record_public_telegram_action_inbound_event(bigint,bigint,bigint,text,text)',
            'EXECUTE'
          ) as authenticated,
          exists (
            select 1
              from pg_catalog.pg_proc routine
              cross join lateral pg_catalog.aclexplode(
                coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
              ) privilege
             where routine.oid =
               'app.record_public_telegram_action_inbound_event(bigint,bigint,bigint,text,text)'::regprocedure
               and privilege.grantee = 0
               and privilege.privilege_type = 'EXECUTE'
          ) as public_role,
          pg_catalog.has_table_privilege(
            'fetanagent_player_actions',
            'app.customers',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          ) as base_table_access
      `);
      expect(privilege.rows).toEqual([
        {
          admitted_group: false,
          api_group: false,
          authenticated: false,
          base_table_access: false,
          player_group: true,
          player_runtime: true,
          public_role: false,
        },
      ]);

      await withRollback(client, async () => {
        await expect(
          queryAsPlayerActions(
            client,
            `select * from app.record_public_telegram_action_inbound_event(
               1::bigint, 2::bigint, 2::bigint, $1::text
             )`,
            [payloadHmac('1')],
          ),
        ).rejects.toThrow();
        await expect(
          queryAsPlayerActions(
            client,
            `select * from app.record_public_telegram_action_inbound_event(
               1::bigint, 2::bigint, 2::bigint, $1::text, 'en'::text, 'extra'::text
             )`,
            [payloadHmac('1')],
          ),
        ).rejects.toThrow();
      });
    });
  });
}
