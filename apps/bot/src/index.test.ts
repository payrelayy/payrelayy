import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  actionDeliveries: [] as unknown[],
  actionResult: { version: 1, outcome: 'player_id_pending' } as unknown,
  actionError: false,
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
    public buttons: { text: string; callbackData: string }[] = [];

    public text(text: string, callbackData: string): this {
      this.buttons.push({ text, callbackData });
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
    if (runtime.actionError) throw new Error('Simulated transport failure.');
    return runtime.actionResult;
  },
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

const signals = ['SIGINT', 'SIGTERM'] as const;
let signalListeners = signals.map((signal) => process.rawListeners(signal));

beforeEach(() => {
  signalListeners = signals.map((signal) => process.rawListeners(signal));
  vi.resetModules();
  runtime.actionDeliveries = [];
  runtime.actionResult = { version: 1, outcome: 'player_id_pending' };
  runtime.actionError = false;
  runtime.admissionCalls = [];
  runtime.admissionOutcome = 'ignored';
  runtime.callbackHandler = undefined;
  runtime.catchHandler = undefined;
  runtime.config = undefined;
  runtime.ingressDeliveries = [];
  runtime.messageHandler = undefined;
  runtime.startOptions = undefined;
});

afterEach(() => {
  signals.forEach((signal, index) => {
    for (const listener of process.rawListeners(signal)) {
      if (!signalListeners[index]?.includes(listener)) {
        process.removeListener(signal, listener as () => void);
      }
    }
  });
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

  it('routes a public /start through the action channel when beta admission ignores it', async () => {
    await loadComposition(true, true);

    await runtime.messageHandler!(messageContext('/start'));

    expect(runtime.admissionCalls).toHaveLength(1);
    expect(runtime.actionDeliveries).toEqual([
      {
        version: 1,
        kind: 'root_menu',
        updateId: '123456',
        telegramUserId: '123456789',
        privateChatId: '123456789',
        preferredLocale: 'en',
      },
    ]);
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('preserves beta invite-token admission as a handled short-circuit', async () => {
    runtime.admissionOutcome = 'admitted';
    await loadComposition(true, true);

    await runtime.messageHandler!(messageContext(`/start ${'A'.repeat(43)}`));

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
    expect(replies).toEqual([
      'Player ID saved — pending validation. It cannot be used for a deposit yet.',
    ]);
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

  it('delivers a proof receipt button through the real presentation and callback handler', async () => {
    await loadComposition(false, true);
    const proofToken = 'A'.repeat(22);
    runtime.actionResult = {
      version: 1,
      outcome: 'deposit_proof_received',
      proofToken,
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'proof_received',
      financialMode: 'dry_run',
    };
    let keyboard: { buttons: { text: string; callbackData: string }[] } | undefined;
    const context = messageContext('/deposit telebirr PLAYER-DEMO-42 SYNTHETICREF7890');
    await runtime.messageHandler!({
      ...context,
      reply: async (text: string, options?: { reply_markup: typeof keyboard }) => {
        context.replies.push(text);
        keyboard = options?.reply_markup;
      },
    });
    expect(keyboard?.buttons).toEqual([
      { text: 'Check status', callbackData: `dps1.${proofToken}` },
    ]);
    expect(context.replies[0]).toContain(`/deposit_status p1.${proofToken}`);
    runtime.actionResult = { ...(runtime.actionResult as object), outcome: 'deposit_proof_status' };
    const answerCallbackQuery = vi.fn(async () => {});
    const reply = vi.fn(async (_text: string, _options?: unknown) => {});
    await runtime.callbackHandler!({
      ...context,
      update: { update_id: 123457 },
      callbackQuery: { data: keyboard?.buttons[0]?.callbackData },
      answerCallbackQuery,
      reply,
    });
    expect(answerCallbackQuery).toHaveBeenCalledOnce();
    expect(runtime.actionDeliveries[1]).toMatchObject({
      kind: 'deposit_proof_status_command',
      proofToken,
      telegramUserId: '123456789',
      privateChatId: '123456789',
    });
    expect(reply.mock.calls[0]?.[0]).toBe(context.replies[0]);
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('routes the proof handle and keeps legacy bare-token status intact', async () => {
    await loadComposition(false, true);
    const token = 'A'.repeat(22);
    await runtime.messageHandler!(messageContext(`/deposit_status p1.${token}`));
    await runtime.messageHandler!(messageContext(`/deposit_status ${token}`));
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({ kind: 'deposit_proof_status_command', proofToken: token }),
      expect.objectContaining({ kind: 'deposit_status_command', depositToken: token }),
    ]);
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('uses one generic reply for malformed, unavailable and transport-failed proof status', async () => {
    await loadComposition(false, true);
    const malformed = messageContext('/deposit_status p1.private-invalid-input');
    await runtime.messageHandler!(malformed);
    expect(runtime.actionDeliveries).toHaveLength(0);
    const unavailable = messageContext(`/deposit_status p1.${'A'.repeat(22)}`);
    runtime.actionResult = { version: 1, outcome: 'deposit_status_unavailable' };
    await runtime.messageHandler!(unavailable);
    const failed = messageContext(`/deposit_status p1.${'A'.repeat(22)}`);
    runtime.actionError = true;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await runtime.messageHandler!(failed);
    } finally {
      warning.mockRestore();
    }
    expect(malformed.replies).toEqual(unavailable.replies);
    expect(failed.replies).toEqual(unavailable.replies);
    expect(malformed.replies[0]).toContain('Deposit status is unavailable.');
    expect(malformed.replies[0]).not.toContain('private-invalid-input');
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('answers a malformed proof callback without dispatching an action', async () => {
    await loadComposition(false, true);
    const context = messageContext('');
    const answerCallbackQuery = vi.fn(async () => {});
    await runtime.callbackHandler!({
      ...context,
      callbackQuery: { data: 'dps1.private-invalid-input' },
      answerCallbackQuery,
    });
    expect(answerCallbackQuery).toHaveBeenCalledOnce();
    expect(context.replies[0]).toContain('Deposit status is unavailable.');
    expect(context.replies[0]).not.toContain('private-invalid-input');
    expect(runtime.actionDeliveries).toHaveLength(0);
  });

  it.each(['/help', '/deposit'])('shows current simulation guidance for %s', async (command) => {
    await loadComposition(false, true);
    const context = messageContext(command);
    await runtime.messageHandler!(context);
    expect(context.replies[0]).toContain('SIMULATION ONLY — DO NOT SEND MONEY.');
    expect(context.replies[0]).toContain('/deposit_status');
    expect(runtime.actionDeliveries).toHaveLength(0);
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });
});
