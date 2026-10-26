import { describe, expect, it } from 'vitest';
import type { Client, QueryResultRow } from 'pg';

import { createPilotPrerequisites } from './private-live-money-pilot.suite.js';

type InboundRow = { readonly inbound_event_id: string };
type SelectionRow = {
  readonly request_replayed: boolean;
  readonly selected_player_id: string;
};

let savepointSequence = 0;

async function asPlayerActions<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly string[],
): Promise<readonly T[]> {
  const savepoint = `saved_player_action_${++savepointSequence}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await client.query('set local role fetanagent_player_actions');
    const rows = (await client.query<T>(query, [...values])).rows;
    await client.query('reset role');
    await client.query(`release savepoint ${savepoint}`);
    return rows;
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    throw error;
  }
}

async function recordInbound(
  client: Client,
  updateId: string,
  telegramUserId: string,
): Promise<string> {
  const rows = await asPlayerActions<InboundRow>(
    client,
    `select inbound_event_id
       from app.record_public_telegram_action_inbound_event(
         $1::bigint, $2::bigint, $2::bigint, $3::text, 'en'::text
       )`,
    [updateId, telegramUserId, `hmac-sha256-v1:${'a'.repeat(64)}`],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.inbound_event_id;
}

async function readSelection(client: Client, eventId: string): Promise<readonly string[]> {
  const rows = await asPlayerActions<{ readonly selected_player_id: string }>(
    client,
    `select selected_player_id from app.get_telegram_saved_player_selection($1::uuid)`,
    [eventId],
  );
  return rows.map((row) => row.selected_player_id);
}

async function saveSelection(
  client: Client,
  eventId: string,
  playerId: string,
): Promise<readonly SelectionRow[]> {
  return asPlayerActions<SelectionRow>(
    client,
    `select selected_player_id, request_replayed
       from app.save_telegram_player_selection($1::uuid, $2::text)`,
    [eventId, playerId],
  );
}

export function registerTelegramSavedPlayerSelectionSqlTests(getClient: () => Client): void {
  describe('Telegram saved Player selection', () => {
    it('keeps an unsigned eligible Player out of the verification reuse path', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const fixture = await createPilotPrerequisites(client);
        const firstEvent = await recordInbound(client, '89620000001', '89610000001');
        expect(await readSelection(client, firstEvent)).toEqual([]);
        const beforeMoney = await client.query<{
          readonly intents: string;
          readonly proofs: string;
          readonly jobs: string;
        }>(`select
              (select count(*)::text from app.deposit_intents) as intents,
              (select count(*)::text from app.deposit_proof_requests) as proofs,
              (select count(*)::text from app.deposit_jobs) as jobs`);

        await expect(saveSelection(client, firstEvent, fixture.playerIds[0]!)).rejects.toThrow(
          /no reusable signed verification/iu,
        );
        expect(await readSelection(client, firstEvent)).toEqual([]);

        const afterMoney = await client.query(`select
              (select count(*)::text from app.deposit_intents) as intents,
              (select count(*)::text from app.deposit_proof_requests) as proofs,
              (select count(*)::text from app.deposit_jobs) as jobs`);
        expect(afterMoney.rows).toEqual(beforeMoney.rows);

        const selections = await client.query<{ readonly count: string }>(
          `select count(*)::text as count from app.telegram_player_selections`,
        );
        expect(selections.rows).toEqual([{ count: '0' }]);

        const invalidEvent = await recordInbound(client, '89620000004', '89610000001');
        await expect(saveSelection(client, invalidEvent, 'UNKNOWN-PLAYER')).rejects.toThrow(
          /unavailable|not currently eligible/iu,
        );
        expect(await readSelection(client, invalidEvent)).toEqual([]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
