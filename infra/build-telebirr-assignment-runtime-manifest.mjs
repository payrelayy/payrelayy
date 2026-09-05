import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const FORBIDDEN_NAME_CODE_UNIT = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u;
const ASCII_WHITESPACE = /[\u0009-\u000d\u0020]+/gu;
const NORMALIZER_VERSION = 'telebirr-credited-party-name-normalizer-v1';

function fail() {
  throw new Error('TeleBirr runtime manifest input is unavailable');
}

function exactObject(value, keys) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  ) {
    fail();
  }
  return value;
}

function requiredEnvironment(environment, name, pattern) {
  const value = environment[name];
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function normalizeReceiverName(value) {
  if (typeof value !== 'string' || FORBIDDEN_NAME_CODE_UNIT.test(value)) fail();
  const normalized = value
    .normalize('NFC')
    .replace(ASCII_WHITESPACE, ' ')
    .trim()
    .replace(/[A-Z]/gu, (character) => character.toLowerCase());
  if (
    normalized.length < 2 ||
    normalized.length > 160 ||
    Buffer.byteLength(normalized, 'utf8') > 320
  ) {
    fail();
  }
  return normalized;
}

function encodedScalar(value) {
  return `string:${value}`;
}

function encodeFields(domain, fields) {
  const values = [domain, String(fields.length)];
  for (const [name, value] of fields) values.push(name, encodedScalar(value));
  const chunks = [];
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    chunks.push(length, bytes);
  }
  return Buffer.concat(chunks);
}

function receiverNameDigest(normalizedName) {
  const transcript = encodeFields('fetanagent:telebirr:live-private-pilot:receiver-name:v1', [
    ['normalizerVersion', NORMALIZER_VERSION],
    ['normalizedName', normalizedName],
  ]);
  return `sha256:${createHash('sha256').update(transcript).digest('hex')}`;
}

function guardedInput(path) {
  if (!isAbsolute(path)) fail();
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path) {
    fail();
  }
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > 16_384 || bytes.includes(0)) fail();
  try {
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    bytes.fill(0);
  }
}

export function buildTelebirrAssignmentRuntimeManifest(input, environment = process.env) {
  const row = exactObject(input, [
    'schemaVersion',
    'pilotRevisionId',
    'receiverRevisionId',
    'receiverProfileId',
    'receiverProfileDigest',
    'receiverConfigurationDigest',
    'receiverNameNormalizerVersion',
    'expectedReceiverNameDigest',
    'receiverAccountHolderNameSnapshot',
    'assignmentSignerId',
    'assignmentSignerKeyId',
    'assignmentSignerPublicKeySpkiSha256',
  ]);
  const assignmentSignerId = requiredEnvironment(
    environment,
    'TELEBIRR_ASSIGNMENT_SIGNER_ID',
    UUID_V4,
  );
  const assignmentSignerKeyId = environment.TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID;
  const assignmentSignerPublicKeySpkiSha256 =
    environment.TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_SHA256;
  const referenceOpeningKeyId = environment.TELEBIRR_REFERENCE_OPENING_KEY_ID;
  if (
    typeof assignmentSignerKeyId !== 'string' ||
    !KEY_ID.test(assignmentSignerKeyId) ||
    typeof assignmentSignerPublicKeySpkiSha256 !== 'string' ||
    !SHA256.test(assignmentSignerPublicKeySpkiSha256) ||
    typeof referenceOpeningKeyId !== 'string' ||
    !SHA256.test(referenceOpeningKeyId)
  ) {
    fail();
  }
  if (
    row.schemaVersion !== 1 ||
    typeof row.pilotRevisionId !== 'string' ||
    !UUID_V4.test(row.pilotRevisionId) ||
    typeof row.receiverRevisionId !== 'string' ||
    !UUID_V4.test(row.receiverRevisionId) ||
    typeof row.receiverProfileId !== 'string' ||
    !UUID_V4.test(row.receiverProfileId) ||
    typeof row.receiverProfileDigest !== 'string' ||
    !SHA256.test(row.receiverProfileDigest) ||
    typeof row.receiverConfigurationDigest !== 'string' ||
    !SHA256.test(row.receiverConfigurationDigest) ||
    row.receiverNameNormalizerVersion !== NORMALIZER_VERSION ||
    typeof row.expectedReceiverNameDigest !== 'string' ||
    !SHA256.test(row.expectedReceiverNameDigest) ||
    row.assignmentSignerId !== assignmentSignerId ||
    row.assignmentSignerKeyId !== assignmentSignerKeyId ||
    row.assignmentSignerPublicKeySpkiSha256 !== assignmentSignerPublicKeySpkiSha256
  ) {
    fail();
  }
  const expectedReceiverNameNormalized = normalizeReceiverName(
    row.receiverAccountHolderNameSnapshot,
  );
  if (receiverNameDigest(expectedReceiverNameNormalized) !== row.expectedReceiverNameDigest) fail();

  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    assignmentSignerId,
    assignmentSignerKeyId,
    assignmentSignerPublicKeySpkiSha256,
    referenceOpeningKeyId,
    receiverManifest: {
      contractVersion: 1,
      providerCode: 'telebirr',
      pilotRevisionId: row.pilotRevisionId,
      receiverRevisionId: row.receiverRevisionId,
      receiverProfileId: row.receiverProfileId,
      receiverProfileDigest: row.receiverProfileDigest,
      receiverConfigurationDigest: row.receiverConfigurationDigest,
      receiverNameNormalizerVersion: NORMALIZER_VERSION,
      expectedReceiverNameNormalized,
      expectedReceiverNameDigest: row.expectedReceiverNameDigest,
    },
  };
}

function cli() {
  if (process.argv.length !== 4) fail();
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!isAbsolute(outputPath)) fail();
  const manifest = buildTelebirrAssignmentRuntimeManifest(guardedInput(inputPath));
  const encoded = Buffer.from(JSON.stringify(manifest), 'utf8');
  try {
    writeFileSync(outputPath, encoded, { encoding: null, flag: 'wx', mode: 0o600 });
  } finally {
    encoded.fill(0);
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  cli();
}
