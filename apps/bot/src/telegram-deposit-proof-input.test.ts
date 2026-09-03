import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TELEGRAM_DEPOSIT_PROOF_COMMAND_MAX_BYTES,
  reduceTelegramDepositProofInput,
} from './telegram-deposit-proof-input.js';
import {
  reduceTelegramDepositProofCommand,
  reduceTelegramDepositProofSubmission,
} from './telegram-private-action.js';

const metadata = {
  updateId: 123456,
  chat: { id: 123456789, type: 'private' },
  from: { id: 123456789, isBot: false, languageCode: 'am-ET' },
} as const;
const reference = 'SYNTB00000001';
const otherReference = 'SYNTB00000002';
const prefix = '/deposit telebirr PLAYER-DEMO-42 ';

afterEach(() => vi.unstubAllGlobals());

describe('Telegram amount-free TeleBirr proof input', () => {
  it.each(['telebirr', 'cbe_birr'] as const)(
    'preserves the established %s direct-reference action for exact delivery retries',
    (providerCode) => {
      const command = `/deposit ${providerCode} PLAYER-DEMO-42 syntb00000001`;
      const expected = {
        version: 1,
        kind: 'deposit_proof_command',
        updateId: '123456',
        telegramUserId: '123456789',
        privateChatId: '123456789',
        preferredLocale: 'en',
        providerCode,
        playerId: 'PLAYER-DEMO-42',
        transactionReference: 'syntb00000001',
      };
      expect(reduceTelegramDepositProofSubmission({ ...metadata, command })).toEqual({
        kind: 'action',
        action: expected,
      });
      expect(reduceTelegramDepositProofCommand({ ...metadata, command })).toEqual(expected);
      expect(reduceTelegramDepositProofCommand({ ...metadata, command })).toEqual(expected);
    },
  );

  it.each([
    `https://transactioninfo.ethiotelecom.et/receipt/${reference}`,
    `https://customer-controlled.invalid/receipt/${reference}?redirect=https://other.invalid`,
    `Transaction number is syntb00000001.Thank you.`,
    `Synthetic receipt\r\nTransaction ID: ${reference}\r\nPaid ETB 900.00, fee ETB 5.00.`,
    `Transaction ID: ${reference}.\nhttps://example.invalid/receipt/${reference}`,
    `Invoice No. ${reference}. Transaction ID: syntb00000001.`,
  ])('forwards only one candidate and never opens pasted content', (proofText) => {
    const fetch = vi.fn(() => {
      throw new Error('No candidate extraction may access a network.');
    });
    vi.stubGlobal('fetch', fetch);

    const result = reduceTelegramDepositProofSubmission({
      ...metadata,
      command: prefix + proofText,
    });
    expect(result).toEqual({
      kind: 'action',
      action: {
        version: 1,
        kind: 'deposit_proof_command',
        updateId: '123456',
        telegramUserId: '123456789',
        privateChatId: '123456789',
        preferredLocale: 'en',
        providerCode: 'telebirr',
        playerId: 'PLAYER-DEMO-42',
        transactionReference: reference,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /https:|receipt\/|900|5\.00|Invoice|Synthetic receipt/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts a pasted direct TeleBirr ID with surrounding whitespace without changing its case', () => {
    expect(reduceTelegramDepositProofInput('telebirr', ' \nsyntb00000001\r\n')).toEqual({
      kind: 'candidate',
      transactionReference: 'syntb00000001',
    });
  });

  it.each([
    `Transaction ID: ${reference}. Invoice No. ${otherReference}.`,
    `https://example.invalid/receipt/${reference} Transaction ID: ${otherReference}.`,
    `https://one.invalid/receipt/${reference}\nhttps://two.invalid/receipt/${otherReference}`,
  ])(
    'requires explicit customer selection instead of guessing or returning candidates',
    (proofText) => {
      const command = prefix + proofText;
      const result = reduceTelegramDepositProofSubmission({ ...metadata, command });
      expect(result).toEqual({ kind: 'selection_required' });
      expect(reduceTelegramDepositProofCommand({ ...metadata, command })).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(reference);
      expect(JSON.stringify(result)).not.toContain(otherReference);
    },
  );

  it.each([
    '',
    'short',
    'A'.repeat(33),
    'SYNTB-00000001',
    'SYNТB00000001',
    'Transaction ID: SYNTB00000001é',
    'Transaction ID: SYNTB00000001_2',
    'Transaction ID: SYNTB00000001-ABCD',
    'Transaction ID: SYNTB00000ſ1',
    `Transaction ID: ${reference}. Transaction ID: short.`,
    `Transaction ID: ${reference}. Invoice No. ${'A'.repeat(33)}.`,
    'No transaction reference here. Paid ETB 900.00 to Synthetic Receiver.',
    `Transaction ID: ${reference}\u0000`,
    `Transaction ID: ${reference}\u000b`,
    `Transaction ID: ${reference}\u007f`,
  ])('rejects invalid or conflicting malformed input without echoing material', (proofText) => {
    const result = reduceTelegramDepositProofSubmission({
      ...metadata,
      command: prefix + proofText,
    });
    expect(result).toEqual({ kind: 'invalid_input' });
  });

  it.each([
    `https://example.invalid/receipt/${reference}`,
    `Transaction ID: ${reference}`,
    ` ${reference}`,
    `${reference}\n`,
  ])('does not apply TeleBirr extraction or whitespace normalization to CBE Birr', (proofText) => {
    expect(
      reduceTelegramDepositProofSubmission({
        ...metadata,
        command: `/deposit cbe_birr PLAYER-DEMO-42 ${proofText}`,
      }),
    ).toEqual({ kind: 'invalid_input' });
  });

  it('bounds the entire command in UTF-8 bytes, not just the extracted reference or code points', () => {
    const ending = ` Transaction ID: ${reference}`;
    const command =
      prefix +
      '.'.repeat(TELEGRAM_DEPOSIT_PROOF_COMMAND_MAX_BYTES - prefix.length - ending.length) +
      ending;
    expect(Buffer.byteLength(command, 'utf8')).toBe(TELEGRAM_DEPOSIT_PROOF_COMMAND_MAX_BYTES);
    expect(reduceTelegramDepositProofSubmission({ ...metadata, command })).toMatchObject({
      kind: 'action',
    });
    expect(reduceTelegramDepositProofSubmission({ ...metadata, command: command + '.' })).toEqual({
      kind: 'invalid_input',
    });
    const multibyteCommand = prefix + 'é'.repeat(8192) + ending;
    expect(multibyteCommand.length).toBeLessThan(TELEGRAM_DEPOSIT_PROOF_COMMAND_MAX_BYTES);
    expect(
      reduceTelegramDepositProofSubmission({ ...metadata, command: multibyteCommand }),
    ).toEqual({ kind: 'invalid_input' });
  });

  it.each([
    '/deposit',
    '/deposit telebirr',
    '/deposit telebirr PLAYER-DEMO-42',
    `/deposit unknown PLAYER-DEMO-42 ${reference}`,
    '/deposit PLAYER-DEMO-42 25.00',
    `/deposit telebirr ${'A'.repeat(65)} ${reference}`,
    `/deposit telebirr PLAYER\u0000DEMO ${reference}`,
  ])('recognizes invalid commands for safe local guidance without an API action', (command) => {
    expect(reduceTelegramDepositProofSubmission({ ...metadata, command })).toEqual({
      kind: 'invalid_input',
    });
  });

  it.each(['/deposit_status p1.AAAAAAAAAAAAAAAAAAAAAA', '/deposits', '/help', undefined])(
    'leaves non-deposit commands to their existing handler',
    (command) => {
      expect(reduceTelegramDepositProofSubmission({ ...metadata, command })).toBeUndefined();
    },
  );

  it.each([
    { chat: { id: 123456789, type: 'group' } },
    { chat: { id: 123456788, type: 'private' } },
    { from: { id: 123456789, isBot: true, languageCode: 'en' } },
    { chat: undefined },
    { from: undefined },
    { updateId: Number.NaN },
    { updateId: -1 },
  ])('does not extract or dispatch for an unsafe private-chat identity', (override) => {
    expect(
      reduceTelegramDepositProofSubmission({
        ...metadata,
        ...override,
        command: prefix + `Transaction ID: ${reference}`,
      }),
    ).toBeUndefined();
  });
});
