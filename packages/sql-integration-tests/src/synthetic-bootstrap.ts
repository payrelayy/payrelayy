import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'pg';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const bootstrapFile = new URL('../sql/bootstrap.sql', import.meta.url);

export async function applySyntheticSupabaseBootstrap(client: Client): Promise<void> {
  const bootstrapSource = await readFile(bootstrapFile, 'utf8');

  if (bootstrapSource.trim() === '') {
    throw new Error(`Synthetic SQL bootstrap is empty: ${sourceDirectory}`);
  }

  await client.query(bootstrapSource);
}
