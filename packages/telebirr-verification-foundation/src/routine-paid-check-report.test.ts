import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  routinePaidCheckReportSignatureBytes,
  verifyRoutinePaidCheckReport,
} from './routine-paid-check-report.js';

const lookup = {
  candidateId: '8b9b4a1c-616d-495b-a259-56d39ffef5d1',
  challengeId: '328535af-2636-44cd-84be-6effdfe9cac1',
  challengeDigest: `sha256:${'d'.repeat(64)}`,
  issuedAt: '2026-10-05T18:02:00.000Z',
  expiresAt: '2026-10-05T18:05:00.000Z',
};
const checkedAt = '2026-10-05T18:03:00.000Z';
const assessedAt = '2026-10-05T18:04:00.000Z';

describe('signed paid phone check reason', () => {
  it('keeps a redacted reason bound to the exact challenge and enrolled key', () => {
    const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = device.publicKey.export({ format: 'der', type: 'spki' });
    const body = {
      version: 1 as const,
      candidateId: lookup.candidateId,
      challengeId: lookup.challengeId,
      challengeDigest: lookup.challengeDigest,
      reasonCode: 'unknown_layout_provider_identity',
      checkedAt,
    };
    const report = {
      body,
      signature: sign('sha256', routinePaidCheckReportSignatureBytes(body), {
        key: device.privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url'),
    };
    expect(verifyRoutinePaidCheckReport(report, lookup, assessedAt, publicKey)).toMatchObject({
      candidateId: lookup.candidateId,
      reasonCode: body.reasonCode,
      checkedAt,
    });
    expect(
      verifyRoutinePaidCheckReport(
        report,
        { ...lookup, challengeId: '39d2dd44-07dc-4946-a989-2533d6e90961' },
        assessedAt,
        publicKey,
      ),
    ).toBeUndefined();
    expect(
      verifyRoutinePaidCheckReport(
        report,
        lookup,
        assessedAt,
        other.publicKey.export({ format: 'der', type: 'spki' }),
      ),
    ).toBeUndefined();
    expect(
      verifyRoutinePaidCheckReport(
        { ...report, body: { ...body, reasonCode: 'network_unavailable' } },
        lookup,
        assessedAt,
        publicKey,
      ),
    ).toBeUndefined();
    expect(
      verifyRoutinePaidCheckReport(report, lookup, '2026-10-05T18:21:00.000Z', publicKey),
    ).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain('rawReference');
  });
});
