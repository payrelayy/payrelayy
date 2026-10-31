import type { FastifyInstance } from 'fastify';
import { OwnerAuthenticationRejectedError } from './owner-auth.js';
import { normalizeSupportUsername } from './owner-support-contact.js';
import {
  OwnerWithdrawalContactConflictError,
  OwnerWithdrawalContactInvalidError,
  OwnerWithdrawalContactRejectedError,
  OwnerWithdrawalContactUnavailableError,
  type PostgresOwnerWithdrawalContact,
} from './owner-withdrawal-contact.js';

export function registerWithdrawalContactRoutes(
  app: FastifyInstance,
  dependencies: {
    readonly withdrawalContact:
      Pick<PostgresOwnerWithdrawalContact, 'get' | 'set' | 'publicContact'> | undefined;
    readonly ownerSubject: (headers: readonly string[]) => Promise<string>;
    readonly mutationOrigins: ReadonlySet<string>;
  },
): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    '/v1/public/withdrawal-chat',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store, max-age=0');
      reply.header('Referrer-Policy', 'no-referrer');
      if (Object.keys(request.query).length)
        return reply.code(400).send({ error: 'invalid_request' });
      try {
        if (!dependencies.withdrawalContact) throw new OwnerWithdrawalContactUnavailableError();
        const { telegramUsername } = await dependencies.withdrawalContact.publicContact();
        if (telegramUsername === null) {
          return reply
            .code(503)
            .type('text/plain')
            .send('Manual withdrawals are unavailable right now. Please try again later.');
        }
        // Defense in depth: never turn a database or configuration fault into an open redirect.
        if (!/^[a-z0-9_]{5,32}$/u.test(telegramUsername))
          throw new OwnerWithdrawalContactUnavailableError();
        return reply.code(302).header('Location', `https://t.me/${telegramUsername}`).send();
      } catch {
        return reply
          .code(503)
          .type('text/plain')
          .send('Manual withdrawals are unavailable right now. Please try again later.');
      }
    },
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    '/v1/owner/withdrawal-contact',
    async (request, reply) => {
      try {
        const actor = await dependencies.ownerSubject(request.raw.rawHeaders);
        if (Object.keys(request.query).length)
          return reply.code(400).send({ error: 'invalid_request' });
        if (!dependencies.withdrawalContact) throw new OwnerWithdrawalContactUnavailableError();
        return reply.send({ withdrawalContact: await dependencies.withdrawalContact.get(actor) });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerWithdrawalContactRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        return reply.code(503).send({ error: 'withdrawal_contact_unavailable' });
      }
    },
  );

  app.post<{ Body: unknown; Querystring: Record<string, unknown> }>(
    '/v1/owner/withdrawal-contact',
    { bodyLimit: 512 },
    async (request, reply) => {
      try {
        const actor = await dependencies.ownerSubject(request.raw.rawHeaders);
        const origins: string[] = [];
        for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
          if (request.raw.rawHeaders[index]?.toLowerCase() === 'origin')
            origins.push(request.raw.rawHeaders[index + 1] ?? '');
        }
        if (origins.length !== 1 || !dependencies.mutationOrigins.has(origins[0]!)) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        const body = request.body;
        if (
          Object.keys(request.query).length ||
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'expectedRevision,telegramUsername'
        ) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const fields = body as Record<string, unknown>;
        const username = normalizeSupportUsername(fields.telegramUsername);
        if (
          username === undefined ||
          typeof fields.expectedRevision !== 'number' ||
          !Number.isInteger(fields.expectedRevision) ||
          fields.expectedRevision < 0 ||
          fields.expectedRevision >= 2_147_483_647
        ) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        if (!dependencies.withdrawalContact) throw new OwnerWithdrawalContactUnavailableError();
        const withdrawalContact = await dependencies.withdrawalContact.set(
          actor,
          username,
          fields.expectedRevision,
        );
        return reply.send({ withdrawalContact });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerWithdrawalContactRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (error instanceof OwnerWithdrawalContactConflictError)
          return reply.code(409).send({ error: 'withdrawal_contact_conflict' });
        if (error instanceof OwnerWithdrawalContactInvalidError)
          return reply.code(400).send({ error: 'invalid_request' });
        return reply.code(503).send({ error: 'withdrawal_contact_unavailable' });
      }
    },
  );
}
