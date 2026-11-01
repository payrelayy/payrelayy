import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
  buildTelegramTelebirrPaymentPrompt,
  buildTelegramCombinedPaymentPrompt,
} from './telegram-guided-deposit.js';

const runtime = vi.hoisted(() => ({
  actionDeliveries: [] as unknown[],
  actionResult: { version: 1, outcome: 'player_id_pending' } as unknown,
  actionError: false,
  admissionCalls: [] as unknown[],
  admissionOutcome: 'ignored' as 'ignored' | 'admitted' | 'unavailable',
  callbackHandler: undefined as ((context: unknown) => Promise<void>) | undefined,
  catchHandler: undefined as ((error: unknown) => void) | undefined,
  commandUpdates: [] as { kind: string; commands?: unknown; scope: unknown }[],
  config: undefined as unknown,
  ingressDeliveries: [] as unknown[],
  instructionRecords: [] as unknown[],
  mediaReads: [] as unknown[],
  mediaResult: { kind: 'text', text: 'Transaction ID: SYNTB00000001' } as unknown,
  messageHandler: undefined as ((context: unknown) => Promise<void>) | undefined,
  startOptions: undefined as
    | {
        readonly allowed_updates: readonly string[];
        readonly onStart: (botInfo: { readonly username: string }) => void | Promise<void>;
      }
    | undefined,
}));

vi.mock('@fetanagent/config/bot', () => ({
  BOT_PUBLIC_SUPPORT_CONTACT_URL: 'https://owner.fetanagent.com/v1/public/support-contact',
  loadBotConfig: () => runtime.config,
  redactedBotConfigForLog: () => ({ redacted: true }),
}));

vi.mock('grammy', () => ({
  Bot: class {
    public api = {
      config: { use: vi.fn() },
      setMyCommands: async (commands: unknown, options: { scope: unknown }) => {
        runtime.commandUpdates.push({ kind: 'set', commands, scope: options.scope });
        return true;
      },
      deleteMyCommands: async (options: { scope: unknown }) => {
        runtime.commandUpdates.push({ kind: 'delete', scope: options.scope });
        return true;
      },
    };
    public async init(): Promise<void> {}

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
    public buttons: { text: string; callbackData?: string; url?: string }[] = [];

    public text(text: string, callbackData: string): this {
      this.buttons.push({ text, callbackData });
      return this;
    }

    public row(): this {
      return this;
    }

    public url(text: string, url: string): this {
      this.buttons.push({ text, url });
      return this;
    }
  },
}));

vi.mock('./telegram-polling-readiness.js', () => ({
  createTelegramPollingReadiness: () => ({ transformer: vi.fn(), stop: vi.fn() }),
}));

vi.mock('./telegram-deposit-outcome-notifier.js', () => ({
  runTelegramDepositOutcomeNotifier: async () => {},
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

vi.mock('./telegram-payment-instruction-expiry.js', () => ({
  recordTelegramPaymentInstruction: async (...arguments_: unknown[]) => {
    runtime.instructionRecords.push(arguments_);
    return true;
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

vi.mock('./telegram-deposit-media.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./telegram-deposit-media.js')>()),
  extractTelegramProofMediaText: async (...arguments_: unknown[]) => {
    runtime.mediaReads.push(arguments_);
    return runtime.mediaResult;
  },
}));

interface TestMessageContext {
  readonly me: { readonly username: string };
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
    me: { username: 'FetanAgentBot' },
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

function botConfig(
  betaAdmissionEnabled: boolean,
  actionChannelEnabled: boolean,
  playerValidationIntakeEnabled = false,
  legacyIngressEnabled = !betaAdmissionEnabled,
  receiverSmsCandidateEnabled = false,
) {
  return {
    nodeEnv: 'test',
    logLevel: 'silent',
    telegram: { enabled: true, token: '123456:test-token' },
    supportContactUrl: undefined as string | undefined,
    playerValidationIntakeEnabled,
    receiverSmsCandidateEnabled,
    screenshotReferenceReader: { enabled: false, modelAccessKey: undefined },
    apiIngress: legacyIngressEnabled
      ? {
          enabled: true,
          baseUrl: 'http://api:3000/',
          transportHmacSecret: 'a'.repeat(64),
        }
      : { enabled: false, baseUrl: undefined, transportHmacSecret: undefined },
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

async function loadComposition(
  betaAdmissionEnabled: boolean,
  actionChannelEnabled: boolean,
  playerValidationIntakeEnabled = false,
  legacyIngressEnabled = !betaAdmissionEnabled,
  receiverSmsCandidateEnabled = false,
) {
  runtime.config = botConfig(
    betaAdmissionEnabled,
    actionChannelEnabled,
    playerValidationIntakeEnabled,
    legacyIngressEnabled,
    receiverSmsCandidateEnabled,
  );
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
  runtime.commandUpdates = [];
  runtime.config = undefined;
  runtime.ingressDeliveries = [];
  runtime.instructionRecords = [];
  runtime.mediaReads = [];
  runtime.mediaResult = { kind: 'text', text: 'Transaction ID: SYNTB00000001' };
  runtime.messageHandler = undefined;
  runtime.startOptions = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  signals.forEach((signal, index) => {
    for (const listener of process.rawListeners(signal)) {
      if (!signalListeners[index]?.includes(listener)) {
        process.removeListener(signal, listener as () => void);
      }
    }
  });
});

describe('Telegram admission, private action, and ingress composition', () => {
  it('publishes a short blue command menu only for private chats', async () => {
    await loadComposition(false, true, true, false, true);
    await runtime.startOptions!.onStart({ username: 'FetanAgentBot' });
    expect(runtime.commandUpdates).toEqual([
      {
        kind: 'set',
        commands: [
          { command: 'start', description: 'Home' },
          { command: 'deposit', description: 'Deposit' },
          { command: 'support', description: 'Support' },
          { command: 'help', description: 'Help' },
        ],
        scope: { type: 'all_private_chats' },
      },
    ]);
  });

  it('acknowledges a receipt without exposing the extracted reference', async () => {
    await loadComposition(false, true, false, false, true);
    runtime.mediaResult = { kind: 'text', text: 'Transaction ID: TB12345678' };
    runtime.actionResult = {
      version: 1,
      outcome: 'receiver_sms_candidate_received',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      matchStatus: 'pending_sms',
    };
    const context = messageContext('');
    await runtime.messageHandler!({
      ...context,
      message: { photo: [{ file_id: 'photo-id', file_size: 100 }] },
    });
    expect(context.replies).toEqual(['⏳ Payment details received. We’ll update you here.']);
    expect(runtime.actionDeliveries).toHaveLength(1);
  });

  it.each(['photo', 'document'] as const)(
    'routes a replied %s receipt through the existing protected proof action',
    async (kind) => {
      await loadComposition(false, true);
      const context = messageContext('');
      const prompt = buildTelegramTelebirrPaymentPrompt({
        playerId: 'PLAYER-DEMO-42',
        receiverAccountHolderName: 'Demo Receiver',
        receiverAccountReference: '0000000042',
      });
      await runtime.messageHandler!({
        ...context,
        message: {
          reply_to_message: { from: { is_bot: true }, text: prompt },
          ...(kind === 'photo'
            ? { photo: [{ file_id: 'photo-id', file_size: 100 }] }
            : { document: { file_id: 'pdf-id', file_size: 100, mime_type: 'application/pdf' } }),
        },
      });
      expect(runtime.mediaReads).toHaveLength(1);
      expect(runtime.actionDeliveries).toEqual([
        {
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
      ]);
      expect(runtime.ingressDeliveries).toHaveLength(0);
    },
  );

  it('accepts a private direct receipt but never downloads from a group', async () => {
    await loadComposition(false, true);
    const context = messageContext('');
    await runtime.messageHandler!({
      ...context,
      message: { photo: [{ file_id: 'photo-id', file_size: 100 }] },
    });
    await runtime.messageHandler!({
      ...context,
      chat: { id: -123456789, type: 'group' },
      message: {
        photo: [{ file_id: 'photo-id', file_size: 100 }],
        reply_to_message: {
          from: { is_bot: true },
          text: buildTelegramTelebirrPaymentPrompt({
            playerId: 'PLAYER-DEMO-42',
            receiverAccountHolderName: 'Demo Receiver',
            receiverAccountReference: '0000000042',
          }),
        },
      },
    });
    expect(runtime.mediaReads).toHaveLength(1);
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'saved_telebirr_proof_command',
        transactionReference: 'SYNTB00000001',
      }),
    ]);
  });

  it('submits a direct TeleBirr reference using the saved-Player action', async () => {
    await loadComposition(false, true);
    const context = messageContext('syntb00000001');
    await runtime.messageHandler!(context);
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'saved_telebirr_proof_command',
        transactionReference: 'SYNTB00000001',
      }),
    ]);
  });

  it('does not route a clearly CBE Birr receipt into TeleBirr', async () => {
    await loadComposition(false, true);
    const context = messageContext('CBE Birr receipt Txn ID TESTCBE123456');
    await runtime.messageHandler!(context);
    expect(context.replies).toEqual([expect.stringContaining('CBE Birr deposits are unavailable')]);
    expect(runtime.actionDeliveries).toHaveLength(0);
  });

  it('never starts a deposit when the replied receipt cannot be read', async () => {
    await loadComposition(false, true);
    runtime.mediaResult = { kind: 'unavailable' };
    const context = messageContext('');
    await runtime.messageHandler!({
      ...context,
      message: {
        photo: [{ file_id: 'photo-id', file_size: 100 }],
        reply_to_message: {
          from: { is_bot: true },
          text: buildTelegramTelebirrPaymentPrompt({
            playerId: 'PLAYER-DEMO-42',
            receiverAccountHolderName: 'Demo Receiver',
            receiverAccountReference: '0000000042',
          }),
        },
      },
    });
    expect(context.replies).toEqual([expect.stringContaining('couldn’t read that receipt')]);
    expect(runtime.actionDeliveries).toHaveLength(0);
  });

  it.each([
    { beta: false, action: false },
    { beta: true, action: false },
    { beta: false, action: true },
    { beta: true, action: true },
  ])(
    'handles public /support before every pipeline with beta=$beta action=$action',
    async ({ beta, action }) => {
      await loadComposition(beta, action);
      for (const command of ['/support', '/support@FetanAgentBot', '/support@fetanagentbot help']) {
        const context = messageContext(command);
        await runtime.messageHandler!(context);
        expect(context.replies[0]).toContain('Support is unavailable');
      }
      expect(runtime.admissionCalls).toHaveLength(0);
      expect(runtime.actionDeliveries).toHaveLength(0);
      expect(runtime.ingressDeliveries).toHaveLength(0);
    },
  );

  it.each(['/support', '/support@FetanAgentBot', '/support@FETANAGENTBOT help'])(
    'looks up the configured contact without admission, action or inbound delivery: %s',
    async (command) => {
      const fetchContact = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ supportContact: { telegramUsername: 'help_team' } }));
      vi.stubGlobal('fetch', fetchContact);
      runtime.config = {
        ...botConfig(true, true),
        supportContactUrl: 'https://owner.fetanagent.com/v1/public/support-contact',
      };
      await import('./index.js');
      const context = messageContext(command);
      await runtime.messageHandler!(context);
      expect(context.replies[0]).toContain('https://t.me/help_team');
      expect(runtime.admissionCalls).toHaveLength(0);
      expect(runtime.actionDeliveries).toHaveLength(0);
      expect(runtime.ingressDeliveries).toHaveLength(0);
      expect(fetchContact).toHaveBeenCalledOnce();
    },
  );

  it('keeps /support available during an Owner API interruption after a verified contact', async () => {
    const fetchContact = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ supportContact: { telegramUsername: 'help_team' } }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchContact);
    runtime.config = {
      ...botConfig(true, true),
      supportContactUrl: 'https://owner.fetanagent.com/v1/public/support-contact',
    };
    await import('./index.js');
    const first = messageContext('/support');
    const duringOutage = messageContext('/support');
    await runtime.messageHandler!(first);
    await runtime.messageHandler!(duringOutage);
    expect(first.replies).toEqual(['Contact support: https://t.me/help_team']);
    expect(duringOutage.replies).toEqual(['Contact support: https://t.me/help_team']);
    expect(fetchContact).toHaveBeenCalledTimes(2);
    expect(runtime.admissionCalls).toHaveLength(0);
    expect(runtime.actionDeliveries).toHaveLength(0);
  });

  it('offers a direct Support action when both deposit methods are unavailable', async () => {
    const fetchPublic = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith('/payment-methods')
          ? Response.json({ methods: { telebirr: false, cbe_birr: false } })
          : Response.json({ supportContact: { telegramUsername: 'help_team' } }),
      );
    vi.stubGlobal('fetch', fetchPublic);
    runtime.config = {
      ...botConfig(false, true, true, false, true),
      supportContactUrl: 'https://owner.fetanagent.com/v1/public/support-contact',
    };
    await import('./index.js');
    const replies: Array<{
      text: string;
      options: { reply_markup?: { buttons: Array<{ text: string; url?: string }> } } | undefined;
    }> = [];
    await runtime.messageHandler!({
      ...messageContext('/deposit'),
      reply: async (text: string, options?: (typeof replies)[number]['options']) => {
        replies.push({ text, options });
      },
    });
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toBe('Deposits are unavailable right now. Need help? /support.');
    expect(replies[0]!.options?.reply_markup?.buttons).toEqual([
      { text: '💬 Support', url: 'https://t.me/help_team' },
    ]);
    expect(runtime.actionDeliveries).toHaveLength(0);
  });

  it.each([
    { beta: false, action: false },
    { beta: true, action: false },
    { beta: false, action: true },
    { beta: true, action: true },
  ])(
    'consumes other-bot and malformed support addresses with beta=$beta action=$action',
    async ({ beta, action }) => {
      await loadComposition(beta, action);
      const fetchContact = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchContact);
      for (const command of [
        '/support@AnotherBot',
        '/support@',
        '/support@@FetanAgentBot',
        '/support@FetanAgentBot.extra',
      ]) {
        const context = messageContext(command);
        await runtime.messageHandler!(context);
        expect(context.replies).toHaveLength(0);
      }
      expect(fetchContact).not.toHaveBeenCalled();
      expect(runtime.admissionCalls).toHaveLength(0);
      expect(runtime.actionDeliveries).toHaveLength(0);
      expect(runtime.ingressDeliveries).toHaveLength(0);
    },
  );

  it.each(['/support', '/support@FetanAgentBot'])(
    'does not turn group support into an inbox event: %s',
    async (command) => {
      await loadComposition(false, false);
      const context = messageContext(command);
      await runtime.messageHandler!({ ...context, chat: { id: -123456789, type: 'group' } });
      expect(context.replies).toHaveLength(0);
      expect(runtime.admissionCalls).toHaveLength(0);
      expect(runtime.actionDeliveries).toHaveLength(0);
      expect(runtime.ingressDeliveries).toHaveLength(0);
    },
  );

  it('adds support discoverability without replacing existing deposit help', async () => {
    await loadComposition(false, true);
    const context = messageContext('/help');
    await runtime.messageHandler!(context);
    expect(context.replies[0]).toContain('Help: /support.');
    expect(context.replies[0]).toContain('Tap Deposit for payment details.');
  });

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
      expectedAdmissionCalls: 0,
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
      expectedAdmissionCalls: 0,
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

  it('does not let the retired admission handler short-circuit an action', async () => {
    runtime.admissionOutcome = 'admitted';
    await loadComposition(true, true);

    await runtime.messageHandler!(
      messageContext('/deposit cbe_birr PLAYER-DEMO-42 SYNTHETICCBE7890'),
    );

    expect(runtime.admissionCalls).toHaveLength(0);
    expect(runtime.actionDeliveries).toHaveLength(1);
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('routes a public /start through the action channel without admission', async () => {
    await loadComposition(true, true);

    await runtime.messageHandler!(messageContext('/start'));

    expect(runtime.admissionCalls).toHaveLength(0);
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

  it('runs the invite-free production action channel without legacy ingress', async () => {
    await loadComposition(false, true, true, false);

    await runtime.messageHandler!(messageContext('/start'));
    await runtime.messageHandler!(messageContext('ordinary private message'));

    expect(runtime.admissionCalls).toHaveLength(0);
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
    expect(runtime.startOptions!.allowed_updates).toEqual(['message', 'callback_query']);
  });

  it('renders Deposit as the first root-menu action', async () => {
    await loadComposition(false, true);
    runtime.actionResult = {
      version: 1,
      outcome: 'menu',
      callbackData: 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w',
      selectedPlayerId: null,
    };
    const context = messageContext('/menu');
    let keyboard: { buttons: { text: string; callbackData: string }[] } | undefined;
    await runtime.messageHandler!({
      ...context,
      reply: async (text: string, options?: { reply_markup: typeof keyboard }) => {
        context.replies.push(text);
        keyboard = options?.reply_markup;
      },
    });

    expect(context.replies[0]).toContain('FetanAgent');
    expect(keyboard?.buttons).toEqual([{ text: '➕ Add Player ID', callbackData: 'sp1.change' }]);
    expect(runtime.commandUpdates).toEqual([
      { kind: 'delete', scope: { type: 'chat', chat_id: 123456789 } },
    ]);
  });

  it('keeps Support visible on the saved-Player menu when deposit methods are offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (url) => {
        if (String(url).endsWith('/payment-methods'))
          return Response.json({ methods: { telebirr: false, cbe_birr: false } });
        if (String(url).endsWith('/withdrawal-chat'))
          return Response.redirect('https://t.me/balem18', 302);
        return Response.json({ supportContact: { telegramUsername: 'help_team' } });
      }),
    );
    runtime.config = {
      ...botConfig(false, true, true, false, true),
      supportContactUrl: 'https://owner.fetanagent.com/v1/public/support-contact',
    };
    await import('./index.js');
    runtime.actionResult = {
      version: 1,
      outcome: 'menu',
      callbackData: 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w',
      selectedPlayerId: 'PLAYER-DEMO-42',
    };
    let buttons: Array<{ text: string; callbackData?: string; url?: string }> = [];
    await runtime.messageHandler!({
      ...messageContext('/menu'),
      reply: async (_text: string, options?: { reply_markup?: { buttons: typeof buttons } }) => {
        buttons = options?.reply_markup?.buttons ?? [];
      },
    });
    expect(buttons).toEqual([
      { text: '💸 Withdraw', url: 'https://t.me/balem18' },
      { text: '💬 Support', url: 'https://t.me/help_team' },
    ]);
  });

  it('uses the current Owner handler only after a Player ID is saved', async () => {
    let handler = 'balem18';
    const fetchPublic = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith('/payment-methods'))
        return Response.json({ methods: { telebirr: true, cbe_birr: true } });
      if (String(url).endsWith('/withdrawal-chat'))
        return Response.redirect(`https://t.me/${handler}`, 302);
      throw new Error('Unexpected public lookup');
    });
    vi.stubGlobal('fetch', fetchPublic);
    runtime.config = {
      ...botConfig(false, true, true, false, true),
      supportContactUrl: 'https://owner.fetanagent.com/v1/public/support-contact',
    };
    await import('./index.js');
    const menus: Array<{ text: string; buttons: Array<{ text: string; url?: string }> }> = [];
    const reply = async (
      text: string,
      options?: { reply_markup?: { buttons: Array<{ text: string; url?: string }> } },
    ) => {
      menus.push({ text, buttons: options?.reply_markup?.buttons ?? [] });
    };

    runtime.actionResult = {
      version: 1,
      outcome: 'menu',
      callbackData: 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w',
      selectedPlayerId: null,
    };
    await runtime.messageHandler!({ ...messageContext('/menu'), reply });
    expect(menus[0]!.buttons).toEqual([{ text: '➕ Add Player ID', callbackData: 'sp1.change' }]);
    expect(fetchPublic.mock.calls.some(([url]) => String(url).endsWith('/withdrawal-chat'))).toBe(
      false,
    );

    runtime.actionResult = {
      version: 1,
      outcome: 'menu',
      callbackData: 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w',
      selectedPlayerId: 'PLAYER-DEMO-42',
    };
    await runtime.messageHandler!({ ...messageContext('/menu'), reply });
    expect(menus[1]!.text).toBe('FetanAgent\nPlayer ID: PLAYER-DEMO-42');
    expect(menus[1]!.buttons[1]).toEqual({ text: '💸 Withdraw', url: 'https://t.me/balem18' });
    handler = 'new_handler';
    await runtime.messageHandler!({ ...messageContext('/menu'), reply });
    expect(menus[2]!.buttons[1]).toEqual({ text: '💸 Withdraw', url: 'https://t.me/new_handler' });
  });

  it('adds Support beside a remaining status action when its Deposit action is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (url) =>
          String(url).endsWith('/payment-methods')
            ? Response.json({ methods: { telebirr: false, cbe_birr: false } })
            : Response.json({ supportContact: { telegramUsername: 'help_team' } }),
        ),
    );
    runtime.config = {
      ...botConfig(false, true, true, false, true),
      supportContactUrl: 'https://owner.fetanagent.com/v1/public/support-contact',
    };
    await import('./index.js');
    runtime.actionResult = {
      version: 1,
      outcome: 'telebirr_live_deposit_status',
      proofToken: 'A'.repeat(22),
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      amountMinor: '10000',
      currencyCode: 'ETB',
      depositStatus: { label: 'Checking payment', tone: 'working' },
      financialMode: 'live',
    };
    let buttons: Array<{ text: string; callbackData?: string; url?: string }> = [];
    await runtime.messageHandler!({
      ...messageContext('/menu'),
      reply: async (_text: string, options?: { reply_markup?: { buttons: typeof buttons } }) => {
        buttons = options?.reply_markup?.buttons ?? [];
      },
    });
    expect(buttons).toEqual([
      { text: 'Refresh status', callbackData: `dps1.${'A'.repeat(22)}` },
      { text: '💬 Support', url: 'https://t.me/help_team' },
    ]);
  });

  it('offers one Deposit action on the live SMS menu and routes CBE proof automatically', async () => {
    await loadComposition(false, true, true, false, true);
    runtime.actionResult = {
      version: 1,
      outcome: 'menu',
      callbackData: 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w',
      selectedPlayerId: 'PLAYER-DEMO-42',
    };
    let buttons: { text: string; callbackData?: string; url?: string }[] = [];
    await runtime.messageHandler!({
      ...messageContext('/menu'),
      reply: async (_text: string, options?: { reply_markup?: { buttons: typeof buttons } }) => {
        buttons = options?.reply_markup?.buttons ?? [];
      },
    });
    expect(buttons).toEqual([{ text: '💰 Deposit', callbackData: 'gd1.deposit' }]);
    expect(runtime.commandUpdates).toEqual([
      {
        kind: 'set',
        commands: [
          { command: 'start', description: 'Home' },
          { command: 'deposit', description: 'Deposit' },
          { command: 'change_player_id', description: 'Change Player ID' },
          { command: 'support', description: 'Support' },
          { command: 'help', description: 'Help' },
        ],
        scope: { type: 'chat', chat_id: 123456789 },
      },
    ]);
    runtime.actionDeliveries = [];
    runtime.actionResult = { version: 1, outcome: 'player_selection_missing' };
    await runtime.callbackHandler!({
      ...messageContext(''),
      update: { update_id: 123457 },
      callbackQuery: { data: 'gd1.deposit' },
      answerCallbackQuery: async () => {},
    });
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'saved_combined_destination_command',
        providerCodes: ['telebirr', 'cbe_birr'],
      }),
    ]);
    runtime.actionDeliveries = [];
    runtime.actionResult = {
      version: 1,
      outcome: 'receiver_sms_candidate_received',
      providerCode: 'cbe_birr',
      providerName: 'CBE Birr',
      matchStatus: 'pending_sms',
    };
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
    await runtime.messageHandler!({
      ...messageContext('CBE12345678'),
      message: {
        text: 'CBE12345678',
        reply_to_message: {
          text: prompt,
          from: { is_bot: true },
        },
      },
    });
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'deposit_proof_command',
        providerCode: 'cbe_birr',
        playerId: 'PLAYER-DEMO-42',
        transactionReference: 'CBE12345678',
      }),
    ]);
  });

  it('shows both configured receivers in one message and records TeleBirr expiry', async () => {
    await loadComposition(false, true, true, false, true);
    runtime.actionResult = {
      version: 1,
      outcome: 'combined_deposit_destination',
      selectedPlayerId: 'PLAYER-DEMO-42',
      acceptsPayments: true,
      receivers: [
        {
          providerCode: 'telebirr',
          providerName: 'TeleBirr',
          receiverAccountHolderName: 'TeleBirr Owner Name',
          receiverAccountReference: '251900000042',
          receiverAccountMasked: '***0042',
        },
        {
          providerCode: 'cbe_birr',
          providerName: 'CBE Birr',
          receiverAccountHolderName: 'CBE Owner Name',
          receiverAccountReference: '251900000043',
          receiverAccountMasked: '***0043',
        },
      ],
    };
    const replies: {
      text: string;
      options:
        | {
            reply_markup?: { buttons?: unknown[] };
            entities?: { type: string; offset: number; length: number }[];
          }
        | undefined;
    }[] = [];
    await runtime.messageHandler!({
      ...messageContext('/deposit'),
      reply: async (
        text: string,
        options?: {
          reply_markup?: { buttons?: unknown[] };
          entities?: { type: string; offset: number; length: number }[];
        },
      ) => {
        replies.push({ text, options });
        return { message_id: 42 };
      },
    });
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'saved_combined_destination_command',
        providerCodes: ['telebirr', 'cbe_birr'],
      }),
    ]);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain('Name: TeleBirr Owner Name\nNumber: 900000042');
    expect(replies[0]!.text).toContain('Name: CBE Owner Name\nNumber: 900000043');
    expect(replies[0]!.text).toContain('Saved Player ID: PLAYER-DEMO-42');
    expect(replies[0]!.text).not.toContain('2519000000');
    expect(replies[0]!.text).not.toContain('Choose one available method');
    expect(replies[0]!.text).not.toContain(
      'Valid for 1 hour. Check the receiver name before paying.',
    );
    expect(replies[0]!.text).toContain('After paying, send your receipt or reference here.');
    expect(replies[0]!.options?.reply_markup).toBeUndefined();
    expect(
      replies[0]!.options?.entities?.map((entity) => ({
        type: entity.type,
        text: replies[0]!.text.slice(entity.offset, entity.offset + entity.length),
      })),
    ).toEqual([
      { type: 'code', text: '900000042' },
      { type: 'code', text: '900000043' },
    ]);
    expect(runtime.instructionRecords).toHaveLength(1);
    expect(runtime.instructionRecords[0]).toEqual([expect.anything(), '123456', '123456789', 42]);
  });

  it('shows CBE only without trying TeleBirr-only expiry registration', async () => {
    runtime.config = {
      ...botConfig(false, true, true, false, true),
      supportContactUrl: 'https://owner.fetanagent.com/v1/public/support-contact',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          methods: { telebirr: false, cbe_birr: true },
        }),
      ),
    );
    await import('./index.js');
    runtime.actionResult = {
      version: 1,
      outcome: 'combined_deposit_destination',
      selectedPlayerId: 'PLAYER-DEMO-42',
      acceptsPayments: true,
      receivers: [
        {
          providerCode: 'cbe_birr',
          providerName: 'CBE Birr',
          receiverAccountHolderName: 'CBE Owner Name',
          receiverAccountReference: '251900000043',
          receiverAccountMasked: '***0043',
        },
      ],
    };
    const replies: {
      text: string;
      options:
        | {
            reply_markup?: { buttons?: unknown[] };
            entities?: { type: string; offset: number; length: number }[];
          }
        | undefined;
    }[] = [];
    await runtime.callbackHandler!({
      ...messageContext(''),
      callbackQuery: { data: 'gd1.deposit' },
      answerCallbackQuery: async () => {},
      reply: async (
        text: string,
        options?: {
          reply_markup?: { buttons?: unknown[] };
          entities?: { type: string; offset: number; length: number }[];
        },
      ) => {
        replies.push({ text, options });
        return { message_id: 42 };
      },
    });
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({ providerCodes: ['cbe_birr'] }),
    ]);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain('Name: CBE Owner Name\nNumber: 900000043');
    expect(replies[0]!.text).not.toContain('TeleBirr\n');
    expect(replies[0]!.text).not.toContain('Valid for 1 hour');
    expect(replies[0]!.options?.reply_markup).toBeUndefined();
    expect(
      replies[0]!.options?.entities?.map((entity) =>
        replies[0]!.text.slice(entity.offset, entity.offset + entity.length),
      ),
    ).toEqual(['900000043']);
    expect(runtime.instructionRecords).toHaveLength(0);
  });

  it('accepts either bare reference and a CBE screenshot without a method selection', async () => {
    await loadComposition(false, true, true, false, true);
    runtime.actionResult = {
      version: 1,
      outcome: 'receiver_sms_candidate_received',
      providerCode: 'cbe_birr',
      providerName: 'CBE Birr',
      matchStatus: 'pending_sms',
    };
    await runtime.messageHandler!(messageContext('TB12345678'));
    await runtime.messageHandler!(messageContext('CBE12345678'));
    runtime.mediaResult = { kind: 'text', text: 'Txn ID: CBE12345678. Paid 100 ETB.' };
    await runtime.messageHandler!({
      ...messageContext(''),
      message: { photo: [{ file_id: 'photo-id', file_size: 100 }] },
    });
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'saved_receiver_sms_proof_command',
        providerCode: 'telebirr',
        transactionReference: 'TB12345678',
      }),
      expect.objectContaining({
        kind: 'saved_receiver_sms_proof_command',
        providerCode: 'cbe_birr',
        transactionReference: 'CBE12345678',
      }),
      expect.objectContaining({
        kind: 'saved_receiver_sms_proof_command',
        providerCode: 'cbe_birr',
        transactionReference: 'CBE12345678',
      }),
    ]);
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('attaches Deposit to an immediate duplicate rejection and routes the button to the deposit flow', async () => {
    await loadComposition(false, true, true, false, true);
    runtime.actionResult = {
      version: 1,
      outcome: 'receiver_sms_candidate_received',
      providerCode: 'cbe_birr',
      providerName: 'CBE Birr',
      matchStatus: 'already_used',
      duplicateState: 'credited',
    };
    const context = messageContext('CBE12345678');
    let keyboard: { buttons: { text: string; callbackData: string }[] } | undefined;
    await runtime.messageHandler!({
      ...context,
      reply: async (text: string, options?: { reply_markup: typeof keyboard }) => {
        context.replies.push(text);
        keyboard = options?.reply_markup;
      },
    });
    expect(context.replies).toEqual([
      '❌ This payment was already credited. It can’t be credited again.',
    ]);
    expect(keyboard?.buttons).toEqual([{ text: '💰 Deposit', callbackData: 'gd1.deposit' }]);
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'saved_receiver_sms_proof_command',
        transactionReference: 'CBE12345678',
      }),
    ]);
    runtime.actionDeliveries = [];
    runtime.actionResult = { version: 1, outcome: 'player_selection_missing' };
    await runtime.callbackHandler!({
      ...context,
      callbackQuery: { data: keyboard?.buttons[0]?.callbackData },
      answerCallbackQuery: async () => {},
    });
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({ kind: 'saved_combined_destination_command' }),
    ]);
  });

  it.each([
    ['telebirr', 'TB12345678'],
    ['cbe_birr', 'CBE12345678'],
  ] as const)(
    'acknowledges a new %s payment without suggesting another deposit',
    async (providerCode, reference) => {
      await loadComposition(false, true, true, false, true);
      runtime.actionResult = {
        version: 1,
        outcome: 'receiver_sms_candidate_received',
        providerCode,
        providerName: providerCode === 'telebirr' ? 'TeleBirr' : 'CBE Birr',
        matchStatus: 'pending_sms',
      };
      const context = messageContext(reference);
      const reply = vi.fn(async (text: string, options?: unknown) => {
        context.replies.push(text);
        return options;
      });
      await runtime.messageHandler!({ ...context, reply });
      expect(context.replies).toEqual(['⏳ Payment details received. We’ll update you here.']);
      expect(reply).toHaveBeenCalledExactlyOnceWith(context.replies[0], undefined);
      expect(runtime.actionDeliveries).toEqual([
        expect.objectContaining({
          kind: 'saved_receiver_sms_proof_command',
          transactionReference: reference,
        }),
      ]);
    },
  );

  it('routes a pasted CBE SMS and a captioned PDF with an unrelated feedback link', async () => {
    await loadComposition(false, true, true, false, true);
    const reference = 'SYNTHCBE001';
    const sms =
      `Dear customer, you sent 110.00Br. on 27/10/26 15:05,Txn ID ${reference}. ` +
      `For invoice https://cbepay1.cbe.com.et/aureceipt?TID=${reference}&PH=900000001 ` +
      'For feedback https://shorturl.at/gy3A0';
    runtime.actionResult = {
      version: 1,
      outcome: 'receiver_sms_candidate_received',
      providerCode: 'cbe_birr',
      providerName: 'CBE Birr',
      matchStatus: 'pending_sms',
    };
    await runtime.messageHandler!(messageContext(sms));
    runtime.mediaResult = {
      kind: 'text',
      text: `Order ID ${reference}\nReceipt Number Transaction Date Amount`,
    };
    await runtime.messageHandler!({
      ...messageContext(''),
      message: {
        caption: sms,
        document: {
          file_id: 'synthetic-pdf-id',
          file_size: 100,
          file_name: 'receipt.pdf',
          mime_type: 'application/pdf',
        },
      },
    });
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'saved_receiver_sms_proof_command',
        providerCode: 'cbe_birr',
        transactionReference: reference,
      }),
      expect.objectContaining({
        kind: 'saved_receiver_sms_proof_command',
        providerCode: 'cbe_birr',
        transactionReference: reference,
      }),
    ]);
  });

  it('asks for one reference when a live SMS proof contains two methods', async () => {
    await loadComposition(false, true, true, false, true);
    const context = messageContext('Txn ID: TB12345678. Txn ID: CBE12345678.');
    let keyboard: { buttons: { text: string; callbackData: string }[] } | undefined;
    await runtime.messageHandler!({
      ...context,
      reply: async (text: string, options?: { reply_markup: typeof keyboard }) => {
        context.replies.push(text);
        keyboard = options?.reply_markup;
      },
    });
    expect(runtime.actionDeliveries).toHaveLength(0);
    expect(context.replies).toEqual([expect.stringContaining('more than one reference')]);
    expect(keyboard?.buttons).toEqual([{ text: '💰 Deposit', callbackData: 'gd1.deposit' }]);
    expect(JSON.stringify(context.replies)).not.toMatch(/TB12345678|CBE12345678/);
  });

  it('hides manual review in the opt-in menu and does not send a stale review callback', async () => {
    await loadComposition(false, true, true);
    runtime.actionResult = {
      version: 1,
      outcome: 'menu',
      callbackData: 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w',
      selectedPlayerId: null,
    };
    let keyboard: { buttons: { text: string; callbackData: string }[] } | undefined;
    await runtime.messageHandler!({
      ...messageContext('/menu'),
      reply: async (_text: string, options?: { reply_markup: typeof keyboard }) => {
        keyboard = options?.reply_markup;
      },
    });
    expect(keyboard?.buttons).toEqual([{ text: '➕ Add Player ID', callbackData: 'sp1.change' }]);

    runtime.actionDeliveries = [];
    const replies: string[] = [];
    await runtime.callbackHandler!({
      update: { update_id: 123457 },
      chat: { id: 123456789, type: 'private' },
      from: { id: 123456789, is_bot: false, language_code: 'en' },
      callbackQuery: { data: 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w' },
      answerCallbackQuery: async () => {},
      reply: async (text: string) => {
        replies.push(text);
      },
    });
    expect(replies).toEqual([TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT]);
    expect(runtime.actionDeliveries).toHaveLength(0);
  });

  it('does not redeem an old invite token', async () => {
    runtime.admissionOutcome = 'admitted';
    await loadComposition(true, true);

    await runtime.messageHandler!(messageContext(`/start ${'A'.repeat(43)}`));

    expect(runtime.admissionCalls).toHaveLength(0);
    expect(runtime.actionDeliveries).toHaveLength(0);
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('falls through from an unknown command to ingress when admission is disabled', async () => {
    await loadComposition(false, true);

    const context = messageContext('/unknown');
    await runtime.messageHandler!(context);

    expect(runtime.actionDeliveries).toHaveLength(0);
    expect(runtime.ingressDeliveries).toHaveLength(1);
    expect(context.replies).toEqual([
      'I didn’t understand that. Open /menu for Deposit or Player ID, or /support for help.',
    ]);
  });

  it('guides an unrecognized private message when legacy ingress is disabled', async () => {
    await loadComposition(false, true, true, false);

    const context = messageContext('hello');
    await runtime.messageHandler!(context);

    expect(runtime.ingressDeliveries).toHaveLength(0);
    expect(context.replies).toEqual([
      'I didn’t understand that. Open /menu for Deposit or Player ID, or /support for help.',
    ]);
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
    expect(replies).toEqual(['Your Player ID is being checked. We’ll update you here.']);
  });

  it.each(['command', 'button'] as const)(
    'opens the same normal Player ID prompt from the %s entry point',
    async (entryPoint) => {
      await loadComposition(false, true);
      runtime.actionResult = { version: 1, outcome: 'player_selection_missing' };
      const replies: { text: string; options?: unknown }[] = [];
      const reply = async (text: string, options?: unknown) => {
        replies.push({ text, options });
      };

      if (entryPoint === 'command') {
        await runtime.messageHandler!({ ...messageContext('/deposit'), reply });
      } else {
        const answerCallbackQuery = vi.fn(async () => {});
        await runtime.callbackHandler!({
          ...messageContext(''),
          update: { update_id: 123457 },
          callbackQuery: { data: 'gd1.deposit' },
          answerCallbackQuery,
          reply,
        });
        expect(answerCallbackQuery).toHaveBeenCalledOnce();
      }

      expect(replies).toEqual([{ text: TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT, options: undefined }]);
      expect(runtime.actionDeliveries).toEqual([
        expect.objectContaining({ kind: 'saved_telebirr_destination_command' }),
      ]);
      expect(runtime.ingressDeliveries).toHaveLength(0);
    },
  );

  it('opens Change Player ID without forcing a Telegram reply', async () => {
    await loadComposition(false, true, true, false, true);
    const replies: { text: string; options?: unknown }[] = [];
    await runtime.callbackHandler!({
      ...messageContext(''),
      callbackQuery: { data: 'sp1.change' },
      answerCallbackQuery: async () => {},
      reply: async (text: string, options?: unknown) => {
        replies.push({ text, options });
      },
    });

    expect(replies).toEqual([{ text: TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT, options: undefined }]);
    expect(runtime.actionDeliveries).toHaveLength(0);

    runtime.actionResult = { version: 1, outcome: 'player_validation_queued' };
    await runtime.messageHandler!(messageContext('28379330'));
    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'player_validation_request_command',
        playerId: '28379330',
      }),
    ]);
  });

  it('opens Change Player ID from the blue Telegram command menu', async () => {
    await loadComposition(false, true, true, false, true);
    const context = messageContext('/change_player_id');
    await runtime.messageHandler!(context);
    expect(context.replies).toEqual([TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT]);
    expect(runtime.actionDeliveries).toHaveLength(0);
  });

  it('saves one Player ID and offers Deposit without starting payment', async () => {
    await loadComposition(false, true);
    runtime.actionResult = {
      version: 1,
      outcome: 'player_selection_saved',
      playerId: 'PLAYER-DEMO-42',
    };
    const context = messageContext('PLAYER-DEMO-42');
    const replies: { text: string; options?: unknown }[] = [];
    await runtime.messageHandler!({
      ...context,
      message: {
        text: 'PLAYER-DEMO-42',
        reply_to_message: {
          text: TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
          from: { is_bot: true },
        },
      },
      reply: async (text: string, options?: unknown) => {
        replies.push({ text, options });
      },
    });

    expect(runtime.actionDeliveries).toEqual([
      {
        version: 1,
        kind: 'save_player_selection_command',
        updateId: '123456',
        telegramUserId: '123456789',
        privateChatId: '123456789',
        preferredLocale: 'en',
        playerId: 'PLAYER-DEMO-42',
      },
    ]);
    expect(replies[0]?.text).toBe('✅ Player ID verified. You can deposit now.');
    expect(replies[0]?.options).toBeDefined();
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('queues a guided Player ID for signed Find only with the explicit opt-in', async () => {
    await loadComposition(false, true, true);
    runtime.actionResult = { version: 1, outcome: 'player_validation_queued' };
    const context = messageContext('PLAYER-DEMO-42');
    await runtime.messageHandler!({
      ...context,
      message: {
        text: 'PLAYER-DEMO-42',
        reply_to_message: {
          text: TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
          from: { is_bot: true },
        },
      },
    });

    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'player_validation_request_command',
        playerId: 'PLAYER-DEMO-42',
      }),
    ]);
    expect(context.replies).toEqual([expect.stringContaining('Checking your Player ID')]);
    expect(context.replies[0]).not.toContain('✅ Player ID');
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('checks an unprompted eight-digit Player ID before the automatic payment-reference route', async () => {
    await loadComposition(false, true, true, false, true);
    runtime.actionResult = { version: 1, outcome: 'player_validation_queued' };
    const context = messageContext('28379330');
    await runtime.messageHandler!(context);

    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'player_validation_request_command',
        playerId: '28379330',
      }),
    ]);
    expect(context.replies).toEqual([expect.stringContaining('Checking your Player ID')]);
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('treats eight digits replying to payment instructions as a Player ID, not a payment', async () => {
    await loadComposition(false, true, true, false, true);
    runtime.actionResult = { version: 1, outcome: 'player_validation_queued' };
    const prompt = buildTelegramCombinedPaymentPrompt({
      playerId: '28379330',
      receivers: [
        {
          providerCode: 'telebirr',
          receiverAccountHolderName: 'Demo Receiver',
          receiverAccountReference: '251900000042',
        },
      ],
    });
    const context = messageContext('12345678');
    await runtime.messageHandler!({
      ...context,
      message: { text: '12345678', reply_to_message: { text: prompt, from: { is_bot: true } } },
    });

    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'player_validation_request_command',
        playerId: '12345678',
      }),
    ]);
  });

  it('does not reinterpret unrelated free text as a Player-ID Find request', async () => {
    await loadComposition(false, true, true);
    await runtime.messageHandler!(messageContext('NOT-A-PLAYER-ID'));
    expect(runtime.actionDeliveries).toHaveLength(0);
  });

  it('accepts only the transaction number after the displayed payment details', async () => {
    await loadComposition(false, true);
    runtime.actionResult = {
      version: 1,
      outcome: 'telebirr_shadow_verification_queued',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'verification_queued',
      verificationMode: 'shadow_no_money',
    };
    const paymentPrompt = buildTelegramTelebirrPaymentPrompt({
      playerId: 'PLAYER-DEMO-42',
      receiverAccountHolderName: 'Demo Receiver',
      receiverAccountReference: '0000000042',
    });
    const context = messageContext('SYNTB00000001');
    await runtime.messageHandler!({
      ...context,
      message: {
        text: 'SYNTB00000001',
        reply_to_message: { text: paymentPrompt, from: { is_bot: true } },
      },
    });

    expect(runtime.actionDeliveries).toEqual([
      expect.objectContaining({
        kind: 'deposit_proof_command',
        providerCode: 'telebirr',
        playerId: 'PLAYER-DEMO-42',
        transactionReference: 'SYNTB00000001',
      }),
    ]);
    expect(context.replies[0]).toContain('Test reference received');
    expect(JSON.stringify(context.replies)).not.toMatch(/SYNTB|PLAYER-DEMO|0000000042/);
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });

  it('keeps an invalid guided reply local and does not disclose it', async () => {
    await loadComposition(false, true);
    const unsafeInput = 'PLAYER DEMO 42';
    const context = messageContext(unsafeInput);
    await runtime.messageHandler!({
      ...context,
      message: {
        text: unsafeInput,
        reply_to_message: {
          text: TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
          from: { is_bot: true },
        },
      },
    });

    expect(runtime.actionDeliveries).toHaveLength(0);
    expect(runtime.ingressDeliveries).toHaveLength(0);
    expect(context.replies).toHaveLength(1);
    expect(context.replies[0]).toContain('Player ID doesn’t look right');
    expect(context.replies[0]).not.toMatch(/PLAYER-DEMO|PRIVATE-INVALID/);
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

  it.each([
    'https://customer-controlled.invalid/receipt/SYNTB00000001?private=do-not-forward',
    'Synthetic Receiver paid ETB 900.00.\nTransaction ID: SYNTB00000001. Fee ETB 5.00.',
  ])(
    'routes a pasted TeleBirr proof into existing protected capture and tracking',
    async (proofText) => {
      await loadComposition(false, true);
      runtime.actionResult = {
        version: 1,
        outcome: 'deposit_proof_received',
        proofToken: 'A'.repeat(22),
        providerCode: 'telebirr',
        providerName: 'TeleBirr',
        proofStatus: 'proof_received',
        financialMode: 'dry_run',
      };
      const context = messageContext(`/deposit telebirr PLAYER-DEMO-42 ${proofText}`);
      await runtime.messageHandler!(context);

      expect(runtime.actionDeliveries).toEqual([
        {
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
      ]);
      expect(runtime.ingressDeliveries).toHaveLength(0);
      expect(context.replies[0]).toContain('p1.AAAAAAAAAAAAAAAAAAAAAA');
      expect(context.replies[0]).toContain('No Player credit will be made');
      expect(JSON.stringify(context.replies)).not.toMatch(
        /SYNTB|PLAYER-DEMO|900|5\.00|https:|Synthetic Receiver/,
      );
      expect(JSON.stringify(runtime.actionDeliveries)).not.toContain(proofText);
    },
  );

  it('requires explicit selection for different URL/SMS references without dispatch or disclosure', async () => {
    await loadComposition(false, true);
    const context = messageContext(
      '/deposit telebirr PLAYER-DEMO-42 https://example.invalid/receipt/SYNTB00000001 Transaction ID: SYNTB00000002',
    );
    await runtime.messageHandler!(context);
    expect(runtime.actionDeliveries).toHaveLength(0);
    expect(runtime.ingressDeliveries).toHaveLength(0);
    expect(context.replies).toEqual([expect.stringContaining('more than one reference')]);
    expect(context.replies[0]).toContain('Send just one.');
    expect(context.replies[0]).not.toMatch(/SYNTB|PLAYER-DEMO|example\.invalid/);
  });

  it('rejects malformed pasted proof locally and does not mistake it for Player-ID registration', async () => {
    await loadComposition(false, true);
    const context = messageContext(
      '/deposit telebirr PLAYER-DEMO-42 Transaction ID: SYNTB00000001. Transaction ID: short.',
    );
    await runtime.messageHandler!(context);
    expect(runtime.actionDeliveries).toHaveLength(0);
    expect(runtime.ingressDeliveries).toHaveLength(0);
    expect(context.replies[0]).toContain('Tap Deposit for payment details.');
    expect(context.replies[0]).not.toMatch(/SYNTB|PLAYER-DEMO/);
  });

  it('does not leak pasted receipt details through transport-failure logs or replies', async () => {
    await loadComposition(false, true);
    runtime.actionError = true;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context = messageContext(
      '/deposit telebirr PLAYER-DEMO-42 Synthetic Receiver paid ETB 900.00. Transaction ID: SYNTB00000001.',
    );
    try {
      await runtime.messageHandler!(context);
      expect(warning).toHaveBeenCalledOnce();
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(
        /SYNTB|PLAYER-DEMO|Synthetic Receiver|900/,
      );
      expect(JSON.stringify(context.replies)).not.toMatch(
        /SYNTB|PLAYER-DEMO|Synthetic Receiver|900/,
      );
      expect(runtime.ingressDeliveries).toHaveLength(0);
    } finally {
      warning.mockRestore();
    }
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
      { text: '💰 Deposit', callbackData: 'gd1.deposit' },
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
    expect(malformed.replies[0]).toContain('Deposit status is unavailable');
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
    expect(context.replies[0]).toContain('Deposit status is unavailable');
    expect(context.replies[0]).not.toContain('private-invalid-input');
    expect(runtime.actionDeliveries).toHaveLength(0);
  });

  it('/help shows the button-first staging guidance', async () => {
    await loadComposition(false, true);
    const context = messageContext('/help');
    await runtime.messageHandler!(context);
    expect(context.replies[0]).toContain('Tap Deposit for payment details.');
    expect(context.replies[0]).toContain('send your receipt or reference');
    expect(context.replies[0]).toContain('/support');
    expect(runtime.actionDeliveries).toHaveLength(0);
    expect(runtime.ingressDeliveries).toHaveLength(0);
  });
});
