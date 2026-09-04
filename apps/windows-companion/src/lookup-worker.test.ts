import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH,
  AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_RESULT_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalKemerBetExactFiveLookupAssignmentSignatureBytes,
  canonicalKemerBetExactFiveLookupResultSignatureBytes,
  decodeSignedKemerBetExactFiveLookupAssignment,
  digestCompanionPlayerId,
  digestKemerBetExactFiveLookupAssignmentBody,
  digestKemerBetExactFiveLookupResultBody,
  type CompanionNoMoneySafety,
  type CompanionPlayerLookupResultItem,
  type KemerBetExactFiveLookupAssignmentBody,
  type KemerBetExactFiveLookupResultBody,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
  type SignedKemerBetExactFiveLookupAssignment,
  type SignedKemerBetExactFiveLookupResult,
} from '@fetanagent/agent-platform-companion-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  CompanionDeviceSigningRuntime,
  ExactFiveCompanionLookupOutcomes,
} from './device-enrollment.js';
import { runCompanionLookupWorker, type CompanionLookupWorkerEvent } from './lookup-worker.js';
import type { WindowsCurrentUserDataProtector } from './windows-data-protection.js';

const roots: string[] = [];
const now = new Date('2026-09-05T12:00:30.000Z');
const playerIds = ['28379330', '28379331', '28379332', '28379333', '28379334'] as const;
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

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

function p1363(privateKey: KeyObject, transcript: Uint8Array): string {
  return sign('sha256', transcript, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fetanagent-lookup-worker-'));
  roots.push(root);
  return root;
}

function protector(): WindowsCurrentUserDataProtector {
  const prefix = Buffer.from('test-dpapi-lookup-ledger:', 'utf8');
  return Object.freeze({
    protect: async (cleartext: Buffer) => Buffer.concat([prefix, cleartext]),
    unprotect: async (ciphertext: Buffer) => {
      if (!ciphertext.subarray(0, prefix.length).equals(prefix)) throw new Error();
      return Buffer.from(ciphertext.subarray(prefix.length));
    },
  });
}

function assignmentFixture(
  serverPrivateKey: KeyObject,
  assignmentId = 'lookup-assignment-0001',
): SignedKemerBetExactFiveLookupAssignment {
  const body: KemerBetExactFiveLookupAssignmentBody = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    assignmentId,
    requestId: `owner-request-${assignmentId.slice(-4)}`,
    certificateId: 'device-certificate-0001',
    deviceId: 'windows-device-0001',
    deviceKeyId: 'windows-device-key-0001',
    platformCode: 'kemerbet',
    assignmentKind: 'exact_five_player_lookup',
    lookupMode: 'find_only',
    playerIds,
    currencyCode: 'ETB',
    leaseNonceDigest: assignmentId.endsWith('1') ? sha('1') : sha('2'),
    oneUse: true,
    issuedAt: '2026-09-05T12:00:00.000Z',
    expiresAt: '2026-09-05T12:05:00.000Z',
    ...safe,
  });
  const bodyDigest = digestKemerBetExactFiveLookupAssignmentBody(body);
  const transcript = canonicalKemerBetExactFiveLookupAssignmentSignatureBytes(
    body,
    'server-signing-key-0001',
  );
  if (!bodyDigest || !transcript) throw new Error('invalid synthetic assignment');
  return Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId: 'server-signing-key-0001',
    body,
    signature: p1363(serverPrivateKey, transcript),
  });
}

function resultFixture(
  assignment: SignedKemerBetExactFiveLookupAssignment,
  devicePrivateKey: KeyObject,
  outcomes: ExactFiveCompanionLookupOutcomes,
): SignedKemerBetExactFiveLookupResult {
  const items = assignment.body.playerIds.map((playerId, playerIndex) => ({
    playerIndex: playerIndex as 0 | 1 | 2 | 3 | 4,
    playerIdDigest: digestCompanionPlayerId(playerId)!,
    outcome: outcomes[playerIndex]!,
  })) as unknown as readonly [
    CompanionPlayerLookupResultItem,
    CompanionPlayerLookupResultItem,
    CompanionPlayerLookupResultItem,
    CompanionPlayerLookupResultItem,
    CompanionPlayerLookupResultItem,
  ];
  const body: KemerBetExactFiveLookupResultBody = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    resultId: `result-${assignment.body.assignmentId}`,
    assignmentId: assignment.body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    requestId: assignment.body.requestId,
    certificateId: assignment.body.certificateId,
    deviceId: assignment.body.deviceId,
    deviceKeyId: assignment.body.deviceKeyId,
    platformCode: 'kemerbet',
    assignmentKind: 'exact_five_player_lookup',
    lookupMode: 'find_only',
    currencyCode: 'ETB',
    items,
    foundCount: outcomes.filter((outcome) => outcome === 'found').length,
    notFoundCount: outcomes.filter((outcome) => outcome === 'not_found').length,
    reviewRequiredCount: outcomes.filter((outcome) => outcome === 'review_required').length,
    observedAt: '2026-09-05T12:00:20.000Z',
    ...safe,
  });
  const bodyDigest = digestKemerBetExactFiveLookupResultBody(body);
  const transcript = canonicalKemerBetExactFiveLookupResultSignatureBytes(body);
  if (!bodyDigest || !transcript) throw new Error('invalid synthetic result');
  return Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_RESULT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    deviceKeyId: body.deviceKeyId,
    body,
    signature: p1363(devicePrivateKey, transcript),
  });
}

function runtimeFixture() {
  const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const assignment = assignmentFixture(server.privateKey);
  const verifyLookupExchange = vi.fn(
    (
      expectedAssignment: SignedKemerBetExactFiveLookupAssignment,
      result: SignedKemerBetExactFiveLookupResult,
      assessedAt = now,
    ) =>
      Number.isFinite(assessedAt.getTime()) &&
      assessedAt.getTime() >= Date.parse(expectedAssignment.body.issuedAt) &&
      assessedAt.getTime() < Date.parse(expectedAssignment.body.expiresAt) &&
      result.body.assignmentId === expectedAssignment.body.assignmentId &&
      result.body.assignmentBodyDigest === expectedAssignment.bodyDigest &&
      result.body.requestId === expectedAssignment.body.requestId,
  );
  const runtime: CompanionDeviceSigningRuntime = {
    certificate: { bodyDigest: sha('c') } as SignedCompanionEnrollmentCertificate,
    pollEndpoint: `https://device.fetanagent.com${AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH}`,
    resultEndpoint: `https://device.fetanagent.com${AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH}`,
    createSignedHttpRequest: (path, contentDigest) =>
      ({ path, contentDigest }) as unknown as SignedCompanionHttpRequest,
    decodeAndVerifyAssignment: (candidate, assessedAt = now) => {
      const decoded = decodeSignedKemerBetExactFiveLookupAssignment(candidate);
      return decoded &&
        assessedAt.getTime() >= Date.parse(decoded.body.issuedAt) &&
        assessedAt.getTime() < Date.parse(decoded.body.expiresAt)
        ? decoded
        : undefined;
    },
    verifyLookupExchange,
    createSignedLookupResult: (selectedAssignment, outcomes) =>
      resultFixture(selectedAssignment, device.privateKey, outcomes),
  };
  return { assignment, device, runtime, server, verifyLookupExchange };
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
    { encoding: 'utf8', mode: 0o600 },
  );
  clear.fill(0);
  protectedBytes.fill(0);
}

function reporter(controller: AbortController) {
  const events: CompanionLookupWorkerEvent[] = [];
  return {
    events,
    report: (event: CompanionLookupWorkerEvent) => {
      events.push(event);
      if (
        event.state === 'result_accepted' ||
        event.state === 'waiting_for_assignment' ||
        event.state === 'temporarily_unavailable'
      ) {
        controller.abort();
      }
    },
  };
}

describe('Windows companion exact-five lookup worker', () => {
  it('polls, executes exactly five lookups, submits one bound result, and clears its ledger', async () => {
    const root = await temporaryRoot();
    const value = runtimeFixture();
    const controller = new AbortController();
    const reports = reporter(controller);
    const executeExactFiveLookup = vi.fn(async () =>
      Object.freeze(['found', 'review_required', 'found', 'review_required', 'found'] as const),
    );
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      const endpoint = String(input);
      if (endpoint.endsWith(AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH)) {
        return jsonResponse({ assignment: value.assignment });
      }
      if (endpoint.endsWith(AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH)) {
        return jsonResponse({ accepted: true, replayed: false }, 201);
      }
      throw new Error('unexpected endpoint');
    });

    await runCompanionLookupWorker({
      dataRoot: root,
      device: value.runtime,
      session: { executeExactFiveLookup },
      signal: controller.signal,
      report: reports.report,
      fetch: fetchImplementation as unknown as typeof fetch,
      now: () => new Date(now),
      pollIntervalMs: 100,
      protector: protector(),
    });

    expect(executeExactFiveLookup).toHaveBeenCalledOnce();
    expect(executeExactFiveLookup).toHaveBeenCalledWith(playerIds);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(reports.events.map(({ state }) => state)).toEqual([
      'assignment_verified',
      'lookup_completed',
      'result_accepted',
    ]);
    expect(reports.events[1]).toMatchObject({ foundCount: 3, reviewRequiredCount: 2 });
    expect(JSON.stringify(reports.events)).not.toMatch(/283793|playerIds|amount|notes/i);
    expect(await readdir(join(root, 'device'))).toEqual([]);
  });

  it('treats a strict 204 as no work without opening the KemerBet session', async () => {
    const root = await temporaryRoot();
    const value = runtimeFixture();
    const controller = new AbortController();
    const reports = reporter(controller);
    const executeExactFiveLookup = vi.fn();
    const fetchImplementation = vi.fn(async () => new Response(null, { status: 204 }));

    await runCompanionLookupWorker({
      dataRoot: root,
      device: value.runtime,
      session: { executeExactFiveLookup },
      signal: controller.signal,
      report: reports.report,
      fetch: fetchImplementation as unknown as typeof fetch,
      now: () => new Date(now),
      pollIntervalMs: 100,
      protector: protector(),
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(executeExactFiveLookup).not.toHaveBeenCalled();
    expect(reports.events.map(({ state }) => state)).toEqual(['waiting_for_assignment']);
  });

  it('never repeats an ambiguous post-start lookup and submits five review-required outcomes', async () => {
    const root = await temporaryRoot();
    const selectedProtector = protector();
    const value = runtimeFixture();
    await seedProtected(
      root,
      'lookup-primary.assignment.secure.json',
      'assignment',
      value.assignment,
      selectedProtector,
    );
    await writeFile(
      join(root, 'device', 'lookup-primary.started.json'),
      `${JSON.stringify({ ledgerVersion: 1, assignmentBodyDigest: value.assignment.bodyDigest })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    const controller = new AbortController();
    const reports = reporter(controller);
    const executeExactFiveLookup = vi.fn();
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ accepted: true, replayed: false }, 201),
    );

    await runCompanionLookupWorker({
      dataRoot: root,
      device: value.runtime,
      session: { executeExactFiveLookup },
      signal: controller.signal,
      report: reports.report,
      fetch: fetchImplementation as unknown as typeof fetch,
      now: () => new Date(now),
      pollIntervalMs: 100,
      protector: selectedProtector,
    });

    expect(executeExactFiveLookup).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(reports.events).toEqual([
      {
        state: 'lookup_completed',
        foundCount: 0,
        reviewRequiredCount: 5,
        detailsRedacted: true,
        identifiersRedacted: true,
        transferDisabled: true,
        moneyMoved: false,
      },
      {
        state: 'result_accepted',
        foundCount: 0,
        reviewRequiredCount: 5,
        detailsRedacted: true,
        identifiersRedacted: true,
        transferDisabled: true,
        moneyMoved: false,
      },
    ]);
  });

  it('rejects a stored result for a different assignment before any network retry', async () => {
    const root = await temporaryRoot();
    const selectedProtector = protector();
    const value = runtimeFixture();
    const otherAssignment = assignmentFixture(value.server.privateKey, 'lookup-assignment-0002');
    const mismatchedResult = resultFixture(otherAssignment, value.device.privateKey, [
      'found',
      'found',
      'found',
      'found',
      'found',
    ]);
    await seedProtected(
      root,
      'lookup-primary.assignment.secure.json',
      'assignment',
      value.assignment,
      selectedProtector,
    );
    await seedProtected(
      root,
      'lookup-primary.result.secure.json',
      'result',
      mismatchedResult,
      selectedProtector,
    );
    const controller = new AbortController();
    const reports = reporter(controller);
    const fetchImplementation = vi.fn();
    const executeExactFiveLookup = vi.fn();

    await runCompanionLookupWorker({
      dataRoot: root,
      device: value.runtime,
      session: { executeExactFiveLookup },
      signal: controller.signal,
      report: reports.report,
      fetch: fetchImplementation as unknown as typeof fetch,
      now: () => new Date(now),
      pollIntervalMs: 100,
      protector: selectedProtector,
    });

    expect(value.verifyLookupExchange).toHaveBeenCalledWith(
      value.assignment,
      mismatchedResult,
      now,
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(executeExactFiveLookup).not.toHaveBeenCalled();
    expect(reports.events.map(({ state }) => state)).toEqual(['temporarily_unavailable']);
  });
});
