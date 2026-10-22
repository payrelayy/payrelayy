import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TELEGRAM_DEPOSIT_PROOF_COMMAND_MAX_BYTES,
  reduceTelegramAutoReceiverSmsProofInput,
  reduceTelegramDepositProofInput,
} from './telegram-deposit-proof-input.js';
import {
  reduceTelegramDepositProofCommand,
  reduceTelegramDepositProofSubmission,
  reduceTelegramGuidedDepositMediaSubmission,
} from './telegram-private-action.js';
import { buildTelegramTelebirrPaymentPrompt } from './telegram-guided-deposit.js';

const metadata = {
  updateId: 123456,
  chat: { id: 123456789, type: 'private' },
  from: { id: 123456789, isBot: false, languageCode: 'am-ET' },
} as const;
const reference = 'SYNTB00000001';
const otherReference = 'SYNTB00000002';
const prefix = '/deposit telebirr PLAYER-DEMO-42 ';
const paymentPrompt = {
  from: { is_bot: true },
  text: buildTelegramTelebirrPaymentPrompt({
    playerId: 'PLAYER-DEMO-42',
    receiverAccountHolderName: 'Synthetic Receiver',
    receiverAccountReference: '0912345678',
  }),
};

afterEach(() => vi.unstubAllGlobals());

describe('Telegram amount-free TeleBirr proof input', () => {
  it('chooses the incoming SMS ledger from an exact 10 or 11 character reference', () => {
    expect(reduceTelegramAutoReceiverSmsProofInput(' tb12345678 ')).toEqual({
      kind: 'candidate',
      providerCode: 'telebirr',
      transactionReference: 'TB12345678',
    });
    expect(reduceTelegramAutoReceiverSmsProofInput(' cbe12345678 ')).toEqual({
      kind: 'candidate',
      providerCode: 'cbe_birr',
      transactionReference: 'CBE12345678',
    });
    expect(reduceTelegramAutoReceiverSmsProofInput('TB1234567890')).toEqual({
      kind: 'invalid_input',
    });
    expect(reduceTelegramAutoReceiverSmsProofInput('ABCDEFGHIJ')).toEqual({
      kind: 'invalid_input',
    });
  });

  it('uses references in pasted SMS and receipt links without opening a URL or trusting branding', () => {
    const fetch = vi.fn(() => {
      throw new Error('Candidate extraction must stay offline.');
    });
    vi.stubGlobal('fetch', fetch);
    expect(
      reduceTelegramAutoReceiverSmsProofInput('TeleBirr transaction number is TB12345678.'),
    ).toMatchObject({ kind: 'candidate', providerCode: 'telebirr' });
    expect(
      reduceTelegramAutoReceiverSmsProofInput(
        'Dear customer, you received 25Br. Txn ID CBE12345678.',
      ),
    ).toMatchObject({ kind: 'candidate', providerCode: 'cbe_birr' });
    expect(
      reduceTelegramAutoReceiverSmsProofInput('Receipt Number: CBE12345678.', 'pdf_text'),
    ).toMatchObject({ kind: 'candidate', providerCode: 'cbe_birr' });
    expect(
      reduceTelegramAutoReceiverSmsProofInput(
        'https://cbepay1.cbe.com.et/aureceipt?TID=CBE12345678&PH=000000000000',
      ),
    ).toMatchObject({ kind: 'candidate', providerCode: 'cbe_birr' });
    expect(
      reduceTelegramAutoReceiverSmsProofInput(
        'https://transactioninfo.ethiotelecom.et/receipt/TB12345678',
      ),
    ).toMatchObject({ kind: 'candidate', providerCode: 'telebirr' });
    expect(
      reduceTelegramAutoReceiverSmsProofInput('CBE Birr receipt Transaction ID: TB12345678.'),
    ).toMatchObject({ kind: 'candidate', providerCode: 'telebirr' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not choose a method for conflicting or malformed payment information', () => {
    expect(
      reduceTelegramAutoReceiverSmsProofInput('Transaction ID: TB12345678. Txn ID: CBE12345678.'),
    ).toEqual({ kind: 'selection_required' });
    expect(
      reduceTelegramAutoReceiverSmsProofInput(
        'Transaction ID: TB12345678. https://cbepay1.cbe.com.et/aureceipt?TID=CBE12345678&PH=000000000000',
      ),
    ).toEqual({ kind: 'selection_required' });
    expect(
      reduceTelegramAutoReceiverSmsProofInput(
        'Transaction ID: TB12345678. https://cbepay1.cbe.com.et/aureceipt?TID=short&PH=000000000000',
      ),
    ).toEqual({ kind: 'invalid_input' });
  });
  it.each(['ocr_text', 'pdf_text'] as const)(
    'reduces a %s attachment to the same protected reference-only action',
    (sourceKind) => {
      expect(
        reduceTelegramGuidedDepositMediaSubmission({
          ...metadata,
          replyToMessage: paymentPrompt,
          caption: undefined,
          extractedText: 'Transaction ID: syntb00000001. Amount ETB 900.00.',
          sourceKind,
        }),
      ).toEqual({
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
    },
  );

  it('compares a caption reference with the attachment and never guesses on a conflict', () => {
    expect(
      reduceTelegramGuidedDepositMediaSubmission({
        ...metadata,
        replyToMessage: paymentPrompt,
        caption: otherReference,
        extractedText: `Transaction ID: ${reference}`,
        sourceKind: 'ocr_text',
      }),
    ).toEqual({ kind: 'selection_required' });
    expect(
      reduceTelegramGuidedDepositMediaSubmission({
        ...metadata,
        replyToMessage: paymentPrompt,
        caption: reference.toLowerCase(),
        extractedText: reference,
        sourceKind: 'pdf_text',
      }),
    ).toMatchObject({ kind: 'action' });
  });

  it('does not accept media outside an authentic private payment prompt', () => {
    for (const replyToMessage of [undefined, { ...paymentPrompt, from: { is_bot: false } }]) {
      expect(
        reduceTelegramGuidedDepositMediaSubmission({
          ...metadata,
          replyToMessage,
          caption: undefined,
          extractedText: `Transaction ID: ${reference}`,
          sourceKind: 'ocr_text',
        }),
      ).toBeUndefined();
    }
    expect(
      reduceTelegramGuidedDepositMediaSubmission({
        ...metadata,
        chat: { id: 123456789, type: 'group' },
        replyToMessage: paymentPrompt,
        caption: undefined,
        extractedText: `Transaction ID: ${reference}`,
        sourceKind: 'ocr_text',
      }),
    ).toBeUndefined();
  });

  it.each([
    { providerCode: 'telebirr', expectedReference: 'SYNTB00000001' },
    { providerCode: 'cbe_birr', expectedReference: 'SYNTB00000001' },
  ] as const)(
    'canonicalizes the $providerCode direct-reference action only where supported',
    ({ providerCode, expectedReference }) => {
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
        transactionReference: expectedReference,
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

  it('canonicalizes a pasted TeleBirr ID with surrounding whitespace or mixed case', () => {
    expect(reduceTelegramDepositProofInput('telebirr', ' \nsyntB00000001\r\n')).toEqual({
      kind: 'candidate',
      transactionReference: 'SYNTB00000001',
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
    `Txn ID syntb00000001. For invoice https://cbepay1.cbe.com.et/aureceipt?TID=SYNTB00000001&PH=900000001`,
    `https://cbepay1.cbe.com.et/aureceipt?TID=syntb00000001&PH=900000002`,
    `Order ID ${reference}\nTransaction Status Completed`,
    `Receipt Number ${reference}\nPaid amount 100.00`,
    ` ${reference}\n`,
  ])(
    'extracts one CBE Birr reference without treating PH or text as payment evidence',
    (proofText) => {
      expect(
        reduceTelegramDepositProofSubmission({
          ...metadata,
          command: `/deposit cbe_birr PLAYER-DEMO-42 ${proofText}`,
        }),
      ).toMatchObject({
        kind: 'action',
        action: { providerCode: 'cbe_birr', transactionReference: reference },
      });
    },
  );

  it('reduces sender and receiver SMS links to the same CBE Birr candidate', () => {
    const sms = (phoneSelector: string) =>
      `Dear TEST CUSTOMER, you received 100.00Br. from 251900000002 - TEST SENDER ` +
      `on 15/10/26 00:03,Txn ID ${reference}.Your CBE Birr account balance is 1000.00Br. ` +
      `For invoice https://cbepay1.cbe.com.et/aureceipt?TID=${reference}&PH=${phoneSelector}`;
    expect(reduceTelegramDepositProofInput('cbe_birr', sms('900000001'))).toEqual({
      kind: 'candidate',
      transactionReference: reference,
    });
    expect(reduceTelegramDepositProofInput('cbe_birr', sms('900000002'))).toEqual({
      kind: 'candidate',
      transactionReference: reference,
    });
  });

  it.each([
    `Txn ID ${reference}. For invoice https://cbepay1.cbe.com.et/aureceipt?TID=${otherReference}&PH=900000001`,
    `Order ID ${reference}\nReceipt Number ${otherReference}`,
  ])('requires explicit choice for conflicting CBE Birr references', (proofText) => {
    expect(reduceTelegramDepositProofInput('cbe_birr', proofText)).toEqual({
      kind: 'selection_required',
    });
  });

  it.each([
    `https://example.invalid/aureceipt?TID=${reference}&PH=900000001`,
    `https://cbepay1.cbe.com.et/aureceipt?TID=${reference}&TID=${otherReference}`,
    `Txn ID ${reference}. For invoice https://example.invalid/aureceipt?TID=${reference}`,
    `Txn ID short`,
    `Txn ID ${reference} and Order ID short`,
  ])('does not guess CBE Birr references from unknown or malformed sources', (proofText) => {
    expect(reduceTelegramDepositProofInput('cbe_birr', proofText)).toEqual({
      kind: 'invalid_input',
    });
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
