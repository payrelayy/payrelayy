import { formatTelegramPlayerRegistrationCapabilityCallback } from '@fetanagent/contracts';
import { describe, expect, it } from 'vitest';

import {
  TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT,
  presentTelegramPlayerIdFlowResult,
  telegramDepositHelpText,
  telegramDepositReferenceSelectionText,
} from './telegram-player-id-flow.js';

describe('Telegram Player-ID flow presentation', () => {
  it('renders only the opaque API capability in the one-button menu', () => {
    const callbackData = formatTelegramPlayerRegistrationCapabilityCallback({
      compactCapabilityId: 'AAAAAAAAAAAAAAAAAAAAAA',
      token: '_____________________w',
    });
    expect(
      presentTelegramPlayerIdFlowResult({ version: 1, outcome: 'menu', callbackData }),
    ).toEqual({
      kind: 'menu',
      menu: {
        text: 'Manage your KemerBet Player ID, or submit a dry-run proof with /deposit PROVIDER PLAYER_ID TRANSACTION_ID.',
        buttons: [{ text: 'Add KemerBet Player ID', callbackData }],
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
    ['deposit_input_invalid', '/deposit cbe_birr PLAYER_ID TRANSACTION_ID'],
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
            'SIMULATION ONLY — proof received.',
            'Provider: TeleBirr.',
            'Tracking reference: p1.AAAAAAAAAAAAAAAAAAAAAA',
            'Check progress with /deposit_status p1.AAAAAAAAAAAAAAAAAAAAAA',
            'No payment was verified or credited. Do not send money for this simulation.',
          ].join('\n'),
          buttons: [{ text: 'Check status', callbackData: 'dps1.AAAAAAAAAAAAAAAAAAAAAA' }],
        },
      });
      expect(JSON.stringify(presentation)).not.toMatch(/amount|player/i);
    },
  );

  it('explains the available proof and tracking commands without requesting money', () => {
    expect(telegramDepositHelpText()).toContain('SIMULATION ONLY — DO NOT SEND MONEY.');
    expect(telegramDepositHelpText()).toContain('/deposit telebirr PLAYER_ID TRANSACTION_ID');
    expect(telegramDepositHelpText()).toContain('/deposit cbe_birr PLAYER_ID TRANSACTION_ID');
    expect(telegramDepositHelpText()).toContain('/deposit_status');
    expect(telegramDepositHelpText()).toContain('No payment is verified or credited');
    expect(telegramDepositHelpText()).toContain('receipt URL or the full SMS text');
    expect(telegramDepositHelpText()).toContain('URLs are not opened');
    expect(telegramDepositHelpText()).toContain('Photos and PDF files are not supported yet');
  });

  it('asks the customer to choose one reference without exposing the candidate list', () => {
    expect(telegramDepositReferenceSelectionText()).toContain('No proof was submitted.');
    expect(telegramDepositReferenceSelectionText()).toContain(
      'SIMULATION ONLY — DO NOT SEND MONEY.',
    );
    expect(telegramDepositReferenceSelectionText()).toContain(
      '/deposit telebirr PLAYER_ID TRANSACTION_ID',
    );
  });
});
