import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  ACTIVATION_DIAGNOSTIC_SQL,
  activationDiagnosticReport,
  inspectOperatorActivationRequest,
  type ActivationDiagnosticInputs,
  type ActivationDiagnosticStage,
} from './activation-diagnostic.js';

const requestKey = randomUUID();
const pilot = randomUUID();
const certificate = randomUUID();
const account = randomUUID();
const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const deviceSpki = device.publicKey.export({ format: 'der', type: 'spki' });
const requested = new Date('2026-09-30T12:00:00.000Z');
const gates = [
  'database_boundary',
  'financial_state',
  'request_binding',
  'historical_window',
  'certificate_binding',
] as const;

function row(): Record<string, unknown> {
  return {
    request_key: requestKey,
    request_pilot_revision_id: pilot,
    request_activation_epoch: '1',
    request_certificate_id: certificate,
    request_account_id: account,
    companion_release_sha: 'a'.repeat(40),
    companion_archive_sha256: `sha256:${'b'.repeat(64)}`,
    companion_installation_tree_sha256: `sha256:${'c'.repeat(64)}`,
    requested_at: requested,
    request_expires_at: new Date(requested.getTime() + 600_000),
    current_pilot_revision_id: pilot,
    current_activation_epoch: '1',
    current_certificate_id: certificate,
    current_account_id: account,
    certificate_body_digest: `sha256:${'d'.repeat(64)}`,
    device_key_id: 'test-device-key-01',
    device_public_key_spki: deviceSpki.toString('base64url'),
    device_public_key_spki_sha256: `sha256:${createHash('sha256').update(deviceSpki).digest('hex')}`,
    certificate_valid_from: new Date('2026-09-30T11:00:00.000Z'),
    certificate_valid_until: new Date('2026-09-30T15:00:00.000Z'),
    ...Object.fromEntries(gates.map((gate) => [gate, true])),
  };
}

function fixture(): ActivationDiagnosticInputs {
  return {
    requestKey,
    administrator: {
      query: vi.fn(async () => ({ rows: [row()] })),
    },
    verifyPublishedRelease: vi.fn(async (request, reconstructionTime) => ({
      releaseSha: request.companionReleaseSha,
      archiveSha256: request.companionArchiveSha256,
      installationTreeSha256: request.companionInstallationTreeSha256,
      observedAt: reconstructionTime.toISOString(),
    })),
    checkExecutionSigner: vi.fn(async () => undefined),
  };
}

describe('non-executing activation reconstruction', () => {
  it('inspects an existing historical request without returning any execution evidence', async () => {
    const input = fixture();
    const report = await inspectOperatorActivationRequest(input);
    expect(report).toEqual(activationDiagnosticReport('inspected'));
    expect(report.inspectionMode).toBe('historical_reconstruction');
    expect(report.liveReadinessProven).toBe(false);
    expect(Object.isFrozen(report)).toBe(true);
    expect(input.administrator.query).toHaveBeenCalledTimes(2);
    for (const args of vi.mocked(input.administrator.query).mock.calls) {
      expect(args).toEqual([ACTIVATION_DIAGNOSTIC_SQL, [requestKey]]);
    }
    expect(input.verifyPublishedRelease).toHaveBeenCalledTimes(1);
    const [snapshot, time] = vi.mocked(input.verifyPublishedRelease).mock.calls[0]!;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(time).toEqual(requested);
    expect(input.checkExecutionSigner).toHaveBeenCalledTimes(1);
    const output = JSON.stringify(report);
    for (const privateValue of [
      requestKey,
      pilot,
      certificate,
      account,
      deviceSpki.toString('base64url'),
      'a'.repeat(40),
      `sha256:${'b'.repeat(64)}`,
    ]) {
      expect(output).not.toContain(privateValue);
    }
    expect(Object.keys(report).sort()).toEqual(
      [
        'component',
        'result',
        'stage',
        'inspectionMode',
        'liveReadinessProven',
        'requestCreated',
        'handoffSigned',
        'executionEnabled',
        'moneyMoved',
        'identifiersRedacted',
      ].sort(),
    );
  });

  it.each(['', "' OR true --", 'not-a-request', 123, [requestKey]])(
    'rejects invalid input before a database or release operation: %s',
    async (value) => {
      const input = fixture();
      const report = await inspectOperatorActivationRequest({
        ...input,
        requestKey: value as string,
      });
      expect(report.stage).toBe('input_validation');
      expect(input.administrator.query).not.toHaveBeenCalled();
      expect(input.verifyPublishedRelease).not.toHaveBeenCalled();
      expect(input.checkExecutionSigner).not.toHaveBeenCalled();
    },
  );

  it.each([[], [row(), row()], [{ ...row(), request_key: randomUUID() }]])(
    'rejects absent, ambiguous, or wrongly bound request rows',
    async (rows) => {
      const input = fixture();
      input.administrator.query = vi.fn(async () => ({ rows }));
      expect((await inspectOperatorActivationRequest(input)).stage).toBe('database_request');
      expect(input.verifyPublishedRelease).not.toHaveBeenCalled();
    },
  );

  for (const gate of gates) {
    it.each([false, null, undefined, 'true', 1])(
      `fails closed at ${gate} for %s`,
      async (value) => {
        const input = fixture();
        input.administrator.query = vi.fn(async () => ({ rows: [{ ...row(), [gate]: value }] }));
        expect((await inspectOperatorActivationRequest(input)).stage).toBe(gate);
        expect(input.verifyPublishedRelease).not.toHaveBeenCalled();
        expect(input.checkExecutionSigner).not.toHaveBeenCalled();
      },
    );
  }

  it.each([
    'requested_at',
    'request_expires_at',
    'certificate_valid_from',
    'certificate_valid_until',
  ])('reports Node/Postgres type incompatibility at snapshot_shape: %s', async (field) => {
    const input = fixture();
    input.administrator.query = vi.fn(async () => ({
      rows: [{ ...row(), [field]: requested.toISOString() }],
    }));
    expect((await inspectOperatorActivationRequest(input)).stage).toBe('snapshot_shape');
    expect(input.verifyPublishedRelease).not.toHaveBeenCalled();
  });

  it('reports a public release failure without its private exception', async () => {
    const input = fixture();
    const report = await inspectOperatorActivationRequest({
      ...input,
      verifyPublishedRelease: async () => {
        throw new Error('private-url-token');
      },
    });
    expect(report.stage).toBe('published_release');
    expect(JSON.stringify(report)).not.toContain('private-url-token');
    expect(input.checkExecutionSigner).not.toHaveBeenCalled();
  });

  it.each([
    { device_public_key_spki: 'not-a-public-key' },
    { device_public_key_spki_sha256: `sha256:${'0'.repeat(64)}` },
    { current_account_id: randomUUID() },
    { request_expires_at: new Date(requested.getTime() + 600_001) },
    { certificate_valid_until: requested },
  ])('uses the real handoff derivation validator without signing', async (change) => {
    const input = fixture();
    input.administrator.query = vi.fn(async () => ({ rows: [{ ...row(), ...change }] }));
    expect((await inspectOperatorActivationRequest(input)).stage).toBe('handoff_derivation');
    expect(input.checkExecutionSigner).not.toHaveBeenCalled();
  });

  it('rejects release attestations that do not bind the stored archive', async () => {
    const input = fixture();
    expect(
      (
        await inspectOperatorActivationRequest({
          ...input,
          verifyPublishedRelease: async (request, time) => ({
            releaseSha: request.companionReleaseSha,
            archiveSha256: `sha256:${'0'.repeat(64)}`,
            installationTreeSha256: request.companionInstallationTreeSha256,
            observedAt: time.toISOString(),
          }),
        })
      ).stage,
    ).toBe('handoff_derivation');
  });

  it('reports only the signer validation category and never signs', async () => {
    const input = fixture();
    const report = await inspectOperatorActivationRequest({
      ...input,
      checkExecutionSigner: async () => {
        throw new Error('private-signer-material');
      },
    });
    expect(report.stage).toBe('execution_signer');
    expect(report.handoffSigned).toBe(false);
    expect(JSON.stringify(report)).not.toContain('private-signer-material');
    expect(input.administrator.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    [],
    [{ ...row(), financial_state: false }],
    [{ ...row(), current_account_id: randomUUID() }],
  ])('refuses a state change during inspection', async (rows) => {
    const input = fixture();
    input.administrator.query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows });
    expect((await inspectOperatorActivationRequest(input)).stage).toBe('state_changed');
  });

  it('never echoes raw database failures or an unrecognized report category', async () => {
    const input = fixture();
    const report = await inspectOperatorActivationRequest({
      ...input,
      administrator: {
        query: async () => {
          throw new Error('password-and-private-request');
        },
      },
    });
    expect(report.stage).toBe('database_request');
    expect(JSON.stringify(report)).not.toContain('password-and-private-request');
    expect(activationDiagnosticReport('private-error' as ActivationDiagnosticStage)).toEqual(
      activationDiagnosticReport('input_validation'),
    );
  });

  it('has only an exact parameterized SELECT, with no lock, transition, OS access, or broad lookup', () => {
    expect(ACTIVATION_DIAGNOSTIC_SQL.trim()).toMatch(/^select\b/iu);
    expect(ACTIVATION_DIAGNOSTIC_SQL).toContain('where request.request_key = $1::uuid');
    expect(ACTIVATION_DIAGNOSTIC_SQL).toContain("current_setting('transaction_read_only') = 'on'");
    expect(ACTIVATION_DIAGNOSTIC_SQL).toContain("mode::text = 'disabled') = 7");
    expect(ACTIVATION_DIAGNOSTIC_SQL).not.toMatch(
      /\b(insert|update|delete|truncate|alter|create|grant|copy|call)\b/iu,
    );
    expect(ACTIVATION_DIAGNOSTIC_SQL).not.toMatch(
      /for\s+(share|update)|pg_read_file|pg_ls_dir|lo_import|pg_advisory/iu,
    );
    expect(ACTIVATION_DIAGNOSTIC_SQL).not.toContain('deposit_jobs');
  });
});
