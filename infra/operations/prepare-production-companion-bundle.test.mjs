import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareProductionCompanionBundle } from './prepare-production-companion-bundle.mjs';

function fixture() {
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicBytes = Buffer.from(key.publicKey.export({ format: 'der', type: 'spki' }));
  const privateBytes = Buffer.from(key.privateKey.export({ format: 'der', type: 'pkcs8' }));
  const digest = `sha256:${createHash('sha256').update(publicBytes).digest('hex')}`;
  const manifest = {
    contractVersion: 2,
    deploymentTarget: 'production',
    pairingAllowed: true,
    exactFiveReadOnlyLookupAllowed: true,
    financialActionAllowed: false,
    moneyMovementAllowed: false,
    serverSignerId: '11111111-1111-4111-8111-111111111111',
    serverSignerKeyId: 'companion-server-production-v1',
    serverSignerPublicKeySpkiSha256: digest,
  };
  return {
    manifest,
    privateBytes,
    environment: {
      PRODUCTION_PROJECT_REF: 'xzztugbgtulptnbpoelr',
      COMPANION_DEVICE_BRIDGE_RUNTIME_PASSWORD: randomBytes(32).toString('hex'),
      COMPANION_SERVER_SIGNER_ID: manifest.serverSignerId,
      COMPANION_SERVER_SIGNER_KEY_ID: manifest.serverSignerKeyId,
      COMPANION_SERVER_SIGNER_PKCS8_BASE64: privateBytes.toString('base64'),
      COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64: publicBytes.toString('base64'),
      COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64URL: publicBytes.toString('base64url'),
      COMPANION_SERVER_SIGNER_PUBLIC_SPKI_SHA256: digest,
      COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_V2_BASE64: Buffer.from(
        JSON.stringify(manifest),
      ).toString('base64'),
    },
  };
}

test('prepares only three production-bound protected files without a database-URL newline', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'fetanagent-companion-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { environment, privateBytes, manifest } = fixture();
  prepareProductionCompanionBundle(environment, directory);
  assert.equal(readdirSync(directory).length, 3);
  assert.deepEqual(
    readFileSync(join(directory, 'companion-bridge-server-signer.pkcs8.der')),
    privateBytes,
  );
  assert.equal(
    readFileSync(join(directory, 'companion-bridge-runtime-manifest.v2.json'), 'utf8'),
    JSON.stringify(manifest),
  );
  const url = readFileSync(join(directory, 'companion-device-database-url'), 'utf8');
  assert.equal(new URL(url).hostname, 'db.xzztugbgtulptnbpoelr.supabase.co');
  assert.equal(url.includes('\n'), false);
  assert.throws(() => prepareProductionCompanionBundle(environment, directory), /unsafe/u);
});

for (const [name, mutate] of [
  [
    'staging project',
    (e) => {
      e.PRODUCTION_PROJECT_REF = 'spzpiyxheappsfyswewl';
    },
  ],
  [
    'staging signer',
    (e) => {
      e.COMPANION_SERVER_SIGNER_KEY_ID = 'companion-server-staging-v1';
    },
  ],
  [
    'staging manifest',
    (_e, m) => {
      m.deploymentTarget = 'staging';
    },
  ],
  [
    'financial authority',
    (_e, m) => {
      m.financialActionAllowed = true;
    },
  ],
  [
    'money authority',
    (_e, m) => {
      m.moneyMovementAllowed = true;
    },
  ],
  [
    'wrong digest',
    (e) => {
      e.COMPANION_SERVER_SIGNER_PUBLIC_SPKI_SHA256 = `sha256:${'0'.repeat(64)}`;
    },
  ],
  [
    'wrong private key',
    (e) => {
      e.COMPANION_SERVER_SIGNER_PKCS8_BASE64 =
        fixture().environment.COMPANION_SERVER_SIGNER_PKCS8_BASE64;
    },
  ],
  [
    'noncanonical key',
    (e) => {
      e.COMPANION_SERVER_SIGNER_PKCS8_BASE64 += '\n';
    },
  ],
  [
    'short password',
    (e) => {
      e.COMPANION_DEVICE_BRIDGE_RUNTIME_PASSWORD = 'short';
    },
  ],
  [
    'reused TeleBirr bridge key',
    (e) => {
      e.TELEBIRR_BRIDGE_SERVER_SIGNER_PUBLIC_SPKI_SHA256 =
        e.COMPANION_SERVER_SIGNER_PUBLIC_SPKI_SHA256;
    },
  ],
  [
    'reused assignment key',
    (e) => {
      e.TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_SHA256 =
        e.COMPANION_SERVER_SIGNER_PUBLIC_SPKI_SHA256;
    },
  ],
]) {
  test(`rejects ${name} before writing any file`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'fetanagent-companion-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const { environment, manifest } = fixture();
    mutate(environment, manifest);
    environment.COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_V2_BASE64 = Buffer.from(
      JSON.stringify(manifest),
    ).toString('base64');
    assert.throws(() => prepareProductionCompanionBundle(environment, directory), /unsafe/u);
    assert.deepEqual(readdirSync(directory), []);
  });
}
