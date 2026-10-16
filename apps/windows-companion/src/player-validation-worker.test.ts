import { generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_ASSIGNMENT_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_POLL_PATH,
  AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_PATH,
  AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalKemerBetPlayerValidationAssignmentSignatureBytes,
  canonicalKemerBetPlayerValidationResultSignatureBytes,
  decodeSignedKemerBetPlayerValidationAssignment,
  digestCompanionPlayerId,
  digestKemerBetPlayerValidationAssignmentBody,
  digestKemerBetPlayerValidationResultBody,
  verifySignedKemerBetPlayerValidationAssignment,
  type CompanionNoMoneySafety,
  type KemerBetPlayerValidationAssignmentBody,
  type KemerBetPlayerValidationResultBody,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
  type SignedKemerBetPlayerValidationAssignment,
  type SignedKemerBetPlayerValidationResult,
} from '@fetanagent/agent-platform-companion-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompanionDeviceSigningRuntime } from './device-enrollment.js';
import {
  runCompanionPlayerValidationWorker,
  type CompanionPlayerValidationWorkerEvent,
} from './lookup-worker.js';
import type { WindowsCurrentUserDataProtector } from './windows-data-protection.js';

const roots: string[] = [];
const now = new Date('2026-10-16T12:00:30.000Z');
const playerId = '28379330';
const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const safe: CompanionNoMoneySafety = Object.freeze({
  accountMutationAllowed: false,
  balanceMutationAllowed: false,
  providerMutationAllowed: false,
  paymentAllowed: false,
  depositAllowed: false,
  withdrawAllowed: false,
  transferAllowed: false,
  settlementAllowed: false,
  finalActionAllowed: false,
  financialActionAllowed: false,
  moneyMovementAllowed: false,
  transferDisabled: true,
  identifiersRedacted: true,
  moneyMoved: false,
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fetanagent-player-validation-worker-'));
  roots.push(root);
  return root;
}

function protector(): WindowsCurrentUserDataProtector {
  const prefix = Buffer.from('test-dpapi-player-validation:', 'utf8');
  return Object.freeze({
    protect: async (cleartext: Buffer) => Buffer.concat([prefix, cleartext]),
    unprotect: async (ciphertext: Buffer) => {
      if (!ciphertext.subarray(0, prefix.length).equals(prefix)) throw new Error();
      return Buffer.from(ciphertext.subarray(prefix.length));
    },
  });
}

function signature(privateKey: KeyObject, transcript: Uint8Array): string {
  return sign('sha256', transcript, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url',
  );
}

function assignmentFixture(
  serverPrivateKey: KeyObject,
  assignmentId = 'player-validation-assignment-0001',
): SignedKemerBetPlayerValidationAssignment {
  const body: KemerBetPlayerValidationAssignmentBody = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    assignmentId,
    validationRequestId: 'telegram-player-validation-request-0001',
    certificateId: 'device-certificate-0001',
    deviceId: 'windows-device-0001',
    deviceKeyId: 'windows-device-key-0001',
    platformCode: 'kemerbet',
    assignmentKind: 'single_telegram_player_validation',
    lookupMode: 'find_only',
    playerId,
    currencyCode: 'ETB',
    leaseNonceDigest: sha('1'),
    oneUse: true,
    issuedAt: '2026-10-16T12:00:00.000Z',
    expiresAt: '2026-10-16T12:05:00.000Z',
    ...safe,
  });
  const bodyDigest = digestKemerBetPlayerValidationAssignmentBody(body);
  const transcript = canonicalKemerBetPlayerValidationAssignmentSignatureBytes(
    body,
    'server-signing-key-0001',
  );
  if (!bodyDigest || !transcript) throw new Error('invalid assignment fixture');
  return Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId: 'server-signing-key-0001',
    body,
    signature: signature(serverPrivateKey, transcript),
  });
}

function resultFixture(
  assignment: SignedKemerBetPlayerValidationAssignment,
  devicePrivateKey: KeyObject,
  outcome: 'found' | 'review_required',
): SignedKemerBetPlayerValidationResult {
  const body: KemerBetPlayerValidationResultBody = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    resultId: 'player-validation-result-0001',
    assignmentId: assignment.body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    validationRequestId: assignment.body.validationRequestId,
    certificateId: assignment.body.certificateId,
    deviceId: assignment.body.deviceId,
    deviceKeyId: assignment.body.deviceKeyId,
    platformCode: 'kemerbet',
    assignmentKind: 'single_telegram_player_validation',
    lookupMode: 'find_only',
    currencyCode: 'ETB',
    playerIdDigest: digestCompanionPlayerId(assignment.body.playerId)!,
    outcome,
    evidenceKind: outcome === 'found' ? 'exact_id_empty_etb_form' : 'inconclusive',
    observedAt: now.toISOString(),
    ...safe,
  });
  const bodyDigest = digestKemerBetPlayerValidationResultBody(body);
  const transcript = canonicalKemerBetPlayerValidationResultSignatureBytes(body);
  if (!bodyDigest || !transcript) throw new Error('invalid result fixture');
  return Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    deviceKeyId: body.deviceKeyId,
    body,
    signature: signature(devicePrivateKey, transcript),
  });
}

function runtimeFixture() {
  const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const assignment = assignmentFixture(server.privateKey);
  const verifyPlayerValidationExchange = vi.fn(
    (
      selected: SignedKemerBetPlayerValidationAssignment,
      result: SignedKemerBetPlayerValidationResult,
      assessedAt = now,
    ) => {
      const transcript = canonicalKemerBetPlayerValidationResultSignatureBytes(result.body);
      return Boolean(
        transcript &&
        assessedAt.getTime() >= Date.parse(selected.body.issuedAt) &&
        assessedAt.getTime() < Date.parse(selected.body.expiresAt) &&
        result.body.assignmentId === selected.body.assignmentId &&
        result.body.assignmentBodyDigest === selected.bodyDigest &&
        result.body.validationRequestId === selected.body.validationRequestId &&
        result.body.playerIdDigest === digestCompanionPlayerId(selected.body.playerId) &&
        verify(
          'sha256',
          transcript,
          { key: deviceKeys.publicKey, dsaEncoding: 'ieee-p1363' },
          Buffer.from(result.signature, 'base64url'),
        ),
      );
    },
  );
  const runtime: CompanionDeviceSigningRuntime = {
    certificate: { bodyDigest: sha('c') } as SignedCompanionEnrollmentCertificate,
    pollEndpoint: `https://device.fetanagent.com${AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_POLL_PATH}`,
    resultEndpoint: `https://device.fetanagent.com${AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_PATH}`,
    playerValidationPollEndpoint: `https://device.fetanagent.com${AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_POLL_PATH}`,
    playerValidationResultEndpoint: `https://device.fetanagent.com${AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_PATH}`,
    createSignedLaunchProof: () => {
      throw new Error();
    },
    createSignedExecutionLaunchProof: () => {
      throw new Error();
    },
    createSignedHttpRequest: (path, contentDigest) =>
      ({ path, contentDigest }) as unknown as SignedCompanionHttpRequest,
    decodeAndVerifyAssignment: () => undefined,
    verifyLookupExchange: () => false,
    createSignedLookupResult: () => {
      throw new Error();
    },
    decodeAndVerifyPlayerValidationAssignment: (candidate, assessedAt = now) => {
      const decoded = decodeSignedKemerBetPlayerValidationAssignment(candidate);
      return decoded &&
        assessedAt.getTime() >= Date.parse(decoded.body.issuedAt) &&
        assessedAt.getTime() < Date.parse(decoded.body.expiresAt) &&
        verifySignedKemerBetPlayerValidationAssignment(
          decoded,
          Buffer.from(server.publicKey.export({ format: 'der', type: 'spki' })),
        )
        ? decoded
        : undefined;
    },
    createSignedPlayerValidationResult: (selected, outcome) =>
      resultFixture(selected, deviceKeys.privateKey, outcome),
    verifyPlayerValidationExchange,
  };
  return { assignment, runtime, server, deviceKeys, verifyPlayerValidationExchange };
}

function jsonResponse(value: unknown, status = 200): Response {
  const encoded = JSON.stringify(value);
  return new Response(encoded, {
    status,
    headers: {
      'content-length': String(Buffer.byteLength(encoded)),
      'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
    },
  });
}

function reporter(controller: AbortController) {
  const events: CompanionPlayerValidationWorkerEvent[] = [];
  return {
    events,
    report: (event: CompanionPlayerValidationWorkerEvent) => {
      events.push(event);
      if (
        event.state === 'result_accepted' ||
        event.state === 'waiting_for_assignment' ||
        event.state === 'temporarily_unavailable'
      )
        controller.abort();
    },
  };
}

async function seedProtected(
  root: string,
  fileName: string,
  kind: 'assignment' | 'result',
  value: unknown,
  selectedProtector: WindowsCurrentUserDataProtector,
): Promise<void> {
  const clear = Buffer.from(JSON.stringify({ ledgerVersion: 1, kind, value }), 'utf8');
  const protectedBytes = await selectedProtector.protect(clear);
  await mkdir(join(root, 'device'), { recursive: true });
  await writeFile(
    join(root, 'device', fileName),
    `${JSON.stringify({
      ledgerVersion: 1,
      protection: 'windows-dpapi-current-user',
      protectedPayloadBase64: protectedBytes.toString('base64'),
    })}\n`,
  );
  clear.fill(0);
  protectedBytes.fill(0);
}

describe('dormant Windows companion single-Player validation worker', () => {
  it('finds one exact Player, submits a bound signed result, and clears its ledger', async () => {
    const root = await temporaryRoot();
    const value = runtimeFixture();
    const controller = new AbortController();
    const reports = reporter(controller);
    const executeSingleLookup = vi.fn(async () => 'found' as const);
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      const endpoint = String(input);
      if (endpoint.endsWith(AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_POLL_PATH)) {
        return jsonResponse({ assignment: value.assignment });
      }
      if (endpoint.endsWith(AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_PATH)) {
        return jsonResponse({ accepted: true, replayed: false }, 201);
      }
      throw new Error('unexpected endpoint');
    });
    await runCompanionPlayerValidationWorker({
      dataRoot: root,
      device: value.runtime,
      session: { executeSingleLookup },
      signal: controller.signal,
      report: reports.report,
      fetch: fetchImplementation as unknown as typeof fetch,
      now: () => new Date(now),
      pollIntervalMs: 100,
      protector: protector(),
    });
    expect(executeSingleLookup).toHaveBeenCalledOnce();
    expect(executeSingleLookup).toHaveBeenCalledWith(playerId);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(reports.events.map(({ state }) => state)).toEqual([
      'assignment_verified',
      'lookup_completed',
      'result_accepted',
    ]);
    expect(reports.events[1]?.outcome).toBe('found');
    expect(JSON.stringify(reports.events)).not.toContain(playerId);
    expect(await readdir(join(root, 'device'))).toEqual([]);
  });

  it('treats an empty poll as no work and never opens the local Find UI', async () => {
    const root = await temporaryRoot();
    const value = runtimeFixture();
    const controller = new AbortController();
    const reports = reporter(controller);
    const executeSingleLookup = vi.fn();
    await runCompanionPlayerValidationWorker({
      dataRoot: root,
      device: value.runtime,
      session: { executeSingleLookup },
      signal: controller.signal,
      report: reports.report,
      fetch: vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
      now: () => new Date(now),
      pollIntervalMs: 100,
      protector: protector(),
    });
    expect(executeSingleLookup).not.toHaveBeenCalled();
    expect(reports.events.map(({ state }) => state)).toEqual(['waiting_for_assignment']);
  });

  it('does not repeat Find after an interrupted attempt and submits review_required', async () => {
    const root = await temporaryRoot();
    const selectedProtector = protector();
    const value = runtimeFixture();
    await seedProtected(
      root,
      'player-validation.assignment.secure.json',
      'assignment',
      value.assignment,
      selectedProtector,
    );
    await writeFile(
      join(root, 'device', 'player-validation.started.json'),
      `${JSON.stringify({ ledgerVersion: 1, assignmentBodyDigest: value.assignment.bodyDigest })}\n`,
    );
    const controller = new AbortController();
    const reports = reporter(controller);
    const executeSingleLookup = vi.fn();
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ accepted: true, replayed: false }, 201),
    );
    await runCompanionPlayerValidationWorker({
      dataRoot: root,
      device: value.runtime,
      session: { executeSingleLookup },
      signal: controller.signal,
      report: reports.report,
      fetch: fetchImplementation as unknown as typeof fetch,
      now: () => new Date(now),
      pollIntervalMs: 100,
      protector: selectedProtector,
    });
    expect(executeSingleLookup).not.toHaveBeenCalled();
    expect(reports.events.map(({ outcome }) => outcome)).toEqual([
      'review_required',
      'review_required',
    ]);
    expect(await readdir(join(root, 'device'))).toEqual([]);
  });

  it('treats a failed or busy local session as inconclusive, never found', async () => {
    const root = await temporaryRoot();
    const value = runtimeFixture();
    const controller = new AbortController();
    const reports = reporter(controller);
    const executeSingleLookup = vi.fn(async () => {
      throw new Error('busy');
    });
    const fetchImplementation = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith(AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_POLL_PATH)
        ? jsonResponse({ assignment: value.assignment })
        : jsonResponse({ accepted: true, replayed: false }, 201),
    );
    await runCompanionPlayerValidationWorker({
      dataRoot: root,
      device: value.runtime,
      session: { executeSingleLookup },
      signal: controller.signal,
      report: reports.report,
      fetch: fetchImplementation as unknown as typeof fetch,
      now: () => new Date(now),
      pollIntervalMs: 100,
      protector: protector(),
    });
    expect(reports.events[1]?.outcome).toBe('review_required');
    expect(reports.events[2]?.outcome).toBe('review_required');
  });

  it('replays a protected signed result after a transport failure without repeating Find', async () => {
    const root = await temporaryRoot();
    const value = runtimeFixture();
    const selectedProtector = protector();
    const executeSingleLookup = vi.fn(async () => 'found' as const);
    const firstController = new AbortController();
    const firstReports = reporter(firstController);
    const firstFetch = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith(AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_POLL_PATH)
        ? jsonResponse({ assignment: value.assignment })
        : jsonResponse({ code: 'temporarily_unavailable' }, 503),
    );
    await runCompanionPlayerValidationWorker({
      dataRoot: root,
      device: value.runtime,
      session: { executeSingleLookup },
      signal: firstController.signal,
      report: firstReports.report,
      fetch: firstFetch as unknown as typeof fetch,
      now: () => new Date(now),
      pollIntervalMs: 100,
      protector: selectedProtector,
    });
    expect(executeSingleLookup).toHaveBeenCalledOnce();
    expect(firstReports.events.at(-1)?.state).toBe('temporarily_unavailable');

    const secondController = new AbortController();
    const secondReports = reporter(secondController);
    const retryFetch = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({ accepted: true, replayed: false }, 201),
    );
    await runCompanionPlayerValidationWorker({
      dataRoot: root,
      device: value.runtime,
      session: { executeSingleLookup },
      signal: secondController.signal,
      report: secondReports.report,
      fetch: retryFetch as unknown as typeof fetch,
      now: () => new Date(now),
      pollIntervalMs: 100,
      protector: selectedProtector,
    });
    expect(executeSingleLookup).toHaveBeenCalledOnce();
    expect(retryFetch).toHaveBeenCalledOnce();
    expect(String(retryFetch.mock.calls[0]?.[0])).toContain(
      AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_PATH,
    );
    expect(secondReports.events.map(({ state }) => state)).toEqual(['result_accepted']);
    expect(await readdir(join(root, 'device'))).toEqual([]);
  });

  it('refuses a protected result for another assignment before a network retry', async () => {
    const root = await temporaryRoot();
    const selectedProtector = protector();
    const value = runtimeFixture();
    const otherAssignment = assignmentFixture(
      value.server.privateKey,
      'player-validation-assignment-0002',
    );
    const mismatchedResult = resultFixture(otherAssignment, value.deviceKeys.privateKey, 'found');
    await seedProtected(
      root,
      'player-validation.assignment.secure.json',
      'assignment',
      value.assignment,
      selectedProtector,
    );
    await seedProtected(
      root,
      'player-validation.result.secure.json',
      'result',
      mismatchedResult,
      selectedProtector,
    );
    const controller = new AbortController();
    const reports = reporter(controller);
    const fetchImplementation = vi.fn();
    const executeSingleLookup = vi.fn();
    await runCompanionPlayerValidationWorker({
      dataRoot: root,
      device: value.runtime,
      session: { executeSingleLookup },
      signal: controller.signal,
      report: reports.report,
      fetch: fetchImplementation as unknown as typeof fetch,
      now: () => new Date(now),
      pollIntervalMs: 100,
      protector: selectedProtector,
    });
    expect(value.verifyPlayerValidationExchange).toHaveBeenCalledWith(
      value.assignment,
      mismatchedResult,
      now,
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(executeSingleLookup).not.toHaveBeenCalled();
    expect(reports.events.map(({ state }) => state)).toEqual(['temporarily_unavailable']);
  });
});
