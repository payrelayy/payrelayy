import { loadApiConfig } from '@fetanagent/config/api';
import { Pool, type PoolClient } from 'pg';

import { playerActionCatalogPreflightPassed } from './player-action-catalog-preflight.js';
import {
  createTelegramPlayerActionPoolConfig,
  isTelegramPlayerActionRuntimeEnabled,
} from './postgres-telegram-player-action-runtime.js';

async function runPlayerActionDatabasePreflight(): Promise<void> {
  const config = loadApiConfig();
  if (!isTelegramPlayerActionRuntimeEnabled(config)) {
    throw new Error('The Player-ID action preflight is disabled.');
  }

  const pool = new Pool({
    ...createTelegramPlayerActionPoolConfig(config.telegramPlayerActionRuntime),
    application_name: 'fetanagent-player-actions-preflight',
    max: 1,
  });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('begin read only');
    await client.query("set local search_path = 'pg_catalog'");
    if (
      !(await playerActionCatalogPreflightPassed(
        { query: (query) => client!.query(query) },
        config.telegramPlayerActionRuntime.routineTelebirrCandidateStagingEnabled ||
          config.telegramPlayerActionRuntime.routineTelebirrCandidateProductionEnabled,
        // The route stays off while only the exact candidate grant is applied.
        true,
      ))
    ) {
      throw new Error('The Player-ID action catalog contract did not pass.');
    }
    await client.query('rollback');
  } catch (error) {
    if (client) {
      try {
        await client.query('rollback');
      } catch {
        // The generic CLI message remains the only output on rollback uncertainty.
      }
    }
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

try {
  await runPlayerActionDatabasePreflight();
  console.info('Player-ID action database preflight passed.');
} catch {
  console.error(
    'FetanAgent Player-ID action database preflight did not complete. Check the restricted runtime configuration.',
  );
  process.exitCode = 1;
}
