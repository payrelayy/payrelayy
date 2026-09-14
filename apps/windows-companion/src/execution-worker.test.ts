import { describe, expect, it, vi } from 'vitest';

const dependency = vi.hoisted(() => ({
  order: [] as string[],
  assess: vi.fn(),
  persist: vi.fn(),
  clearPreFence: vi.fn(),
  clearTerminal: vi.fn(),
  consume: vi.fn(),
  loadAttempt: vi.fn(),
  persistInitialAttempt: vi.fn(),
  persistAttemptAuthority: vi.fn(),
  persistAttemptResult: vi.fn(),
  clearPreFenceAttempt: vi.fn(),
  clearTerminalAttempt: vi.fn(),
}));

vi.mock('@fetanagent/agent-platform-companion-execution-contracts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@fetanagent/agent-platform-companion-execution-contracts')
    >();
  const digest = `sha256:${'d'.repeat(64)}`;
  return {
    ...actual,
    digestCompanionExecutionAuthorityRequestContent: () => digest,
    digestCompanionExecutionNonce: () => digest,
    digestCompanionExecutionPollContent: () => digest,
    digestCompanionExecutionResultContent: () => digest,
    digestCompanionExecutionStatusQueryContent: () => digest,
    recheckOneUseActionAuthorityDeadlineAfterAtomicConsumption: () => {
      dependency.order.push('deadline:rechecked');
      return true;
    },
  };
});

vi.mock('./execution-v2-crash-journal.js', () => ({
  assessWindowsCompanionExecutionV2Recovery: dependency.assess,
  clearWindowsCompanionExecutionV2PreFenceEvidence: dependency.clearPreFence,
  clearWindowsCompanionExecutionV2TerminalEvidence: dependency.clearTerminal,
  createWindowsCompanionExecutionV2AssignmentEvidence: (assignment: {
    bodyDigest: string;
    body: { assignmentId: string };
  }) => ({
    phase: 'assignment_observed',
    journalRevision: 1,
    assignmentId: assignment.body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    authorityId: null,
    authorityBodyDigest: null,
    resultBodyDigest: null,
  }),
  persistWindowsCompanionExecutionV2CrashEvidence: dependency.persist,
  recordWindowsCompanionExecutionV2FenceConsumptionEvidence: (
    previous: object,
    authority: { bodyDigest: string; body: { authorityId: string } },
  ) => ({
    ...previous,
    phase: 'fence_consumed_reconciliation_required',
    journalRevision: 2,
    authorityId: authority.body.authorityId,
    authorityBodyDigest: authority.bodyDigest,
  }),
  recordWindowsCompanionExecutionV2FinalActionStartedEvidence: (
    previous: object,
    startedAt: string,
  ) => ({
    ...previous,
    phase: 'final_action_started_reconciliation_required',
    journalRevision: 3,
    finalActionStartedAt: startedAt,
  }),
  recordWindowsCompanionExecutionV2SignedResultEvidence: (
    previous: object,
    result: { bodyDigest: string },
  ) => ({
    ...previous,
    phase: 'signed_result_recorded_reconciliation_required',
    journalRevision: 4,
    resultBodyDigest: result.bodyDigest,
  }),
}));

vi.mock('./execution-v2-replay-store.js', () => ({
  consumeWindowsCompanionExecutionV2AuthorityOnce: dependency.consume,
}));

vi.mock('./execution-v2-attempt-store.js', () => ({
  loadWindowsCompanionExecutionV2AttemptChain: dependency.loadAttempt,
  persistWindowsCompanionExecutionV2InitialAttemptChain: dependency.persistInitialAttempt,
  persistWindowsCompanionExecutionV2AttemptAuthority: dependency.persistAttemptAuthority,
  persistWindowsCompanionExecutionV2AttemptResult: dependency.persistAttemptResult,
  clearWindowsCompanionExecutionV2PreFenceAttemptChain: dependency.clearPreFenceAttempt,
  clearWindowsCompanionExecutionV2TerminalAttemptChain: dependency.clearTerminalAttempt,
}));

import {
  COMPANION_EXECUTION_AUTHORITY_PATH,
  COMPANION_EXECUTION_POLL_PATH,
  COMPANION_EXECUTION_RESULT_PATH,
  COMPANION_EXECUTION_STATUS_PATH,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import { runCompanionExecutionWorker } from './execution-worker.js';

const MEDIA_TYPE = 'application/vnd.fetanagent.companion-device-bridge+json';
const SERVER_DATE = 'Mon, 14 Sep 2026 00:00:05 GMT';
const digest = (character: string) => `sha256:${character.repeat(64)}`;

function response(status: number, body?: unknown): Response {
  if (status === 204) return new Response(null, { status, headers: { date: SERVER_DATE } });
  const serialized = JSON.stringify(body);
  return new Response(serialized, {
    status,
    headers: {
      'content-length': String(Buffer.byteLength(serialized)),
      'content-type': MEDIA_TYPE,
      date: SERVER_DATE,
    },
  });
}

function fixture() {
  dependency.order.length = 0;
  dependency.assess.mockReset().mockResolvedValue({ localEvidenceState: 'missing' });
  dependency.persist.mockReset().mockImplementation(async (journal: { phase: string }) => {
    dependency.order.push(`journal:${journal.phase}`);
    return {};
  });
  dependency.clearPreFence.mockReset().mockImplementation(async () => {
    dependency.order.push('journal:cleared-pre-fence');
  });
  dependency.clearTerminal.mockReset().mockImplementation(async () => {
    dependency.order.push('journal:cleared-terminal');
  });
  dependency.consume
    .mockReset()
    .mockImplementation(
      async (verification: { replayIdentity: string; authorityBodyDigest: string }) => {
        dependency.order.push('authority:atomically-consumed');
        return {
          receiptKind: 'external_atomic_replay_consumption',
          replayIdentity: verification.replayIdentity,
          authorityBodyDigest: verification.authorityBodyDigest,
          consumedExactlyOnce: true,
        };
      },
    );
  const assignmentBody = {
    assignmentId: 'execution-assignment-0001',
    activationEpoch: '11',
    intentId: 'deposit-intent-0001',
    jobId: 'deposit-job-0001',
    attemptId: 'deposit-attempt-0001',
    platformAgentAccountId: 'platform-agent-account-0001',
    enrollmentId: 'execution-enrollment-0001',
    enrollmentBodyDigest: digest('1'),
    noMoneyCertificateId: 'no-money-certificate-0001',
    noMoneyCertificateBodyDigest: digest('2'),
    deviceId: 'device-primary-0001',
    deviceKeyId: 'device-key-primary-0001',
    executionSignerKeyId: 'execution-signer-production-0001',
    platformCode: 'kemerbet' as const,
    pilotId: 'private-pilot-0001',
    pilotRevision: '7',
    pilotConfigDigest: digest('3'),
    pilotReservationId: 'pilot-reservation-0001',
    pilotReservationDigest: digest('4'),
    amountMinorUnits: 2500 as const,
    currencyCode: 'ETB' as const,
    playerIdDigest: digest('5'),
  };
  const enrollment = {
    bodyDigest: digest('6'),
    body: { enrollmentId: assignmentBody.enrollmentId },
  };
  const assignment = { bodyDigest: digest('7'), body: assignmentBody };
  const chain = { enrollment, assignment, playerId: '28379330' };
  const authority = {
    bodyDigest: digest('8'),
    body: {
      authorityId: 'one-use-authority-0001',
      fenceId: 'database-fence-0001',
      fenceNonceDigest: digest('9'),
      requestNonceDigest: digest('d'),
      databaseAuthorityIssuedAt: '2026-09-14T00:00:05.000Z',
    },
  };
  const verification = {
    verificationKind: 'cryptographically_verified_one_use_action_authority' as const,
    grantsActionAuthority: false as const,
    atomicReplayConsumptionRequired: true as const,
    authorityBodyDigest: authority.bodyDigest,
    replayIdentity: digest('a'),
    signedServerActionDeadline: '2026-09-14T00:00:12.000Z',
    monotonicActionDeadlineMs: 20_000,
    verifiedAtTrustedTime: '2026-09-14T00:00:05.000Z',
    responseReceivedMonotonicMs: 1_000,
  };
  const signedResult = (body: object) => ({ bodyDigest: digest('b'), body });
  const execution = {
    pollEndpoint: 'https://device.fetanagent.com/poll',
    authorityEndpoint: 'https://device.fetanagent.com/authority',
    resultEndpoint: 'https://device.fetanagent.com/result',
    statusEndpoint: 'https://device.fetanagent.com/status',
    verifyAssignment: vi.fn(() => chain),
    verifyAuthority: vi.fn(() => ({ authority, verification })),
    createSignedResult: vi.fn((body) => signedResult(body)),
    verifyStatus: vi.fn(() => ({ body: { terminalState: 'succeeded' } })),
  };
  const device = {
    certificate: { bodyDigest: digest('c'), body: {} },
    execution,
    createSignedHttpRequest: vi.fn((path: string) => {
      dependency.order.push(`http:${path}`);
      return { path };
    }),
  };
  dependency.loadAttempt.mockReset().mockResolvedValue({ state: 'missing' });
  dependency.persistInitialAttempt.mockReset().mockResolvedValue({
    enrollment,
    assignment,
    authority: null,
    result: null,
  });
  dependency.persistAttemptAuthority.mockReset().mockImplementation(async (previous) => ({
    ...previous,
    authority,
  }));
  dependency.persistAttemptResult.mockReset().mockImplementation(async (previous, result) => ({
    ...previous,
    result,
  }));
  dependency.clearPreFenceAttempt.mockReset().mockResolvedValue(undefined);
  dependency.clearTerminalAttempt.mockReset().mockImplementation(async () => {
    dependency.order.push('attempt:cleared-terminal');
  });
  return { assignment, authority, chain, device, execution };
}

describe('companion execution worker orchestration', () => {
  it('orders preparation, database fence, durable local consumption, one action, result, and status', async () => {
    const selected = fixture();
    const abort = new AbortController();
    const fetchImplementation = vi.fn(async (endpoint: string | URL | Request) => {
      const url = String(endpoint);
      if (url.endsWith('/poll')) {
        dependency.order.push('server:assignment');
        return response(201, {
          enrollment: selected.chain.enrollment,
          assignment: selected.chain.assignment,
          playerId: selected.chain.playerId,
          authority: null,
          result: null,
        });
      }
      if (url.endsWith('/authority')) {
        dependency.order.push('server:authority');
        return response(201, { authority: selected.authority });
      }
      if (url.endsWith('/result')) {
        dependency.order.push('server:result');
        return response(201, { accepted: true, replayed: false });
      }
      dependency.order.push('server:status');
      return response(201, { status: { body: { terminalState: 'succeeded' } } });
    });
    const session = {
      executeExactOneUseDeposit: vi.fn(
        async (_playerId: string, acquire: () => Promise<{ isFresh(): boolean }>) => {
          dependency.order.push('provider:prepared');
          const finalAction = await acquire();
          expect(finalAction.isFresh()).toBe(true);
          dependency.order.push('provider:one-exact-request');
          return { outcome: 'submission_attempted' as const, providerResponseDigest: digest('e') };
        },
      ),
    };
    const events: string[] = [];
    await runCompanionExecutionWorker({
      dataRoot: 'D:\\FetanAgent Companion Test',
      device: selected.device as never,
      session,
      signal: abort.signal,
      fetch: fetchImplementation as unknown as typeof fetch,
      localNow: () => new Date('2026-09-14T00:00:05.000Z'),
      monotonicNow: (() => {
        let value = 1_000;
        return () => ++value;
      })(),
      pollIntervalMs: 250,
      report: (entry) => {
        events.push(entry.state);
        if (entry.state === 'reconciliation_succeeded') abort.abort();
      },
    });
    expect(session.executeExactOneUseDeposit).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    expect(events).toEqual([
      'waiting_for_assignment',
      'assignment_verified',
      'provider_prepared',
      'database_fence_consumed',
      'final_action_started',
      'result_recorded',
      'result_accepted',
      'reconciliation_succeeded',
    ]);
    const order = dependency.order;
    expect(order.indexOf('provider:prepared')).toBeLessThan(order.indexOf('server:authority'));
    expect(order.indexOf('server:authority')).toBeLessThan(
      order.indexOf('authority:atomically-consumed'),
    );
    expect(order.indexOf('authority:atomically-consumed')).toBeLessThan(
      order.indexOf('deadline:rechecked'),
    );
    expect(order.indexOf('deadline:rechecked')).toBeLessThan(
      order.indexOf('provider:one-exact-request'),
    );
    expect(order.indexOf('provider:one-exact-request')).toBeLessThan(
      order.indexOf('server:result'),
    );
    expect(order).toContain('journal:cleared-terminal');
  });

  it('never retries after an ambiguous authority request that may have fenced the database', async () => {
    const selected = fixture();
    const abort = new AbortController();
    const fetchImplementation = vi.fn(async (endpoint: string | URL | Request) => {
      const url = String(endpoint);
      if (url.endsWith('/poll')) {
        return response(201, {
          enrollment: selected.chain.enrollment,
          assignment: selected.chain.assignment,
          playerId: selected.chain.playerId,
          authority: null,
          result: null,
        });
      }
      if (url.endsWith('/authority')) throw new Error('ambiguous network loss');
      throw new Error('result or status must not be attempted');
    });
    const session = {
      executeExactOneUseDeposit: vi.fn(
        async (_playerId: string, acquire: () => Promise<unknown>) => {
          await acquire();
          throw new Error('unreachable');
        },
      ),
    };
    const events: string[] = [];
    await runCompanionExecutionWorker({
      dataRoot: 'D:\\FetanAgent Companion Test',
      device: selected.device as never,
      session,
      signal: abort.signal,
      fetch: fetchImplementation as unknown as typeof fetch,
      localNow: () => new Date('2026-09-14T00:00:05.000Z'),
      monotonicNow: (() => {
        let value = 1_000;
        return () => ++value;
      })(),
      pollIntervalMs: 250,
      report: (entry) => {
        events.push(entry.state);
        if (entry.state === 'failed_closed') abort.abort();
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toBe('failed_closed');
    expect(dependency.clearPreFence).not.toHaveBeenCalled();
    expect(
      dependency.order.filter((entry) => entry === 'journal:assignment_observed'),
    ).toHaveLength(1);
  });

  it('reconciles a protected signed result after restart without touching the provider', async () => {
    const selected = fixture();
    const result = {
      bodyDigest: digest('b'),
      body: { outcome: 'submission_attempted' as const },
    };
    const recoveredChain = {
      enrollment: selected.chain.enrollment,
      assignment: selected.chain.assignment,
      authority: selected.authority,
      result,
    };
    dependency.assess.mockResolvedValue({
      localEvidenceState: 'locally_consistent_untrusted',
      localEvidence: {
        phase: 'signed_result_recorded_reconciliation_required',
        assignmentId: selected.assignment.body.assignmentId,
        assignmentBodyDigest: selected.assignment.bodyDigest,
        authorityId: selected.authority.body.authorityId,
        authorityBodyDigest: selected.authority.bodyDigest,
        resultBodyDigest: result.bodyDigest,
      },
    });
    dependency.loadAttempt.mockResolvedValue({ state: 'available', chain: recoveredChain });
    const abort = new AbortController();
    const fetchImplementation = vi.fn(async () =>
      response(201, { status: { body: { terminalState: 'succeeded' } } }),
    );
    const session = { executeExactOneUseDeposit: vi.fn() };
    const events: string[] = [];
    await runCompanionExecutionWorker({
      dataRoot: 'D:\\FetanAgent Companion Test',
      device: selected.device as never,
      session: session as never,
      signal: abort.signal,
      fetch: fetchImplementation as unknown as typeof fetch,
      localNow: () => new Date('2026-09-14T00:00:05.000Z'),
      monotonicNow: (() => {
        let value = 1_000;
        return () => ++value;
      })(),
      pollIntervalMs: 250,
      report: (entry) => {
        events.push(entry.state);
        if (entry.state === 'reconciliation_succeeded') abort.abort();
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(session.executeExactOneUseDeposit).not.toHaveBeenCalled();
    expect(events).toEqual(['reconciliation_succeeded', 'waiting_for_assignment']);
    expect(dependency.clearTerminal).toHaveBeenCalledTimes(1);
    expect(dependency.clearTerminalAttempt).toHaveBeenCalledTimes(1);
  });

  it('hard-stops on partial restart evidence without polling or touching the provider', async () => {
    const selected = fixture();
    dependency.assess.mockResolvedValue({
      localEvidenceState: 'locally_consistent_untrusted',
      localEvidence: {
        phase: 'fence_consumed_reconciliation_required',
      },
    });
    dependency.loadAttempt.mockResolvedValue({
      state: 'available',
      chain: {
        enrollment: selected.chain.enrollment,
        assignment: selected.chain.assignment,
        authority: selected.authority,
        result: null,
      },
    });
    const abort = new AbortController();
    const fetchImplementation = vi.fn();
    const session = { executeExactOneUseDeposit: vi.fn() };
    const events: string[] = [];
    await runCompanionExecutionWorker({
      dataRoot: 'D:\\FetanAgent Companion Test',
      device: selected.device as never,
      session: session as never,
      signal: abort.signal,
      fetch: fetchImplementation as unknown as typeof fetch,
      pollIntervalMs: 250,
      report: (entry) => {
        events.push(entry.state);
        if (entry.state === 'failed_closed') abort.abort();
      },
    });
    expect(events).toEqual(['failed_closed']);
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(session.executeExactOneUseDeposit).not.toHaveBeenCalled();
  });
});
