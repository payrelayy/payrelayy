import { loadApiConfig, type ApiConfig } from '@payreplayy/config/api';
import Fastify from 'fastify';

export function buildApp(config: ApiConfig = loadApiConfig()) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.x-telegram-bot-api-secret-token',
          '*.token',
          '*.password',
        ],
        censor: '[REDACTED]',
      },
    },
  });

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
