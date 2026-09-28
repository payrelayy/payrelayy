// The production workflow pipes this document directly to the root-owned host
// launcher. Never print it to logs or persist it on the runner or production VM.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RELEASE_TAG = /^windows-companion-v[0-9A-Za-z._-]{1,60}$/u;
const DIRECT_HOST = 'db.xzztugbgtulptnbpoelr.supabase.co';

export function renderProductionOperatorLaunch(environment) {
  const requestKey = environment.PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY;
  const password = environment.SUPABASE_DB_PASSWORD;
  const databaseCaPem = environment.SUPABASE_CA_CERTIFICATE_PEM;
  const releaseTag = environment.PRODUCTION_COMPANION_RELEASE_TAG;
  if (
    typeof requestKey !== 'string' ||
    !UUID_V4.test(requestKey) ||
    typeof password !== 'string' ||
    password.length < 1 ||
    password.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(password) ||
    typeof databaseCaPem !== 'string' ||
    Buffer.byteLength(databaseCaPem, 'utf8') > 8 * 1024 ||
    !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/u.test(
      databaseCaPem,
    ) ||
    typeof releaseTag !== 'string' ||
    !RELEASE_TAG.test(releaseTag)
  ) {
    throw new Error('The protected operator launch input is unavailable.');
  }
  const databaseUrl = new URL(`postgresql://postgres@${DIRECT_HOST}:5432/postgres`);
  databaseUrl.password = encodeURIComponent(password);
  databaseUrl.searchParams.set('sslmode', 'verify-full');
  const document = JSON.stringify({
    version: 1,
    requestKey,
    databaseUrl: databaseUrl.href,
    databaseCaPem,
    releaseTag,
  });
  if (Buffer.byteLength(document, 'utf8') > 16 * 1024) {
    throw new Error('The protected operator launch input is unavailable.');
  }
  return document;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.stdout.write(renderProductionOperatorLaunch(process.env));
  } catch {
    process.stderr.write('The protected operator launch input is unavailable.\n');
    process.exitCode = 1;
  }
}
