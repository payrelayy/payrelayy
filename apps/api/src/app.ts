import { loadConfig, type AppConfig } from '@payreplayy/config';
import Fastify from 'fastify';

export function buildApp(config: AppConfig = loadConfig()) {
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

  app.get('/readyz', async () => ({
    ready: true,
    stage: 'stage-0',
    databaseConfigured: Boolean(config.supabase.url),
  }));

  return app;
}
