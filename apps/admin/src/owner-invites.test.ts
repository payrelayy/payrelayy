import { createHash } from 'node:crypto';

import { telegramBetaInviteTokenDigestInput } from '@payreplayy/contracts';
import { describe, expect, it } from 'vitest';

import { PostgresOwnerInviteControl } from './owner-invites.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const inviteId = '22222222-2222-4222-8222-222222222222';
const expiresAt = new Date('2026-08-12T00:00:00.000Z');

describe('PostgreSQL Owner invite adapter', () => {
  it('stores only a domain-separated digest and returns the raw token once in the deep link', async () => {
    let observedSql = '';
    let observedValues: readonly (string | Date)[] = [];
    const adapter = new PostgresOwnerInviteControl({
      query: async (sql, values) => {
        observedSql = sql;
        observedValues = values;
        return { rows: [{ issued_invite_id: inviteId, issued_expires_at: expiresAt }] };
      },
    });
    const issued = await adapter.issue(authUserId, expiresAt, 'PayReplayyBot');
    const token = new URL(issued.inviteUrl).searchParams.get('start');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const expectedDigest = `sha256-v1:${createHash('sha256')
      .update(telegramBetaInviteTokenDigestInput(token!), 'utf8')
      .digest('hex')}`;
    expect(observedSql).toContain('app.issue_telegram_beta_invite');
    expect(observedValues).toEqual([authUserId, expectedDigest, expiresAt]);
    expect(observedSql).not.toContain(token!);
    expect(observedValues).not.toContain(token!);
    expect(issued).toMatchObject({ inviteId, expiresAt: expiresAt.toISOString() });
  });

  it('revokes by opaque invite identifier and safe reason code only', async () => {
    let observedValues: readonly (string | Date)[] = [];
    const revokedAt = new Date('2026-08-10T18:30:00.000Z');
    const adapter = new PostgresOwnerInviteControl({
      query: async (_sql, values) => {
        observedValues = values;
        return { rows: [{ revoked_invite_id: inviteId, revoked_at: revokedAt }] };
      },
    });
    await adapter.revoke(authUserId, inviteId, 'owner_cancelled');
    expect(observedValues).toEqual([authUserId, inviteId, 'owner_cancelled']);
  });

  it('maps database detail to generic typed errors', async () => {
    const adapter = new PostgresOwnerInviteControl({
      query: async () => {
        throw Object.assign(new Error('sensitive database detail'), { code: 'P0001' });
      },
    });
    await expect(adapter.issue(authUserId, expiresAt, 'PayReplayyBot')).rejects.toMatchObject({
      name: 'OwnerInviteRejectedError',
      message: 'The Owner invite operation was rejected.',
    });
  });
});
