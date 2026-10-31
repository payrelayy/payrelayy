import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnerAuthenticationRejectedError } from './owner-auth.js';
import { OwnerWithdrawalContactConflictError } from './owner-withdrawal-contact.js';
import { registerWithdrawalContactRoutes } from './withdrawal-contact-routes.js';

const actor = '11111111-1111-4111-8111-111111111111';
const launch = { telegramUsername: 'balem18', revision: 0, updatedAt: null };
const auth = { authorization: 'Bearer test', origin: 'https://owner.fetanagent.com' };
const apps: ReturnType<typeof Fastify>[] = [];

function fixture() {
  const app = Fastify();
  apps.push(app);
  const withdrawalContact = {
    get: vi.fn().mockResolvedValue(launch),
    set: vi.fn().mockResolvedValue(launch),
    publicContact: vi.fn().mockResolvedValue({ telegramUsername: 'balem18' }),
  };
  const ownerSubject = vi.fn(async (headers: readonly string[]) => {
    if (!headers.includes('Bearer test')) throw new OwnerAuthenticationRejectedError();
    return actor;
  });
  registerWithdrawalContactRoutes(app, {
    withdrawalContact,
    ownerSubject,
    mutationOrigins: new Set([auth.origin]),
  });
  return { app, withdrawalContact, ownerSubject };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Manual withdrawal contact HTTP boundary', () => {
  it('resolves the current Owner contact on each click, including links in older bot messages', async () => {
    const { app, withdrawalContact, ownerSubject } = fixture();
    const first = await app.inject('/v1/public/withdrawal-chat');
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe('https://t.me/balem18');
    expect(first.headers['cache-control']).toBe('no-store, max-age=0');
    expect(first.headers['referrer-policy']).toBe('no-referrer');
    withdrawalContact.publicContact.mockResolvedValue({ telegramUsername: 'new_handler' });
    const second = await app.inject('/v1/public/withdrawal-chat');
    expect(second.headers.location).toBe('https://t.me/new_handler');
    expect(ownerSubject).not.toHaveBeenCalled();
  });

  it('fails closed when disabled, unavailable, malformed, or given a query string', async () => {
    const { app, withdrawalContact } = fixture();
    withdrawalContact.publicContact.mockResolvedValue({ telegramUsername: null });
    const disabled = await app.inject('/v1/public/withdrawal-chat');
    expect(disabled.statusCode).toBe(503);
    expect(disabled.body).toContain('Manual withdrawals are unavailable');
    expect(disabled.headers.location).toBeUndefined();
    withdrawalContact.publicContact.mockResolvedValue({ telegramUsername: 'evil.example/path' });
    expect((await app.inject('/v1/public/withdrawal-chat')).statusCode).toBe(503);
    withdrawalContact.publicContact.mockRejectedValue(new Error('private detail'));
    const failed = await app.inject('/v1/public/withdrawal-chat');
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('private detail');
    expect((await app.inject('/v1/public/withdrawal-chat?next=evil')).statusCode).toBe(400);
  });

  it('requires the active Owner and trusted origin for edits, with revision checking', async () => {
    const { app, withdrawalContact } = fixture();
    expect((await app.inject('/v1/owner/withdrawal-contact')).statusCode).toBe(403);
    expect(
      (await app.inject({ url: '/v1/owner/withdrawal-contact', headers: auth })).json(),
    ).toEqual({
      withdrawalContact: launch,
    });
    const payload = { telegramUsername: '@New_Handler', expectedRevision: 0 };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/owner/withdrawal-contact',
          headers: {
            authorization: auth.authorization,
          },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/owner/withdrawal-contact',
          headers: auth,
          payload: { ...payload, next: 'https://evil.example' },
        })
      ).statusCode,
    ).toBe(400);
    expect(withdrawalContact.set).not.toHaveBeenCalled();
    const saved = await app.inject({
      method: 'POST',
      url: '/v1/owner/withdrawal-contact',
      headers: auth,
      payload,
    });
    expect(saved.statusCode).toBe(200);
    expect(withdrawalContact.set).toHaveBeenCalledWith(actor, 'new_handler', 0);
    withdrawalContact.set.mockRejectedValue(new OwnerWithdrawalContactConflictError());
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/owner/withdrawal-contact',
          headers: auth,
          payload,
        })
      ).statusCode,
    ).toBe(409);
  });
});
