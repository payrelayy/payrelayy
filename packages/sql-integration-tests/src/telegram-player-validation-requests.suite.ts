import { describe, expect, it } from 'vitest';
import type { Client, QueryResultRow } from 'pg';

import { createPilotPrerequisites } from './private-live-money-pilot.suite.js';

let savepointSequence = 0;

async function asPlayerActions<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly string[],
): Promise<readonly T[]> {
  const savepoint = `player_validation_request_${++savepointSequence}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await client.query('set local role fetanagent_player_actions');
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

async function recordInbound(client: Client, updateId: string, userId: string): Promise<string> {
  const rows = await asPlayerActions<{ inbound_event_id: string }>(
    client,
    `select inbound_event_id from app.record_public_telegram_action_inbound_event(
       $1::bigint, $2::bigint, $2::bigint, $3::text, 'en'::text
     )`,
    [updateId, userId, `hmac-sha256-v1:${'a'.repeat(64)}`],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.inbound_event_id;
}

async function requestValidation(client: Client, eventId: string, playerId: string) {
  return asPlayerActions<{ request_id: string; request_replayed: boolean }>(
    client,
    `select request_id, request_replayed
       from app.request_telegram_player_validation($1::uuid, $2::text)`,
    [eventId, playerId],
  );
}

export function registerTelegramPlayerValidationRequestSqlTests(getClient: () => Client): void {
  describe('dormant Telegram Player validation requests', () => {
    it('preserves the current selection and money ledgers while superseding an older request', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const fixture = await createPilotPrerequisites(client);
        const firstEvent = await recordInbound(client, '89630000001', '89640000001');
        const selected = await asPlayerActions<{ selected_player_id: string }>(
          client,
          `select selected_player_id from app.save_telegram_player_selection($1::uuid, $2::text)`,
          [firstEvent, fixture.playerIds[0]!],
        );
        expect(selected[0]!.selected_player_id).toBe(fixture.playerIds[0]);

        const before = (
          await client.query(`select
          (select count(*)::text from app.deposit_intents) as intents,
          (select count(*)::text from app.deposit_jobs) as jobs,
          (select count(*)::text from app.player_validation_attempts) as attempts,
          (select count(*)::text from app.player_deposit_eligibility_decisions) as decisions`)
        ).rows;

        const newEvent = await recordInbound(client, '89630000002', '89640000001');
        const first = await requestValidation(client, newEvent, 'NEW-PLAYER-1');
        expect(first).toHaveLength(1);
        expect(first[0]!.request_replayed).toBe(false);
        expect(await requestValidation(client, newEvent, 'NEW-PLAYER-1')).toEqual([
          { request_id: first[0]!.request_id, request_replayed: true },
        ]);

        const secondEvent = await recordInbound(client, '89630000003', '89640000001');
        const second = await requestValidation(client, secondEvent, 'NEW-PLAYER-2');
        expect(second[0]!.request_id).not.toBe(first[0]!.request_id);
        const state = (
          await client.query<{
            player_id: string;
            status: string;
            selection_origin_inbound_event_id: string;
          }>(
            `select player_id, status, selection_origin_inbound_event_id
              from app.telegram_player_validation_requests
             where telegram_identity_id = (
               select customer_identity_id from app.inbound_events where id = $1::uuid
             ) order by case when origin_inbound_event_id = $1::uuid then 0 else 1 end`,
            [newEvent],
          )
        ).rows;
        expect(state).toEqual([
          {
            player_id: 'NEW-PLAYER-1',
            status: 'superseded',
            selection_origin_inbound_event_id: firstEvent,
          },
          {
            player_id: 'NEW-PLAYER-2',
            status: 'pending',
            selection_origin_inbound_event_id: firstEvent,
          },
        ]);
        const selection = await asPlayerActions<{ selected_player_id: string }>(
          client,
          'select selected_player_id from app.get_telegram_saved_player_selection($1::uuid)',
          [secondEvent],
        );
        expect(selection[0]!.selected_player_id).toBe(fixture.playerIds[0]);
        expect(
          (
            await client.query(`select
          (select count(*)::text from app.deposit_intents) as intents,
          (select count(*)::text from app.deposit_jobs) as jobs,
          (select count(*)::text from app.player_validation_attempts) as attempts,
          (select count(*)::text from app.player_deposit_eligibility_decisions) as decisions`)
          ).rows,
        ).toEqual(before);

        const otherEvent = await recordInbound(client, '89630000004', '89640000002');
        expect(
          (await requestValidation(client, otherEvent, 'NEW-PLAYER-2'))[0]!.request_replayed,
        ).toBe(false);
        await expect(requestValidation(client, secondEvent, 'NEW-PLAYER-1')).rejects.toThrow(
          /replay conflicts/iu,
        );
        const invalidEvent = await recordInbound(client, '89630000005', '89640000001');
        await expect(requestValidation(client, invalidEvent, '../x')).rejects.toThrow(/invalid/iu);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
