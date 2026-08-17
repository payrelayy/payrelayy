import type { CustomerWebAuthPort } from '@fetanagent/customer-web-auth-runtime';
import type { CustomerWorkspaceRuntime } from '@fetanagent/customer-web-workspace-runtime';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { buildCustomerWebApp } from './app.js';
import {
  productPreviewPage,
  telegramProductPreviewPage,
  type PreviewDepositStage,
  type ProductPreviewModel,
  type ProductPreviewSection,
  type TelegramPreviewScreen,
} from './product-preview-pages.js';

const HOST = '127.0.0.1';
const PORT = 4173;
const AUTH_USER_ID = '018f1f58-91bd-7cc0-9e5a-5bda1d0c0184';
const PREVIEW_PLAYER_ID = 'PLAYER-DEMO-42' as const;
const PREVIEW_DEPOSIT_STAGES = new Set<PreviewDepositStage>([
  'details',
  'review',
  'payment',
  'checking_payment',
  'preparing_deposit',
  'completed',
  'needs_attention',
]);
const TELEGRAM_SCREENS = new Set<TelegramPreviewScreen>([
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
]);

const auth = Object.freeze({
  completePasswordRecovery: async () => ({ ok: true, status: 'password_updated' }),
  getCurrentCustomer: async () => ({
    account: { authUserId: AUTH_USER_ID, email: 'preview@fetanagent.local' },
    ok: true,
    status: 'authenticated',
  }),
  requestPasswordRecovery: async () => ({
    ok: true,
    status: 'recovery_request_accepted',
  }),
  signInWithEmailPassword: async () => ({ ok: true, status: 'authenticated' }),
  signOut: async () => ({ ok: true, status: 'signed_out' }),
  signUpWithEmailPassword: async () => ({ ok: true, status: 'authenticated' }),
} satisfies CustomerWebAuthPort);

const workspace = Object.freeze({
  captureDepositReference: async ({ depositIntentId }: { readonly depositIntentId: string }) => ({
    ok: true as const,
    depositIntentId,
    replayed: false,
    status: { label: 'Checking payment' as const, tone: 'working' as const },
    submittedAt: '2026-08-16T00:00:00.000Z',
  }),
  close: async () => undefined,
  ensureAccount: async () => ({ ok: true, status: 'active' }),
  listDeposits: async () => ({ ok: true as const, deposits: [] }),
  listPlayerRegistrations: async () => ({
    ok: true,
    registrations: [{ playerId: PREVIEW_PLAYER_ID, status: 'ready' }],
  }),
  ready: async () => true,
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
  submitPlayerRegistration: async ({ playerId }) => ({
    ok: true,
    registration: { playerId, status: 'checking' },
  }),
} satisfies CustomerWorkspaceRuntime);

const app = buildCustomerWebApp({
  auth,
  productPreviewMode: true,
  publicOrigin: `http://${HOST}:${PORT}`,
  workspace,
});

function previewQuery(request: FastifyRequest): Readonly<Record<string, unknown>> {
  return typeof request.query === 'object' &&
    request.query !== null &&
    !Array.isArray(request.query)
    ? (request.query as Readonly<Record<string, unknown>>)
    : {};
}

function previewAmount(query: Readonly<Record<string, unknown>>): number {
  const raw = query.amount;
  if (typeof raw !== 'string' || !/^[0-9]{2,5}$/u.test(raw)) return 100;
  const amount = Number(raw);
  return Number.isSafeInteger(amount) && amount >= 25 && amount <= 25_000 ? amount : 100;
}

function previewStage(
  query: Readonly<Record<string, unknown>>,
  fallback: PreviewDepositStage,
): PreviewDepositStage {
  const stage = query.step;
  return typeof stage === 'string' && PREVIEW_DEPOSIT_STAGES.has(stage as PreviewDepositStage)
    ? (stage as PreviewDepositStage)
    : fallback;
}

function previewModel(
  request: FastifyRequest,
  fallback: PreviewDepositStage = 'checking_payment',
): ProductPreviewModel {
  const query = previewQuery(request);
  return {
    amountEtb: previewAmount(query),
    depositStage: previewStage(query, fallback),
    playerId: PREVIEW_PLAYER_ID,
  };
}

function previewHtml(reply: FastifyReply, body: string): FastifyReply {
  return reply
    .header('cache-control', 'private, no-store, max-age=0, must-revalidate')
    .type('text/html; charset=utf-8')
    .send(body);
}

app.get('/preview', async (_request, reply) =>
  reply.code(302).header('location', '/preview/dashboard').send(),
);

for (const section of [
  'dashboard',
  'deposits',
  'player-ids',
  'activity',
  'account',
] as const satisfies readonly ProductPreviewSection[]) {
  app.get(`/preview/${section}`, async (request, reply) =>
    previewHtml(
      reply,
      productPreviewPage(
        section,
        previewModel(request, section === 'deposits' ? 'details' : 'checking_payment'),
      ),
    ),
  );
}

app.get('/preview/telegram', async (request, reply) => {
  const query = previewQuery(request);
  const rawScreen = query.screen;
  const screen =
    typeof rawScreen === 'string' && TELEGRAM_SCREENS.has(rawScreen as TelegramPreviewScreen)
      ? (rawScreen as TelegramPreviewScreen)
      : 'start';
  const sharedStage: PreviewDepositStage =
    screen === 'checking_payment' ||
    screen === 'preparing_deposit' ||
    screen === 'completed' ||
    screen === 'needs_attention'
      ? screen
      : 'details';
  return previewHtml(
    reply,
    telegramProductPreviewPage(screen, {
      amountEtb: previewAmount(query),
      depositStage: sharedStage,
      playerId: PREVIEW_PLAYER_ID,
    }),
  );
});

await app.listen({ host: HOST, port: PORT });
console.log(`FetanAgent web preview: http://${HOST}:${PORT}/preview/dashboard`);
console.log(`FetanAgent Telegram preview: http://${HOST}:${PORT}/preview/telegram`);
