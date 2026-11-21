import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const repository = 'payrelayy/payrelayy';
const environment = 'production';
const signerKeyId = 'companion-server-production-v2';
const secretName = 'COMPANION_SERVER_SIGNER_PKCS8_BASE64_V2';
const variableNames = [
  'COMPANION_SERVER_SIGNER_ID_V2',
  'COMPANION_SERVER_SIGNER_KEY_ID_V2',
  'COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64_V2',
  'COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64URL_V2',
  'COMPANION_SERVER_SIGNER_PUBLIC_SPKI_SHA256_V2',
  'COMPANION_SERVER_SIGNER_VALID_FROM_V2',
  'COMPANION_SERVER_SIGNER_VALID_UNTIL_V2',
  'COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_V2_BASE64_V2',
];

function gh(args, input) {
  return execFileSync('gh', args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

if (gh(['repo', 'view', repository, '--json', 'id', '--jq', '.id']) !== 'R_kgDOTyrLjQ') {
  throw new Error('The exact FetanAgent repository is required.');
}
const existingSecrets = new Set(
  JSON.parse(
    gh(['secret', 'list', '--repo', repository, '--env', environment, '--json', 'name']),
  ).map((value) => value.name),
);
const existingVariables = new Set(
  JSON.parse(
    gh(['variable', 'list', '--repo', repository, '--env', environment, '--json', 'name']),
  ).map((value) => value.name),
);
if (existingSecrets.has(secretName) || variableNames.some((name) => existingVariables.has(name))) {
  throw new Error('A permanent v2 signer is already staged; no key was replaced.');
}

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privateKey = Buffer.from(pair.privateKey.export({ format: 'der', type: 'pkcs8' }));
const publicKey = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }));
const privateBase64 = Buffer.from(privateKey.toString('base64'));
try {
  if (publicKey.length !== 91) throw new Error('The P-256 public key is not canonical.');
  const signerId = randomUUID();
  const digest = `sha256:${createHash('sha256').update(publicKey).digest('hex')}`;
  const validFrom = new Date(Math.floor((Date.now() - 300_000) / 1000) * 1000)
    .toISOString()
    .replace('.000Z', 'Z');
  const validUntil = '9999-12-31T00:00:00Z';
  const manifest = {
    contractVersion: 2,
    deploymentTarget: environment,
    pairingAllowed: true,
    exactFiveReadOnlyLookupAllowed: true,
    financialActionAllowed: false,
    moneyMovementAllowed: false,
    serverSignerId: signerId,
    serverSignerKeyId: signerKeyId,
    serverSignerPublicKeySpkiSha256: digest,
  };
  const variables = {
    COMPANION_SERVER_SIGNER_ID_V2: signerId,
    COMPANION_SERVER_SIGNER_KEY_ID_V2: signerKeyId,
    COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64_V2: publicKey.toString('base64'),
    COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64URL_V2: publicKey.toString('base64url'),
    COMPANION_SERVER_SIGNER_PUBLIC_SPKI_SHA256_V2: digest,
    COMPANION_SERVER_SIGNER_VALID_FROM_V2: validFrom,
    COMPANION_SERVER_SIGNER_VALID_UNTIL_V2: validUntil,
    COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_V2_BASE64_V2: Buffer.from(
      JSON.stringify(manifest),
    ).toString('base64'),
  };
  const installedVariables = [];
  let installedSecret = false;
  try {
    gh(['secret', 'set', secretName, '--repo', repository, '--env', environment], privateBase64);
    installedSecret = true;
    for (const [name, value] of Object.entries(variables)) {
      gh(['variable', 'set', name, '--repo', repository, '--env', environment, '--body', value]);
      installedVariables.push(name);
    }
  } catch {
    for (const name of installedVariables) {
      try {
        gh(['variable', 'delete', name, '--repo', repository, '--env', environment]);
      } catch {
        // Leave an unused staged variable for explicit operator cleanup.
      }
    }
    if (installedSecret) {
      try {
        gh(['secret', 'delete', secretName, '--repo', repository, '--env', environment]);
      } catch {
        // Leave an unused staged secret for explicit operator cleanup.
      }
    }
    throw new Error('Permanent v2 signer staging failed; the live v1 signer was unchanged.');
  }
  console.log(JSON.stringify({ signerKeyId, signerId, publicKeySha256: digest, staged: true }));
} finally {
  privateKey.fill(0);
  privateBase64.fill(0);
  publicKey.fill(0);
}
