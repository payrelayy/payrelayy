import type { BetaAdmissionConfig } from '@fetanagent/config/beta-admission';
import {
  TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
  TELEGRAM_BETA_INVITE_REDEMPTION_MAX_BODY_BYTES,
  TELEGRAM_BETA_INVITE_REDEMPTION_PATH,
} from '@fetanagent/contracts';
import Fastify, { LogController } from 'fastify';

import { TelegramBetaInviteAdmissionNonceStoreUnavailableError } from './postgres-telegram-beta-invite-admission-nonce-store.js';
import type { BetaAdmissionPostgresRuntime } from './postgres-runtime.js';
import {
  TelegramBetaInviteAdmissionRejectedError,
  TelegramBetaInviteAdmissionUnavailableError,
  toTelegramBetaInviteRedemptionDatabaseInput,
  verifyTelegramBetaInviteAdmissionRequest,
} from './telegram-beta-invite-admission.js';

export interface BetaAdmissionAppDependencies {
  readonly runtime: BetaAdmissionPostgresRuntime;
  readonly now?: () => Date;
}

function errorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  return typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

/** The dedicated service exposes only liveness, readiness, and invite redemption. */
export function buildBetaAdmissionApp(
  config: BetaAdmissionConfig,
  dependencies: BetaAdmissionAppDependencies,
) {
  if (!config.runtime.enabled) {
    throw new Error('The beta-admission runtime must be enabled before building the service.');
  }
  const runtimeConfig = config.runtime;
  const app = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.body',
          'req.headers',
          '*.inviteToken',
          '*.databaseUrl',
          '*.password',
          '*.secret',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = errorStatusCode(error);
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    request.log.warn('Beta-admission request handling is unavailable.');
    return reply.code(503).send({ error: 'admission_unavailable' });
  });

  app.addContentTypeParser(
    TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
    { parseAs: 'buffer', bodyLimit: TELEGRAM_BETA_INVITE_REDEMPTION_MAX_BODY_BYTES },
    (_request, rawBody, done) => done(null, rawBody),
  );

  app.post<{ Body: Buffer }>(
    TELEGRAM_BETA_INVITE_REDEMPTION_PATH,
    { bodyLimit: TELEGRAM_BETA_INVITE_REDEMPTION_MAX_BODY_BYTES },
    async (request, reply) => {
      let redemption;
      try {
        redemption = await verifyTelegramBetaInviteAdmissionRequest(
          {
            headers: request.headers,
            rawHeaders: request.raw.rawHeaders,
            method: request.method,
            url: request.raw.url,
          },
          request.body,
          {
            transportHmacSecret: runtimeConfig.transportHmacSecret,
            now: dependencies.now?.() ?? new Date(),
            nonceStore: dependencies.runtime.nonceStore,
          },
        );
      } catch (error) {
        if (error instanceof TelegramBetaInviteAdmissionNonceStoreUnavailableError) {
          request.log.warn('Beta-admission nonce storage is unavailable.');
          return reply.code(503).send({ error: 'admission_unavailable' });
        }
        request.log.warn('Beta-admission verification is unavailable.');
        return reply.code(503).send({ error: 'admission_unavailable' });
      }

      if (!redemption) return reply.code(401).send({ error: 'unauthorized' });

      try {
        const databaseInput = toTelegramBetaInviteRedemptionDatabaseInput(redemption, {
          payloadHmacSecret: runtimeConfig.payloadHmacSecret,
        });
        await dependencies.runtime.admission.redeem(databaseInput);
      } catch (error) {
        if (error instanceof TelegramBetaInviteAdmissionRejectedError) {
          return reply.code(401).send({ error: 'unauthorized' });
        }
        if (error instanceof TelegramBetaInviteAdmissionUnavailableError) {
          request.log.warn('Beta invite redemption is unavailable.');
          return reply.code(503).send({ error: 'admission_unavailable' });
        }
        request.log.warn('Beta invite redemption is unavailable.');
        return reply.code(503).send({ error: 'admission_unavailable' });
      }

      return reply.code(204).send();
    },
  );

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'fetanagent-beta-admission',
    runtimeEnabled: true,
    stage: 'staging',
  }));

  app.get('/readyz', async (_request, reply) => {
    const ready = await dependencies.runtime.ready();
    if (!ready) return reply.code(503).send({ ready: false });
    return reply.code(200).send({ ready: true });
  });

  app.addHook('onClose', async () => {
    await dependencies.runtime.close();
  });

  return app;
}
