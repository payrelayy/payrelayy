import type { KeyObject } from 'node:crypto';

import {
  PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256,
  signCompanionExecutionActivationHandoff,
  type CompanionActivationReleaseAttestation,
  type CompanionActivationRequestSnapshot,
  type SignedCompanionExecutionActivationHandoff,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import { deriveGuardedCompanionHandoffBody } from './guarded-handoff-publication.js';
import {
  loadCompanionActivationDatabaseSnapshot,
  type CompanionActivationSnapshotQuery,
} from './snapshot.js';

export interface GuardedServerHandoffSignerInput {
  readonly requestKey: string;
  /** Protected administrator session on the server, never in the browser or companion. */
  readonly administrator: CompanionActivationSnapshotQuery;
  /** Rechecks the immutable published release independently of the Windows caller. */
  readonly verifyPublishedRelease: (
    request: CompanionActivationRequestSnapshot,
  ) => Promise<CompanionActivationReleaseAttestation>;
  /** Server-only key object; never serialized, logged, or returned. */
  readonly signerPrivateKey: KeyObject;
  readonly trustedNow: () => Date;
}

interface TrustedSigner {
  readonly keyId: string;
  readonly publicKeySpkiSha256: string;
}

const PRODUCTION_SIGNER: TrustedSigner = {
  keyId: PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID,
  publicKeySpkiSha256: PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256,
};

export class GuardedServerHandoffSigningUnavailableError extends Error {
  constructor() {
    super('The protected companion handoff signing request is unavailable.');
    this.name = 'GuardedServerHandoffSigningUnavailableError';
  }
}

function sameSnapshot(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Server-only signing core. It never signs caller-supplied body fields: an
 * immutable request and its current identity are read twice from PostgreSQL,
 * and release evidence is independently checked before the body is derived.
 * No HTTP route, credential source, or production caller is provided here.
 */
export async function signGuardedServerCompanionHandoffWithSigner(
  input: GuardedServerHandoffSignerInput,
  signer: TrustedSigner,
): Promise<SignedCompanionExecutionActivationHandoff> {
  try {
    if (
      !input ||
      typeof input.verifyPublishedRelease !== 'function' ||
      typeof input.trustedNow !== 'function' ||
      !input.administrator ||
      typeof input.administrator.query !== 'function'
    )
      throw new Error();
    const first = await loadCompanionActivationDatabaseSnapshot(
      input.requestKey,
      input.administrator,
    );
    const verified = await input.verifyPublishedRelease(Object.freeze({ ...first.request }));
    const release: CompanionActivationReleaseAttestation = Object.freeze({
      releaseSha: verified.releaseSha,
      archiveSha256: verified.archiveSha256,
      installationTreeSha256: verified.installationTreeSha256,
      observedAt: verified.observedAt,
    });
    const beforeSign = await loadCompanionActivationDatabaseSnapshot(
      input.requestKey,
      input.administrator,
    );
    if (!sameSnapshot(first, beforeSign)) throw new Error();
    const body = deriveGuardedCompanionHandoffBody({
      ...beforeSign,
      release,
      trustedNow: input.trustedNow,
    });
    const signed = signCompanionExecutionActivationHandoff(
      body,
      input.signerPrivateKey,
      signer.keyId,
      signer.publicKeySpkiSha256,
    );
    if (!signed) throw new Error();
    const afterSign = await loadCompanionActivationDatabaseSnapshot(
      input.requestKey,
      input.administrator,
    );
    if (!sameSnapshot(beforeSign, afterSign)) throw new Error();
    // Signing must not extend a request whose deadline passed during the operation.
    const rechecked = deriveGuardedCompanionHandoffBody({
      ...afterSign,
      release,
      trustedNow: input.trustedNow,
    });
    if (Date.parse(rechecked.issuedAt) < Date.parse(body.issuedAt)) throw new Error();
    return signed;
  } catch {
    throw new GuardedServerHandoffSigningUnavailableError();
  }
}

/** Pinned production identity; deliberately not exported from the package root. */
export async function signGuardedServerCompanionHandoff(
  input: GuardedServerHandoffSignerInput,
): Promise<SignedCompanionExecutionActivationHandoff> {
  return signGuardedServerCompanionHandoffWithSigner(input, PRODUCTION_SIGNER);
}
