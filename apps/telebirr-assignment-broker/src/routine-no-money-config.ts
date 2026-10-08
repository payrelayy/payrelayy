import { createHash, createPrivateKey, createPublicKey, sign as signSignature } from 'node:crypto';
import { isProxy } from 'node:util/types';

import type { TelebirrScopedReferenceOpeningKey } from '@fetanagent/telebirr-reference-opening';

import {
  guardedCa,
  openingKeyFrom,
  readGuardedBytes,
  readGuardedText,
  type TelebirrAssignmentBrokerConfigDependencies,
} from './telebirr-assignment-broker-config.js';
import type { RoutineNoMoneyConnectionConfig } from './routine-no-money-runtime.js';
import type { RoutineTelebirrAssignmentSigner } from './routine-telebirr-assignment-builder.js';

export const ROUTINE_NO_MONEY_DATABASE_URL_FILE = '/run/secrets/routine_no_money_database_url';
export const ROUTINE_NO_MONEY_REFERENCE_OPENING_KEY_FILE =
  '/run/secrets/routine_no_money_reference_opening_key.v1.json';
export const ROUTINE_NO_MONEY_SIGNER_PRIVATE_KEY_FILE =
  '/run/secrets/routine_no_money_lookup_signer.pkcs8.der';
export const ROUTINE_NO_MONEY_SIGNER_MANIFEST_FILE =
  '/run/secrets/routine_no_money_lookup_signer.v1.json';
export const ROUTINE_NO_MONEY_CA_FILE = '/run/configs/supabase_ca_certificate';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const KEY_ID = 'telebirr-routine-lookup-production-v1';
const ROLE = 'fetanagent_routine_telebirr_no_money_runtime';
const PROJECT = 'xzztugbgtulptnbpoelr';
const POOLER_HOST = 'aws-0-eu-west-1.pooler.supabase.com';
const DIRECT_HOST = `db.${PROJECT}.supabase.co`;

export interface RoutineNoMoneyConfig {
  readonly connection: RoutineNoMoneyConnectionConfig;
  readonly openingKey: TelebirrScopedReferenceOpeningKey;
  readonly signer: RoutineTelebirrAssignmentSigner;
}

export class RoutineNoMoneyConfigError extends Error {
  constructor() {
    super('The private routine no-money broker configuration is unavailable.');
    this.name = 'RoutineNoMoneyConfigError';
  }
}

function unavailable(): never {
  throw new RoutineNoMoneyConfigError();
}

function connectionFromUrl(value: string, ca: string): RoutineNoMoneyConnectionConfig {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return unavailable();
  }
  let user: string;
  let password: string;
  let database: string;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return unavailable();
  }
  const direct = url.hostname === DIRECT_HOST && user === ROLE;
  const pooled = url.hostname === POOLER_HOST && user === `${ROLE}.${PROJECT}`;
  const params = [...url.searchParams.entries()];
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    (!direct && !pooled) ||
    (url.port !== '' && url.port !== '5432') ||
    database !== 'postgres' ||
    password.length < 16 ||
    /[\r\n\0]/u.test(password) ||
    url.hash !== '' ||
    params.length !== 1 ||
    params[0]?.[0] !== 'sslmode' ||
    params[0]?.[1] !== 'verify-full'
  )
    return unavailable();
  return Object.freeze({
    target: 'production',
    host: direct ? DIRECT_HOST : POOLER_HOST,
    port: 5432,
    database: 'postgres',
    user,
    password,
    ca,
  });
}

function signerFrom(
  privateKeyBytes: Buffer,
  manifestText: string,
): RoutineTelebirrAssignmentSigner {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText) as unknown;
  } catch {
    return unavailable();
  }
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    Array.isArray(manifest) ||
    isProxy(manifest) ||
    Object.getPrototypeOf(manifest) !== Object.prototype ||
    Object.keys(manifest).join(',') !==
      [
        'contractVersion',
        'providerCode',
        'assignmentSignerId',
        'keyId',
        'publicKeySpkiSha256',
      ].join(',') ||
    JSON.stringify(manifest) !== manifestText
  )
    return unavailable();
  const value = manifest as Record<string, unknown>;
  if (
    value.contractVersion !== 1 ||
    value.providerCode !== 'telebirr' ||
    typeof value.assignmentSignerId !== 'string' ||
    !UUID.test(value.assignmentSignerId) ||
    value.keyId !== KEY_ID ||
    typeof value.publicKeySpkiSha256 !== 'string' ||
    !DIGEST.test(value.publicKeySpkiSha256)
  )
    return unavailable();
  let key;
  let canonicalPrivate: Buffer | undefined;
  let spki: Buffer | undefined;
  try {
    key = createPrivateKey({ key: privateKeyBytes, format: 'der', type: 'pkcs8' });
    canonicalPrivate = Buffer.from(key.export({ format: 'der', type: 'pkcs8' }));
    spki = Buffer.from(createPublicKey(key).export({ format: 'der', type: 'spki' }));
    if (
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !canonicalPrivate.equals(privateKeyBytes) ||
      spki.byteLength !== 91 ||
      `sha256:${createHash('sha256').update(spki).digest('hex')}` !== value.publicKeySpkiSha256
    ) {
      return unavailable();
    }
  } catch {
    return unavailable();
  } finally {
    canonicalPrivate?.fill(0);
  }
  const publicKeySpkiDer = Uint8Array.from(spki);
  spki.fill(0);
  return Object.freeze({
    assignmentSignerId: value.assignmentSignerId,
    keyId: KEY_ID,
    publicKeySpkiDer,
    async signP1363(transcript: Uint8Array): Promise<string> {
      let signature: Buffer | undefined;
      try {
        if (
          !(transcript instanceof Uint8Array) ||
          isProxy(transcript) ||
          transcript.byteLength < 1 ||
          transcript.byteLength > 16_384
        )
          return unavailable();
        signature = signSignature('sha256', Buffer.from(transcript), {
          key,
          dsaEncoding: 'ieee-p1363',
        });
        if (signature.byteLength !== 64) return unavailable();
        return signature.toString('base64url');
      } catch {
        return unavailable();
      } finally {
        signature?.fill(0);
      }
    },
  });
}

/** Explicit production-only configuration. Absence of the flag never opens a credential file. */
export function loadRoutineNoMoneyConfig(
  environment: NodeJS.ProcessEnv,
  dependencies: TelebirrAssignmentBrokerConfigDependencies = {},
): RoutineNoMoneyConfig | undefined {
  const flag = environment.INTERNAL_ROUTINE_NO_MONEY_BROKER_ENABLED;
  if (flag === undefined || flag === 'false') return undefined;
  if (
    flag !== 'true' ||
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    environment.TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET !== 'production' ||
    environment.TELEBIRR_ASSIGNMENT_BROKER_ENROLLMENT_ONLY_ENABLED !== 'true' ||
    environment.NODE_EXTRA_CA_CERTS !== undefined ||
    environment.ROUTINE_NO_MONEY_DATABASE_URL_FILE !== ROUTINE_NO_MONEY_DATABASE_URL_FILE ||
    environment.ROUTINE_NO_MONEY_REFERENCE_OPENING_KEY_FILE !==
      ROUTINE_NO_MONEY_REFERENCE_OPENING_KEY_FILE ||
    environment.ROUTINE_NO_MONEY_SIGNER_PRIVATE_KEY_FILE !==
      ROUTINE_NO_MONEY_SIGNER_PRIVATE_KEY_FILE ||
    environment.ROUTINE_NO_MONEY_SIGNER_MANIFEST_FILE !== ROUTINE_NO_MONEY_SIGNER_MANIFEST_FILE ||
    [
      'ROUTINE_NO_MONEY_DATABASE_URL',
      'ROUTINE_NO_MONEY_REFERENCE_OPENING_KEY',
      'ROUTINE_NO_MONEY_SIGNER_PRIVATE_KEY',
    ].some((name) => environment[name] !== undefined)
  ) {
    return unavailable();
  }
  let privateKeyBytes: Buffer | undefined;
  try {
    const ca = guardedCa(readGuardedText(ROUTINE_NO_MONEY_CA_FILE, dependencies, 'public_config'));
    const connection = connectionFromUrl(
      readGuardedText(ROUTINE_NO_MONEY_DATABASE_URL_FILE, dependencies, 'secret').trim(),
      ca,
    );
    const openingKey = openingKeyFrom(
      readGuardedText(ROUTINE_NO_MONEY_REFERENCE_OPENING_KEY_FILE, dependencies, 'secret'),
    );
    privateKeyBytes = readGuardedBytes(
      ROUTINE_NO_MONEY_SIGNER_PRIVATE_KEY_FILE,
      dependencies,
      'secret',
    );
    const signer = signerFrom(
      privateKeyBytes,
      readGuardedText(ROUTINE_NO_MONEY_SIGNER_MANIFEST_FILE, dependencies, 'secret'),
    );
    return Object.freeze({ connection, openingKey, signer });
  } catch {
    return unavailable();
  } finally {
    privateKeyBytes?.fill(0);
  }
}
