import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260918002000_extend_live_telebirr_network_binding_recovery.sql',
    import.meta.url,
  ),
);
const predecessorMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260917220932_fix_live_telebirr_network_retry_binding.sql',
    import.meta.url,
  ),
);
const operationPath = fileURLToPath(
  new URL(
    '../../../infra/sql/production-live-telebirr-network-binding-recovery.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let predecessorMigrationSource = '';
let operationSource = '';

beforeAll(async () => {
  [migrationSource, predecessorMigrationSource, operationSource] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(predecessorMigrationPath, 'utf8'),
    readFile(operationPath, 'utf8'),
  ]);
});

function extractFunctionBody(source: string, functionName: string): string {
  const declarationIndex = source.indexOf(`function app.${functionName}(`);
  expect(declarationIndex).toBeGreaterThanOrEqual(0);
  const bodyStartMarker = source.indexOf('as $$', declarationIndex);
  expect(bodyStartMarker).toBeGreaterThan(declarationIndex);
  const bodyStart = bodyStartMarker + 'as $$'.length;
  const bodyEnd = source.indexOf('$$;', bodyStart);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

function extractTaggedConstant(name: string, tag: 'new' | 'old'): string {
  const opening = `${name} constant text := $${tag}$`;
  const startMarker = migrationSource.indexOf(opening);
  expect(startMarker).toBeGreaterThanOrEqual(0);
  const start = startMarker + opening.length;
  const end = migrationSource.indexOf(`$${tag}$;`, start);
  expect(end).toBeGreaterThan(start);
  return migrationSource.slice(start, end);
}

function replaceExactly(source: string, oldValue: string, newValue: string, count: number): string {
  expect(source.split(oldValue)).toHaveLength(count + 1);
  return source.replaceAll(oldValue, newValue);
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

describe('two-attempt live TeleBirr network-binding recovery extension', () => {
  it('pins the reviewed predecessor functions before extending them', () => {
    for (const digest of [
      '71fe68f4d142b8cb84fdb52f174fc2e7fc782d7d707bf01bf24778e165142651',
      '237330eccfa5dfde5dd6c26de8694d32d1fd701964eeb65d5ef1d9049d1584d6',
      'sha256:705ed0d86edb81ecfd887697abd0896c7b0e3124c4a38ffcc05b35c447b6ac95',
    ]) {
      expect(migrationSource).toContain(digest);
    }
    expect(migrationSource).toContain(
      "'app.reject_private_live_telebirr_network_retry_mutation()'",
    );
    expect(migrationSource).toContain(
      "'app.recover_private_live_telebirr_network_retry_binding(uuid,uuid,bigint,uuid,text)'",
    );
  });

  it('adds a separately domain-bound digest and postgres-only recovery function', () => {
    expect(migrationSource).toContain(
      'app.private_live_telebirr_network_binding_recovery_digest_v2(',
    );
    expect(migrationSource).toContain(
      'app.recover_private_live_telebirr_network_retry_binding_v2(',
    );
    expect(migrationSource).toContain(
      'fetanagent:telebirr:private-live-pilot:network-retry-binding-recovery-two-attempt:v1',
    );
    expect(migrationSource).toContain('|attempt_count=2');
    expect(migrationSource).toContain('|extension_migration=20260918002000');
    expect(migrationSource).toContain(
      'sha256:1c6a7cb045a7b29967e15deb7e0c39cbbb9f0e356047f992bbc36ecf63f1efb8',
    );
    expect(migrationSource).toContain("routine.proacl = array['postgres=X/postgres']::aclitem[]");
  });

  it('derives the exact catalog fingerprints pinned by the production operation', () => {
    let guardSource = extractFunctionBody(
      predecessorMigrationSource,
      'reject_private_live_telebirr_network_retry_mutation',
    );
    expect(sha256(guardSource)).toBe(
      '71fe68f4d142b8cb84fdb52f174fc2e7fc782d7d707bf01bf24778e165142651',
    );
    guardSource = replaceExactly(
      guardSource,
      extractTaggedConstant('old_guard_attempt', 'old'),
      extractTaggedConstant('new_guard_attempt', 'new'),
      1,
    );
    guardSource = replaceExactly(
      guardSource,
      extractTaggedConstant('old_guard_validation', 'old'),
      extractTaggedConstant('new_guard_validation', 'new'),
      1,
    );
    guardSource = replaceExactly(
      guardSource,
      extractTaggedConstant('old_guard_digest', 'old'),
      extractTaggedConstant('new_guard_digest', 'new'),
      1,
    );

    let recoverySource = extractFunctionBody(
      predecessorMigrationSource,
      'recover_private_live_telebirr_network_retry_binding',
    );
    expect(sha256(recoverySource)).toBe(
      '237330eccfa5dfde5dd6c26de8694d32d1fd701964eeb65d5ef1d9049d1584d6',
    );
    recoverySource = replaceExactly(
      recoverySource,
      extractTaggedConstant('old_recovery_attempt', 'old'),
      extractTaggedConstant('new_recovery_attempt', 'new'),
      1,
    );
    recoverySource = replaceExactly(
      recoverySource,
      extractTaggedConstant('old_recovery_validation', 'old'),
      extractTaggedConstant('new_recovery_validation', 'new'),
      1,
    );
    recoverySource = replaceExactly(
      recoverySource,
      'app.private_live_telebirr_network_binding_recovery_digest(',
      'app.private_live_telebirr_network_binding_recovery_digest_v2(',
      2,
    );

    const expectedFingerprints = [
      sha256(guardSource),
      sha256(
        extractFunctionBody(
          migrationSource,
          'private_live_telebirr_network_binding_recovery_digest_v2',
        ),
      ),
      sha256(recoverySource),
    ];
    expect(expectedFingerprints).toEqual([
      '4d93dceeff811a24ca7b2efb71d8739591e9e225baf2b4a45255837c68fdbe18',
      '5dc91392f85dd5d33420f64e6e0bd612f352364ec149379eedf1baa5e414ac9b',
      'dfdb229faea840e7c39e273eab6d9829b2ff5032cbe10758920ff828c184c194',
    ]);
    for (const fingerprint of expectedFingerprints) {
      expect(operationSource).toContain(fingerprint);
    }
  });

  it('accepts only two contiguous expired attempts with no downstream evidence', () => {
    for (const fragment of [
      'attempt_count <> 2',
      'attempt.attempt_number <> 2',
      'verification_attempt.attempt_number between 1 and 2',
      'verification_attempt.expires_at <= authorized_at',
      'app.private_live_telebirr_assignment_transcripts',
      'app.private_live_telebirr_assignment_deliveries',
      'app.private_live_telebirr_device_evidence_staging',
      'app.private_live_telebirr_observation_transcripts',
    ]) {
      expect(migrationSource).toContain(fragment);
    }
    expect(migrationSource).toContain("'network_retry_reference_binding_registry'");
  });

  it('keeps every runtime role outside the recovery boundary', () => {
    for (const role of [
      'fetanagent_deposit_executor_runtime',
      'fetanagent_telebirr_assignment_broker_runtime',
      'fetanagent_companion_device_bridge_runtime',
    ]) {
      expect(migrationSource).toContain(role);
    }
    expect(migrationSource).not.toMatch(/grant\s+execute/iu);
    expect(migrationSource).not.toMatch(/alter\s+role\s+fetanagent_deposit_executor/iu);
    expect(migrationSource).not.toMatch(/update\s+app\.feature_switches/iu);
  });

  it('does not create financial, evidence, outcome, reservation, or settlement rows', () => {
    expect(migrationSource).not.toMatch(/\binsert\s+into\s+app\./iu);
    expect(migrationSource).not.toMatch(/\bdelete\s+from\s+app\./iu);
    expect(migrationSource).not.toMatch(/\btruncate\s+(?:table\s+)?app\./iu);
  });
});
