import type { FastifyInstance } from 'fastify';
import { OwnerAuthenticationRejectedError } from './owner-auth.js';
import {
  normalizeSupportUsername,
  OwnerSupportContactConflictError,
  OwnerSupportContactInvalidError,
  OwnerSupportContactRejectedError,
  OwnerSupportContactUnavailableError,
  type PostgresOwnerSupportContact,
} from './owner-support-contact.js';

export function registerSupportContactRoutes(
  app: FastifyInstance,
  dependencies: {
    readonly supportContact:
      Pick<PostgresOwnerSupportContact, 'get' | 'set' | 'publicContact'> | undefined;
    readonly ownerSubject: (headers: readonly string[]) => Promise<string>;
    readonly mutationOrigins: ReadonlySet<string>;
    readonly now?: () => number;
  },
): void {
  type PublicContact = { readonly telegramUsername: string | null };
  let generation = 0;
  let cache: { until: number; value?: PublicContact } | undefined;
  let pending: { generation: number; value: Promise<PublicContact> } | undefined;
  const now = dependencies.now ?? Date.now;

  async function publicContact(): Promise<PublicContact> {
    if (cache && cache.until > now()) {
      if (cache.value) return cache.value;
      throw new OwnerSupportContactUnavailableError();
    }
    if (pending?.generation === generation) return pending.value;
    const requestGeneration = generation;
    const value = Promise.resolve().then(async () => {
      try {
        if (!dependencies.supportContact) throw new OwnerSupportContactUnavailableError();
        const result = await dependencies.supportContact.publicContact();
        if (requestGeneration !== generation) throw new OwnerSupportContactUnavailableError();
        cache = { until: now() + 5_000, value: result };
        return result;
      } catch {
        if (requestGeneration === generation) cache = { until: now() + 5_000 };
        throw new OwnerSupportContactUnavailableError();
      } finally {
        if (pending?.generation === requestGeneration) pending = undefined;
      }
    });
    pending = { generation: requestGeneration, value };
    return value;
  }

  app.get<{ Querystring: Record<string, unknown> }>(
    '/v1/public/support-contact',
    async (request, reply) => {
      if (Object.keys(request.query).length)
        return reply.code(400).send({ error: 'invalid_request' });
      try {
        return reply.send({ supportContact: await publicContact() });
      } catch {
        return reply.code(503).send({ error: 'support_contact_unavailable' });
      }
    },
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    '/v1/owner/support-contact',
    async (request, reply) => {
      try {
        const actor = await dependencies.ownerSubject(request.raw.rawHeaders);
        if (Object.keys(request.query).length)
          return reply.code(400).send({ error: 'invalid_request' });
        if (!dependencies.supportContact) throw new OwnerSupportContactUnavailableError();
        return reply.send({ supportContact: await dependencies.supportContact.get(actor) });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerSupportContactRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        return reply.code(503).send({ error: 'support_contact_unavailable' });
      }
    },
  );

  app.post<{ Body: unknown; Querystring: Record<string, unknown> }>(
    '/v1/owner/support-contact',
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
        if (!dependencies.supportContact) throw new OwnerSupportContactUnavailableError();
        const supportContact = await dependencies.supportContact.set(
          actor,
          username,
          fields.expectedRevision,
        );
        generation += 1;
        cache = undefined;
        pending = undefined;
        return reply.send({ supportContact });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerSupportContactRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (error instanceof OwnerSupportContactConflictError)
          return reply.code(409).send({ error: 'support_contact_conflict' });
        if (error instanceof OwnerSupportContactInvalidError)
          return reply.code(400).send({ error: 'invalid_request' });
        return reply.code(503).send({ error: 'support_contact_unavailable' });
      }
    },
  );
}
