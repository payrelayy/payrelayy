import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { chmod, open, rm } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const DATABASE_ROLE = 'fetanagent_trusted_telebirr_verifier_runtime';
const DATABASE_HOST = 'db.xzztugbgtulptnbpoelr.supabase.co';
const ITERATIONS = 4_096;

function fail(message) {
  throw new Error(`production trusted TeleBirr credential: ${message}`);
}

function exactOutputPath(flag, value) {
  if (flag === undefined || value === undefined || value === '' || !isAbsolute(value)) {
    fail('two distinct absolute output paths are required');
  }
  return resolve(value);
}

if (
  process.argv.length !== 6 ||
  process.argv[2] !== '--database-url-output' ||
  process.argv[4] !== '--scram-output'
) {
  fail('expected --database-url-output <absolute-path> --scram-output <absolute-path>');
}

const databaseUrlOutput = exactOutputPath(process.argv[2], process.argv[3]);
const scramOutput = exactOutputPath(process.argv[4], process.argv[5]);
if (databaseUrlOutput === scramOutput) fail('the output paths must be distinct');

const passwordBytes = randomBytes(32);
const salt = randomBytes(16);
const password = passwordBytes.toString('hex');
const saltedPassword = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
const storedKey = createHash('sha256').update(clientKey).digest();
const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();
const scramVerifier =
  `SCRAM-SHA-256$${ITERATIONS}:${salt.toString('base64')}` +
  `$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
const databaseUrl =
  `postgresql://${DATABASE_ROLE}:${password}@${DATABASE_HOST}:5432/postgres` +
  '?sslmode=verify-full';

let databaseHandle;
let scramHandle;
try {
  databaseHandle = await open(databaseUrlOutput, 'wx', 0o600);
  await databaseHandle.writeFile(databaseUrl, { encoding: 'utf8' });
  await databaseHandle.sync();
  await databaseHandle.close();
  databaseHandle = undefined;
  await chmod(databaseUrlOutput, 0o600);

  scramHandle = await open(scramOutput, 'wx', 0o600);
  await scramHandle.writeFile(scramVerifier, { encoding: 'utf8' });
  await scramHandle.sync();
  await scramHandle.close();
  scramHandle = undefined;
  await chmod(scramOutput, 0o600);
} catch (error) {
  await databaseHandle?.close().catch(() => undefined);
  await scramHandle?.close().catch(() => undefined);
  await Promise.all([rm(databaseUrlOutput, { force: true }), rm(scramOutput, { force: true })]);
  throw error;
} finally {
  passwordBytes.fill(0);
  salt.fill(0);
  saltedPassword.fill(0);
  clientKey.fill(0);
  storedKey.fill(0);
  serverKey.fill(0);
}
