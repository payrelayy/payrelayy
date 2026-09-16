import { createHash, createHmac } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

const MASTER_PATTERN = /^[0-9a-f]{64}\n?$/u;
const KEY_CONTEXT = 'fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:telebirr';

function fail() {
  throw new Error('The scoped TeleBirr reference-opening key could not be derived.');
}

function guardedMaster(path) {
  if (!isAbsolute(path)) fail();
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path) {
    fail();
  }
  const bytes = readFileSync(path);
  try {
    if (bytes.includes(0)) fail();
    const text = bytes.toString('utf8');
    if (!MASTER_PATTERN.test(text)) fail();
    return Buffer.from(text.slice(0, 64), 'hex');
  } finally {
    bytes.fill(0);
  }
}

function guardedOutput(path) {
  if (!isAbsolute(path) || realpathSync(dirname(path)) !== dirname(path)) fail();
  try {
    lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  fail();
}

function main() {
  if (process.argv.length !== 4) fail();
  const masterPath = process.argv[2];
  const outputPath = process.argv[3];
  guardedOutput(outputPath);

  let master;
  let child;
  try {
    master = guardedMaster(masterPath);
    child = createHmac('sha256', master).update(KEY_CONTEXT, 'utf8').digest();
    const keyId = `sha256:${createHash('sha256').update(child).digest('hex')}`;
    const document = JSON.stringify({
      contractVersion: 1,
      providerCode: 'telebirr',
      purpose: 'deposit-proof-reference-opening',
      keyVersion: 2,
      keyId,
      keyHex: child.toString('hex'),
    });
    writeFileSync(outputPath, document, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    process.stdout.write(keyId);
  } finally {
    master?.fill(0);
    child?.fill(0);
  }
}

main();
