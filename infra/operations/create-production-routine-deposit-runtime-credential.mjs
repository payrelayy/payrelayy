import { randomBytes } from 'node:crypto';
import { chmod, open, rm } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const DATABASE_ROLE = 'fetanagent_routine_deposit_broker_runtime.xzztugbgtulptnbpoelr';
const DATABASE_HOST = 'aws-0-eu-west-1.pooler.supabase.com';

function fail(message) {
  throw new Error(`production routine-deposit credential: ${message}`);
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
  process.argv[4] !== '--activation-password-output'
) {
  fail(
    'expected --database-url-output <absolute-path> --activation-password-output <absolute-path>',
  );
}

const databaseUrlOutput = exactOutputPath(process.argv[2], process.argv[3]);
const activationPasswordOutput = exactOutputPath(process.argv[4], process.argv[5]);
if (databaseUrlOutput === activationPasswordOutput) fail('the output paths must be distinct');

const passwordBytes = randomBytes(32);
const password = passwordBytes.toString('hex');
const databaseUrl =
  `postgresql://${DATABASE_ROLE}:${password}@${DATABASE_HOST}:5432/postgres` +
  '?sslmode=verify-full';
let databaseHandle;
let passwordHandle;
let databaseCreated = false;
let passwordCreated = false;
try {
  databaseHandle = await open(databaseUrlOutput, 'wx', 0o600);
  databaseCreated = true;
  await databaseHandle.writeFile(databaseUrl, { encoding: 'utf8' });
  await databaseHandle.sync();
  await databaseHandle.close();
  databaseHandle = undefined;
  await chmod(databaseUrlOutput, 0o600);

  passwordHandle = await open(activationPasswordOutput, 'wx', 0o600);
  passwordCreated = true;
  await passwordHandle.writeFile(password, { encoding: 'utf8' });
  await passwordHandle.sync();
  await passwordHandle.close();
  passwordHandle = undefined;
  await chmod(activationPasswordOutput, 0o600);
} catch (error) {
  await databaseHandle?.close().catch(() => undefined);
  await passwordHandle?.close().catch(() => undefined);
  await Promise.all([
    ...(databaseCreated ? [rm(databaseUrlOutput, { force: true })] : []),
    ...(passwordCreated ? [rm(activationPasswordOutput, { force: true })] : []),
  ]);
  throw error;
} finally {
  passwordBytes.fill(0);
}
