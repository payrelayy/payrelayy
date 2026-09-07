import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { lstatSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const unavailable = () => {
  throw new Error('Production companion material is missing, mismatched, or unsafe.');
};
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fields = [
  'contractVersion',
  'deploymentTarget',
  'pairingAllowed',
  'exactFiveReadOnlyLookupAllowed',
  'financialActionAllowed',
  'moneyMovementAllowed',
  'serverSignerId',
  'serverSignerKeyId',
  'serverSignerPublicKeySpkiSha256',
];

function decode(value) {
  if (typeof value !== 'string' || value.length > 16_384 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value))
    unavailable();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value) unavailable();
  return bytes;
}

export function prepareProductionCompanionBundle(environment, directory) {
  const buffers = [];
  try {
    if (!isAbsolute(directory)) unavailable();
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) unavailable();
    const password = environment.COMPANION_DEVICE_BRIDGE_RUNTIME_PASSWORD;
    if (!/^[0-9a-f]{64}$/u.test(password ?? '')) unavailable();
    if (environment.PRODUCTION_PROJECT_REF !== 'xzztugbgtulptnbpoelr') unavailable();
    const signerId = environment.COMPANION_SERVER_SIGNER_ID;
    const keyId = environment.COMPANION_SERVER_SIGNER_KEY_ID;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        signerId ?? '',
      ) ||
      keyId !== 'companion-server-production-v1'
    )
      unavailable();
    const privateBytes = decode(environment.COMPANION_SERVER_SIGNER_PKCS8_BASE64);
    buffers.push(privateBytes);
    const privateKey = createPrivateKey({ key: privateBytes, format: 'der', type: 'pkcs8' });
    const canonicalPrivate = Buffer.from(privateKey.export({ format: 'der', type: 'pkcs8' }));
    buffers.push(canonicalPrivate);
    if (
      privateKey.asymmetricKeyType !== 'ec' ||
      privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !privateBytes.equals(canonicalPrivate)
    )
      unavailable();
    const publicBytes = Buffer.from(
      createPublicKey(privateKey).export({ format: 'der', type: 'spki' }),
    );
    buffers.push(publicBytes);
    const publicDigest = digest(publicBytes);
    if (
      publicBytes.length !== 91 ||
      publicBytes.toString('base64') !== environment.COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64 ||
      publicBytes.toString('base64url') !==
        environment.COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64URL ||
      publicDigest !== environment.COMPANION_SERVER_SIGNER_PUBLIC_SPKI_SHA256 ||
      [
        environment.TELEBIRR_BRIDGE_SERVER_SIGNER_PUBLIC_SPKI_SHA256,
        environment.TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_SHA256,
      ].includes(publicDigest)
    )
      unavailable();
    const manifestBytes = decode(environment.COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_V2_BASE64);
    buffers.push(manifestBytes);
    const manifestText = manifestBytes.toString('utf8');
    const manifest = JSON.parse(manifestText);
    if (
      !manifest ||
      Object.keys(manifest).join(',') !== fields.join(',') ||
      JSON.stringify(manifest) !== manifestText ||
      manifest.contractVersion !== 2 ||
      manifest.deploymentTarget !== 'production' ||
      manifest.pairingAllowed !== true ||
      manifest.exactFiveReadOnlyLookupAllowed !== true ||
      manifest.financialActionAllowed !== false ||
      manifest.moneyMovementAllowed !== false ||
      manifest.serverSignerId !== signerId ||
      manifest.serverSignerKeyId !== keyId ||
      manifest.serverSignerPublicKeySpkiSha256 !== publicDigest
    )
      unavailable();
    const values = [
      [
        'companion-device-database-url',
        `postgresql://fetanagent_companion_device_bridge_runtime:${password}@db.xzztugbgtulptnbpoelr.supabase.co:5432/postgres?sslmode=verify-full`,
      ],
      ['companion-bridge-server-signer.pkcs8.der', privateBytes],
      ['companion-bridge-runtime-manifest.v2.json', manifestBytes],
    ];
    for (const [name, value] of values) {
      writeFileSync(join(directory, name), value, { flag: 'wx', mode: 0o600 });
    }
  } catch {
    unavailable();
  } finally {
    for (const bytes of buffers) bytes.fill(0);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareProductionCompanionBundle(process.env, process.argv[2]);
}
