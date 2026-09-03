import { describe, expect, it } from 'vitest';

import {
  isRecognizedTelegramDepositCommand,
  isRecognizedTelegramDepositProofStatusCallback,
  isRecognizedTelegramDepositStatusCommand,
  isTelegramPrivateHelpCommand,
  reduceTelegramDepositIntentCommand,
  reduceTelegramDepositProofCommand,
  reduceTelegramDepositProofStatusCallbackAction,
  reduceTelegramDepositReferenceCommand,
  reduceTelegramDepositStatusCommand,
  reduceTelegramPlayerIdTextAction,
  reduceTelegramPlayerRegistrationCallbackAction,
  reduceTelegramRootMenuAction,
} from './telegram-private-action.js';

const privateMetadata = {
  updateId: 123456,
  chat: { id: 123456789, type: 'private' },
  from: {
    id: 123456789,
    isBot: false,
    languageCode: 'am-ET',
  },
} as const;

const callbackData = 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w';

describe('private Telegram action reducers', () => {
  it('reduces only exact root-menu commands to an English-only envelope', () => {
    expect(reduceTelegramRootMenuAction({ ...privateMetadata, command: '/start' })).toEqual({
      version: 1,
      kind: 'root_menu',
      updateId: '123456',
      telegramUserId: '123456789',
      privateChatId: '123456789',
      preferredLocale: 'en',
    });
    expect(reduceTelegramRootMenuAction({ ...privateMetadata, command: '/start extra' })).toBe(
      undefined,
    );
  });

  it('accepts only a compact Player ID capability callback within Telegram’s byte limit', () => {
    const action = reduceTelegramPlayerRegistrationCallbackAction({
      ...privateMetadata,
      callbackData,
    });

    expect(action).toMatchObject({
      kind: 'player_registration_callback',
      callbackData,
      preferredLocale: 'en',
    });
    expect(Buffer.byteLength(callbackData, 'utf8')).toBeLessThanOrEqual(64);
    expect(
      reduceTelegramPlayerRegistrationCallbackAction({
        ...privateMetadata,
        callbackData: 'start:player-registration',
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramPlayerRegistrationCallbackAction({
        ...privateMetadata,
        callbackData: `${callbackData}x`.repeat(2),
      }),
    ).toBeUndefined();
  });

  it('rejects unsafe chat identities and control-character Player ID text', () => {
    expect(
      reduceTelegramPlayerIdTextAction({ ...privateMetadata, text: 'player\u0000id' }),
    ).toBeUndefined();
    expect(
      reduceTelegramPlayerIdTextAction({
        ...privateMetadata,
        text: 'x'.repeat(65),
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramPlayerIdTextAction({
        ...privateMetadata,
        chat: { id: 123456788, type: 'private' },
        text: 'player-123',
      }),
    ).toBeUndefined();
  });

  it('preserves bounded text only in memory for a later database authority', () => {
    expect(
      reduceTelegramPlayerIdTextAction({ ...privateMetadata, text: 'player-123' }),
    ).toMatchObject({
      kind: 'player_id_text',
      playerId: 'player-123',
      preferredLocale: 'en',
    });
  });

  it('reduces only exact deposit commands', () => {
    expect(
      reduceTelegramDepositIntentCommand({
        ...privateMetadata,
        command: '/deposit PLAYER-DEMO-42 25.00',
      }),
    ).toMatchObject({
      kind: 'deposit_intent_command',
      playerId: 'PLAYER-DEMO-42',
      amountEtb: '25.00',
    });
    expect(
      reduceTelegramDepositIntentCommand({
        ...privateMetadata,
        command: '/deposit PLAYER-DEMO-42 25 extra',
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramDepositIntentCommand({
        ...privateMetadata,
        command: '/deposit PLAYER-DEMO-42 0',
      }),
    ).toBeUndefined();
  });

  it('reduces an amount-free proof command only for an approved provider and one safe reference', () => {
    expect(
      reduceTelegramDepositProofCommand({
        ...privateMetadata,
        command: '/deposit telebirr PLAYER-DEMO-42 SYNTHETICREF7890',
      }),
    ).toMatchObject({
      kind: 'deposit_proof_command',
      providerCode: 'telebirr',
      playerId: 'PLAYER-DEMO-42',
      transactionReference: 'SYNTHETICREF7890',
    });
    expect(
      reduceTelegramDepositProofCommand({
        ...privateMetadata,
        command: '/deposit cbe_birr PLAYER-DEMO-42 SYNTHETICCBE7890',
      }),
    ).toMatchObject({ kind: 'deposit_proof_command', providerCode: 'cbe_birr' });
    expect(
      reduceTelegramDepositProofCommand({
        ...privateMetadata,
        command: '/deposit unknown PLAYER-DEMO-42 SYNTHETICREF7890',
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramDepositProofCommand({
        ...privateMetadata,
        command: '/deposit telebirr PLAYER-DEMO-42 raw reference',
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramDepositProofCommand({
        ...privateMetadata,
        command: '/deposit telebirr PLAYER-DEMO-42 ABCD',
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramDepositProofCommand({
        ...privateMetadata,
        command: '/deposit telebirr PLAYER-DEMO-42 SYNTHETIC-REF-7890',
      }),
    ).toBeUndefined();
  });

  it('recognizes malformed and legacy amount-bearing deposit commands without echoing input', () => {
    expect(
      isRecognizedTelegramDepositCommand({
        ...privateMetadata,
        command: '/deposit PLAYER-DEMO-42 25.00',
      }),
    ).toBe(true);
    expect(
      isRecognizedTelegramDepositCommand({
        ...privateMetadata,
        command: '/deposit telebirr PLAYER-DEMO-42 INVALID-REFERENCE',
      }),
    ).toBe(true);
    expect(
      isRecognizedTelegramDepositCommand({ ...privateMetadata, command: '/deposit_status token' }),
    ).toBe(false);
    expect(
      isRecognizedTelegramDepositCommand({
        ...privateMetadata,
        chat: { id: 123456788, type: 'private' },
        command: '/deposit PLAYER-DEMO-42 25.00',
      }),
    ).toBe(false);
  });

  it('reduces a status command to the same non-authoritative compact token presentation', () => {
    const depositToken = 'AAAAAAAAAAAAAAAAAAAAAA';
    expect(
      reduceTelegramDepositStatusCommand({
        ...privateMetadata,
        command: `/deposit_status ${depositToken}`,
      }),
    ).toMatchObject({ kind: 'deposit_status_command', depositToken });
    expect(
      reduceTelegramDepositStatusCommand({
        ...privateMetadata,
        command: `/deposit_status ${depositToken} extra`,
      }),
    ).toBeUndefined();
  });

  it('keeps proof status command and callback separate from the legacy deposit namespace', () => {
    const proofToken = 'AAAAAAAAAAAAAAAAAAAAAA';
    const commandAction = reduceTelegramDepositStatusCommand({
      ...privateMetadata,
      command: `/deposit_status p1.${proofToken}`,
    });
    expect(commandAction).toEqual({
      version: 1,
      updateId: '123456',
      telegramUserId: '123456789',
      privateChatId: '123456789',
      preferredLocale: 'en',
      kind: 'deposit_proof_status_command',
      proofToken,
    });
    expect(
      reduceTelegramDepositProofStatusCallbackAction({
        ...privateMetadata,
        callbackData: `dps1.${proofToken}`,
      }),
    ).toEqual(commandAction);
    expect(
      reduceTelegramDepositStatusCommand({
        ...privateMetadata,
        command: `/deposit_status ${proofToken}`,
      }),
    ).toMatchObject({ kind: 'deposit_status_command', depositToken: proofToken });
    expect(
      reduceTelegramPlayerRegistrationCallbackAction({
        ...privateMetadata,
        callbackData: `dps1.${proofToken}`,
      }),
    ).toBeUndefined();
  });

  it.each([
    '/deposit_status',
    '/deposit_status p1.invalid',
    `/deposit_status p1.${'B'.repeat(22)}`,
    `/deposit_status p1.${'A'.repeat(23)}`,
    `/deposit_status p1.${'A'.repeat(22)} extra`,
    `/deposit_status p1.${'A'.repeat(22)}\n`,
    `/deposit_status dps1.${'A'.repeat(22)}`,
  ])('recognizes malformed status for a generic reply without dispatch: %s', (command) => {
    expect(isRecognizedTelegramDepositStatusCommand({ ...privateMetadata, command })).toBe(true);
    expect(reduceTelegramDepositStatusCommand({ ...privateMetadata, command })).toBeUndefined();
  });

  it.each(['dps1', 'dps1.invalid', `dps1.${'B'.repeat(22)}`, `dps1.${'A'.repeat(22)}.extra`])(
    'recognizes malformed proof callback for a generic reply without dispatch: %s',
    (callbackData) => {
      expect(
        isRecognizedTelegramDepositProofStatusCallback({ ...privateMetadata, callbackData }),
      ).toBe(true);
      expect(
        reduceTelegramDepositProofStatusCallbackAction({ ...privateMetadata, callbackData }),
      ).toBeUndefined();
    },
  );

  it.each([
    { chat: { id: 123456789, type: 'group' } },
    { chat: { id: 123456788, type: 'private' } },
    { from: { id: 123456789, isBot: true, languageCode: 'en' } },
    { updateId: Number.NaN },
  ])('rejects help and proof status from an unsafe identity', (override) => {
    const metadata = { ...privateMetadata, ...override };
    expect(isTelegramPrivateHelpCommand({ ...metadata, command: '/help' })).toBe(false);
    expect(
      reduceTelegramDepositStatusCommand({
        ...metadata,
        command: `/deposit_status p1.${'A'.repeat(22)}`,
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramDepositProofStatusCallbackAction({
        ...metadata,
        callbackData: `dps1.${'A'.repeat(22)}`,
      }),
    ).toBeUndefined();
    expect(
      isRecognizedTelegramDepositStatusCommand({ ...metadata, command: '/deposit_status bad' }),
    ).toBe(false);
    expect(
      isRecognizedTelegramDepositProofStatusCallback({ ...metadata, callbackData: 'dps1.bad' }),
    ).toBe(false);
  });

  it('recognizes only exact help in an authenticated private chat identity', () => {
    expect(isTelegramPrivateHelpCommand({ ...privateMetadata, command: '/help' })).toBe(true);
    expect(isTelegramPrivateHelpCommand({ ...privateMetadata, command: '/help extra' })).toBe(
      false,
    );
    expect(
      isRecognizedTelegramDepositStatusCommand({
        ...privateMetadata,
        command: '/deposit_statuses',
      }),
    ).toBe(false);
  });

  it('reduces only one compact deposit token and one bounded reference', () => {
    const depositToken = 'AAAAAAAAAAAAAAAAAAAAAA';
    expect(
      reduceTelegramDepositReferenceCommand({
        ...privateMetadata,
        command: `/reference ${depositToken} TX-ABC-7890`,
      }),
    ).toMatchObject({
      kind: 'deposit_reference_command',
      depositToken,
      transactionReference: 'TX-ABC-7890',
    });
    expect(
      reduceTelegramDepositReferenceCommand({
        ...privateMetadata,
        command: `/reference ${depositToken} raw reference`,
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramDepositReferenceCommand({
        ...privateMetadata,
        command: '/reference invalid TX-ABC-7890',
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramDepositReferenceCommand({
        ...privateMetadata,
        command: `/reference ${depositToken} ABCD`,
      }),
    ).toBeUndefined();
  });
});
