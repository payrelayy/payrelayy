import { createHash, createHmac } from 'node:crypto';
import { constants } from 'node:fs';

import {
  type CbeBirrApprovedProofRootProfile,
  type CbeBirrReferenceOpeningProfile,
  type CbeBirrScopedReferenceOpeningKey,
} from '@fetanagent/cbe-birr-reference-opening';
import { describe, expect, it, vi } from 'vitest';

import {
  CBE_BIRR_WORKER_OPENING_KEY_FILE,
  CBE_BIRR_WORKER_OPENING_PROFILE_FILE,
  CBE_BIRR_WORKER_PRODUCER_ROOT_PROFILE_FILE,
  CbeBirrWorkerKeyCustodyError,
  loadCbeBirrWorkerKeyCustody,
  redactedCbeBirrWorkerKeyCustodyForLog,
  type CbeBirrApprovedReleasePins,
  type CbeBirrGuardedFileStat,
  type CbeBirrWorkerKeyCustodyDependencies,
} from './index.js';

type FileValues = Record<string, Buffer>;

const enabledEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'dry_run',
  INTERNAL_CBE_BIRR_WORKER_KEY_CUSTODY_CANDIDATE_ENABLED: 'true',
  CBE_BIRR_WORKER_DEPLOYMENT_TARGET: 'staging',
  CBE_BIRR_WORKER_OPENING_KEY_FILE,
  CBE_BIRR_WORKER_OPENING_PROFILE_FILE,
  CBE_BIRR_WORKER_PRODUCER_ROOT_PROFILE_FILE,
};

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function syntheticFixture(): {
  readonly key: CbeBirrScopedReferenceOpeningKey;
  readonly pins: CbeBirrApprovedReleasePins;
  readonly profile: CbeBirrReferenceOpeningProfile;
  readonly root: CbeBirrApprovedProofRootProfile;
  readonly values: FileValues;
} {
  const master = Buffer.alloc(32, 0xa1);
  const child = createHmac('sha256', master)
    .update('fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:cbe_birr', 'utf8')
    .digest();
  const root: CbeBirrApprovedProofRootProfile = {
    encryptionMasterFingerprint: sha256(master),
    fingerprintMasterFingerprint: sha256(Buffer.alloc(32, 0xb2)),
    version: 2,
  };
  const key: CbeBirrScopedReferenceOpeningKey = {
    contractVersion: 1,
    providerCode: 'cbe_birr',
    purpose: 'deposit-proof-reference-opening',
    keyVersion: 2,
    keyId: sha256(child),
    keyHex: child.toString('hex'),
  };
  const profile: CbeBirrReferenceOpeningProfile = {
    version: 1,
    providerCode: 'cbe_birr',
    purpose: 'deposit-proof-reference-opening',
    sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
    ciphertextProfileVersion: 2,
    encryptionKeyVersion: 2,
    keyId: key.keyId,
    rootEncryptionMasterFingerprint: root.encryptionMasterFingerprint,
    rootFingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
  };
  const values: FileValues = {
    [CBE_BIRR_WORKER_OPENING_KEY_FILE]: jsonBytes(key),
    [CBE_BIRR_WORKER_OPENING_PROFILE_FILE]: jsonBytes(profile),
    [CBE_BIRR_WORKER_PRODUCER_ROOT_PROFILE_FILE]: jsonBytes(root),
  };
  const pins: CbeBirrApprovedReleasePins = {
    deploymentTarget: 'staging',
    rootProfileSha256: sha256(values[CBE_BIRR_WORKER_PRODUCER_ROOT_PROFILE_FILE]!),
    workerProfileSha256: sha256(values[CBE_BIRR_WORKER_OPENING_PROFILE_FILE]!),
    workerKeyId: key.keyId,
  };
  master.fill(0);
  child.fill(0);
  return { key, pins, profile, root, values };
}

interface FileOverrides {
  readonly before?: Partial<CbeBirrGuardedFileStat>;
  readonly opened?: Partial<CbeBirrGuardedFileStat>;
  readonly after?: Partial<CbeBirrGuardedFileStat>;
  readonly realpath?: string;
  readonly readBytes?: Buffer;
  readonly closeFails?: boolean;
}

function guardedDependencies(
  values: FileValues,
  target: string = CBE_BIRR_WORKER_OPENING_KEY_FILE,
  overrides: FileOverrides = {},
): CbeBirrWorkerKeyCustodyDependencies & {
  readonly fileSystem: NonNullable<CbeBirrWorkerKeyCustodyDependencies['fileSystem']>;
  readonly returnedBuffers: Buffer[];
  readonly closeHandles: ReturnType<typeof vi.fn>[];
  readonly readPaths: string[];
} {
  const statFor = (
    path: string,
    override: Partial<CbeBirrGuardedFileStat> = {},
  ): CbeBirrGuardedFileStat => ({
    dev: 7,
    ino: path.length,
    mode: path === CBE_BIRR_WORKER_OPENING_KEY_FILE ? 0o100400 : 0o100444,
    mtimeMs: 1_700_000_000_000,
    nlink: 1,
    size: values[path]!.byteLength,
    uid: 10_001,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...override,
  });
  const returnedBuffers: Buffer[] = [];
  const closeHandles: ReturnType<typeof vi.fn>[] = [];
  const readPaths: string[] = [];
  const fileSystem = {
    noFollowFlag: 0o400000,
    lstat: vi.fn((path: string) => {
      readPaths.push(path);
      return statFor(path, path === target ? overrides.before : {});
    }),
    realpath: vi.fn((path: string) =>
      path === target && overrides.realpath !== undefined ? overrides.realpath : path,
    ),
    open: vi.fn((path: string, _flags: number) => {
      let statCalls = 0;
      const close = vi.fn(() => {
        if (path === target && overrides.closeFails) throw new Error('synthetic close failure');
      });
      closeHandles.push(close);
      return {
        close,
        read: vi.fn(() => {
          const bytes = Buffer.from(
            path === target && overrides.readBytes ? overrides.readBytes : values[path]!,
          );
          returnedBuffers.push(bytes);
          return bytes;
        }),
        stat: vi.fn(() => {
          statCalls += 1;
          return statFor(
            path,
            path === target ? (statCalls === 1 ? overrides.opened : overrides.after) : {},
          );
        }),
      };
    }),
  };
  return {
    effectiveUserId: 10_001,
    fileSystem,
    platform: 'linux',
    returnedBuffers,
    closeHandles,
    readPaths,
  };
}

function expectUnavailable(run: () => unknown): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CbeBirrWorkerKeyCustodyError);
  expect((thrown as Error).message).toBe('CBE Birr worker key custody is unavailable.');
}

describe('dormant CBE Birr worker key custody candidate', () => {
  it('is disabled by default and performs no file read', () => {
    const fixture = syntheticFixture();
    const dependencies = guardedDependencies(fixture.values);
    const config = loadCbeBirrWorkerKeyCustody({}, undefined, dependencies);
    expect(config).toEqual({ enabled: false });
    expect(Object.isFrozen(config)).toBe(true);
    expect(redactedCbeBirrWorkerKeyCustodyForLog(config)).toEqual({ enabled: false });
    expect(dependencies.fileSystem.lstat).not.toHaveBeenCalled();
  });

  it('loads only the three guarded paths with an independent release pin and redacts the key', () => {
    const fixture = syntheticFixture();
    const dependencies = guardedDependencies(fixture.values);
    const config = loadCbeBirrWorkerKeyCustody(enabledEnvironment, fixture.pins, dependencies);
    expect(config).toEqual({
      enabled: true,
      deploymentTarget: 'staging',
      key: fixture.key,
      workerProfile: fixture.profile,
      approvedRootProfile: fixture.root,
    });
    expect(Object.isFrozen(config)).toBe(true);
    if (!config.enabled) throw new Error('expected synthetic enabled config');
    expect(Object.isFrozen(config.key)).toBe(true);
    expect(Object.isFrozen(config.workerProfile)).toBe(true);
    expect(Object.isFrozen(config.approvedRootProfile)).toBe(true);
    expect(dependencies.readPaths).toEqual([
      CBE_BIRR_WORKER_PRODUCER_ROOT_PROFILE_FILE,
      CBE_BIRR_WORKER_OPENING_KEY_FILE,
      CBE_BIRR_WORKER_OPENING_PROFILE_FILE,
    ]);
    for (const path of Object.keys(fixture.values)) {
      expect(dependencies.fileSystem.open).toHaveBeenCalledWith(
        path,
        constants.O_RDONLY | 0o400000,
      );
    }
    expect(dependencies.closeHandles).toHaveLength(3);
    expect(dependencies.closeHandles.every((close) => close.mock.calls.length === 1)).toBe(true);
    expect(dependencies.returnedBuffers).toHaveLength(3);
    expect(dependencies.returnedBuffers.every((bytes) => bytes.every((value) => value === 0))).toBe(
      true,
    );
    const redacted = redactedCbeBirrWorkerKeyCustodyForLog(config);
    expect(redacted).toEqual({
      enabled: true,
      deploymentTarget: 'staging',
      keyId: fixture.key.keyId,
      rootProfileVersion: 2,
      workerProfileVersion: 1,
    });
    expect(JSON.stringify(redacted)).not.toContain(fixture.key.keyHex);
  });

  it.each([
    { NODE_ENV: 'development' },
    { FINANCIAL_ACTIONS_MODE: 'live' },
    { CBE_BIRR_WORKER_OPENING_KEY_FILE: '/tmp/key.json' },
    { CBE_BIRR_WORKER_OPENING_PROFILE_FILE: '/tmp/profile.json' },
    { CBE_BIRR_WORKER_PRODUCER_ROOT_PROFILE_FILE: '/tmp/root.json' },
    { CBE_BIRR_WORKER_DEPLOYMENT_TARGET: 'production' },
    { CBE_BIRR_WORKER_OPENING_KEY: 'inline-secret' },
    { DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE: '/tmp/master' },
    { DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET: 'inline-secret' },
  ])('rejects an unsafe enabled environment %# before reading', (override) => {
    const fixture = syntheticFixture();
    const dependencies = guardedDependencies(fixture.values);
    expectUnavailable(() =>
      loadCbeBirrWorkerKeyCustody(
        { ...enabledEnvironment, ...override },
        fixture.pins,
        dependencies,
      ),
    );
    expect(dependencies.fileSystem.lstat).not.toHaveBeenCalled();
  });

  it('requires external pins and rejects drift in either profile digest or key ID', () => {
    const fixture = syntheticFixture();
    const dependencies = guardedDependencies(fixture.values);
    expectUnavailable(() =>
      loadCbeBirrWorkerKeyCustody(enabledEnvironment, undefined, dependencies),
    );
    expect(dependencies.fileSystem.lstat).not.toHaveBeenCalled();
    for (const pins of [
      { ...fixture.pins, rootProfileSha256: `sha256:${'c'.repeat(64)}` },
      { ...fixture.pins, workerProfileSha256: `sha256:${'c'.repeat(64)}` },
      { ...fixture.pins, workerKeyId: `sha256:${'c'.repeat(64)}` },
    ]) {
      expectUnavailable(() =>
        loadCbeBirrWorkerKeyCustody(enabledEnvironment, pins, guardedDependencies(fixture.values)),
      );
    }
  });

  it('rejects self-consistent profile changes even when a caller updates its file digest', () => {
    const fixture = syntheticFixture();
    fixture.values[CBE_BIRR_WORKER_OPENING_PROFILE_FILE] = jsonBytes({
      ...fixture.profile,
      rootEncryptionMasterFingerprint: `sha256:${'c'.repeat(64)}`,
    });
    const pins = {
      ...fixture.pins,
      workerProfileSha256: sha256(fixture.values[CBE_BIRR_WORKER_OPENING_PROFILE_FILE]!),
    };
    expectUnavailable(() =>
      loadCbeBirrWorkerKeyCustody(enabledEnvironment, pins, guardedDependencies(fixture.values)),
    );
  });

  it('rejects key metadata drift and a false self-fingerprint', () => {
    for (const keyChange of [
      { providerCode: 'telebirr' },
      { keyId: `sha256:${'c'.repeat(64)}` },
      { keyHex: 'd'.repeat(64) },
    ]) {
      const fixture = syntheticFixture();
      fixture.values[CBE_BIRR_WORKER_OPENING_KEY_FILE] = jsonBytes({
        ...fixture.key,
        ...keyChange,
      });
      expectUnavailable(() =>
        loadCbeBirrWorkerKeyCustody(
          enabledEnvironment,
          fixture.pins,
          guardedDependencies(fixture.values),
        ),
      );
    }
  });

  it.each([
    { before: { isSymbolicLink: () => true } },
    { before: { nlink: 2 } },
    { before: { mode: 0o100440 } },
    { before: { uid: 20_000 } },
    { before: { size: 4097 } },
    { opened: { ino: 100 } },
    { after: { mtimeMs: 1_700_000_000_001 } },
    { realpath: '/tmp/other-key.json' },
    { readBytes: Buffer.from('{}') },
    { closeFails: true },
  ])('fails closed on unsafe or changed guarded files %#', (overrides) => {
    const fixture = syntheticFixture();
    const dependencies = guardedDependencies(
      fixture.values,
      CBE_BIRR_WORKER_OPENING_KEY_FILE,
      overrides,
    );
    expectUnavailable(() =>
      loadCbeBirrWorkerKeyCustody(enabledEnvironment, fixture.pins, dependencies),
    );
    expect(dependencies.returnedBuffers.every((bytes) => bytes.every((value) => value === 0))).toBe(
      true,
    );
    expect(dependencies.closeHandles.every((close) => close.mock.calls.length === 1)).toBe(true);
  });

  it('rejects a writable profile and an unavailable no-follow flag', () => {
    const fixture = syntheticFixture();
    const profileDependencies = guardedDependencies(
      fixture.values,
      CBE_BIRR_WORKER_OPENING_PROFILE_FILE,
      { before: { mode: 0o100644 } },
    );
    expectUnavailable(() =>
      loadCbeBirrWorkerKeyCustody(enabledEnvironment, fixture.pins, profileDependencies),
    );
    const flagDependencies = guardedDependencies(fixture.values);
    expectUnavailable(() =>
      loadCbeBirrWorkerKeyCustody(enabledEnvironment, fixture.pins, {
        ...flagDependencies,
        fileSystem: { ...flagDependencies.fileSystem, noFollowFlag: undefined },
      }),
    );
  });

  it('rejects non-Linux or root execution before reading', () => {
    const fixture = syntheticFixture();
    for (const dependencyChange of [{ platform: 'win32' as const }, { effectiveUserId: 0 }]) {
      const dependencies = guardedDependencies(fixture.values);
      expectUnavailable(() =>
        loadCbeBirrWorkerKeyCustody(enabledEnvironment, fixture.pins, {
          ...dependencies,
          ...dependencyChange,
        }),
      );
      expect(dependencies.fileSystem.lstat).not.toHaveBeenCalled();
    }
  });

  it.each([Buffer.from([0xc3, 0x28]), Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])])(
    'rejects malformed UTF-8 and a UTF-8 BOM in the secret file %#',
    (bytes) => {
      const fixture = syntheticFixture();
      fixture.values[CBE_BIRR_WORKER_OPENING_KEY_FILE] = bytes;
      const dependencies = guardedDependencies(fixture.values);
      expectUnavailable(() =>
        loadCbeBirrWorkerKeyCustody(enabledEnvironment, fixture.pins, dependencies),
      );
      expect(
        dependencies.returnedBuffers.every((buffer) => buffer.every((value) => value === 0)),
      ).toBe(true);
    },
  );
});
