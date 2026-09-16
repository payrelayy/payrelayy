import { createHash, createHmac, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function decodeCanonicalBase64(value) {
  if (!canonicalBase64.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) return null;
  return decoded;
}

export function verifyPostgresScramSha256Secret(secret, verifier) {
  if (!/^[0-9a-f]{64}$/u.test(secret)) return false;
  const match = /^SCRAM-SHA-256\$([1-9][0-9]{3,6}):([^$]+)\$([^:]+):([^:]+)$/u.exec(verifier);
  if (!match) return false;

  const iterations = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(iterations) || iterations < 4096 || iterations > 1_000_000) {
    return false;
  }

  const salt = decodeCanonicalBase64(match[2]);
  const expectedStoredKey = decodeCanonicalBase64(match[3]);
  const expectedServerKey = decodeCanonicalBase64(match[4]);
  if (
    salt === null ||
    salt.length < 16 ||
    expectedStoredKey === null ||
    expectedStoredKey.length !== 32 ||
    expectedServerKey === null ||
    expectedServerKey.length !== 32
  ) {
    return false;
  }

  const saltedPassword = pbkdf2Sync(secret, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();

  const storedKeyMatches = timingSafeEqual(storedKey, expectedStoredKey);
  const serverKeyMatches = timingSafeEqual(serverKey, expectedServerKey);
  const matches = storedKeyMatches && serverKeyMatches;
  salt.fill(0);
  expectedStoredKey.fill(0);
  expectedServerKey.fill(0);
  saltedPassword.fill(0);
  clientKey.fill(0);
  storedKey.fill(0);
  serverKey.fill(0);
  return matches;
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error('Expected one protected PostgreSQL SCRAM verifier file.');
  }
  const secret = process.env.POSTGRES_SCRAM_SECRET ?? '';
  const raw = await readFile(process.argv[2], 'utf8');
  const verifier = raw.replace(/\r?\n$/u, '');
  if (verifier.includes('\n') || verifier.includes('\r')) {
    throw new Error('The PostgreSQL SCRAM verifier file is not canonical.');
  }
  if (!verifyPostgresScramSha256Secret(secret, verifier)) {
    throw new Error('The protected PostgreSQL SCRAM credential does not match.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
