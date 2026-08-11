import type { OwnerControlConfig } from '@payreplayy/config/owner-control';
import Fastify, { LogController } from 'fastify';

import {
  OwnerAuthenticationRejectedError,
  OwnerAuthenticationUnavailableError,
  bearerTokenFromRawHeaders,
  verifyOwnerBearerToken,
} from './owner-auth.js';
import {
  OwnerInviteRejectedError,
  OwnerInviteUnavailableError,
  type BetaInviteRevocationReason,
} from './owner-invites.js';
import type { OwnerControlPostgresRuntime } from './postgres-runtime.js';
import {
  OWNER_DASHBOARD_CONTENT_SECURITY_POLICY,
  OWNER_DASHBOARD_CSS,
  OWNER_DASHBOARD_HTML,
  OWNER_DASHBOARD_JAVASCRIPT,
  ownerDashboardPublicConfig,
} from './owner-dashboard.js';

export interface OwnerControlAppDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly runtime: OwnerControlPostgresRuntime;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
    ? object
    : undefined;
}

const REVOCATION_REASONS = new Set<BetaInviteRevocationReason>([
  'owner_cancelled',
  'security_rotation',
  'staging_reset',
]);

function statusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  return typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

export function buildOwnerControlApp(
  config: OwnerControlConfig,
  dependencies: OwnerControlAppDependencies,
) {
  if (!config.runtime.enabled) throw new Error('The Owner-control runtime is disabled.');
  const runtimeConfig = config.runtime;
  const app = Fastify({
    bodyLimit: 4 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers', 'req.body', 'res.body', '*.token', '*.inviteUrl', '*.password'],
        censor: '[REDACTED]',
      },
    },
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store, max-age=0').header('pragma', 'no-cache');
    return payload;
  });

  const browserHeaders = {
    'content-security-policy': OWNER_DASHBOARD_CONTENT_SECURITY_POLICY,
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  } as const;

  app.get('/owner', async (_request, reply) =>
    reply.headers(browserHeaders).type('text/html; charset=utf-8').send(OWNER_DASHBOARD_HTML),
  );
  app.get('/owner/app.js', async (_request, reply) =>
    reply
      .headers(browserHeaders)
      .type('text/javascript; charset=utf-8')
      .send(OWNER_DASHBOARD_JAVASCRIPT),
  );
  app.get('/owner/styles.css', async (_request, reply) =>
    reply.headers(browserHeaders).type('text/css; charset=utf-8').send(OWNER_DASHBOARD_CSS),
  );
  app.get('/owner/config.json', async (_request, reply) =>
    reply.headers(browserHeaders).send(ownerDashboardPublicConfig(runtimeConfig)),
  );
  app.setErrorHandler((error, request, reply) => {
    const code = statusCode(error);
    if (code !== undefined && code >= 400 && code < 500) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    request.log.warn('Owner control request handling is unavailable.');
    return reply.code(503).send({ error: 'owner_control_unavailable' });
  });

  async function ownerSubject(rawHeaders: readonly string[]): Promise<string> {
    const token = bearerTokenFromRawHeaders(rawHeaders);
    if (!token) throw new OwnerAuthenticationRejectedError();
    const verified = await verifyOwnerBearerToken(
      token,
      {
        publishableKey: runtimeConfig.publishableKey,
        supabaseUrl: runtimeConfig.supabaseUrl,
      },
      dependencies.fetch,
    );
    return verified.authUserId;
  }

  app.post('/v1/owner/telegram-beta-invites', async (request, reply) => {
    try {
      const body = exactObject(request.body, ['expiresInSeconds']);
      const expiresInSeconds = body?.expiresInSeconds;
      if (
        !Number.isSafeInteger(expiresInSeconds) ||
        // Keep a one-minute transport margin above the database's five-minute minimum.
        (expiresInSeconds as number) < 360 ||
        (expiresInSeconds as number) > 604_800
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authUserId = await ownerSubject(request.raw.rawHeaders);
      const now = dependencies.now?.() ?? new Date();
      const invite = await dependencies.runtime.invites.issue(
        authUserId,
        new Date(now.getTime() + (expiresInSeconds as number) * 1_000),
        config.botUsername,
      );
      return reply.code(201).send(invite);
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerInviteRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (
        error instanceof OwnerAuthenticationUnavailableError ||
        error instanceof OwnerInviteUnavailableError
      ) {
        request.log.warn('Owner beta-invite issuance is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
      request.log.warn('Owner beta-invite issuance is unavailable.');
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.post<{ Params: { inviteId: string } }>(
    '/v1/owner/telegram-beta-invites/:inviteId/revoke',
    async (request, reply) => {
      try {
        const body = exactObject(request.body, ['reasonCode']);
        const reasonCode = body?.reasonCode;
        if (
          typeof reasonCode !== 'string' ||
          !REVOCATION_REASONS.has(reasonCode as BetaInviteRevocationReason)
        ) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        await dependencies.runtime.invites.revoke(
          authUserId,
          request.params.inviteId,
          reasonCode as BetaInviteRevocationReason,
        );
        return reply.code(204).send();
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerInviteRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        request.log.warn('Owner beta-invite revocation is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.get('/healthz', async () => ({ status: 'ok', service: 'payreplayy-owner-control' }));
  app.get('/readyz', async (_request, reply) => {
    const ready = await dependencies.runtime.ready();
    return ready ? reply.code(200).send({ ready: true }) : reply.code(503).send({ ready: false });
  });
  app.addHook('onClose', async () => dependencies.runtime.close());
  return app;
}
