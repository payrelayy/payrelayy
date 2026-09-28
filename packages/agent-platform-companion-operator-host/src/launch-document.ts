const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIRECT_HOST = 'db.xzztugbgtulptnbpoelr.supabase.co';
const MAX_DOCUMENT_BYTES = 16 * 1024;
const MAX_CA_BYTES = 8 * 1024;

export interface OperatorHostLaunchDocument {
  readonly requestKey: string;
  readonly database: {
    readonly host: string;
    readonly port: 5432;
    readonly user: 'postgres';
    readonly database: 'postgres';
    readonly password: string;
  };
  readonly databaseCaPem: string;
}

/**
 * Only a one-use, stdin-only launch document is accepted. The URL is reduced
 * to exact direct-connection fields; pg and psql never receive a pooler URL or
 * caller-supplied TLS flags. The certificate is public, but is still kept in
 * container tmpfs so the image and production host remain credential-free.
 */
export function parseOperatorHostLaunchDocument(raw: Uint8Array): OperatorHostLaunchDocument {
  if (!(raw instanceof Uint8Array) || raw.byteLength < 1 || raw.byteLength > MAX_DOCUMENT_BYTES)
    throw new Error('Invalid protected operator launch document.');
  const decoded: unknown = JSON.parse(Buffer.from(raw).toString('utf8'));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
    throw new Error('Invalid protected operator launch document.');
  const record = decoded as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'databaseCaPem,databaseUrl,requestKey,version' ||
    record.version !== 1 ||
    typeof record.requestKey !== 'string' ||
    !UUID_V4.test(record.requestKey) ||
    typeof record.databaseUrl !== 'string' ||
    record.databaseUrl.length > 2048 ||
    typeof record.databaseCaPem !== 'string' ||
    Buffer.byteLength(record.databaseCaPem, 'utf8') > MAX_CA_BYTES ||
    !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/u.test(
      record.databaseCaPem,
    )
  )
    throw new Error('Invalid protected operator launch document.');
  let url: URL;
  try {
    url = new URL(record.databaseUrl);
  } catch {
    throw new Error('Invalid protected operator launch document.');
  }
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== DIRECT_HOST ||
    url.port !== '5432' ||
    url.username !== 'postgres' ||
    url.pathname !== '/postgres' ||
    url.hash !== '' ||
    (url.search !== '' && url.search !== '?sslmode=verify-full') ||
    !url.password
  )
    throw new Error('Invalid protected operator launch document.');
  let password: string;
  try {
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error('Invalid protected operator launch document.');
  }
  if (!password || password.length > 512 || /[\u0000-\u001f\u007f]/u.test(password))
    throw new Error('Invalid protected operator launch document.');
  return Object.freeze({
    requestKey: record.requestKey,
    database: Object.freeze({
      host: DIRECT_HOST,
      port: 5432,
      user: 'postgres',
      database: 'postgres',
      password,
    }),
    databaseCaPem: record.databaseCaPem,
  });
}
