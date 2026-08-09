import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Client } from 'pg';

const migrationFilePattern = /^\d{14}_[a-z0-9_]+\.sql$/;

export async function listMigrationsLexically(
  migrationsDirectory: string,
): Promise<readonly string[]> {
  const directoryEntries = await readdir(migrationsDirectory, { withFileTypes: true });
  const sqlEntries = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name);

  const invalidNames = sqlEntries.filter((name) => !migrationFilePattern.test(name));
  if (invalidNames.length > 0) {
    throw new Error(`Unexpected SQL migration filename(s): ${invalidNames.sort().join(', ')}`);
  }

  const migrationNames = sqlEntries.sort((left, right) => left.localeCompare(right));
  if (migrationNames.length === 0) {
    throw new Error('No checked-in SQL migrations were found.');
  }

  const duplicateVersions = migrationNames
    .map((name) => name.slice(0, 14))
    .filter((version, index, versions) => versions.indexOf(version) !== index);
  if (duplicateVersions.length > 0) {
    throw new Error(
      `Duplicate SQL migration versions: ${[...new Set(duplicateVersions)].join(', ')}`,
    );
  }

  return migrationNames;
}

export async function applyMigrationsLexically(
  client: Client,
  migrationsDirectory: string,
): Promise<readonly string[]> {
  const migrationNames = await listMigrationsLexically(migrationsDirectory);

  await client.query('create schema if not exists sql_integration');
  await client.query(`
    create table if not exists sql_integration.applied_migrations (
      filename text primary key,
      applied_at timestamptz not null default clock_timestamp()
    )
  `);

  for (const migrationName of migrationNames) {
    const migrationSource = await readFile(join(migrationsDirectory, migrationName), 'utf8');

    if (migrationSource.trim() === '') {
      throw new Error(`Migration ${migrationName} is empty.`);
    }

    try {
      await client.query(migrationSource);
    } catch (error) {
      throw new Error(`Migration ${migrationName} failed to apply.`, { cause: error });
    }

    await client.query('insert into sql_integration.applied_migrations (filename) values ($1)', [
      migrationName,
    ]);
  }

  return migrationNames;
}
