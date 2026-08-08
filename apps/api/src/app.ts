import { loadApiConfig, type ApiConfig } from '@payreplayy/config/api';
import {
  TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
  TELEGRAM_PRIVATE_INGRESS_MAX_BODY_BYTES,
  TELEGRAM_PRIVATE_INGRESS_PATH,
} from '@payreplayy/contracts';
import Fastify from 'fastify';

import {
  InMemoryTelegramIngressNonceStore,
  type TelegramIngressNonceStore,
  type TelegramPrivateInboundRecorder,
  verifyTelegramIngressRequest,
} from './telegram-ingress.js';

export interface ApiDependencies {
  readonly now?: () => Date;
  readonly telegramIngressNonceStore?: TelegramIngressNonceStore;
  readonly telegramPrivateInboundRecorder?: TelegramPrivateInboundRecorder;
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

  if (config.telegramIngress.enabled) {
    const telegramIngress = config.telegramIngress;
    const recorder = dependencies.telegramPrivateInboundRecorder;
    if (!recorder) {
      throw new Error(
        'INTERNAL_TELEGRAM_INGRESS_ENABLED requires a reviewed private Telegram inbox recorder.',
      );
    }

    const nonceStore =
      dependencies.telegramIngressNonceStore ?? new InMemoryTelegramIngressNonceStore();
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
        const inbound = await verifyTelegramIngressRequest(
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

        if (!inbound) {
          return reply.code(401).send({ error: 'unauthorized' });
        }

        try {
          await recorder.record(inbound);
        } catch {
          request.log.warn(
            { updateId: inbound.event.updateId },
            'Private Telegram inbound recorder is unavailable.',
          );
          return reply.code(503).send({ error: 'inbound_unavailable' });
        }

        return reply.code(204).send();
      },
    );
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
