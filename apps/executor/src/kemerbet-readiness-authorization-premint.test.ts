import { describe, expect, it, vi } from 'vitest';

import {
  KEMERBET_READINESS_AUTHORIZATION_PREMINT_RUNTIME_CONTRACT,
  KemerBetReadinessAuthorizationPremintUnavailableError,
  runKemerBetReadinessAuthorizationPremint,
  serializeKemerBetReadinessPremintedAuthorizations,
} from './kemerbet-readiness-authorization-premint.js';

const HMAC_KEY = Buffer.from('11'.repeat(32), 'hex');
const RUN_NONCE = Buffer.from('22'.repeat(16), 'hex');
const PLAYER_IDS = Object.freeze(['1', 'abc', 'deadbeef', 'PLAYER-DELTA', '0099']);

describe('KemerBet offline readiness authorization premint', () => {
  it('mints exactly five sequence/ID-bound token lines and never emits an ID field', () => {
    const serialized = serializeKemerBetReadinessPremintedAuthorizations({
      playerIds: PLAYER_IDS,
      signingMaterial: { hmacKey: HMAC_KEY, runNonce: RUN_NONCE },
    });
    expect(Buffer.byteLength(serialized, 'utf8')).toBe(515);
    const lines = serialized.slice(0, -1).split('\n');
    expect(lines).toHaveLength(5);
    for (const [index, line] of lines.entries()) {
      expect(line).toMatch(/^v1\.[0-9a-f]{32}\.[1-5]\.[0-9a-f]{64}$/u);
      expect(line.split('.')[2]).toBe(String(index + 1));
    }
    expect(serialized).not.toContain('PLAYER-DELTA');
    expect(serialized).not.toContain('externalId');
    expect(serialized).not.toContain('playerId');
  });

  it('runs only as 10004:10004 with no network and zeroizes both signing buffers', async () => {
    const hmacKey = Buffer.from(HMAC_KEY);
    const runNonce = Buffer.from(RUN_NONCE);
    const assertOfflineNetwork = vi.fn();
    let installed = '';
    await runKemerBetReadinessAuthorizationPremint({
      assertOfflineNetwork,
      effectiveGroupId: 10004,
      effectiveUserId: 10004,
      loadPlayerIds: async () => PLAYER_IDS,
      loadSigningMaterial: async () => ({ hmacKey, runNonce }),
      writeAuthorizations: async (serialized) => {
        installed = serialized;
      },
    });
    expect(assertOfflineNetwork).toHaveBeenCalledOnce();
    expect(Buffer.byteLength(installed, 'utf8')).toBe(515);
    expect(hmacKey.equals(Buffer.alloc(32))).toBe(true);
    expect(runNonce.equals(Buffer.alloc(16))).toBe(true);
  });

  it('rejects the wrong UID before loading any secret or cohort', async () => {
    const loadPlayerIds = vi.fn(async () => PLAYER_IDS);
    await expect(
      runKemerBetReadinessAuthorizationPremint({
        assertOfflineNetwork: vi.fn(),
        effectiveGroupId: 10004,
        effectiveUserId: 0,
        loadPlayerIds,
        loadSigningMaterial: async () => ({
          hmacKey: Buffer.from(HMAC_KEY),
          runNonce: Buffer.from(RUN_NONCE),
        }),
        writeAuthorizations: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessAuthorizationPremintUnavailableError);
    expect(loadPlayerIds).not.toHaveBeenCalled();
  });

  it('exports the offline, identifier-free runtime contract', () => {
    expect(KEMERBET_READINESS_AUTHORIZATION_PREMINT_RUNTIME_CONTRACT).toEqual({
      command: ['node', 'apps/executor/dist/kemerbet-readiness-authorization-premint.js'],
      environment: [],
      groupId: 10004,
      networkMode: 'none',
      output: {
        bytes: 515,
        file: '/run/output/authorizations',
        installingFile: '/run/output/.authorizations.installing',
        mode: 0o400,
        schema: 'five LF-terminated v1.<nonce>.<sequence>.<mac> lines; no Player IDs',
      },
      outputRoot: '/run/output',
      secretFiles: [
        '/run/secrets/kemerbet_no_transfer_readiness_player_ids',
        '/run/secrets/kemerbet_readiness_authorizer_hmac_key',
        '/run/secrets/kemerbet_readiness_authorizer_run_nonce',
      ],
      userId: 10004,
    });
  });
});
