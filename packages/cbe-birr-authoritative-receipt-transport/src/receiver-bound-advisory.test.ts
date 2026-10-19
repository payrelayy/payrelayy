import { createHash } from 'node:crypto';

import {
  parseCbeBirrAuthoritativePdf,
  type CbeBirrAuthoritativePdfParserExpectations,
} from '@fetanagent/cbe-birr-authoritative-pdf-parser';
import { deriveCbeBirrReceiverLookupChildKey } from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-provisioning';
import { prepareCbeBirrReceiverRotation } from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-rotation';
import { describe, expect, it, vi } from 'vitest';

import { retrieveAndParseCbeBirrReceiptForProtectedReceiverAdvisoryOnly } from './advisory-composition.js';
import {
  SYNTHETIC_PHONE,
  SYNTHETIC_REFERENCE,
  allowedTransportControl,
  syntheticPdfEnvelope,
} from './test-helpers.js';

const revisionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const encryptionSecret = 'a'.repeat(64);
const fingerprintSecret = 'b'.repeat(64);
const keyId = (secret: string) =>
  `sha256:${createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex')}`;
const protectedReceiver = prepareCbeBirrReceiverRotation({
  receiverRevisionId: revisionId,
  receiverVersion: 3,
  receiverPhone: SYNTHETIC_PHONE,
  referenceSecrets: { encryptionSecret: 'c'.repeat(64), fingerprintSecret: 'd'.repeat(64) },
  lookupSecrets: { encryptionSecret, fingerprintSecret },
}).lookup;
const receiver = {
  receiverRevisionId: revisionId,
  receiverVersion: 3,
  ciphertext: protectedReceiver.ciphertext,
  masked: protectedReceiver.masked,
  protectionProfileVersion: protectedReceiver.protectionProfileVersion,
  encryptionKeyVersion: protectedReceiver.encryptionKeyVersion,
};
const child = deriveCbeBirrReceiverLookupChildKey({
  receiverRevisionId: revisionId,
  receiverVersion: 3,
  encryptionSecret,
});
const root = {
  version: 2 as const,
  purpose: 'cbe_birr_receiver_lookup' as const,
  encryptionMasterFingerprint: keyId(encryptionSecret),
  fingerprintMasterFingerprint: keyId(fingerprintSecret),
};
const profile = {
  version: 1 as const,
  providerCode: 'cbe_birr' as const,
  purpose: 'receiver-lookup-opening' as const,
  receiverRevisionId: revisionId,
  receiverVersion: 3,
  keyId: child.keyId,
  rootEncryptionMasterFingerprint: root.encryptionMasterFingerprint,
  rootFingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
};

describe('protected receiver to one-fetch CBE advisory path', () => {
  it('uses the one opened revision for the official selector and PDF receiver comparison', async () => {
    const transport = vi.fn(async (plan: { pathAndQuery: string }) => {
      expect(plan.pathAndQuery).toBe(
        `/aureceipt?TID=${SYNTHETIC_REFERENCE}&PH=${SYNTHETIC_PHONE.slice(3)}`,
      );
      return { ok: true, body: syntheticPdfEnvelope() };
    });
    const parser = vi.fn(async (...args: Parameters<typeof parseCbeBirrAuthoritativePdf>) => {
      const expectations = args[1] as CbeBirrAuthoritativePdfParserExpectations;
      expect(expectations.configuredReceiverAccountIdentifier).toBe(SYNTHETIC_PHONE);
      expect(expectations.canonicalReference).toBe(SYNTHETIC_REFERENCE);
      return parseCbeBirrAuthoritativePdf(...args);
    });
    const result = await retrieveAndParseCbeBirrReceiptForProtectedReceiverAdvisoryOnly(
      SYNTHETIC_REFERENCE,
      receiver,
      child,
      profile,
      root,
      allowedTransportControl,
      transport,
      parser,
    );

    expect(transport).toHaveBeenCalledTimes(1);
    expect(parser).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      disposition: 'parsed_advisory',
      advisoryOnly: true,
      runtimeWiringAllowed: false,
      financialActionAllowed: false,
    });
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_PHONE);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_REFERENCE);
    expect(JSON.stringify(result)).not.toContain(protectedReceiver.ciphertext);
  });

  it('stops before opening a bad receiver or making a provider request', async () => {
    const transport = vi.fn(async () => ({ ok: true, body: syntheticPdfEnvelope() }));
    const parser = vi.fn(parseCbeBirrAuthoritativePdf);
    for (const [reference, boundReceiver, boundChild, control, disposition] of [
      [
        SYNTHETIC_REFERENCE,
        receiver,
        child,
        { ...allowedTransportControl, incidentStop: 'open' },
        'transport_failed_closed',
      ],
      [
        SYNTHETIC_REFERENCE,
        receiver,
        child,
        { ...allowedTransportControl, providerRequest: 'disabled' },
        'transport_failed_closed',
      ],
      ['bad reference', receiver, child, allowedTransportControl, 'transport_failed_closed'],
      [
        SYNTHETIC_REFERENCE,
        { ...receiver, receiverVersion: 4 },
        child,
        allowedTransportControl,
        'receiver_unavailable',
      ],
      [
        SYNTHETIC_REFERENCE,
        receiver,
        { ...child, keyHex: 'e'.repeat(64) },
        allowedTransportControl,
        'receiver_unavailable',
      ],
    ] as const) {
      const result = await retrieveAndParseCbeBirrReceiptForProtectedReceiverAdvisoryOnly(
        reference,
        boundReceiver,
        boundChild,
        profile,
        root,
        control,
        transport,
        parser,
      );
      expect(result.disposition).toBe(disposition);
      expect(result.financialActionAllowed).toBe(false);
      expect(JSON.stringify(result)).not.toContain(SYNTHETIC_PHONE);
    }
    expect(transport).not.toHaveBeenCalled();
    expect(parser).not.toHaveBeenCalled();
  });
});
