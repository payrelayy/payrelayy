import { describe, expect, it } from 'vitest';

import {
  formatTelegramDepositProofStatusCallback,
  formatTelegramDepositProofTrackingHandle,
  isTelegramDepositProofToken,
  parseTelegramDepositProofStatusCallback,
  parseTelegramDepositProofTrackingHandle,
} from './telegram-deposit-proof-tracking.js';
import { redactTelegramPrivateActionForLog } from './telegram-private-action.js';

describe('Telegram deposit proof tracking presentation', () => {
  it.each(['A', 'Q', 'g', 'w'])('roundtrips canonical UUID padding ending in %s', (last) => {
    const token = `${'B'.repeat(21)}${last}`;
    const handle = formatTelegramDepositProofTrackingHandle(token);
    const callback = formatTelegramDepositProofStatusCallback(token);
    expect(handle).toBe(`p1.${token}`);
    expect(callback).toBe(`dps1.${token}`);
    expect(parseTelegramDepositProofTrackingHandle(handle)).toBe(token);
    expect(parseTelegramDepositProofStatusCallback(callback)).toBe(token);
    expect(Buffer.byteLength(callback)).toBe(27);
    expect(parseTelegramDepositProofTrackingHandle(callback)).toBeUndefined();
    expect(parseTelegramDepositProofStatusCallback(handle)).toBeUndefined();
    expect(parseTelegramDepositProofTrackingHandle(token)).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    123,
    '',
    'A'.repeat(21),
    'A'.repeat(23),
    'B'.repeat(22),
    `${'A'.repeat(22)}=`,
    `${'A'.repeat(21)}+`,
    `${'A'.repeat(22)}\n`,
    ` ${'A'.repeat(22)}`,
  ])('rejects malformed or noncanonical token %j', (token) => {
    expect(isTelegramDepositProofToken(token)).toBe(false);
    expect(parseTelegramDepositProofTrackingHandle(`p1.${String(token)}`)).toBeUndefined();
    expect(parseTelegramDepositProofStatusCallback(`dps1.${String(token)}`)).toBeUndefined();
    if (typeof token === 'string') {
      expect(() => formatTelegramDepositProofTrackingHandle(token)).toThrow();
      expect(() => formatTelegramDepositProofStatusCallback(token)).toThrow();
    }
  });

  it('keeps a proof tracking token out of the transport log projection', () => {
    expect(
      redactTelegramPrivateActionForLog({
        version: 1,
        kind: 'deposit_proof_status_command',
        updateId: '1',
        telegramUserId: '2',
        privateChatId: '2',
        preferredLocale: 'en',
        proofToken: 'A'.repeat(22),
      }),
    ).toEqual({
      version: 1,
      kind: 'deposit_proof_status_command',
      preferredLocale: 'en',
      customerInputPresent: true,
    });
  });
});
