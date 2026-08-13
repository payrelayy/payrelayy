import { loadApiConfig, type ApiConfig } from '@fetanagent/config/api';
import {
  TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
  TELEGRAM_PRIVATE_INGRESS_MAX_BODY_BYTES,
  TELEGRAM_PRIVATE_INGRESS_PATH,
  TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE,
  TELEGRAM_PRIVATE_ACTION_MAX_BODY_BYTES,
  TELEGRAM_PRIVATE_ACTION_PATH,
  type TelegramPrivateActionEnvelope,
} from '@fetanagent/contracts';
import Fastify from 'fastify';

import {
  type TelegramIngressNonceStore,
  type TelegramPrivateInboundRecord,
  type TelegramPrivateInboundRecorder,
  verifyTelegramIngressRequest,
} from './telegram-ingress.js';
import { TelegramIngressNonceStoreUnavailableError } from './postgres-telegram-ingress-nonce-store.js';
import {
  createPostgresTelegramIngressRuntime,
  isPostgresTelegramIngressRuntimeEnabled,
  type PostgresTelegramIngressRuntime,
  type PostgresTelegramIngressRuntimeFactory,
} from './postgres-telegram-ingress-runtime.js';
import {
  createPostgresTelegramPlayerActionRuntime,
  isTelegramPlayerActionRuntimeEnabled,
  TelegramPlayerActionRuntimeUnavailableError,
  type PostgresTelegramPlayerActionRuntime,
} from './postgres-telegram-player-action-runtime.js';
import { TelegramPrivateActionNonceStoreUnavailableError } from './postgres-telegram-private-action-nonce-store.js';
import { verifyTelegramPrivateActionRequest } from './telegram-private-action.js';

export interface ApiDependencies {
  readonly now?: () => Date;
  readonly telegramIngressNonceStore?: TelegramIngressNonceStore;
  readonly telegramPrivateInboundRecorder?: TelegramPrivateInboundRecorder;
  /** Test seam for the dual-gated database runtime; production startup uses the default factory. */
  readonly createPostgresTelegramIngressRuntime?: PostgresTelegramIngressRuntimeFactory;
  /** Test seam for a complete dual-gated database runtime; Fastify owns its shutdown lifecycle. */
  readonly postgresTelegramIngressRuntime?: PostgresTelegramIngressRuntime;
  readonly postgresTelegramPlayerActionRuntime?: PostgresTelegramPlayerActionRuntime;
}

export function buildApp(config: ApiConfig = loadApiConfig(), dependencies: ApiDependencies = {}) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.x-telegram-bot-api-secret-token',
          'req.headers.x-fetanagent-key-id',
          'req.headers.x-fetanagent-nonce',
          'req.headers.x-fetanagent-signature',
          'req.headers.x-fetanagent-timestamp',
          'req.headers.x-fetanagent-action-key-id',
          'req.headers.x-fetanagent-action-nonce',
          'req.headers.x-fetanagent-action-signature',
          'req.headers.x-fetanagent-action-timestamp',
          '*.token',
          '*.password',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  const playerActionEnabled = isTelegramPlayerActionRuntimeEnabled(config);
  if (playerActionEnabled && isPostgresTelegramIngressRuntimeEnabled(config)) {
    throw new Error('The isolated Player-ID action runtime cannot share the generic ingress mode.');
  }
  const playerActionRuntime = playerActionEnabled
    ? (dependencies.postgresTelegramPlayerActionRuntime ??
      createPostgresTelegramPlayerActionRuntime(config))
    : undefined;

  if (playerActionRuntime) {
    if (!config.telegramActionChannel.enabled) {
      throw new Error('The Player-ID action runtime requires its isolated action channel.');
    }
    const telegramActionChannel = config.telegramActionChannel;
    app.addContentTypeParser(
      TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE,
      { parseAs: 'buffer', bodyLimit: TELEGRAM_PRIVATE_ACTION_MAX_BODY_BYTES },
      (_request, rawBody, done) => done(null, rawBody),
    );
    app.post<{ Body: Buffer }>(
      TELEGRAM_PRIVATE_ACTION_PATH,
      { bodyLimit: TELEGRAM_PRIVATE_ACTION_MAX_BODY_BYTES },
      async (request, reply) => {
        let action: TelegramPrivateActionEnvelope | undefined;
        try {
          action = await verifyTelegramPrivateActionRequest(
            {
              headers: request.headers,
              rawHeaders: request.raw.rawHeaders,
              method: request.method,
              url: request.raw.url,
            },
            request.body,
            {
              transportHmacSecret: telegramActionChannel.transportHmacSecret,
              now: dependencies.now?.() ?? new Date(),
              nonceStore: playerActionRuntime.nonceStore,
            },
          );
        } catch (error) {
          if (error instanceof TelegramPrivateActionNonceStoreUnavailableError) {
            request.log.warn('Telegram Player-ID action nonce storage is unavailable.');
            return reply.code(503).send({ error: 'action_unavailable' });
          }
          throw error;
        }
        if (!action) return reply.code(401).send({ error: 'unauthorized' });

        try {
          return reply.code(200).send(await playerActionRuntime.handle(action, request.body));
        } catch (error) {
          if (error instanceof TelegramPlayerActionRuntimeUnavailableError) {
            request.log.warn('Telegram Player-ID action processing is unavailable.');
            return reply.code(503).send({ error: 'action_unavailable' });
          }
          throw error;
        }
      },
    );
    app.addHook('onClose', async () => playerActionRuntime.close());
  }

  if (isPostgresTelegramIngressRuntimeEnabled(config)) {
    const telegramIngress = config.telegramIngress;
    const hasNonceStore = dependencies.telegramIngressNonceStore !== undefined;
    const hasRecorder = dependencies.telegramPrivateInboundRecorder !== undefined;
    if (hasNonceStore !== hasRecorder) {
      throw new Error(
        'Dual-gated Telegram ingress test dependencies must provide both nonce storage and an inbox recorder.',
      );
    }

    const postgresRuntime = !hasNonceStore
      ? (dependencies.postgresTelegramIngressRuntime ??
        (dependencies.createPostgresTelegramIngressRuntime ?? createPostgresTelegramIngressRuntime)(
          config,
        ))
      : undefined;
    const recorder = dependencies.telegramPrivateInboundRecorder ?? postgresRuntime?.recorder;
    const nonceStore = dependencies.telegramIngressNonceStore ?? postgresRuntime?.nonceStore;
    if (!recorder || !nonceStore) {
      throw new Error(
        'Dual-gated Telegram ingress requires a reviewed private Telegram inbox recorder.',
      );
    }
    if (config.nodeEnv === 'production' && !nonceStore.durable) {
      throw new Error('Production Telegram ingress requires a durable, cross-replica nonce store.');
    }

    app.addContentTypeParser(
      TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
      { parseAs: 'buffer', bodyLimit: TELEGRAM_PRIVATE_INGRESS_MAX_BODY_BYTES },
      (_request, rawBody, done) => done(null, rawBody),
    );

    app.post<{ Body: Buffer }>(
      TELEGRAM_PRIVATE_INGRESS_PATH,
      { bodyLimit: TELEGRAM_PRIVATE_INGRESS_MAX_BODY_BYTES },
      async (request, reply) => {
        let inbound: TelegramPrivateInboundRecord | undefined;
        try {
          inbound = await verifyTelegramIngressRequest(
            {
              headers: request.headers,
              rawHeaders: request.raw.rawHeaders,
              method: request.method,
              url: request.raw.url,
            },
            request.body,
            {
              transportHmacSecret: telegramIngress.transportHmacSecret,
              payloadHmacSecret: telegramIngress.payloadHmacSecret,
              now: dependencies.now?.() ?? new Date(),
              nonceStore,
            },
          );
        } catch (error) {
          if (error instanceof TelegramIngressNonceStoreUnavailableError) {
            request.log.warn('Private Telegram ingress nonce store is unavailable.');
            return reply.code(503).send({ error: 'inbound_unavailable' });
          }
          throw error;
        }

        if (!inbound) {
          return reply.code(401).send({ error: 'unauthorized' });
        }

        try {
          await recorder.record(inbound);
        } catch {
          request.log.warn('Private Telegram inbound recorder is unavailable.');
          return reply.code(503).send({ error: 'inbound_unavailable' });
        }

        return reply.code(204).send();
      },
    );

    if (postgresRuntime) {
      app.addHook('onClose', async () => {
        await postgresRuntime.close();
      });
    }
  }

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'fetanagent-api',
    financialActionsMode: config.financialActionsMode,
  }));

  app.get('/readyz', async (_request, reply) => {
    if (playerActionRuntime && (await playerActionRuntime.ready())) {
      return reply.code(200).send({ ready: true, service: 'fetanagent-player-actions' });
    }
    return reply.code(503).send({
      ready: false,
      stage: 'stage-0',
      reason: 'database_not_initialized',
    });
  });

  return app;
}
