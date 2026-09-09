import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnerAuthenticationRejectedError } from './owner-auth.js';
import {
  OwnerSupportContactConflictError,
  OwnerSupportContactRejectedError,
} from './owner-support-contact.js';
import { registerSupportContactRoutes } from './support-contact-routes.js';

const actor = '11111111-1111-4111-8111-111111111111';
const contact = { telegramUsername: null, revision: 0, updatedAt: null };
const auth = { authorization: 'Bearer test', origin: 'https://owner.fetanagent.com' };
const apps: ReturnType<typeof Fastify>[] = [];
function fixture() {
  const app = Fastify();
  apps.push(app);
  const supportContact = {
    get: vi.fn().mockResolvedValue(contact),
    set: vi.fn().mockResolvedValue(contact),
    publicContact: vi.fn().mockResolvedValue({ telegramUsername: null }),
  };
  const ownerSubject = vi.fn(async (headers: readonly string[]) => {
    if (!headers.includes('Bearer test')) throw new OwnerAuthenticationRejectedError();
    return actor;
  });
  registerSupportContactRoutes(app, {
    supportContact,
    ownerSubject,
    mutationOrigins: new Set([auth.origin]),
  });
  return { app, supportContact, ownerSubject };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe('Support contact HTTP boundary', () => {
  it('allows only the deliberately public contact projection without authentication', async () => {
    const { app, ownerSubject } = fixture();
    const response = await app.inject('/v1/public/support-contact');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ supportContact: { telegramUsername: null } });
    expect(ownerSubject).not.toHaveBeenCalled();
    expect((await app.inject('/v1/public/support-contact?actor=evil')).statusCode).toBe(400);
  });
  it('requires verified authentication and the database active-Owner check for private reads', async () => {
    const { app, supportContact } = fixture();
    expect((await app.inject('/v1/owner/support-contact')).statusCode).toBe(403);
    expect(supportContact.get).not.toHaveBeenCalled();
    expect((await app.inject({ url: '/v1/owner/support-contact', headers: auth })).json()).toEqual({
      supportContact: contact,
    });
    expect(supportContact.get).toHaveBeenCalledWith(actor);
    supportContact.get.mockRejectedValue(new OwnerSupportContactRejectedError());
    expect((await app.inject({ url: '/v1/owner/support-contact', headers: auth })).statusCode).toBe(
      403,
    );
  });
  it('normalizes and saves with the server-derived actor and expected revision', async () => {
    const { app, supportContact } = fixture();
    const saved = {
      telegramUsername: 'support_name',
      revision: 1,
      updatedAt: '2026-09-09T12:00:00.000Z',
    };
    supportContact.set.mockResolvedValue(saved);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/support-contact',
      headers: auth,
      payload: { telegramUsername: '@Support_Name', expectedRevision: 0 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ supportContact: saved });
    expect(supportContact.set).toHaveBeenCalledWith(actor, 'support_name', 0);
  });
  it('rejects missing/foreign origins and invalid payloads without mutation', async () => {
    const { app, supportContact } = fixture();
    for (const headers of [
      { authorization: auth.authorization },
      { ...auth, origin: 'https://evil.example' },
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/owner/support-contact',
            headers,
            payload: { telegramUsername: 'support', expectedRevision: 0 },
          })
        ).statusCode,
      ).toBe(403);
    }
    for (const payload of [
      { telegramUsername: '@', expectedRevision: 0 },
      { telegramUsername: 'support', expectedRevision: -1 },
      { telegramUsername: 'support', expectedRevision: 0, actor },
      { telegramUsername: 'support' },
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/owner/support-contact',
            headers: auth,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(supportContact.set).not.toHaveBeenCalled();
  });
  it('reports a stale edit as conflict and a failed operation as unavailable', async () => {
    const { app, supportContact } = fixture();
    const request = {
      method: 'POST' as const,
      url: '/v1/owner/support-contact',
      headers: auth,
      payload: { telegramUsername: null, expectedRevision: 1 },
    };
    supportContact.set.mockRejectedValue(new OwnerSupportContactConflictError());
    expect((await app.inject(request)).statusCode).toBe(409);
    supportContact.set.mockRejectedValue(new Error('private detail'));
    const response = await app.inject(request);
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private detail');
  });
  it('coalesces public reads and invalidates the short cache after an Owner save', async () => {
    const { app, supportContact } = fixture();
    await Promise.all([
      app.inject('/v1/public/support-contact'),
      app.inject('/v1/public/support-contact'),
    ]);
    expect(supportContact.publicContact).toHaveBeenCalledTimes(1);
    await app.inject({
      method: 'POST',
      url: '/v1/owner/support-contact',
      headers: auth,
      payload: { telegramUsername: 'support', expectedRevision: 0 },
    });
    supportContact.publicContact.mockResolvedValue({ telegramUsername: 'support' });
    expect((await app.inject('/v1/public/support-contact')).json()).toEqual({
      supportContact: { telegramUsername: 'support' },
    });
    expect(supportContact.publicContact).toHaveBeenCalledTimes(2);
  });
});
