import type { CustomerWebAuthPort } from '@fetanagent/customer-web-auth-runtime';
import type { CustomerWorkspaceRuntime } from '@fetanagent/customer-web-workspace-runtime';
import { describe, expect, it } from 'vitest';

import { buildCustomerWebApp } from './app.js';
import {
  productPreviewPage,
  previewDepositStatusLabel,
  telegramProductPreviewPage,
  type PreviewDepositStage,
} from './product-preview-pages.js';

const model = {
  amountEtb: 100,
  depositStage: 'checking_payment' as const,
  playerId: 'PLAYER-DEMO-42' as const,
};

const auth = {
  completePasswordRecovery: async () => ({ ok: true, status: 'password_updated' }),
  getCurrentCustomer: async () => ({ ok: true, status: 'anonymous' }),
  requestPasswordRecovery: async () => ({ ok: true, status: 'recovery_request_accepted' }),
  signInWithEmailPassword: async () => ({ ok: true, status: 'authenticated' }),
  signOut: async () => ({ ok: true, status: 'signed_out' }),
  signUpWithEmailPassword: async () => ({ ok: true, status: 'authenticated' }),
} satisfies CustomerWebAuthPort;

const workspace = {
  captureDryRunDepositProof: async ({
    provider,
  }: {
    readonly provider: 'cbe_birr' | 'telebirr';
  }) => ({
    ok: true as const,
    provider,
    replayed: false,
    status: 'proof_received' as const,
    submittedAt: '2026-08-20T00:00:00.000Z',
  }),
  captureDepositReference: async ({ depositIntentId }: { readonly depositIntentId: string }) => ({
    ok: true as const,
    depositIntentId,
    replayed: false,
    status: { label: 'Checking payment' as const, tone: 'working' as const },
    submittedAt: '2026-08-16T00:00:00.000Z',
  }),
  close: async () => undefined,
  consumeRateLimit: async () => ({
    allowed: true,
    currentCount: 1,
    ok: true as const,
    retryAfterSeconds: 0,
  }),
  ensureAccount: async () => ({ ok: true, status: 'active' }),
  listDeposits: async () => ({ ok: true as const, deposits: [] }),
  listPlayerRegistrations: async () => ({ ok: true, registrations: [] }),
  openDeposit: async ({ amountMinor }: { readonly amountMinor: string }) => ({
    ok: true as const,
    instructions: {
      amountMinor,
      currencyCode: 'ETB' as const,
      customerInstruction: 'Send the exact amount using CBE Birr.',
      depositIntentId: '018f1f58-91bd-7cc0-9e5a-5bda1d0c0185',
      paymentDeadline: '2026-08-16T00:30:00.000Z',
      providerName: 'CBE Birr' as const,
      receiverAccountHolderName: 'FetanAgent',
      receiverAccountMasked: '***1234',
      replayed: false,
      status: { label: 'Ready to start' as const, tone: 'neutral' as const },
    },
  }),
  ready: async () => true,
  submitPlayerRegistration: async ({ playerId }) => ({
    ok: true,
    registration: { playerId, status: 'checking' },
  }),
} satisfies CustomerWorkspaceRuntime;

function expectNoOutsidePlatformLinks(page: string): void {
  expect(page).not.toMatch(/affiliate|registration link|login link|external platform/iu);
}

describe('full FetanAgent product preview', () => {
  it.each([
    ['details', 'Ready to start'],
    ['review', 'Ready to start'],
    ['payment', 'Ready to start'],
    ['checking_payment', 'Checking payment'],
    ['preparing_deposit', 'Preparing deposit'],
    ['completed', 'Completed'],
    ['needs_attention', 'Needs attention'],
  ] as const satisfies readonly (readonly [PreviewDepositStage, string])[])(
    'uses the shared customer projection for preview stage %s',
    (stage, label) => expect(previewDepositStatusLabel(stage)).toBe(label),
  );

  it('renders one unified customer workspace with all primary sections and progress states', () => {
    const page = productPreviewPage('dashboard', model);

    for (const label of ['Home', 'Deposits', 'Player IDs', 'Activity', 'Account']) {
      expect(page).toContain(label);
    }
    expect(page).toContain('Good to see you, Preview User.');
    expect(page).toContain('Start deposit');
    expect(page).toContain('PLAYER-DEMO-42');
    expect(page).toContain('Checking payment');
    expect(page).toContain('Working now');
    expect(page).toContain('In progress');
    expect(page).toContain('Preview boundary');
    expect(page).toContain('Preview · No money moves');
    expectNoOutsidePlatformLinks(page);
  });

  it('uses the normal deposit policy and covers review, payment, and status outcomes', () => {
    const details = productPreviewPage('deposits', {
      ...model,
      depositStage: 'details',
    });
    expect(details).toContain('min="25"');
    expect(details).toContain('max="25000"');
    expect(details).toContain('value="100"');
    expect(details).toContain('25–25,000 ETB');
    expect(details).toContain('Ready Player ID');

    const review = productPreviewPage('deposits', { ...model, depositStage: 'review' });
    expect(review).toContain('Review');
    expect(review).toContain('100 ETB');

    const payment = productPreviewPage('deposits', { ...model, depositStage: 'payment' });
    expect(payment).toContain('CBE Birr');
    expect(payment).toContain('***DEMO');
    expect(payment).toContain('15:00 remaining');
    expect(payment).toContain('PREVIEW-REF-2026');

    for (const stage of [
      'checking_payment',
      'preparing_deposit',
      'completed',
      'needs_attention',
    ] as const satisfies readonly PreviewDepositStage[]) {
      const page = productPreviewPage('deposits', { ...model, depositStage: stage });
      expect(page).toContain('these status changes are simulated and no money moved');
      expectNoOutsidePlatformLinks(page);
    }
  });

  it('mirrors the button-led Telegram journey without pretending handlers are live', () => {
    const screens = [
      'start',
      'deposit',
      'player',
      'amount',
      'review',
      'payment',
      'checking_payment',
      'preparing_deposit',
      'completed',
      'needs_attention',
    ] as const;
    const conversation = screens
      .map((screen) => telegramProductPreviewPage(screen, model))
      .join('\n');

    for (const copy of [
      'Interactive deposit experience',
      'Choose a Ready Player ID',
      'How much would you like to deposit?',
      'Review deposit',
      'CBE Birr payment instructions',
      'Receiver: ***DEMO',
      'Deadline: 15 minutes',
      'PREVIEW-REF-2026',
      'Checking payment',
      'Preparing deposit',
      'Completed',
      'Needs attention',
      'Message interactions are simulated',
    ]) {
      expect(conversation).toContain(copy);
    }
    expect(conversation).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
    );
    expect(conversation).not.toMatch(/service.?role|confirmation.?key|auth.?uuid/iu);
    expectNoOutsidePlatformLinks(conversation);
  });

  it('keeps local preview permission loopback-only and does not relax mutation provenance', async () => {
    expect(() =>
      buildCustomerWebApp({
        auth,
        publicOrigin: 'http://127.0.0.1:4173',
        workspace,
      }),
    ).toThrow('Customer web public origin must be one exact HTTPS origin.');
    expect(() =>
      buildCustomerWebApp({
        auth,
        productPreviewMode: true,
        publicOrigin: 'http://localhost:4173',
        workspace,
      }),
    ).toThrow('Customer web public origin must be one exact HTTPS origin.');

    const app = buildCustomerWebApp({
      auth,
      productPreviewMode: true,
      publicOrigin: 'http://127.0.0.1:4173',
      workspace,
    });
    const csrf = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const response = await app.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `__Host-fetanagent-csrf=${csrf}`,
        origin: 'null',
        'sec-fetch-site': 'same-origin',
      },
      method: 'POST',
      payload: `_csrf=${csrf}&playerId=PLAYER-DEMO-42&requestKey=4f8e2a44-58ef-4cb7-b274-6202e01ed341`,
      url: '/player-ids',
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
