import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  client: vi.fn(),
  inspect: vi.fn(),
  release: vi.fn(),
  spawn: vi.fn(),
  listener: vi.fn(),
}));

vi.mock('pg', () => ({
  default: {
    Client: vi.fn(function (config: unknown) {
      mocks.client(config);
      return { connect: mocks.connect, query: mocks.query, end: mocks.end };
    }),
  },
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:net', () => ({ createServer: mocks.listener }));
vi.mock('./activation-diagnostic.js', async (original) => ({
  ...(await original<typeof import('./activation-diagnostic.js')>()),
  inspectOperatorActivationRequest: mocks.inspect,
}));
vi.mock('./release-verification.js', () => ({ verifyPublishedCompanionRelease: mocks.release }));

import { activationDiagnosticReport } from './activation-diagnostic.js';
import { diagnoseOperatorActivation } from './index.js';
import type { OperatorHostLaunchDocument } from './launch-document.js';

const document = {
  requestKey: '00000000-0000-4000-8000-000000000001',
  database: {
    host: 'synthetic.invalid',
    port: 5432,
    user: 'postgres',
    database: 'postgres',
    password: 'synthetic-do-not-print',
  },
  databaseCaPem: 'synthetic-ca',
  releaseTag: 'windows-companion-v0.1.17',
} satisfies OperatorHostLaunchDocument;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.end.mockResolvedValue(undefined);
  mocks.inspect.mockResolvedValue(activationDiagnosticReport('inspected'));
});

describe('activation diagnostic lifecycle is separate from execution', () => {
  it('opens only a bounded read-only transaction and always rolls back/closes', async () => {
    expect(await diagnoseOperatorActivation(document)).toEqual(
      activationDiagnosticReport('inspected'),
    );
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeoutMillis: 5000,
        query_timeout: 10000,
        statement_timeout: 10000,
        ssl: { ca: 'synthetic-ca', rejectUnauthorized: true, servername: 'synthetic.invalid' },
      }),
    );
    expect(mocks.query.mock.calls).toEqual([['begin read only'], ['rollback']]);
    expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.listener).not.toHaveBeenCalled();
  });

  it('provides only the request read, public-release check, and key-format check to inspection', async () => {
    await diagnoseOperatorActivation(document);
    const input = mocks.inspect.mock.calls[0]![0];
    expect(Object.keys(input).sort()).toEqual(
      ['requestKey', 'administrator', 'verifyPublishedRelease', 'checkExecutionSigner'].sort(),
    );
    await input.administrator.query('select synthetic', ['test-only']);
    expect(mocks.query).toHaveBeenCalledWith('select synthetic', ['test-only']);
    const request = Object.freeze({ synthetic: true });
    const reconstructionTime = new Date('2026-09-30T12:00:00.000Z');
    await input.verifyPublishedRelease(request, reconstructionTime);
    const [actualRequest, tag, clock] = mocks.release.mock.calls[0]!;
    expect(actualRequest).toBe(request);
    expect(tag).toBe(document.releaseTag);
    expect(clock()).toBe(reconstructionTime);
    expect(typeof input.checkExecutionSigner).toBe('function');
  });

  it.each(['connect', 'begin'])('redacts a failure during %s and still closes', async (at) => {
    const failure = new Error('synthetic-do-not-print');
    if (at === 'connect') mocks.connect.mockRejectedValue(failure);
    else mocks.query.mockRejectedValue(failure);
    const report = await diagnoseOperatorActivation(document);
    expect(report.stage).toBe('node_database');
    expect(JSON.stringify(report)).not.toContain(document.database.password);
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.listener).not.toHaveBeenCalled();
  });

  it('preserves a fixed inspection failure while rolling back', async () => {
    mocks.inspect.mockResolvedValue(activationDiagnosticReport('published_release'));
    expect((await diagnoseOperatorActivation(document)).stage).toBe('published_release');
    expect(mocks.query).toHaveBeenLastCalledWith('rollback');
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });

  it.each(['rollback', 'end'])('prioritizes unconfirmed %s cleanup', async (at) => {
    if (at === 'rollback')
      mocks.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('private'));
    else mocks.end.mockRejectedValue(new Error('private'));
    expect((await diagnoseOperatorActivation(document)).stage).toBe('cleanup');
    expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.listener).not.toHaveBeenCalled();
  });
});
