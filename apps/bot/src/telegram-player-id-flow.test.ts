import { formatTelegramPlayerRegistrationCapabilityCallback } from '@fetanagent/contracts';
import { describe, expect, it } from 'vitest';

import {
  TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT,
  presentTelegramPlayerIdFlowResult,
  telegramDepositHelpText,
  telegramDepositReferenceSelectionText,
} from './telegram-player-id-flow.js';

describe('Telegram Player-ID flow presentation', () => {
  it('presents an opaque CBE Birr staging token without payable details', () => {
    const presentation = presentTelegramPlayerIdFlowResult(
      {
        version: 1,
        outcome: 'cbe_birr_dry_run_instruction_preview',
        instructionToken: 'AAAAAAAAAAAAAAAAAAAAAA',
        expiresAt: '2026-10-18T01:00:00.000Z',
        acceptsPayments: false,
      },
      { selectedPlayerId: 'PLAYER-DEMO-42' },
    );
    expect(presentation.kind).toBe('message');
    if (presentation.kind === 'message') {
      expect(presentation.text).toContain('do not send money');
      expect(presentation.text).toContain(
        '/cbe_test_proof AAAAAAAAAAAAAAAAAAAAAA PLAYER-DEMO-42 SYNTHCBE0001',
      );
      expect(presentation.text).not.toMatch(/send money to|account|receiver.*[0-9]{4}/iu);
    }
  });

  it('acknowledges a queued Find without claiming Player approval', () => {
    const presentation = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'player_validation_queued',
    });
    expect(presentation.kind).toBe('message');
    if (presentation.kind === 'message') {
      expect(presentation.text).toContain('Checking your Player ID');
      expect(presentation.text).toContain('We’ll update you here');
      expect(presentation.text).not.toContain('verified and saved');
    }
  });

  it('confirms the saved selection and offers a one-tap deposit', () => {
    const saved = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'player_selection_saved',
      playerId: 'PLAYER-DEMO-42',
    });
    expect(saved.kind).toBe('menu');
    if (saved.kind === 'menu') {
      expect(saved.menu.text).toBe('✅ Player ID verified. You can deposit now.');
      expect(saved.menu.buttons[0]).toEqual({ text: '💰 Deposit', callbackData: 'gd1.deposit' });
    }
    const missing = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'player_selection_missing',
    });
    expect(missing.kind).toBe('prompt');
  });
  it('shows only Add Player ID before an ID is saved', () => {
    const callbackData = formatTelegramPlayerRegistrationCapabilityCallback({
      compactCapabilityId: 'AAAAAAAAAAAAAAAAAAAAAA',
      token: '_____________________w',
    });
    expect(
      presentTelegramPlayerIdFlowResult({
        version: 1,
        outcome: 'menu',
        callbackData,
        selectedPlayerId: null,
      }),
    ).toEqual({
      kind: 'menu',
      menu: {
        text: 'FetanAgent',
        buttons: [{ text: '➕ Add Player ID', callbackData: 'sp1.change' }],
      },
    });
  });

  it.each([
    ['awaiting_player_id', 'Send your KemerBet Player ID.'],
    ['player_id_pending', 'Your Player ID is being checked.'],
    ['player_id_exists', 'That Player ID is already saved.'],
    ['invalid_player_id', 'That Player ID doesn’t look right.'],
    ['restart_required', 'That action expired.'],
    ['menu_required', 'Open /menu to add a Player ID.'],
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
        'Test reference: /reference AAAAAAAAAAAAAAAAAAAAAA TEST_REFERENCE',
      ),
    });
    if (presentation.kind === 'message') {
      expect(presentation.text).toContain('25.00 ETB');
      expect(presentation.text).toContain('do not send money');
      expect(presentation.text).toContain('No payment or Player credit will be made');
      expect(presentation.text).not.toContain('FETANAGENT STAGING SIMULATION');
    }
  });

  it.each([
    ['deposit_input_invalid', 'Tap Deposit for payment details'],
    ['deposit_unavailable', 'Deposits are unavailable right now'],
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
      expect(live.text).toContain('Amount: 25.00 ETB');
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
    ).toEqual({ kind: 'message', text: '⏳ Payment details received. We’ll update you here.' });
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

  it('does not invite payment to a disabled receiver', () => {
    const presentation = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'telebirr_deposit_preview',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      receiverAccountHolderName: 'Demo Receiver',
      receiverAccountMasked: '***0042',
      acceptsPayments: false,
    });

    expect(presentation).toEqual({
      kind: 'message',
      text: expect.stringContaining('TeleBirr deposits are unavailable right now.'),
    });
    if (presentation.kind === 'message') {
      expect(presentation.text).not.toContain('Demo Receiver');
      expect(presentation.text).toContain('Do not send money to this receiver yet');
      expect(presentation.text).not.toContain('0000000042');
    }
  });

  it('renders the no-money receiver review as a plain non-submittable message', () => {
    const presentation = presentTelegramPlayerIdFlowResult(
      {
        version: 1,
        outcome: 'telebirr_deposit_destination_review',
        providerCode: 'telebirr',
        providerName: 'TeleBirr',
        receiverAccountHolderName: 'Demo Receiver',
        receiverAccountReference: '0000000042',
        receiverAccountMasked: '***0042',
        amountMinor: '2500',
        currencyCode: 'ETB',
        acceptsPayments: false,
      },
      { selectedPlayerId: 'PLAYER-DEMO-42' },
    );

    expect(presentation).toEqual({
      kind: 'message',
      text: expect.stringContaining('TeleBirr receiver preview'),
    });
    if (presentation.kind === 'message') {
      expect(presentation.text).toContain('Name: Demo Receiver');
      expect(presentation.text).toContain('Number: 0000000042');
      expect(presentation.text).toContain('Player ID: PLAYER-DEMO-42');
      expect(presentation.text).toContain('Do not send money yet');
      expect(presentation.text).not.toContain('Live');
      expect(presentation.text).not.toMatch(/transaction number|receipt|full SMS/iu);
    }
  });

  it('renders a concise payment card with a local copyable number', () => {
    const presentation = presentTelegramPlayerIdFlowResult(
      {
        version: 1,
        outcome: 'telebirr_deposit_destination',
        providerCode: 'telebirr',
        providerName: 'TeleBirr',
        receiverAccountHolderName: 'Demo Receiver',
        receiverAccountReference: '251900000042',
        receiverAccountMasked: '***0042',
        acceptsPayments: true,
      },
      { selectedPlayerId: 'PLAYER-DEMO-42' },
    );

    expect(presentation).toEqual({
      kind: 'prompt',
      text: expect.stringContaining('👤 Name: Demo Receiver'),
    });
    if (presentation.kind === 'prompt') {
      expect(presentation.text).toContain('📱 Number: 900000042');
      expect(presentation.text).not.toContain('251900000042');
      expect(presentation.text).toContain('🎮 KemerBet Player ID: PLAYER-DEMO-42');
      expect(presentation.text).toContain('Send 25–25,000 ETB to:');
      expect(presentation.text).not.toContain('send exactly 25 ETB');
      expect(presentation.text).not.toContain('Valid for 1 hour');
      expect(presentation.text).not.toContain('Check the receiver name before paying.');
      expect(presentation.text).not.toContain('valid for 12 hours');
      expect(presentation.text).toContain('send your receipt or reference here.');
      expect(presentation.text).not.toContain('first line');
      expect(presentation.text).not.toContain('second line');
    }
  });

  it('renders the CBE SMS payment card for the saved Player', () => {
    const presentation = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'cbe_sms_deposit_destination',
      providerCode: 'cbe_birr',
      providerName: 'CBE Birr',
      receiverAccountHolderName: 'Demo Receiver',
      receiverAccountReference: '251900000042',
      receiverAccountMasked: '***0042',
      selectedPlayerId: 'PLAYER-DEMO-42',
      acceptsPayments: true,
    });
    expect(presentation).toEqual({
      kind: 'prompt',
      text: expect.stringContaining('💳 CBE Birr deposit'),
    });
    if (presentation.kind === 'prompt') {
      expect(presentation.text).toContain('👤 Name: Demo Receiver');
      expect(presentation.text).toContain('📱 Number: 900000042');
      expect(presentation.text).not.toContain('251900000042');
      expect(presentation.text).toContain('send your receipt or reference here.');
      expect(presentation.text).not.toContain('identifies CBE Birr automatically');
    }
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
            '🧪 Test reference received. No Player credit will be made.',
            'Status: /deposit_status p1.AAAAAAAAAAAAAAAAAAAAAA',
          ].join('\n'),
          buttons: [{ text: 'Check status', callbackData: 'dps1.AAAAAAAAAAAAAAAAAAAAAA' }],
        },
      });
      expect(JSON.stringify(presentation)).not.toMatch(/Amount:|PLAYER-DEMO-42/i);
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
      text: '🧪 Test reference received. No Player credit will be made.',
    });
    expect(JSON.stringify(presentation)).not.toMatch(/PLAYER-DEMO-42|SYNTB|token|uuid|amount/iu);
    expect(JSON.stringify(presentation)).not.toMatch(/completed|successful/iu);
  });

  it('renders a token-free synthetic candidate acknowledgement without claiming verification', () => {
    const presentation = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'telebirr_routine_candidate_recorded_no_money',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'untrusted_received',
      verificationMode: 'not_started_no_money',
    });

    expect(presentation).toEqual({
      kind: 'message',
      text: '🧪 Test reference received. No payment was verified or credited. Do not send money.',
    });
    expect(JSON.stringify(presentation)).not.toMatch(/PLAYER|FETANTEST|uuid|token|amount/iu);
  });

  it('defers a paid candidate reply until its signed outcome or delayed progress notice', () => {
    const presentation = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'telebirr_routine_candidate_recorded_paid_pending',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'pending_verification',
      verificationMode: 'phone_receipt_pending',
    });

    expect(presentation).toEqual({ kind: 'deferred' });
    expect(JSON.stringify(presentation)).not.toMatch(/AB12CD34EF|uuid|token|amount/iu);
  });

  it.each(['older_review', 'held_review'] as const)(
    'defers the %s SMS response to the durable outcome notifier',
    (matchStatus) => {
      expect(
        presentTelegramPlayerIdFlowResult({
          version: 1,
          outcome: 'receiver_sms_candidate_received',
          providerCode: 'telebirr',
          providerName: 'TeleBirr',
          matchStatus,
        }),
      ).toEqual({ kind: 'deferred' });
    },
  );

  it('acknowledges an SMS-route submission without exposing the checking process', () => {
    expect(
      presentTelegramPlayerIdFlowResult({
        version: 1,
        outcome: 'receiver_sms_candidate_received',
        providerCode: 'cbe_birr',
        providerName: 'CBE Birr',
        matchStatus: 'pending_sms',
      }),
    ).toEqual({
      kind: 'message',
      text: '⏳ Payment details received. We’ll update you here.',
    });
  });

  it('does not imply a prior CBE submission was credited when its reference is submitted again', () => {
    expect(
      presentTelegramPlayerIdFlowResult({
        version: 1,
        outcome: 'receiver_sms_candidate_received',
        providerCode: 'cbe_birr',
        providerName: 'CBE Birr',
        matchStatus: 'already_used',
      }),
    ).toEqual({
      kind: 'message',
      text: 'This payment was submitted before. If your Player balance is missing, contact support.',
    });
  });

  it('immediately explains a same-customer completed duplicate without exposing the reference', () => {
    const presentation = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'telebirr_routine_candidate_already_used',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'already_used',
      verificationMode: 'same_customer_completed_ledger',
    });
    expect(presentation).toEqual({
      kind: 'menu',
      menu: {
        text: 'This payment was submitted before. If your Player balance is missing, contact support.',
        buttons: [{ text: '💰 Deposit', callbackData: 'gd1.deposit' }],
      },
    });
    expect(JSON.stringify(presentation)).not.toMatch(
      /AB12CD34EF|PLAYER-DEMO-42|uuid|token|amount/iu,
    );
  });

  it('renders a live verifier acknowledgement with one opaque tracking button', () => {
    const presentation = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'telebirr_live_verification_queued',
      proofToken: 'A'.repeat(22),
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      depositStatus: { label: 'Checking payment', tone: 'working' },
      financialMode: 'live',
    });
    expect(presentation).toEqual({
      kind: 'menu',
      menu: {
        text: '⏳ Payment details received. We’ll update you here.',
        buttons: [
          { text: 'Check status', callbackData: 'dps1.AAAAAAAAAAAAAAAAAAAAAA' },
          { text: '💰 Deposit', callbackData: 'gd1.deposit' },
        ],
      },
    });
    expect(JSON.stringify(presentation)).not.toMatch(/PLAYER|SYNTB|uuid/iu);
    expect(JSON.stringify(presentation)).not.toMatch(/completed|successful/iu);
  });

  it('shows an authoritative live amount only after it is available', () => {
    const pending = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'telebirr_live_deposit_status',
      proofToken: 'A'.repeat(22),
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      amountMinor: null,
      currencyCode: null,
      depositStatus: { label: 'Being checked', tone: 'working' },
      financialMode: 'live',
    });
    const settled = presentTelegramPlayerIdFlowResult({
      version: 1,
      outcome: 'telebirr_live_deposit_status',
      proofToken: 'A'.repeat(22),
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      amountMinor: '2500',
      currencyCode: 'ETB',
      depositStatus: { label: 'Preparing deposit', tone: 'working' },
      financialMode: 'live',
    });
    expect(JSON.stringify(pending)).not.toContain('Amount:');
    expect(JSON.stringify(settled)).toContain('Amount: 25.00 ETB');
  });

  it('explains the button-first flow and tracking without requiring command syntax', () => {
    expect(telegramDepositHelpText()).toContain('Tap Deposit for payment details');
    expect(telegramDepositHelpText()).toContain('send your receipt or reference here.');
    expect(telegramDepositHelpText()).not.toContain('first line');
    expect(telegramDepositHelpText()).not.toContain('second line');
    expect(telegramDepositHelpText()).not.toContain('PROVIDER PLAYER_ID TRANSACTION_ID');
  });

  it('explains both SMS payment methods only when the SMS route is selected', () => {
    const help = telegramDepositHelpText(true);
    expect(help).toContain('Tap Deposit for payment details');
    expect(help).not.toContain('receiving phone SMS');
    expect(help).not.toContain('/cbe followed by the reference');
    expect(help).not.toContain('CBE Birr is not live yet');
  });

  it('asks the customer to choose one reference without exposing the candidate list', () => {
    expect(telegramDepositReferenceSelectionText()).toContain('Send just one.');
    expect(telegramDepositReferenceSelectionText()).not.toContain('PLAYER_ID TRANSACTION_ID');
  });
});
