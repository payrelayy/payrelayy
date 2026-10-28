import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionDiagnosticJournal } from './session-diagnostic-journal.js';

describe('local KemerBet session diagnostic journal', () => {
  let dataRoot: string;
  let logPath: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'fetanagent-session-diagnostic-'));
    logPath = join(dataRoot, 'diagnostics', 'kemerbet-session.jsonl');
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('retains ordered timestamps and fixed event names without provider or payment data', async () => {
    const journal = createSessionDiagnosticJournal({
      dataRoot,
      releaseSha: 'local-development',
    });
    journal.record({ category: 'process', state: 'started' });
    journal.record({ category: 'provider', state: 'admin_socket_logout_received' });
    journal.record({ category: 'session', state: 'login_required' });
    journal.record({
      category: 'provider',
      state: 'token-and-payment-reference-must-never-appear' as never,
    });
    journal.record({
      category: 'session',
      state: 'failed',
      reason: 'secret-account-number' as never,
    });
    await journal.flush();

    const contents = await readFile(logPath, 'utf8');
    const entries = contents
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => `${entry.category}:${entry.state}`)).toEqual([
      'process:started',
      'provider:admin_socket_logout_received',
      'session:login_required',
    ]);
    expect(entries.every((entry) => entry.launchId === entries[0]?.launchId)).toBe(true);
    expect(entries.every((entry) => entry.releaseSha === 'local-development')).toBe(true);
    expect(entries.every((entry) => Number.isSafeInteger(entry.elapsedMs))).toBe(true);
    expect(entries.every((entry) => !Number.isNaN(Date.parse(String(entry.recordedAt))))).toBe(
      true,
    );
    expect(contents).not.toContain('token-and-payment-reference');
    expect(contents).not.toContain('secret-account-number');
  });

  it('rotates an oversized journal while retaining its prior events', async () => {
    await mkdir(join(dataRoot, 'diagnostics'));
    await writeFile(logPath, 'x'.repeat(8_388_550), 'utf8');
    const journal = createSessionDiagnosticJournal({
      dataRoot,
      releaseSha: 'local-development',
    });
    journal.record({ category: 'session', state: 'signed_in_verified' });
    await journal.flush();

    expect((await stat(`${logPath}.1`)).size).toBe(8_388_550);
    expect((await readFile(logPath, 'utf8')).trim()).toContain('signed_in_verified');
  });

  it('warns once and does not interrupt the Companion if local logging is unavailable', async () => {
    await mkdir(join(dataRoot, 'diagnostics'), { recursive: true });
    await mkdir(logPath);
    const onFailure = vi.fn();
    const journal = createSessionDiagnosticJournal({
      dataRoot,
      releaseSha: 'local-development',
      onFailure,
    });
    journal.record({ category: 'process', state: 'started' });
    journal.record({ category: 'provider', state: 'refresh_http_rejected' });
    await expect(journal.flush()).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
