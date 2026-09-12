import { formatTelegramPlayerRegistrationCapabilityCallback } from '@fetanagent/contracts';
import { describe, expect, it } from 'vitest';

import {
  TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT,
  presentTelegramPlayerIdFlowResult,
  telegramDepositHelpText,
  telegramDepositReferenceSelectionText,
} from './telegram-player-id-flow.js';

describe('Telegram Player-ID flow presentation', () => {
  it('renders the guided deposit before the opaque Player-ID action', () => {
    const callbackData = formatTelegramPlayerRegistrationCapabilityCallback({
      compactCapabilityId: 'AAAAAAAAAAAAAAAAAAAAAA',
      token: '_____________________w',
    });
    expect(
      presentTelegramPlayerIdFlowResult({ version: 1, outcome: 'menu', callbackData }),
    ).toEqual({
      kind: 'menu',
      menu: {
        text: [
          'What would you like to do?',
          '',
          'To deposit, tap 💰 Deposit with TeleBirr.',
          'The bot will ask for your KemerBet Player ID and TeleBirr transaction number.',
          'Automatic credit is not enabled yet.',
        ].join('\n'),
        buttons: [
          { text: '💰 Deposit with TeleBirr', callbackData: 'gd1.telebirr' },
          { text: 'Add KemerBet Player ID', callbackData },
        ],
      },
    });
  });

  it.each([
    ['awaiting_player_id', 'Send your KemerBet Player ID now.'],
    ['player_id_pending', 'Player ID saved — pending validation.'],
    ['player_id_exists', 'That Player ID is already registered on your FetanAgent account.'],
    ['invalid_player_id', 'That Player ID format is not accepted.'],
    ['restart_required', 'That action expired or is no longer available.'],
    ['menu_required', 'Send /menu, then choose Add KemerBet Player ID.'],
  ] as const)('maps %s to safe customer copy', (outcome, expected) => {
    const presentation = presentTelegramPlayerIdFlowResult({ version: 1, outcome });
    expect(presentation.kind).toBe('message');
    if (presentation.kind === 'message') expect(presentation.text).toContain(expected);
  });

  it('renders bounded dry-run instructions without claiming verification or execution', () => {
    const presentation = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'deposit_instructions',
      depositToken: 'AAAAAAAAAAAAAAAAAAAAAA',
      amountMinor: '2500',
      currencyCode: 'ETB',
      providerName: 'CBE Birr',
      receiverAccountHolderName: 'FETANAGENT STAGING SIMULATION - DO NOT PAY',
      receiverAccountMasked: '****TEST',
      customerInstruction: 'SIMULATION ONLY — DO NOT SEND MONEY.',
      paymentDeadline: '2026-08-12T13:00:00.000Z',
      depositStatus: { label: 'Ready to start', tone: 'neutral' },
      financialMode: 'dry_run',
    });

    expect(presentation).toEqual({
      kind: 'message',
      text: expect.stringContaining(
        'To test protected reference capture, send /reference AAAAAAAAAAAAAAAAAAAAAA TEST_REFERENCE.',
      ),
    });
    if (presentation.kind === 'message') {
      expect(presentation.text).toContain('25.00 ETB');
      expect(presentation.text).toContain('Status: Ready to start.');
      expect(presentation.text).toContain('SIMULATION ONLY — DO NOT SEND MONEY.');
      expect(presentation.text).toContain('Synthetic receiver:');
      expect(presentation.text).toContain('No payment is verified or executed in this simulation');
    }
  });

  it.each([
    ['deposit_input_invalid', 'Tap 💰 Deposit with TeleBirr'],
    ['deposit_unavailable', 'No payment action was started'],
    ['deposit_status_unavailable', TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT],
  ] as const)('maps %s to an explicit safe-state message', (outcome, expected) => {
    const presentation = presentTelegramPlayerIdFlowResult({ version: 1, outcome });
    expect(presentation.kind).toBe('message');
    if (presentation.kind === 'message') expect(presentation.text).toContain(expected);
  });

  it('renders live instructions and customer-safe reference/status updates', () => {
    const live = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'deposit_instructions',
      depositToken: 'AAAAAAAAAAAAAAAAAAAAAA',
      amountMinor: '2500',
      currencyCode: 'ETB',
      providerName: 'CBE Birr',
      receiverAccountHolderName: 'FetanAgent',
      receiverAccountMasked: '***1234',
      customerInstruction: 'Send the exact amount.',
      paymentDeadline: '2026-08-16T13:00:00.000Z',
      depositStatus: { label: 'Ready to start', tone: 'neutral' },
      financialMode: 'live',
    });
    expect(live.kind).toBe('message');
    if (live.kind === 'message') {
      expect(live.text).toContain('CBE Birr deposit: 25.00 ETB');
      expect(live.text).toContain('/deposit_status AAAAAAAAAAAAAAAAAAAAAA');
      expect(live.text).not.toMatch(/simulation|test reference/iu);
    }

    expect(
      presentTelegramPlayerIdFlowResult({
        version: 1,
        outcome: 'deposit_reference_received',
        depositStatus: { label: 'Checking payment', tone: 'working' },
        financialMode: 'live',
      }),
    ).toEqual({ kind: 'message', text: 'Reference received. Status: Checking payment.' });
    expect(
      presentTelegramPlayerIdFlowResult({
        version: 1,
        outcome: 'deposit_status',
        amountMinor: '2500',
        currencyCode: 'ETB',
        depositStatus: { label: 'Preparing deposit', tone: 'working' },
      }),
    ).toEqual({ kind: 'message', text: 'Deposit 25.00 ETB — Preparing deposit.' });
  });

  it.each(['deposit_proof_received', 'deposit_proof_status'] as const)(
    'renders %s with tracking and a button without exposing payment or destination facts',
    (outcome) => {
      const presentation = presentTelegramPlayerIdFlowResult({
        version: 1,
        outcome,
        proofToken: 'A'.repeat(22),
        providerCode: 'telebirr',
        providerName: 'TeleBirr',
        proofStatus: 'proof_received',
        financialMode: 'dry_run',
      });

      expect(presentation).toEqual({
        kind: 'menu',
        menu: {
          text: [
            '✅ Reference received.',
            'Payment method: TeleBirr.',
            'Tracking reference: p1.AAAAAAAAAAAAAAAAAAAAAA',
            'To check it later, send /deposit_status p1.AAAAAAAAAAAAAAAAAAAAAA',
            'Automatic credit and money movement are not enabled yet.',
          ].join('\n'),
          buttons: [{ text: 'Check status', callbackData: 'dps1.AAAAAAAAAAAAAAAAAAAAAA' }],
        },
      });
      expect(JSON.stringify(presentation)).not.toMatch(/amount|player/i);
    },
  );

  it('renders a token-free shadow queue acknowledgement that cannot imply payment completion', () => {
    const presentation = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'telebirr_shadow_verification_queued',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'verification_queued',
      verificationMode: 'shadow_no_money',
    });

    expect(presentation).toEqual({
      kind: 'message',
      text: [
        '✅ Reference received.',
        'FetanAgent is checking it.',
        'Automatic credit and money movement are not enabled yet.',
      ].join('\n'),
    });
    expect(JSON.stringify(presentation)).not.toMatch(/player|SYNTB|token|uuid|amount/iu);
    expect(JSON.stringify(presentation)).not.toMatch(/completed|successful/iu);
  });

  it('explains the button-first flow and tracking without requiring command syntax', () => {
    expect(telegramDepositHelpText()).toContain('Tap 💰 Deposit with TeleBirr');
    expect(telegramDepositHelpText()).toContain('first line');
    expect(telegramDepositHelpText()).toContain('second line');
    expect(telegramDepositHelpText()).toContain('/deposit_status');
    expect(telegramDepositHelpText()).toContain(
      'Automatic credit and money movement are not enabled yet',
    );
    expect(telegramDepositHelpText()).toContain('receipt link or the full SMS');
    expect(telegramDepositHelpText()).not.toContain('PROVIDER PLAYER_ID TRANSACTION_ID');
  });

  it('asks the customer to choose one reference without exposing the candidate list', () => {
    expect(telegramDepositReferenceSelectionText()).toContain('Nothing was submitted.');
    expect(telegramDepositReferenceSelectionText()).toContain('only the transaction number');
    expect(telegramDepositReferenceSelectionText()).not.toContain('PLAYER_ID TRANSACTION_ID');
  });
});
