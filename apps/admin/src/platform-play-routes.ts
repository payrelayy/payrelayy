import type { FastifyInstance } from 'fastify';
import { OwnerAuthenticationRejectedError } from './owner-auth.js';
import {
  normalizePlatformPlayUrl,
  OwnerPlatformPlayConflictError,
  OwnerPlatformPlayInvalidError,
  OwnerPlatformPlayRejectedError,
  OwnerPlatformPlayUnavailableError,
  type PostgresOwnerPlatformPlayDestinations,
} from './owner-platform-play-destinations.js';

const PLATFORM_CODE = /^[a-z0-9_]{1,64}$/u;

export function registerPlatformPlayRoutes(
  app: FastifyInstance,
  dependencies: {
    readonly destinations:
      Pick<PostgresOwnerPlatformPlayDestinations, 'get' | 'set' | 'publicDestination'> | undefined;
    readonly ownerSubject: (headers: readonly string[]) => Promise<string>;
    readonly mutationOrigins: ReadonlySet<string>;
  },
): void {
  app.get<{ Params: { platformCode: string }; Querystring: Record<string, unknown> }>(
    '/v1/public/play/:platformCode',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store, max-age=0');
      reply.header('Referrer-Policy', 'no-referrer');
      if (Object.keys(request.query).length || !PLATFORM_CODE.test(request.params.platformCode))
        return reply.code(400).send({ error: 'invalid_request' });
      try {
        if (!dependencies.destinations) throw new OwnerPlatformPlayUnavailableError();
        const destination = await dependencies.destinations.publicDestination(
          request.params.platformCode,
        );
        // Never turn a corrupt database value into an open redirect.
        if (destination === null || normalizePlatformPlayUrl(destination) !== destination)
          throw new OwnerPlatformPlayUnavailableError();
        return reply.code(302).header('Location', destination).send();
      } catch {
        return reply
          .code(503)
          .type('text/plain')
          .send('Play is unavailable right now. Please try again later.');
      }
    },
  );

  app.get<{ Params: { platformCode: string }; Querystring: Record<string, unknown> }>(
    '/v1/owner/platforms/:platformCode/play',
    async (request, reply) => {
      try {
        const actor = await dependencies.ownerSubject(request.raw.rawHeaders);
        if (Object.keys(request.query).length || !PLATFORM_CODE.test(request.params.platformCode))
          return reply.code(400).send({ error: 'invalid_request' });
        if (!dependencies.destinations) throw new OwnerPlatformPlayUnavailableError();
        return reply.send({
          playDestination: await dependencies.destinations.get(actor, request.params.platformCode),
        });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerPlatformPlayRejectedError
        )
          return reply.code(403).send({ error: 'forbidden' });
        if (error instanceof OwnerPlatformPlayInvalidError)
          return reply.code(400).send({ error: 'invalid_request' });
        return reply.code(503).send({ error: 'play_destination_unavailable' });
      }
    },
  );

  app.post<{
    Params: { platformCode: string };
    Body: unknown;
    Querystring: Record<string, unknown>;
  }>('/v1/owner/platforms/:platformCode/play', { bodyLimit: 4096 }, async (request, reply) => {
    try {
      const actor = await dependencies.ownerSubject(request.raw.rawHeaders);
      const origins: string[] = [];
      for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
        if (request.raw.rawHeaders[index]?.toLowerCase() === 'origin')
          origins.push(request.raw.rawHeaders[index + 1] ?? '');
      }
      if (origins.length !== 1 || !dependencies.mutationOrigins.has(origins[0]!))
        return reply.code(403).send({ error: 'forbidden' });
      const body = request.body;
      if (
        Object.keys(request.query).length ||
        !PLATFORM_CODE.test(request.params.platformCode) ||
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).sort().join(',') !== 'destinationUrl,expectedRevision'
      )
        return reply.code(400).send({ error: 'invalid_request' });
      const fields = body as Record<string, unknown>;
      const destination = normalizePlatformPlayUrl(fields.destinationUrl);
      if (
        destination === undefined ||
        !Number.isInteger(fields.expectedRevision) ||
        (fields.expectedRevision as number) < 0 ||
        (fields.expectedRevision as number) >= 2_147_483_647
      )
        return reply.code(400).send({ error: 'invalid_request' });
      if (!dependencies.destinations) throw new OwnerPlatformPlayUnavailableError();
      return reply.send({
        playDestination: await dependencies.destinations.set(
          actor,
          request.params.platformCode,
          destination,
          fields.expectedRevision as number,
        ),
      });
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerPlatformPlayRejectedError
      )
        return reply.code(403).send({ error: 'forbidden' });
      if (error instanceof OwnerPlatformPlayInvalidError)
        return reply.code(400).send({ error: 'invalid_request' });
      if (error instanceof OwnerPlatformPlayConflictError)
        return reply.code(409).send({ error: 'play_destination_conflict' });
      return reply.code(503).send({ error: 'play_destination_unavailable' });
    }
  });
}
