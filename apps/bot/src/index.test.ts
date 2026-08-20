import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  actionDeliveries: [] as unknown[],
  admissionCalls: [] as unknown[],
  admissionOutcome: 'ignored' as 'ignored' | 'admitted' | 'unavailable',
  callbackHandler: undefined as ((context: unknown) => Promise<void>) | undefined,
  catchHandler: undefined as ((error: unknown) => void) | undefined,
  config: undefined as unknown,
  ingressDeliveries: [] as unknown[],
  messageHandler: undefined as ((context: unknown) => Promise<void>) | undefined,
  startOptions: undefined as
    | {
        readonly allowed_updates: readonly string[];
        readonly onStart: (botInfo: { readonly username: string }) => void;
      }
    | undefined,
}));

vi.mock('@fetanagent/config/bot', () => ({
  loadBotConfig: () => runtime.config,
  redactedBotConfigForLog: () => ({ redacted: true }),
}));

vi.mock('grammy', () => ({
  Bot: class {
    public on(event: string, handler: (context: unknown) => Promise<void>): void {
      if (event === 'message') runtime.messageHandler = handler;
      if (event === 'callback_query:data') runtime.callbackHandler = handler;
    }

    public catch(handler: (error: unknown) => void): void {
      runtime.catchHandler = handler;
    }

    public stop(): void {}

    public async start(options: typeof runtime.startOptions): Promise<void> {
      runtime.startOptions = options;
    }
  },
  InlineKeyboard: class {
    public text(): this {
      return this;
    }
  },
}));

vi.mock('./telegram-beta-invite-admission.js', () => ({
  handleTelegramBetaInviteMessage: async (...arguments_: unknown[]) => {
    runtime.admissionCalls.push(arguments_);
    return runtime.admissionOutcome;
  },
}));

vi.mock('./telegram-private-action-client.js', () => ({
  deliverTelegramPrivateActionWithRetry: async (action: unknown) => {
    runtime.actionDeliveries.push(action);
    return { outcome: 'deposit_proof_received' };
  },
}));

vi.mock('./telegram-player-id-flow.js', () => ({
  presentTelegramPlayerIdFlowResult: () => ({ kind: 'message', text: 'safe action reply' }),
}));

vi.mock('./telegram-ingress.js', () => ({
  toTelegramPrivateInboundEvent: (metadata: { readonly updateId: number }) => ({
    updateId: String(metadata.updateId),
    preferredLocale: 'en',
  }),
  deliverTelegramPrivateInboundWithRetry: async (inbound: unknown) => {
    runtime.ingressDeliveries.push(inbound);
  },
}));

interface TestMessageContext {
  readonly update: { readonly update_id: number };
  readonly chat: { readonly id: number; readonly type: 'private' };
  readonly from: {
    readonly id: number;
    readonly is_bot: false;
    readonly first_name: string;
    readonly language_code: string;
  };
  readonly message: { readonly text: string };
  readonly replies: string[];
  readonly reply: (text: string) => Promise<void>;
}

function messageContext(text: string): TestMessageContext {
  const replies: string[] = [];
  return {
    update: { update_id: 123456 },
    chat: { id: 123456789, type: 'private' },
    from: {
      id: 123456789,
      is_bot: false,
      first_name: 'Test',
      language_code: 'en',
    },
    message: { text },
    replies,
    reply: async (reply) => {
      replies.push(reply);
    },
  };
}

function botConfig(betaAdmissionEnabled: boolean, actionChannelEnabled: boolean) {
  return {
    nodeEnv: 'test',
    logLevel: 'silent',
    telegram: { enabled: true, token: '123456:test-token' },
    apiIngress: betaAdmissionEnabled
      ? { enabled: false, baseUrl: undefined, transportHmacSecret: undefined }
      : {
          enabled: true,
          baseUrl: 'http://api:3000/',
          transportHmacSecret: 'a'.repeat(64),
        },
    telegramBetaAdmission: betaAdmissionEnabled
      ? {
          enabled: true,
          baseUrl: 'http://beta-admission:3001/',
          transportHmacSecret: 'b'.repeat(64),
        }
      : { enabled: false, baseUrl: undefined, transportHmacSecret: undefined },
    telegramActionChannel: actionChannelEnabled
      ? {
          enabled: true,
          baseUrl: 'http://api:3000/',
          transportHmacSecret: 'c'.repeat(64),
        }
      : { enabled: false, baseUrl: undefined, transportHmacSecret: undefined },
  };
}

async function loadComposition(betaAdmissionEnabled: boolean, actionChannelEnabled: boolean) {
  runtime.config = botConfig(betaAdmissionEnabled, actionChannelEnabled);
  await import('./index.js');
  expect(runtime.messageHandler).toBeTypeOf('function');
  expect(runtime.startOptions).toBeDefined();
}

beforeEach(() => {
  vi.resetModules();
  runtime.actionDeliveries = [];
  runtime.admissionCalls = [];
  runtime.admissionOutcome = 'ignored';
  runtime.callbackHandler = undefined;
  runtime.catchHandler = undefined;
  runtime.config = undefined;
  runtime.ingressDeliveries = [];
  runtime.messageHandler = undefined;
  runtime.startOptions = undefined;
});

describe('Telegram admission, private action, and ingress composition', () => {
  it.each([
    {
      betaAdmissionEnabled: false,
      actionChannelEnabled: false,
      expectedAdmissionCalls: 0,
      expectedActionDeliveries: 0,
      expectedIngressDeliveries: 1,
    },
    {
      betaAdmissionEnabled: true,
      actionChannelEnabled: false,
      expectedAdmissionCalls: 1,
      expectedActionDeliveries: 0,
      expectedIngressDeliveries: 0,
    },
    {
      betaAdmissionEnabled: false,
      actionChannelEnabled: true,
      expectedAdmissionCalls: 0,
      expectedActionDeliveries: 1,
      expectedIngressDeliveries: 0,
    },
    {
      betaAdmissionEnabled: true,
      actionChannelEnabled: true,
      expectedAdmissionCalls: 1,
      expectedActionDeliveries: 1,
      expectedIngressDeliveries: 0,
    },
  ])(
    'routes proof-first commands with beta=$betaAdmissionEnabled and action=$actionChannelEnabled',
    async ({
      betaAdmissionEnabled,
      actionChannelEnabled,
      expectedAdmissionCalls,
      expectedActionDeliveries,
      expectedIngressDeliveries,
    }) => {
      await loadComposition(betaAdmissionEnabled, actionChannelEnabled);

      const context = messageContext('/deposit telebirr PLAYER-DEMO-42 SYNTHETICREF7890');
      await runtime.messageHandler!(context);

      expect(runtime.admissionCalls).toHaveLength(expectedAdmissionCalls);
      expect(runtime.actionDeliveries).toHaveLength(expectedActionDeliveries);
      expect(runtime.ingressDeliveries).toHaveLength(expectedIngressDeliveries);
      expect(runtime.callbackHandler === undefined).toBe(!actionChannelEnabled);
      expect(runtime.startOptions!.allowed_updates).toEqual(
        actionChannelEnabled ? ['message', 'callback_query'] : ['message'],
      );
    },
  );

  it('lets admission short-circuit only an update it handled', async () => {
    runtime.admissionOutcome = 'admitted';
    await loadComposition(true, true);

    await runtime.messageHandler!(
      messageContext('/deposit cbe_birr PLAYER-DEMO-42 SYNTHETICCBE7890'),
    );

    expect(runtime.admissionCalls).toHaveLength(1);
    expect(runtime.actionDeliveries).toHaveLength(0);
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('falls through from an unknown command to ingress when admission is disabled', async () => {
    await loadComposition(false, true);

    await runtime.messageHandler!(messageContext('/unknown'));

    expect(runtime.actionDeliveries).toHaveLength(0);
    expect(runtime.ingressDeliveries).toHaveLength(1);
  });

  it('handles action callbacks when admission is disabled', async () => {
    await loadComposition(false, true);
    const replies: string[] = [];
    let callbackAnswered = false;

    await runtime.callbackHandler!({
      update: { update_id: 123457 },
      chat: { id: 123456789, type: 'private' },
      from: { id: 123456789, is_bot: false, language_code: 'en' },
      callbackQuery: {
        data: 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w',
      },
      answerCallbackQuery: async () => {
        callbackAnswered = true;
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    });

    expect(callbackAnswered).toBe(true);
    expect(runtime.actionDeliveries).toHaveLength(1);
    expect(replies).toEqual(['safe action reply']);
  });

  it('rejects malformed deposit input without echoing it or falling through to ingress', async () => {
    await loadComposition(false, true);
    const unsafeInput = '/deposit telebirr PLAYER-DEMO-42 INVALID-REFERENCE';
    const context = messageContext(unsafeInput);

    await runtime.messageHandler!(context);

    expect(runtime.actionDeliveries).toHaveLength(0);
    expect(runtime.ingressDeliveries).toHaveLength(0);
    expect(context.replies).toHaveLength(1);
    expect(context.replies[0]).not.toContain(unsafeInput);
  });
});
