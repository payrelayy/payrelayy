import { describe, expect, it } from 'vitest';

import {
  KEMERBET_READINESS_COMPLETION_RECEIPT_CONTRACT,
  KemerBetReadinessCompletionReceiptUnavailableError,
  serializeKemerBetReadinessCompletionReceipt,
} from './kemerbet-readiness-completion-receipt.js';

const RELEASE_SHA = 'a'.repeat(40);
const NONCE_SHA = 'b'.repeat(64);
const BINDING_SHA = 'c'.repeat(64);

describe('KemerBet readiness generic completion receipt', () => {
  it('contains only the reviewed release, nonce digest, fixed proofs, and exact sequences', () => {
    const serialized = serializeKemerBetReadinessCompletionReceipt({
      agentIdentityBindingSha256: BINDING_SHA,
      releaseSha: RELEASE_SHA,
      runNonceSha256: NONCE_SHA,
      sameAgentIdentityValidated: true,
      sequences: [1, 2, 3, 4, 5],
    });
    expect(serialized.endsWith('\n')).toBe(true);
    expect(JSON.parse(serialized) as unknown).toEqual({
      contract: 'fetanagent-kemerbet-readiness-layer7-completion-v2',
      agentIdentityBindingSha256: BINDING_SHA,
      identifiersRedacted: true,
      moneyMoved: false,
      releaseSha: RELEASE_SHA,
      responsesValidated: true,
      runNonceSha256: NONCE_SHA,
      sameAgentIdentityValidated: true,
      sequences: [1, 2, 3, 4, 5],
      transferDisabled: true,
      version: 2,
    });
    expect(serialized).not.toContain('externalId');
    expect(serialized).not.toContain('Bearer');
    expect(KEMERBET_READINESS_COMPLETION_RECEIPT_CONTRACT).toMatchObject({
      file: '/run/output/completion-receipt',
      mode: 0o400,
      ownerUserId: 10003,
    });
  });

  it.each([
    {
      agentIdentityBindingSha256: BINDING_SHA,
      releaseSha: 'A'.repeat(40),
      runNonceSha256: NONCE_SHA,
      sameAgentIdentityValidated: true as const,
      sequences: [1, 2, 3, 4, 5],
    },
    {
      agentIdentityBindingSha256: 'c'.repeat(63),
      releaseSha: RELEASE_SHA,
      runNonceSha256: NONCE_SHA,
      sameAgentIdentityValidated: true as const,
      sequences: [1, 2, 3, 4, 5],
    },
    {
      agentIdentityBindingSha256: BINDING_SHA,
      releaseSha: RELEASE_SHA,
      runNonceSha256: 'b'.repeat(63),
      sameAgentIdentityValidated: true as const,
      sequences: [1, 2, 3, 4, 5],
    },
    {
      agentIdentityBindingSha256: BINDING_SHA,
      releaseSha: RELEASE_SHA,
      runNonceSha256: NONCE_SHA,
      sameAgentIdentityValidated: true as const,
      sequences: [1, 2, 4, 3, 5],
    },
    {
      agentIdentityBindingSha256: BINDING_SHA,
      releaseSha: RELEASE_SHA,
      runNonceSha256: NONCE_SHA,
      sameAgentIdentityValidated: true as const,
      sequences: [1, 2, 3, 4],
    },
  ])('rejects a non-exact proof contract %#', (input) => {
    expect(() => serializeKemerBetReadinessCompletionReceipt(input)).toThrow(
      KemerBetReadinessCompletionReceiptUnavailableError,
    );
  });
});
