import { describe, expect, it, vi } from 'vitest';
import {
  normalizeSupportUsername,
  OWNER_SUPPORT_CONTACT_SQL,
  PostgresOwnerSupportContact,
  OwnerSupportContactRejectedError,
  OwnerSupportContactInvalidError,
  OwnerSupportContactConflictError,
  OwnerSupportContactUnavailableError,
} from './owner-support-contact.js';

const actor = '11111111-1111-4111-8111-111111111111';
const initial = { telegram_username: null, revision: 0, updated_at: null };
describe('Owner-editable support contact adapter', () => {
  it('normalizes a basic username or explicit blank without accepting links or markup', () => {
    expect(normalizeSupportUsername(' @Support_Name ')).toBe('support_name');
    expect(normalizeSupportUsername('12345')).toBe('12345');
    expect(normalizeSupportUsername(null)).toBeNull();
    expect(normalizeSupportUsername('  ')).toBeNull();
    for (const invalid of [
      '@',
      '@@support',
      'https://t.me/name',
      '<name>',
      'a bcd',
      'x'.repeat(33),
      'Kname',
      42,
      {},
      undefined,
    ]) {
      expect(normalizeSupportUsername(invalid)).toBeUndefined();
    }
  });
  it('reads only the exact private projection', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [initial] });
    expect(await new PostgresOwnerSupportContact({ query }).get(actor)).toEqual({
      telegramUsername: null,
      revision: 0,
      updatedAt: null,
    });
    expect(query).toHaveBeenCalledWith(OWNER_SUPPORT_CONTACT_SQL.get, [actor]);
  });
  it('writes canonical username with expected revision and only reports the committed result', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          telegram_username: 'support_name',
          revision: 1,
          updated_at: new Date('2026-09-09T12:00:00Z'),
        },
      ],
    });
    const contact = await new PostgresOwnerSupportContact({ query }).set(actor, '@Support_Name', 0);
    expect(query).toHaveBeenCalledWith(OWNER_SUPPORT_CONTACT_SQL.set, [actor, 'support_name', 0]);
    expect(contact).toEqual({
      telegramUsername: 'support_name',
      revision: 1,
      updatedAt: '2026-09-09T12:00:00.000Z',
    });
  });
  it('rejects invalid actor/input/version before opening a database operation', async () => {
    const query = vi.fn();
    const adapter = new PostgresOwnerSupportContact({ query });
    await expect(adapter.get('bad')).rejects.toBeInstanceOf(OwnerSupportContactRejectedError);
    await expect(adapter.set(actor, 'https://evil.example', 0)).rejects.toBeInstanceOf(
      OwnerSupportContactInvalidError,
    );
    for (const revision of [-1, 0.5, NaN, 2_147_483_647]) {
      await expect(adapter.set(actor, 'support', revision)).rejects.toBeInstanceOf(
        OwnerSupportContactInvalidError,
      );
    }
    expect(query).not.toHaveBeenCalled();
  });
  it.each([
    ['42501', OwnerSupportContactRejectedError],
    ['22023', OwnerSupportContactInvalidError],
    ['40001', OwnerSupportContactConflictError],
    ['08006', OwnerSupportContactUnavailableError],
  ])('maps database failure %s without disclosing its body', async (code, ErrorType) => {
    const query = vi.fn().mockRejectedValue({ code, message: 'private detail' });
    await expect(
      new PostgresOwnerSupportContact({ query }).set(actor, 'support', 0),
    ).rejects.toBeInstanceOf(ErrorType);
  });
  it.each(
    [
      [],
      [initial, initial],
      [{ ...initial, secret: 'unexpected' }],
      [{ ...initial, revision: '0' }],
      [{ ...initial, telegram_username: 'support' }],
      [{ ...initial, revision: 1 }],
      [{ telegram_username: 'UPPERCASE', revision: 1, updated_at: new Date() }],
      [{ telegram_username: null, revision: 1, updated_at: '2026-09-09' }],
    ].map((rows) => ({ rows })),
  )('fails closed for malformed or inconsistent rows %j', async ({ rows }) => {
    const query = vi.fn().mockResolvedValue({ rows });
    await expect(new PostgresOwnerSupportContact({ query }).get(actor)).rejects.toBeInstanceOf(
      OwnerSupportContactUnavailableError,
    );
  });
  it('public projection never includes Owner metadata', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ telegram_username: 'support' }] });
    expect(await new PostgresOwnerSupportContact({ query }).publicContact()).toEqual({
      telegramUsername: 'support',
    });
    expect(query).toHaveBeenCalledWith(OWNER_SUPPORT_CONTACT_SQL.public, []);
    query.mockResolvedValue({ rows: [{ ...initial }] });
    await expect(new PostgresOwnerSupportContact({ query }).publicContact()).rejects.toBeInstanceOf(
      OwnerSupportContactUnavailableError,
    );
  });
});
