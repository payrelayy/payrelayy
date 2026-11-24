import { describe, expect, it, vi } from 'vitest';

import {
  normalizePlatformPlayUrl,
  OWNER_PLATFORM_PLAY_SQL,
  OwnerPlatformPlayConflictError,
  PostgresOwnerPlatformPlayDestinations,
} from './owner-platform-play-destinations.js';

const actor = '11111111-1111-4111-8111-111111111111';
const launch = {
  platform_code: 'kemerbet',
  destination_url: 'https://kemer.co/',
  revision: 0,
  updated_at: null,
};

describe('platform Play destination storage', () => {
  it('accepts only a public HTTPS destination or an explicit disable', () => {
    expect(normalizePlatformPlayUrl('https://kemer.co')).toBe('https://kemer.co/');
    expect(normalizePlatformPlayUrl(null)).toBeNull();
    for (const input of [
      'http://kemer.co/',
      'https://user:secret@kemer.co/',
      'https://kemer.co/#part',
      'https://kemer.co:8443/',
      'https://localhost/',
      'https://127.0.0.1/',
      'https://owner.fetanagent.com/v1/public/play/kemerbet',
      'https://owner.fetanagent.com/owner',
      'https://fetanagent.com/',
      'https://kemer.co\\@evil.example/',
      ' https://kemer.co/',
    ])
      expect(normalizePlatformPlayUrl(input)).toBeUndefined();
  });

  it('saves by active Owner and revision and exposes only the selected public destination', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [launch] })
      .mockResolvedValueOnce({
        rows: [
          {
            ...launch,
            destination_url: 'https://new.example/',
            revision: 1,
            updated_at: new Date('2026-11-24T12:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ destination_url: 'https://new.example/' }] });
    const storage = new PostgresOwnerPlatformPlayDestinations({ query });
    expect(await storage.get(actor, 'kemerbet')).toEqual({
      platformCode: 'kemerbet',
      destinationUrl: 'https://kemer.co/',
      revision: 0,
      updatedAt: null,
    });
    expect(await storage.set(actor, 'kemerbet', 'https://new.example', 0)).toEqual({
      platformCode: 'kemerbet',
      destinationUrl: 'https://new.example/',
      revision: 1,
      updatedAt: '2026-11-24T12:00:00.000Z',
    });
    expect(await storage.publicDestination('kemerbet')).toBe('https://new.example/');
    expect(query.mock.calls).toEqual([
      [OWNER_PLATFORM_PLAY_SQL.get, [actor, 'kemerbet']],
      [OWNER_PLATFORM_PLAY_SQL.set, [actor, 'kemerbet', 'https://new.example/', 0]],
      [OWNER_PLATFORM_PLAY_SQL.public, ['kemerbet']],
    ]);
  });

  it('prevents a stale Owner edit from replacing another saved destination', async () => {
    const query = vi.fn().mockRejectedValue({ code: '40001' });
    const storage = new PostgresOwnerPlatformPlayDestinations({ query });
    await expect(storage.set(actor, 'kemerbet', 'https://new.example/', 0)).rejects.toBeInstanceOf(
      OwnerPlatformPlayConflictError,
    );
  });
});
