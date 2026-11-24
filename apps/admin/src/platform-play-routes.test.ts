import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OwnerAuthenticationRejectedError } from './owner-auth.js';
import { OwnerPlatformPlayConflictError } from './owner-platform-play-destinations.js';
import { registerPlatformPlayRoutes } from './platform-play-routes.js';

const actor = '11111111-1111-4111-8111-111111111111';
const launch = {
  platformCode: 'kemerbet',
  destinationUrl: 'https://kemer.co/',
  revision: 0,
  updatedAt: null,
};
const auth = { authorization: 'Bearer test', origin: 'https://owner.fetanagent.com' };
const apps: ReturnType<typeof Fastify>[] = [];

function fixture() {
  const app = Fastify();
  apps.push(app);
  const destinations = {
    get: vi.fn().mockResolvedValue(launch),
    set: vi.fn().mockResolvedValue(launch),
    publicDestination: vi.fn().mockResolvedValue('https://kemer.co/'),
  };
  const ownerSubject = vi.fn(async (headers: readonly string[]) => {
    if (!headers.includes('Bearer test')) throw new OwnerAuthenticationRejectedError();
    return actor;
  });
  registerPlatformPlayRoutes(app, {
    destinations,
    ownerSubject,
    mutationOrigins: new Set([auth.origin]),
  });
  return { app, destinations, ownerSubject };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('platform Play HTTP boundary', () => {
  it('redirects through the current saved URL, so old buttons follow Owner edits', async () => {
    const { app, destinations, ownerSubject } = fixture();
    const first = await app.inject('/v1/public/play/kemerbet');
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe('https://kemer.co/');
    expect(first.headers['cache-control']).toBe('no-store, max-age=0');
    expect(first.headers['referrer-policy']).toBe('no-referrer');
    destinations.publicDestination.mockResolvedValue('https://new.example/play');
    expect((await app.inject('/v1/public/play/kemerbet')).headers.location).toBe(
      'https://new.example/play',
    );
    expect(ownerSubject).not.toHaveBeenCalled();
  });

  it('fails closed for disabled, invalid, unavailable, and query-bearing links', async () => {
    const { app, destinations } = fixture();
    destinations.publicDestination.mockResolvedValue(null);
    expect((await app.inject('/v1/public/play/kemerbet')).statusCode).toBe(503);
    destinations.publicDestination.mockResolvedValue('https://evil.example\\@kemer.co/');
    expect((await app.inject('/v1/public/play/kemerbet')).statusCode).toBe(503);
    destinations.publicDestination.mockRejectedValue(new Error('private detail'));
    const failed = await app.inject('/v1/public/play/kemerbet');
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('private detail');
    expect(failed.headers.location).toBeUndefined();
    expect((await app.inject('/v1/public/play/kemerbet?next=evil')).statusCode).toBe(400);
    expect((await app.inject('/v1/public/play/Bad')).statusCode).toBe(400);
  });

  it('requires Owner authentication, trusted origin, exact body, and a fresh revision', async () => {
    const { app, destinations } = fixture();
    expect((await app.inject('/v1/owner/platforms/kemerbet/play')).statusCode).toBe(403);
    expect(
      (await app.inject({ url: '/v1/owner/platforms/kemerbet/play', headers: auth })).json(),
    ).toEqual({ playDestination: launch });
    const payload = { destinationUrl: 'https://new.example/play', expectedRevision: 0 };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/owner/platforms/kemerbet/play',
          headers: { authorization: auth.authorization },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/owner/platforms/kemerbet/play',
          headers: auth,
          payload: { ...payload, next: 'https://evil.example/' },
        })
      ).statusCode,
    ).toBe(400);
    expect(destinations.set).not.toHaveBeenCalled();
    const saved = await app.inject({
      method: 'POST',
      url: '/v1/owner/platforms/kemerbet/play',
      headers: auth,
      payload,
    });
    expect(saved.statusCode).toBe(200);
    expect(destinations.set).toHaveBeenCalledWith(actor, 'kemerbet', payload.destinationUrl, 0);
    destinations.set.mockRejectedValue(new OwnerPlatformPlayConflictError());
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/owner/platforms/kemerbet/play',
          headers: auth,
          payload,
        })
      ).statusCode,
    ).toBe(409);
  });
});
