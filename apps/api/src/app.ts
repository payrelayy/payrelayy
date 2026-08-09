import { loadApiConfig, type ApiConfig } from '@payreplayy/config/api';
import {
  TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
  TELEGRAM_PRIVATE_INGRESS_MAX_BODY_BYTES,
  TELEGRAM_PRIVATE_INGRESS_PATH,
} from '@payreplayy/contracts';
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

export interface ApiDependencies {
  readonly now?: () => Date;
  readonly telegramIngressNonceStore?: TelegramIngressNonceStore;
  readonly telegramPrivateInboundRecorder?: TelegramPrivateInboundRecorder;
  /** Test seam for the dual-gated database runtime; production startup uses the default factory. */
  readonly createPostgresTelegramIngressRuntime?: PostgresTelegramIngressRuntimeFactory;
  /** Test seam for a complete dual-gated database runtime; Fastify owns its shutdown lifecycle. */
  readonly postgresTelegramIngressRuntime?: PostgresTelegramIngressRuntime;
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
          'req.headers.x-payreplayy-key-id',
          'req.headers.x-payreplayy-nonce',
          'req.headers.x-payreplayy-signature',
          'req.headers.x-payreplayy-timestamp',
          '*.token',
          '*.password',
        ],
        censor: '[REDACTED]',
      },
    },
  });

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
    service: 'payreplayy-api',
    financialActionsMode: config.financialActionsMode,
  }));

  app.get('/readyz', async (_request, reply) =>
    reply.code(503).send({
      ready: false,
      stage: 'stage-0',
      reason: 'database_not_initialized',
    }),
  );

  return app;
}
