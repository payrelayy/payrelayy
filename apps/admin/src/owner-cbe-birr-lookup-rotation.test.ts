import { describe, expect, it, vi } from 'vitest';

import {
  OwnerCbeBirrLookupRotationRejectedError,
  OwnerCbeBirrLookupRotationUnavailableError,
  PostgresOwnerCbeBirrLookupRotation,
  type OwnerCbeBirrLookupRotationRequest,
} from './owner-cbe-birr-lookup-rotation.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const request: OwnerCbeBirrLookupRotationRequest = {
  accountHolderName: 'Synthetic Receiver',
  accountReference: '251000000123',
  receiverRevisionId: '22222222-2222-4222-8222-222222222222',
  receiverVersion: 2,
  requestId: '33333333-3333-4333-8333-333333333333',
  rotationReason: 'account_rotation',
};
const referenceSecrets = Object.freeze({
  encryptionSecret: 'a'.repeat(64),
  fingerprintSecret: 'b'.repeat(64),
});
const lookupSecrets = Object.freeze({
  encryptionSecret: 'c'.repeat(64),
  fingerprintSecret: 'd'.repeat(64),
});

function result(overrides: Record<string, unknown> = {}) {
  return {
    rows: [
      {
        receiver_revision_id: request.receiverRevisionId,
        revision: request.receiverVersion,
        receiver_status: 'active',
        active_from: new Date('2026-10-17T10:00:00.000Z'),
        lookup_protected: true,
        ...overrides,
      },
    ],
  };
}

describe('default-off Owner CBE Birr v2 rotation adapter', () => {
  it('prepares both protections from one exact phone and sends only envelopes to the private SQL function', async () => {
    const query = vi.fn(async (_sql: string, _values: readonly (number | string)[]) => result());
    const controller = new PostgresOwnerCbeBirrLookupRotation(
      { query },
      referenceSecrets,
      lookupSecrets,
    );
    const receipt = await controller.rotate(authUserId, request);
    expect(receipt).toEqual({
      accountHolderName: request.accountHolderName,
      accountReferenceMasked: '***0123',
      activeFrom: '2026-10-17T10:00:00.000Z',
      lookupProtected: true,
      providerCode: 'cbe_birr',
      receiverRevisionId: request.receiverRevisionId,
      receiverStatus: 'active',
      revision: request.receiverVersion,
      rotationReason: request.rotationReason,
    });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('app.rotate_owner_cbe_birr_receiver_lookup_v2');
    expect(values).toHaveLength(12);
    expect(values.slice(0, 5)).toEqual([
      authUserId,
      request.requestId,
      request.receiverRevisionId,
      request.receiverVersion,
      request.accountHolderName,
    ]);
    expect(values[5]).toMatch(/^receiver-v1[.]cbe_birr[.]/u);
    expect(values[8]).toMatch(/^cbe-receiver-v2[.]/u);
    expect(values[7]).toBe('***0123');
    expect(values[10]).toBe('***0123');
    expect(JSON.stringify(values)).not.toContain(request.accountReference);
    expect(JSON.stringify(receipt)).not.toContain(request.accountReference);
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it('rejects malformed, ambiguous, and accessor requests before any database access', async () => {
    const query = vi.fn(async () => result());
    const controller = new PostgresOwnerCbeBirrLookupRotation(
      { query },
      referenceSecrets,
      lookupSecrets,
    );
    for (const bad of [
      { ...request, accountReference: '000000123' },
      { ...request, receiverVersion: 0 },
      { ...request, receiverRevisionId: request.requestId },
      { ...request, receiverRevisionId: 'not-a-uuid' },
      { ...request, rotationReason: 'unapproved' },
      { ...request, accountHolderName: ' synthetic ' },
      { ...request, extra: true },
    ]) {
      await expect(
        controller.rotate(authUserId, bad as OwnerCbeBirrLookupRotationRequest),
      ).rejects.toBeInstanceOf(OwnerCbeBirrLookupRotationRejectedError);
    }
    let reads = 0;
    const accessor = {
      ...request,
      get accountReference() {
        reads += 1;
        return request.accountReference;
      },
    };
    await expect(controller.rotate(authUserId, accessor)).rejects.toBeInstanceOf(
      OwnerCbeBirrLookupRotationRejectedError,
    );
    expect(reads).toBe(0);
    await expect(
      controller.rotate(authUserId, new Proxy({ ...request }, {})),
    ).rejects.toBeInstanceOf(OwnerCbeBirrLookupRotationRejectedError);
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed on database denial, incompatible keys, or an inconsistent saved receipt', async () => {
    const denied = new PostgresOwnerCbeBirrLookupRotation(
      { query: async () => Promise.reject(new Error('permission denied')) },
      referenceSecrets,
      lookupSecrets,
    );
    await expect(denied.rotate(authUserId, request)).rejects.toBeInstanceOf(
      OwnerCbeBirrLookupRotationUnavailableError,
    );
    const reused = new PostgresOwnerCbeBirrLookupRotation(
      { query: async () => result() },
      referenceSecrets,
      { ...lookupSecrets, encryptionSecret: referenceSecrets.encryptionSecret },
    );
    await expect(reused.rotate(authUserId, request)).rejects.toBeInstanceOf(
      OwnerCbeBirrLookupRotationUnavailableError,
    );
    for (const rows of [
      [],
      result({ receiver_revision_id: '44444444-4444-4444-8444-444444444444' }).rows,
      result({ lookup_protected: false }).rows,
      result({ revision: 3 }).rows,
      result({ active_from: 'not-a-date' }).rows,
    ]) {
      const controller = new PostgresOwnerCbeBirrLookupRotation(
        { query: async () => ({ rows }) },
        referenceSecrets,
        lookupSecrets,
      );
      await expect(controller.rotate(authUserId, request)).rejects.toBeInstanceOf(
        OwnerCbeBirrLookupRotationUnavailableError,
      );
    }
  });
});
