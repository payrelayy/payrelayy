import { describe, expect, it } from 'vitest';

import {
  TELEGRAM_PLAYER_REGISTRATION_CAPABILITY_CALLBACK_MAX_BYTES,
  formatTelegramPlayerRegistrationCapabilityCallback,
  parseTelegramPlayerRegistrationCapabilityCallback,
} from './telegram-action-capability.js';

const compactCapabilityId = 'AAAAAAAAAAAAAAAAAAAAAA';
const token = '_____________________w';

describe('Telegram Player ID capability callback contract', () => {
  it("formats the compact opaque callback below Telegram's byte limit", () => {
    const callbackData = formatTelegramPlayerRegistrationCapabilityCallback({
      compactCapabilityId,
      token,
    });

    expect(callbackData).toBe(`prc1.${compactCapabilityId}.${token}`);
    expect(Buffer.byteLength(callbackData, 'utf8')).toBe(50);
    expect(Buffer.byteLength(callbackData, 'utf8')).toBeLessThanOrEqual(
      TELEGRAM_PLAYER_REGISTRATION_CAPABILITY_CALLBACK_MAX_BYTES,
    );
  });

  it('parses only the exact opaque presentation', () => {
    const callbackData = formatTelegramPlayerRegistrationCapabilityCallback({
      compactCapabilityId,
      token,
    });

    expect(parseTelegramPlayerRegistrationCapabilityCallback(callbackData)).toEqual({
      compactCapabilityId,
      token,
    });
    expect(
      parseTelegramPlayerRegistrationCapabilityCallback('start:player-registration'),
    ).toBeUndefined();
    expect(
      parseTelegramPlayerRegistrationCapabilityCallback(`prc1.${compactCapabilityId}.short`),
    ).toBeUndefined();
    expect(
      parseTelegramPlayerRegistrationCapabilityCallback(
        `prc1.${compactCapabilityId}.${token}.extra`,
      ),
    ).toBeUndefined();
  });

  it('rejects malformed parts before formatting', () => {
    expect(() =>
      formatTelegramPlayerRegistrationCapabilityCallback({
        compactCapabilityId: 'not-a-compact-id',
        token,
      }),
    ).toThrow('canonical compact parts');
  });
});
