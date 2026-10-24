import { describe, expect, it } from 'vitest';

import {
  isRecognizedTelegramDepositCommand,
  isRecognizedTelegramDepositProofStatusCallback,
  isRecognizedTelegramDepositStatusCommand,
  isTelegramGuidedDepositStartCallback,
  isTelegramGuidedDepositStartCommand,
  isTelegramCbeSmsDepositStartCallback,
  isTelegramCbeSmsDepositStartCommand,
  isTelegramSavedPlayerChangeCallback,
  isCbeBirrReceiptText,
  isTelegramPrivateHelpCommand,
  reduceTelegramAutoReceiverSmsMediaSubmission,
  reduceTelegramAutoReceiverSmsTextSubmission,
  reduceTelegramDepositIntentCommand,
  reduceTelegramCbeBirrDryRunCommand,
  reduceTelegramGuidedDepositDestinationSubmission,
  reduceTelegramGuidedDepositProofSubmission,
  reduceTelegramDepositProofCommand,
  reduceTelegramDepositProofSubmission,
  reduceTelegramDepositProofStatusCallbackAction,
  reduceTelegramDepositReferenceCommand,
  reduceTelegramDepositStatusCommand,
  reduceTelegramPlayerIdTextAction,
  reduceTelegramStandalonePlayerIdSubmission,
  reduceTelegramPlayerRegistrationCallbackAction,
  reduceTelegramRootMenuAction,
  reduceTelegramSavedTelebirrDestinationAction,
  reduceTelegramSavedCombinedDestinationAction,
  reduceTelegramSavedCbeSmsMediaSubmission,
  reduceTelegramSavedCbeSmsProofSubmission,
  reduceTelegramSavedCbeSmsDestinationAction,
  reduceTelegramCbeSmsReplySubmission,
  reduceTelegramSavedTelebirrProofSubmission,
} from './telegram-private-action.js';
import {
  TELEGRAM_GUIDED_DEPOSIT_LEGACY_PROMPT_TEXT,
  TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
  TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
  buildTelegramCombinedPaymentPrompt,
  isTelegramCombinedPaymentPromptReply,
  telegramReceiverNumberCodeEntities,
  buildTelegramTelebirrPaymentPrompt,
  parseTelegramTelebirrPaymentPromptReply,
  buildTelegramCbeSmsPaymentPrompt,
  isTelegramCbeSmsPaymentPromptReply,
} from './telegram-guided-deposit.js';

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

/** A card sent by the immediately preceding release must remain replyable after rollout. */
const priorPaymentPrompt = [
  '💰 TeleBirr payment details',
  '',
  'Send money to:',
  '👤 Name: Demo Receiver',
  '📱 Number: 0000000042',
  '',
  '🎮 KemerBet Player ID: PLAYER-DEMO-42',
  'Amount: choose 25–25,000 ETB in TeleBirr.',
  'These payment details remain valid for 1 hour. Send the receipt or reference after paying.',
  '',
  'After paying, reply to this message with the TeleBirr transaction number.',
  'You can also send the full message, receipt link, JPG/PNG screenshot, or PDF (up to 5 MB).',
  '',
  'Before sending, confirm the name shown in TeleBirr matches the name above.',
  'Tap /menu to cancel.',
].join('\n');

describe('private Telegram action reducers', () => {
  it('requests only enabled methods and recognizes the exact combined Owner-configured card', () => {
    expect(
      reduceTelegramSavedCombinedDestinationAction(privateMetadata, {
        telebirr: true,
        cbe_birr: true,
      }),
    ).toMatchObject({
      kind: 'saved_combined_destination_command',
      providerCodes: ['telebirr', 'cbe_birr'],
    });
    expect(
      reduceTelegramSavedCombinedDestinationAction(privateMetadata, {
        telebirr: false,
        cbe_birr: true,
      }),
    ).toMatchObject({ providerCodes: ['cbe_birr'] });
    expect(
      reduceTelegramSavedCombinedDestinationAction(privateMetadata, {
        telebirr: false,
        cbe_birr: false,
      }),
    ).toBeUndefined();
    const prompt = buildTelegramCombinedPaymentPrompt({
      playerId: 'PLAYER-DEMO-42',
      receivers: [
        {
          providerCode: 'telebirr',
          receiverAccountHolderName: 'TeleBirr Owner Name',
          receiverAccountReference: '251900000042',
        },
        {
          providerCode: 'cbe_birr',
          receiverAccountHolderName: 'CBE Owner Name',
          receiverAccountReference: '251900000043',
        },
      ],
    });
    expect(prompt).toContain('Name: TeleBirr Owner Name\nNumber: 900000042');
    expect(prompt).toContain('Name: CBE Owner Name\nNumber: 900000043');
    expect(prompt).not.toContain('2519000000');
    expect(prompt).toContain('Saved Player ID: PLAYER-DEMO-42');
    expect(prompt).toContain('Send 25–25,000 ETB.');
    expect(prompt).not.toContain('Choose one available method');
    expect(prompt).not.toContain('Valid for 1 hour. Check the receiver name before paying.');
    expect(prompt).toContain(
      'After paying, send reference, SMS, receipt link, screenshot or PDF here.',
    );
    expect(
      telegramReceiverNumberCodeEntities(prompt).map((entity) => ({
        type: entity.type,
        text: prompt.slice(entity.offset, entity.offset + entity.length),
      })),
    ).toEqual([
      { type: 'code', text: '900000042' },
      { type: 'code', text: '900000043' },
    ]);
    expect(isTelegramCombinedPaymentPromptReply({ from: { is_bot: true }, text: prompt })).toBe(
      true,
    );
    const priorLocalPrompt = prompt.replace(
      'After paying, send reference, SMS, receipt link, screenshot or PDF here.',
      'After paying, send one reference, SMS, receipt link, screenshot or PDF (max 5 MB) here.',
    );
    expect(
      isTelegramCombinedPaymentPromptReply({ from: { is_bot: true }, text: priorLocalPrompt }),
    ).toBe(true);
    const currentInternationalPrompt = priorLocalPrompt
      .replace('Number: 900000042', 'Number: 251900000042')
      .replace('Number: 900000043', 'Number: 251900000043');
    expect(
      isTelegramCombinedPaymentPromptReply({
        from: { is_bot: true },
        text: currentInternationalPrompt,
      }),
    ).toBe(true);
    const previousPrompt = priorLocalPrompt
      .replace('Number: 900000042', 'Number: 251900000042')
      .replace('Number: 900000043', 'Number: 251900000043')
      .replace('Send 25–25,000 ETB.', 'Choose one available method. Send 25–25,000 ETB.')
      .replace(
        '\nAfter paying,',
        '\nValid for 1 hour. Check the receiver name before paying.\nAfter paying,',
      );
    expect(
      isTelegramCombinedPaymentPromptReply({ from: { is_bot: true }, text: previousPrompt }),
    ).toBe(true);
    expect(
      reduceTelegramAutoReceiverSmsTextSubmission({
        ...privateMetadata,
        command: 'CBE12345678',
        replyToMessage: { from: { is_bot: true }, text: currentInternationalPrompt },
      }),
    ).toMatchObject({
      kind: 'action',
      action: {
        kind: 'deposit_proof_command',
        providerCode: 'cbe_birr',
        playerId: 'PLAYER-DEMO-42',
        transactionReference: 'CBE12345678',
      },
    });
    expect(isTelegramCombinedPaymentPromptReply({ from: { is_bot: false }, text: prompt })).toBe(
      false,
    );
    expect(
      isTelegramCombinedPaymentPromptReply({
        from: { is_bot: true },
        text: prompt.replace('CBE Owner Name', 'Other Name'),
      }),
    ).toBe(true);
    expect(
      isTelegramCombinedPaymentPromptReply({
        from: { is_bot: true },
        text: prompt.replace('Send 25–25,000 ETB.', 'Send any amount.'),
      }),
    ).toBe(false);
    const cbeOnly = buildTelegramCombinedPaymentPrompt({
      playerId: 'PLAYER-DEMO-42',
      receivers: [
        {
          providerCode: 'cbe_birr',
          receiverAccountHolderName: 'CBE Owner Name',
          receiverAccountReference: '0000000043',
        },
      ],
    });
    expect(cbeOnly).not.toContain('Valid for 1 hour');
    expect(cbeOnly).not.toContain('Check the receiver name before paying.');
    expect(cbeOnly).not.toContain('TeleBirr\n');
    expect(isTelegramCombinedPaymentPromptReply({ from: { is_bot: true }, text: cbeOnly })).toBe(
      true,
    );
    expect(
      isTelegramCombinedPaymentPromptReply({
        from: { is_bot: true },
        text: cbeOnly
          .replace(
            'After paying, send reference, SMS, receipt link, screenshot or PDF here.',
            'After paying, send one reference, SMS, receipt link, screenshot or PDF (max 5 MB) here.',
          )
          .replace('Send 25–25,000 ETB.', 'Choose one available method. Send 25–25,000 ETB.')
          .replace('\nAfter paying,', '\nCheck the receiver name before paying.\nAfter paying,'),
      }),
    ).toBe(true);
  });

  it('routes typed proof by reference length even under the other method instruction', () => {
    const telePrompt = buildTelegramTelebirrPaymentPrompt({
      playerId: 'PLAYER-DEMO-42',
      receiverAccountHolderName: 'Demo Receiver',
      receiverAccountReference: '251900000042',
    });
    const cbePrompt = buildTelegramCbeSmsPaymentPrompt({
      playerId: 'PLAYER-DEMO-42',
      receiverAccountHolderName: 'Demo Receiver',
      receiverAccountReference: '251900000042',
    });
    expect(telePrompt).toContain('📱 Number: 900000042');
    expect(cbePrompt).toContain('📱 Number: 900000042');
    expect(telePrompt).not.toContain('251900000042');
    expect(telePrompt).not.toContain('Valid for 1 hour. Check the receiver name before paying.');
    expect(cbePrompt).not.toContain('Valid for 1 hour. Check the receiver name before paying.');
    const previouslyIssuedTeleBirrCard = telePrompt.replace(
      'After paying, send reference, SMS, receipt link, screenshot or PDF here.',
      'After paying, send the reference, SMS, receipt link, screenshot or PDF (max 5 MB) here.',
    );
    const previouslyIssuedCbeCard = cbePrompt.replace(
      'After paying, send reference, SMS, receipt link, screenshot or PDF here.',
      'After paying, send the reference, SMS, receipt link, screenshot or PDF (max 5 MB) here.\nThe reference identifies CBE Birr automatically.',
    );
    expect(
      parseTelegramTelebirrPaymentPromptReply({
        from: { is_bot: true },
        text: previouslyIssuedTeleBirrCard,
      }),
    ).toBe('PLAYER-DEMO-42');
    expect(
      isTelegramCbeSmsPaymentPromptReply({
        from: { is_bot: true },
        text: previouslyIssuedCbeCard,
      }),
    ).toBe(true);
    expect(
      parseTelegramTelebirrPaymentPromptReply({
        from: { is_bot: true },
        text: telePrompt.replace('📱 Number: 900000042', '📱 Number: 251900000042'),
      }),
    ).toBe('PLAYER-DEMO-42');
    expect(
      isTelegramCbeSmsPaymentPromptReply({
        from: { is_bot: true },
        text: cbePrompt.replace('📱 Number: 900000042', '📱 Number: 251900000042'),
      }),
    ).toBe(true);
    expect(
      parseTelegramTelebirrPaymentPromptReply({
        from: { is_bot: true },
        text: telePrompt.replace(
          '\nAfter paying,',
          '\nValid for 1 hour. Check the receiver name before paying.\nAfter paying,',
        ),
      }),
    ).toBe('PLAYER-DEMO-42');
    expect(
      reduceTelegramAutoReceiverSmsTextSubmission({
        ...privateMetadata,
        command: 'CBE12345678',
        replyToMessage: { from: { is_bot: true }, text: telePrompt },
      }),
    ).toMatchObject({
      kind: 'action',
      action: {
        kind: 'deposit_proof_command',
        providerCode: 'cbe_birr',
        playerId: 'PLAYER-DEMO-42',
        transactionReference: 'CBE12345678',
      },
    });
    expect(
      reduceTelegramAutoReceiverSmsTextSubmission({
        ...privateMetadata,
        command: 'TB12345678',
        replyToMessage: { from: { is_bot: true }, text: cbePrompt },
      }),
    ).toMatchObject({
      kind: 'action',
      action: {
        kind: 'saved_receiver_sms_proof_command',
        providerCode: 'telebirr',
        transactionReference: 'TB12345678',
      },
    });
    expect(
      reduceTelegramAutoReceiverSmsTextSubmission({
        ...privateMetadata,
        command: 'hello there',
        replyToMessage: undefined,
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramSavedCbeSmsProofSubmission(
        { ...privateMetadata, command: '/cbe TB12345678' },
        true,
      ),
    ).toMatchObject({
      kind: 'action',
      action: { providerCode: 'telebirr', transactionReference: 'TB12345678' },
    });
    expect(
      reduceTelegramDepositProofSubmission(
        { ...privateMetadata, command: '/deposit telebirr PLAYER-DEMO-42 CBE12345678' },
        true,
      ),
    ).toMatchObject({
      kind: 'action',
      action: { providerCode: 'cbe_birr', transactionReference: 'CBE12345678' },
    });
  });

  it('routes media by reference while withholding conflicting OCR and captions', () => {
    const telePrompt = buildTelegramTelebirrPaymentPrompt({
      playerId: 'PLAYER-DEMO-42',
      receiverAccountHolderName: 'Demo Receiver',
      receiverAccountReference: '0000000042',
    });
    expect(
      reduceTelegramAutoReceiverSmsMediaSubmission({
        ...privateMetadata,
        extractedText: 'Txn ID: CBE12345678. Amount ETB 100.00.',
        caption: undefined,
        sourceKind: 'ocr_text',
        replyToMessage: { from: { is_bot: true }, text: telePrompt },
      }),
    ).toMatchObject({
      kind: 'action',
      action: {
        kind: 'deposit_proof_command',
        providerCode: 'cbe_birr',
        playerId: 'PLAYER-DEMO-42',
        transactionReference: 'CBE12345678',
      },
    });
    const conflict = reduceTelegramAutoReceiverSmsMediaSubmission({
      ...privateMetadata,
      extractedText: 'Transaction ID: TB12345678.',
      caption: 'CBE12345678',
      sourceKind: 'pdf_text',
      replyToMessage: undefined,
    });
    expect(conflict).toEqual({ kind: 'selection_required' });
    expect(JSON.stringify(conflict)).not.toMatch(/TB12345678|CBE12345678/);
  });
  it('accepts explicit private CBE Birr test commands with synthetic references only', () => {
    expect(
      reduceTelegramCbeBirrDryRunCommand({
        ...privateMetadata,
        command: '/cbe_test PLAYER-DEMO-42',
      }),
    ).toMatchObject({
      kind: 'cbe_birr_dry_run_instruction_command',
      playerId: 'PLAYER-DEMO-42',
    });
    expect(
      reduceTelegramCbeBirrDryRunCommand({
        ...privateMetadata,
        command: '/cbe_test_proof AAAAAAAAAAAAAAAAAAAAAA PLAYER-DEMO-42 SYNTHCBE0001',
      }),
    ).toMatchObject({
      kind: 'cbe_birr_bound_dry_run_proof_command',
      instructionToken: 'AAAAAAAAAAAAAAAAAAAAAA',
      playerId: 'PLAYER-DEMO-42',
      transactionReference: 'SYNTHCBE0001',
    });
    for (const command of [
      '/cbe_test_proof AAAAAAAAAAAAAAAAAAAAAA PLAYER-DEMO-42 REALREF1234',
      '/cbe_test_proof AAAAAAAAAAAAAAAAAAAAAA PLAYER-DEMO-42 synthcbe0001',
      '/cbe_test_proof invalid PLAYER-DEMO-42 SYNTHCBE0001',
      '/cbe_test PLAYER-DEMO-42 extra',
    ]) {
      expect(reduceTelegramCbeBirrDryRunCommand({ ...privateMetadata, command })).toBeUndefined();
    }
    expect(
      reduceTelegramCbeBirrDryRunCommand({
        ...privateMetadata,
        chat: { id: 123456789, type: 'group' },
        command: '/cbe_test PLAYER-DEMO-42',
      }),
    ).toBeUndefined();
  });

  it('routes saved-Player actions only from the same private chat', () => {
    expect(reduceTelegramSavedTelebirrDestinationAction(privateMetadata)).toMatchObject({
      kind: 'saved_telebirr_destination_command',
      preferredLocale: 'en',
    });
    expect(
      isTelegramSavedPlayerChangeCallback({ ...privateMetadata, callbackData: 'sp1.change' }),
    ).toBe(true);
    expect(
      reduceTelegramSavedTelebirrDestinationAction({
        ...privateMetadata,
        chat: { id: 99, type: 'group' },
      }),
    ).toBeUndefined();
  });

  it('extracts one direct TeleBirr reference but never infers CBE Birr as TeleBirr', () => {
    expect(
      reduceTelegramSavedTelebirrProofSubmission({ ...privateMetadata, command: 'syntb00000001' }),
    ).toMatchObject({
      kind: 'action',
      action: { kind: 'saved_telebirr_proof_command', transactionReference: 'SYNTB00000001' },
    });
    expect(
      reduceTelegramSavedTelebirrProofSubmission({ ...privateMetadata, command: 'hello there' }),
    ).toBeUndefined();
    expect(isCbeBirrReceiptText('https://cbepay1.cbe.com.et/aureceipt?TID=TESTCBE123456')).toBe(
      true,
    );
    expect(
      reduceTelegramSavedTelebirrProofSubmission({
        ...privateMetadata,
        command: 'CBE Birr receipt Transaction ID: TESTCBE123456',
      }),
    ).toBeUndefined();
  });

  it('nominates CBE SMS text, link, screenshot or PDF as a reference only', () => {
    const expected = {
      kind: 'action',
      action: {
        kind: 'saved_receiver_sms_proof_command',
        providerCode: 'cbe_birr',
        transactionReference: 'SYNTHCBE1234',
      },
    };
    for (const command of [
      '/cbe synthcbe1234',
      'CBE Birr received. Txn ID: SYNTHCBE1234',
      'https://cbepay1.cbe.com.et/aureceipt?TID=SYNTHCBE1234&PH=000000000000',
    ]) {
      expect(
        reduceTelegramSavedCbeSmsProofSubmission({ ...privateMetadata, command }),
      ).toMatchObject(expected);
    }
    expect(
      reduceTelegramSavedCbeSmsMediaSubmission({
        ...privateMetadata,
        caption: undefined,
        extractedText: 'CBE Birr transaction ID: SYNTHCBE1234',
        sourceKind: 'ocr_text',
      }),
    ).toMatchObject(expected);
    expect(
      reduceTelegramSavedCbeSmsMediaSubmission({
        ...privateMetadata,
        caption: undefined,
        extractedText: 'CBE Birr transaction ID: SYNTHCBE1234',
        sourceKind: 'pdf_text',
      }),
    ).toMatchObject(expected);
    expect(
      reduceTelegramSavedCbeSmsProofSubmission({
        ...privateMetadata,
        command: '/deposit cbe_birr PLAYER-DEMO-42 CBE Birr Txn ID: SYNTHCBE1234',
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramSavedCbeSmsProofSubmission({
        ...privateMetadata,
        command: 'CBE Birr Txn ID: SYNTHCBE1234 Txn ID: OTHERREF12',
      }),
    ).toEqual({ kind: 'selection_required' });
  });

  it('keeps the CBE instruction and its replies bound to the CBE SMS route', () => {
    const prompt = buildTelegramCbeSmsPaymentPrompt({
      playerId: 'PLAYER-DEMO-42',
      receiverAccountHolderName: 'Demo Receiver',
      receiverAccountReference: '0000000042',
    });
    const replyToMessage = { from: { is_bot: true }, text: prompt };
    const previousPrompt = prompt
      .replace(
        '\nAfter paying,',
        '\nValid for 1 hour. Check the receiver name before paying.\nAfter paying,',
      )
      .replace(
        'After paying, send the reference, SMS, receipt link, screenshot or PDF (max 5 MB) here.\nThe reference identifies CBE Birr automatically.',
        'After paying, reply with the transaction reference, SMS, receipt link, screenshot or PDF (max 5 MB).\nIf sending a reference separately, use /cbe followed by the reference.',
      );
    expect(
      isTelegramCbeSmsPaymentPromptReply({ from: { is_bot: true }, text: previousPrompt }),
    ).toBe(true);
    expect(
      isTelegramCbeSmsDepositStartCallback({
        ...privateMetadata,
        callbackData: 'gd1.cbe',
      }),
    ).toBe(true);
    expect(
      isTelegramCbeSmsDepositStartCommand({
        ...privateMetadata,
        command: '/cbe',
      }),
    ).toBe(true);
    expect(reduceTelegramSavedCbeSmsDestinationAction(privateMetadata)).toMatchObject({
      kind: 'saved_cbe_sms_destination_command',
    });
    expect(
      reduceTelegramCbeSmsReplySubmission({
        ...privateMetadata,
        command: 'SYNTHCBE1234',
        replyToMessage,
      }),
    ).toMatchObject({
      kind: 'action',
      action: {
        kind: 'saved_receiver_sms_proof_command',
        providerCode: 'cbe_birr',
        transactionReference: 'SYNTHCBE1234',
      },
    });
    expect(
      reduceTelegramSavedCbeSmsMediaSubmission({
        ...privateMetadata,
        extractedText: 'Txn ID: SYNTHCBE1234',
        caption: undefined,
        sourceKind: 'ocr_text',
        replyToMessage,
      }),
    ).toMatchObject({ kind: 'action', action: { providerCode: 'cbe_birr' } });
    expect(
      reduceTelegramCbeSmsReplySubmission({
        ...privateMetadata,
        command: 'SYNTHCBE1234',
        replyToMessage: { from: { is_bot: false }, text: prompt },
      }),
    ).toBeUndefined();
  });
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

  it('recognizes the non-authoritative guided deposit button and exact /deposit entry point', () => {
    expect(
      isTelegramGuidedDepositStartCallback({
        ...privateMetadata,
        callbackData: TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
      }),
    ).toBe(true);
    expect(Buffer.byteLength(TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA, 'utf8')).toBeLessThanOrEqual(
      64,
    );
    expect(
      isTelegramGuidedDepositStartCallback({
        ...privateMetadata,
        callbackData: `${TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA}.extra`,
      }),
    ).toBe(false);
    expect(isTelegramGuidedDepositStartCommand({ ...privateMetadata, command: '/deposit' })).toBe(
      true,
    );
    expect(
      isTelegramGuidedDepositStartCommand({ ...privateMetadata, command: '/deposit anything' }),
    ).toBe(false);
  });

  it('turns the first one-value reply into a destination lookup', () => {
    expect(
      reduceTelegramGuidedDepositDestinationSubmission({
        ...privateMetadata,
        text: 'PLAYER-DEMO-42',
        replyToMessage: {
          text: TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
          from: { is_bot: true },
        },
      }),
    ).toEqual({
      kind: 'action',
      action: {
        version: 1,
        kind: 'save_player_selection_command',
        updateId: '123456',
        telegramUserId: '123456789',
        privateChatId: '123456789',
        preferredLocale: 'en',
        playerId: 'PLAYER-DEMO-42',
      },
    });
  });

  it('routes a guided Player ID to signed Find only when explicitly enabled', () => {
    expect(
      reduceTelegramGuidedDepositDestinationSubmission({
        ...privateMetadata,
        text: 'PLAYER-DEMO-42',
        replyToMessage: {
          text: TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
          from: { is_bot: true },
        },
        playerValidationEnabled: true,
      }),
    ).toMatchObject({
      kind: 'action',
      action: {
        kind: 'player_validation_request_command',
        playerId: 'PLAYER-DEMO-42',
      },
    });
  });

  it('still accepts a reply to the previous Player ID question', () => {
    const priorPlayerPrompt = [
      '🎮 Choose Player ID',
      '',
      'Which KemerBet Player ID should receive your deposits?',
      'Reply with the Player ID only.',
      'This choice applies to future direct submissions; it does not change a deposit already submitted.',
      '',
      'Tap /menu to cancel.',
    ].join('\n');
    expect(
      reduceTelegramGuidedDepositDestinationSubmission({
        ...privateMetadata,
        text: 'PLAYER-DEMO-42',
        replyToMessage: { text: priorPlayerPrompt, from: { is_bot: true } },
      }),
    ).toMatchObject({ kind: 'action', action: { playerId: 'PLAYER-DEMO-42' } });
  });

  it('does not accept malformed Player IDs or customer-authored wizard prompts', () => {
    expect(
      reduceTelegramGuidedDepositDestinationSubmission({
        ...privateMetadata,
        text: 'PLAYER DEMO 42',
        replyToMessage: {
          text: TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
          from: { is_bot: true },
        },
      }),
    ).toEqual({ kind: 'invalid_input' });
    expect(
      reduceTelegramGuidedDepositDestinationSubmission({
        ...privateMetadata,
        text: 'PLAYER-DEMO-42',
        replyToMessage: {
          text: TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
          from: { is_bot: false },
        },
      }),
    ).toBeUndefined();
  });

  it('turns a one-value payment reply into the existing protected TeleBirr action', () => {
    const paymentPrompt = buildTelegramTelebirrPaymentPrompt({
      playerId: 'PLAYER-DEMO-42',
      receiverAccountHolderName: 'Demo Receiver',
      receiverAccountReference: '0000000042',
    });
    expect(
      reduceTelegramGuidedDepositProofSubmission({
        ...privateMetadata,
        text: 'syntB00000001',
        replyToMessage: { text: paymentPrompt, from: { is_bot: true } },
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
        transactionReference: 'SYNTB00000001',
      },
    });
  });

  it('accepts a reply to a full one-hour card sent before the copy update', () => {
    expect(
      reduceTelegramGuidedDepositProofSubmission({
        ...privateMetadata,
        text: 'SYNTB00000001',
        replyToMessage: { text: priorPaymentPrompt, from: { is_bot: true } },
      }),
    ).toMatchObject({
      kind: 'action',
      action: { playerId: 'PLAYER-DEMO-42', transactionReference: 'SYNTB00000001' },
    });
  });

  it('accepts an already-open payment reply from the previous pilot card during rollout', () => {
    const previousPrompt = priorPaymentPrompt.replace(
      'These payment details remain valid for 1 hour. Send the receipt or reference after paying.',
      'These payment details are valid for 12 hours.',
    );
    expect(
      reduceTelegramGuidedDepositProofSubmission({
        ...privateMetadata,
        text: 'SYNTB00000001',
        replyToMessage: { text: previousPrompt, from: { is_bot: true } },
      }),
    ).toMatchObject({
      kind: 'action',
      action: { playerId: 'PLAYER-DEMO-42', transactionReference: 'SYNTB00000001' },
    });
  });

  it('accepts a reply to a ten-minute instruction already open during the one-hour rollout', () => {
    const previousPrompt = priorPaymentPrompt.replace(
      'These payment details remain valid for 1 hour. Send the receipt or reference after paying.',
      'This payment instruction is valid for at most 10 minutes; submit the reference promptly.',
    );
    expect(
      reduceTelegramGuidedDepositProofSubmission({
        ...privateMetadata,
        text: 'SYNTB00000001',
        replyToMessage: { text: previousPrompt, from: { is_bot: true } },
      }),
    ).toMatchObject({
      kind: 'action',
      action: { playerId: 'PLAYER-DEMO-42', transactionReference: 'SYNTB00000001' },
    });
  });

  it('accepts a reply to the prior text-only payment card during the media rollout', () => {
    const previousPrompt = priorPaymentPrompt.replace(
      'You can also send the full message, receipt link, JPG/PNG screenshot, or PDF (up to 5 MB).',
      'You can also paste the receipt link or full SMS.',
    );
    expect(
      reduceTelegramGuidedDepositProofSubmission({
        ...privateMetadata,
        text: 'SYNTB00000001',
        replyToMessage: { text: previousPrompt, from: { is_bot: true } },
      }),
    ).toMatchObject({
      kind: 'action',
      action: { playerId: 'PLAYER-DEMO-42', transactionReference: 'SYNTB00000001' },
    });
  });

  it('accepts an already-open exactly-25-ETB payment reply during rollout', () => {
    const previousPrompt = priorPaymentPrompt.replace(
      'Amount: choose 25–25,000 ETB in TeleBirr.',
      'Amount: send exactly 25 ETB in TeleBirr.',
    );
    expect(
      reduceTelegramGuidedDepositProofSubmission({
        ...privateMetadata,
        text: 'SYNTB00000001',
        replyToMessage: { text: previousPrompt, from: { is_bot: true } },
      }),
    ).toMatchObject({
      kind: 'action',
      action: { playerId: 'PLAYER-DEMO-42', transactionReference: 'SYNTB00000001' },
    });
  });

  it('keeps the previous two-line prompt safe during a rolling deployment', () => {
    expect(
      reduceTelegramGuidedDepositProofSubmission({
        ...privateMetadata,
        text: 'PLAYER-DEMO-42\nSYNTB00000001',
        replyToMessage: {
          text: TELEGRAM_GUIDED_DEPOSIT_LEGACY_PROMPT_TEXT,
          from: { is_bot: true },
        },
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
        transactionReference: 'SYNTB00000001',
      },
    });
  });

  it('accepts receipt text after the first Player-ID token without forwarding receipt details', () => {
    const result = reduceTelegramGuidedDepositProofSubmission({
      ...privateMetadata,
      text: [
        'PLAYER-DEMO-42',
        'Synthetic receiver paid ETB 900.00.',
        'Transaction ID: SYNTB00000001.',
      ].join('\n'),
      replyToMessage: {
        text: TELEGRAM_GUIDED_DEPOSIT_LEGACY_PROMPT_TEXT,
        from: { is_bot: true },
      },
    });
    expect(result).toMatchObject({
      kind: 'action',
      action: { playerId: 'PLAYER-DEMO-42', transactionReference: 'SYNTB00000001' },
    });
    expect(JSON.stringify(result)).not.toMatch(/Synthetic receiver|900\.00/);
  });

  it('does not treat ordinary text or a forged customer prompt as a guided deposit', () => {
    expect(
      reduceTelegramGuidedDepositProofSubmission({
        ...privateMetadata,
        text: 'PLAYER-DEMO-42\nSYNTB00000001',
        replyToMessage: undefined,
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramGuidedDepositProofSubmission({
        ...privateMetadata,
        text: 'PLAYER-DEMO-42\nSYNTB00000001',
        replyToMessage: {
          text: TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
          from: { is_bot: false },
        },
      }),
    ).toBeUndefined();
  });

  it('fails a malformed or ambiguous guided reply without echoing any candidate', () => {
    const replyToMessage = {
      text: TELEGRAM_GUIDED_DEPOSIT_LEGACY_PROMPT_TEXT,
      from: { is_bot: true },
    };
    expect(
      reduceTelegramGuidedDepositProofSubmission({
        ...privateMetadata,
        text: 'only-one-value',
        replyToMessage,
      }),
    ).toEqual({ kind: 'invalid_input' });
    const ambiguous = reduceTelegramGuidedDepositProofSubmission({
      ...privateMetadata,
      text: 'PLAYER-DEMO-42\nTransaction ID: SYNTB00000001. Invoice No. SYNTB00000002.',
      replyToMessage,
    });
    expect(ambiguous).toEqual({ kind: 'selection_required' });
    expect(JSON.stringify(ambiguous)).not.toMatch(/SYNTB|PLAYER-DEMO/);
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

  it('routes a standalone eight-digit Player ID to signed validation without a prompt reply', () => {
    expect(
      reduceTelegramStandalonePlayerIdSubmission({
        ...privateMetadata,
        text: ' 28379330 ',
        playerValidationEnabled: true,
      }),
    ).toEqual({
      version: 1,
      kind: 'player_validation_request_command',
      updateId: '123456',
      telegramUserId: '123456789',
      privateChatId: '123456789',
      preferredLocale: 'en',
      playerId: '28379330',
    });
  });

  it('uses the existing selection action when signed validation is disabled', () => {
    expect(
      reduceTelegramStandalonePlayerIdSubmission({
        ...privateMetadata,
        text: '28379330',
        playerValidationEnabled: false,
      }),
    ).toMatchObject({ kind: 'save_player_selection_command', playerId: '28379330' });
  });

  it.each([
    '1234567',
    '123456789',
    'ID 12345678',
    '12345678 paid',
    '/12345678',
    '１２３４５６７８',
  ])('does not mistake other text for a standalone Player ID: %s', (text) => {
    expect(
      reduceTelegramStandalonePlayerIdSubmission({
        ...privateMetadata,
        text,
        playerValidationEnabled: true,
      }),
    ).toBeUndefined();
  });

  it('does not accept a standalone Player ID outside the matching private chat', () => {
    expect(
      reduceTelegramStandalonePlayerIdSubmission({
        ...privateMetadata,
        chat: { id: -123456789, type: 'group' },
        text: '28379330',
        playerValidationEnabled: true,
      }),
    ).toBeUndefined();
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
