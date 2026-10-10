import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID as ISSUER_SIGNER_KEY_ID,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI as ISSUER_SIGNER_SPKI,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256 as ISSUER_SIGNER_SPKI_SHA256,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import {
  loadWindowsCompanionConfig,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256,
  redactedWindowsCompanionConfig,
} from './config.js';

describe('Windows companion configuration', () => {
  it('pins the same public execution signer as the independent operator observer', () => {
    expect(PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID).toBe(ISSUER_SIGNER_KEY_ID);
    expect(PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI).toBe(ISSUER_SIGNER_SPKI);
    expect(PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256).toBe(
      ISSUER_SIGNER_SPKI_SHA256,
    );
  });

  it('accepts an explicit absolute data directory and redacts it from logs', () => {
    const config = loadWindowsCompanionConfig({
      NODE_ENV: 'test',
      FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
      FETANAGENT_COMPANION_RELEASE_SHA: 'a'.repeat(40),
      FETANAGENT_COMPANION_EXPECTED_AGENT_IDENTITY: 'owner-agent@example.invalid',
      FETANAGENT_COMPANION_PAIRING_PACKAGE: 'fetanagent-companion-pairing-v1.abc',
      INTERNAL_COMPANION_EXECUTION_V2_ENABLED: 'true',
      FETANAGENT_COMPANION_EXECUTION_PLATFORM_AGENT_ACCOUNT_ID:
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(config.profileRoot).toContain('profiles');
    const redacted = JSON.stringify(redactedWindowsCompanionConfig(config));
    expect(redacted).not.toContain('FetanAgent Companion Test');
    expect(redacted).not.toContain('owner-agent@example.invalid');
    expect(redacted).not.toContain('fetanagent-companion-pairing-v1.abc');
    expect(redacted).toContain('expectedAgentIdentityProvided');
    expect(redacted).toContain('pairingPackageProvided');
    expect(redacted).toContain('executionV2Enabled');
    expect(redacted).not.toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(config.executionV2Enabled).toBe(true);
    expect(config.executionV2ExpectedPlatformAgentAccountId).toBe(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(redacted).toContain('a'.repeat(40));
    expect(config.takeExpectedAgentIdentity()).toBe('owner-agent@example.invalid');
    expect(config.takeExpectedAgentIdentity()).toBeUndefined();
    expect(config.takePairingPackage()).toBe('fetanagent-companion-pairing-v1.abc');
    expect(config.takePairingPackage()).toBeUndefined();
  });

  it('enables only an explicitly account-bound routine lane', () => {
    const config = loadWindowsCompanionConfig({
      NODE_ENV: 'test',
      FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
      INTERNAL_COMPANION_ROUTINE_DEPOSITS_ENABLED: 'true',
      FETANAGENT_COMPANION_ROUTINE_PLATFORM_AGENT_ACCOUNT_ID:
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(config.routineDepositsEnabled).toBe(true);
    expect(config.routineExpectedPlatformAgentAccountId).toBe(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
    expect(config.executionV2Enabled).toBe(false);
    expect(redactedWindowsCompanionConfig(config)).toMatchObject({
      routineDepositsEnabled: true,
      routineExpectedAccountConfigured: true,
    });

    expect(() =>
      loadWindowsCompanionConfig({
        NODE_ENV: 'test',
        FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
        INTERNAL_COMPANION_ROUTINE_DEPOSITS_ENABLED: 'true',
      }),
    ).toThrow('account binding is required');
    expect(() =>
      loadWindowsCompanionConfig({
        NODE_ENV: 'test',
        FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
        INTERNAL_COMPANION_ROUTINE_DEPOSITS_ENABLED: 'true',
        FETANAGENT_COMPANION_ROUTINE_PLATFORM_AGENT_ACCOUNT_ID:
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        INTERNAL_COMPANION_EXECUTION_V2_ENABLED: 'true',
        FETANAGENT_COMPANION_EXECUTION_PLATFORM_AGENT_ACCOUNT_ID:
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).toThrow('mutually exclusive');
  });

  it('accepts only a complete, redacted no-money preflight in the protected routine lane', () => {
    const base = {
      NODE_ENV: 'test',
      FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
      INTERNAL_COMPANION_ROUTINE_DEPOSITS_ENABLED: 'true',
      FETANAGENT_COMPANION_ROUTINE_PLATFORM_AGENT_ACCOUNT_ID:
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };
    const environment = {
      ...base,
      INTERNAL_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER',
      INTERNAL_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '2500',
    };
    const config = loadWindowsCompanionConfig(environment);
    expect(config.routineNoMoneyPreflight).toEqual({
      playerId: 'SAMPLE-PLAYER',
      amountMinor: 2500,
    });
    expect(JSON.stringify(redactedWindowsCompanionConfig(config))).not.toContain('SAMPLE-PLAYER');
    expect(environment).not.toHaveProperty('INTERNAL_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID');
    expect(environment).not.toHaveProperty('INTERNAL_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR');
    for (const override of [
      { INTERNAL_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER' },
      { INTERNAL_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '2500' },
      {
        INTERNAL_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER',
        INTERNAL_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '2499',
      },
      {
        INTERNAL_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'BAD PLAYER',
        INTERNAL_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '2500',
      },
    ]) {
      expect(() => loadWindowsCompanionConfig({ ...base, ...override })).toThrow(
        'no-money routine preflight is invalid',
      );
    }
    expect(() =>
      loadWindowsCompanionConfig({
        NODE_ENV: 'test',
        FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
        INTERNAL_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER',
        INTERNAL_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '2500',
      }),
    ).toThrow('no-money routine preflight is invalid');
  });

  it('rejects relative paths, control characters, and unreviewed release identities', () => {
    for (const dataRoot of ['relative', `D:\\bad\u0000path`]) {
      expect(() =>
        loadWindowsCompanionConfig({
          NODE_ENV: 'test',
          FETANAGENT_COMPANION_DATA_ROOT: dataRoot,
        }),
      ).toThrow();
    }
    expect(() =>
      loadWindowsCompanionConfig({
        NODE_ENV: 'test',
        FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
        FETANAGENT_COMPANION_RELEASE_SHA: 'main',
      }),
    ).toThrow();
    for (const identity of ['', ' padded ', `bad\nidentity`, 'x'.repeat(257)]) {
      expect(() =>
        loadWindowsCompanionConfig({
          NODE_ENV: 'test',
          FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
          FETANAGENT_COMPANION_EXPECTED_AGENT_IDENTITY: identity,
        }),
      ).toThrow();
    }
    for (const pairingPackage of ['', ' padded ', `bad\npairing`, 'x'.repeat(8_193)]) {
      expect(() =>
        loadWindowsCompanionConfig({
          NODE_ENV: 'test',
          FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
          FETANAGENT_COMPANION_PAIRING_PACKAGE: pairingPackage,
        }),
      ).toThrow();
    }
    for (const executionFlag of ['', 'false', 'TRUE', '1']) {
      expect(() =>
        loadWindowsCompanionConfig({
          NODE_ENV: 'test',
          FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
          INTERNAL_COMPANION_EXECUTION_V2_ENABLED: executionFlag,
        }),
      ).toThrow();
    }
    for (const routineFlag of ['', 'false', 'TRUE', '1']) {
      expect(() =>
        loadWindowsCompanionConfig({
          NODE_ENV: 'test',
          FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
          INTERNAL_COMPANION_ROUTINE_DEPOSITS_ENABLED: routineFlag,
        }),
      ).toThrow();
    }
    expect(() =>
      loadWindowsCompanionConfig({
        NODE_ENV: 'test',
        FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
        INTERNAL_COMPANION_EXECUTION_V2_ENABLED: 'true',
      }),
    ).toThrow();
    expect(() =>
      loadWindowsCompanionConfig({
        NODE_ENV: 'test',
        FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
        FETANAGENT_COMPANION_EXECUTION_PLATFORM_AGENT_ACCOUNT_ID: 'not-a-uuid',
      }),
    ).toThrow();
  });
});
