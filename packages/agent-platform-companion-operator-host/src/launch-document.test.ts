import { describe, expect, it } from 'vitest';

import { parseOperatorHostLaunchDocument } from './launch-document.js';

const ca = '-----BEGIN CERTIFICATE-----\n' + 'A'.repeat(64) + '\n-----END CERTIFICATE-----\n';
const requestKey = '00000000-0000-4000-8000-000000000001';
const direct =
  'postgresql://postgres:encoded%40password@db.xzztugbgtulptnbpoelr.supabase.co:5432/postgres?sslmode=verify-full';

function encoded(databaseUrl = direct, extra: Record<string, unknown> = {}): Uint8Array {
  return Buffer.from(
    JSON.stringify({ version: 1, requestKey, databaseUrl, databaseCaPem: ca, ...extra }),
  );
}

describe('one-use production operator host launch document', () => {
  it('accepts only the exact direct database host, URL shape, and verified TLS mode', () => {
    const parsed = parseOperatorHostLaunchDocument(encoded());
    expect(parsed.database.host).toBe('db.xzztugbgtulptnbpoelr.supabase.co');
    expect(parsed.database.port).toBe(5432);
    expect(parsed.database.password).toBe('encoded@password');
    expect(parsed.requestKey).toBe(requestKey);
  });

  it.each([
    'postgresql://postgres:p@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
    'postgresql://postgres:p@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres:p@db.xzztugbgtulptnbpoelr.supabase.co:6543/postgres',
    'postgresql://other:p@db.xzztugbgtulptnbpoelr.supabase.co:5432/postgres',
    'postgresql://postgres:p@db.xzztugbgtulptnbpoelr.supabase.co:5432/other',
    'postgresql://postgres:p@db.xzztugbgtulptnbpoelr.supabase.co:5432/postgres?sslmode=require',
    'postgresql://postgres:p@db.xzztugbgtulptnbpoelr.supabase.co:5432/postgres?sslmode=disable',
  ])('refuses an alternate database or weaker connection: %s', (url) => {
    expect(() => parseOperatorHostLaunchDocument(encoded(url))).toThrow();
  });

  it('refuses extra fields, non-v4 requests, malformed CA, and oversized input', () => {
    expect(() => parseOperatorHostLaunchDocument(encoded(direct, { bypass: true }))).toThrow();
    expect(() =>
      parseOperatorHostLaunchDocument(encoded(direct, { requestKey: 'not-a-uuid' })),
    ).toThrow();
    expect(() => parseOperatorHostLaunchDocument(encoded(direct, { databaseCaPem: '' }))).toThrow();
    expect(() => parseOperatorHostLaunchDocument(Buffer.alloc(16 * 1024 + 1))).toThrow();
  });
});
