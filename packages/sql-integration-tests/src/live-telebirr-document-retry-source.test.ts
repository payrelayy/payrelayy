import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const bindingMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260918021500_scope_live_telebirr_document_retries.sql',
    import.meta.url,
  ),
);
const recoveryMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260918023000_recover_live_telebirr_document_collision.sql',
    import.meta.url,
  ),
);
const predecessorMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260917220932_fix_live_telebirr_network_retry_binding.sql',
    import.meta.url,
  ),
);
const extensionMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260918002000_extend_live_telebirr_network_binding_recovery.sql',
    import.meta.url,
  ),
);

let bindingSource = '';
let recoverySource = '';
let predecessorSource = '';
let extensionSource = '';

beforeAll(async () => {
  [bindingSource, recoverySource, predecessorSource, extensionSource] = await Promise.all([
    readFile(bindingMigrationPath, 'utf8'),
    readFile(recoveryMigrationPath, 'utf8'),
    readFile(predecessorMigrationPath, 'utf8'),
    readFile(extensionMigrationPath, 'utf8'),
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

function extractTaggedConstant(source: string, name: string, tag: 'new' | 'old'): string {
  const opening = `${name} constant text := $${tag}$`;
  const startMarker = source.indexOf(opening);
  expect(startMarker).toBeGreaterThanOrEqual(0);
  const start = startMarker + opening.length;
  const end = source.indexOf(`$${tag}$;`, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function replaceExactly(source: string, oldValue: string, newValue: string): string {
  expect(source.split(oldValue)).toHaveLength(2);
  return source.replace(oldValue, newValue);
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

describe('live TeleBirr source-document retry boundary', () => {
  it('replaces global document uniqueness with same-reference and one-settlement registries', () => {
    for (const fragment of [
      'app.private_live_telebirr_source_document_bindings',
      'app.private_live_telebirr_settlement_documents',
      'private_live_telebirr_source_document_binding_guard',
      'private_live_telebirr_settlement_document_guard',
      'binding.source_document_digest = new.source_document_digest',
      'on conflict (source_document_digest) do nothing',
      'The TeleBirr receipt document already has a settlement candidate.',
      'drop constraint private_live_telebirr_observation_tr_source_document_digest_key',
    ]) {
      expect(bindingSource).toContain(fragment);
    }
    expect(bindingSource).not.toMatch(/drop\s+constraint[\s\S]+observation_body_digest/iu);
    expect(bindingSource).not.toMatch(/drop\s+constraint[\s\S]+replay_identity/iu);
  });

  it('keeps both new registries append-only, RLS sealed, and ungranted', () => {
    for (const table of [
      'private_live_telebirr_source_document_bindings',
      'private_live_telebirr_settlement_documents',
    ]) {
      expect(bindingSource).toContain(`alter table app.${table} enable row level security`);
      expect(bindingSource).toContain(`alter table app.${table} force row level security`);
      expect(bindingSource).toContain(`app.${table}`);
    }
    expect(bindingSource).toContain('app.reject_private_live_telebirr_lineage_mutation()');
    expect(bindingSource).toContain('app.reject_private_live_telebirr_lineage_truncate()');
    expect(bindingSource).not.toMatch(/grant\s+(?:select|insert|update|delete)/iu);
  });

  it('pins and exactly patches the reviewed network-retry mutation guard', () => {
    let guardSource = extractFunctionBody(
      predecessorSource,
      'reject_private_live_telebirr_network_retry_mutation',
    );
    for (const marker of ['guard_attempt', 'guard_validation', 'guard_digest']) {
      guardSource = replaceExactly(
        guardSource,
        extractTaggedConstant(extensionSource, `old_${marker}`, 'old'),
        extractTaggedConstant(extensionSource, `new_${marker}`, 'new'),
      );
    }
    expect(sha256(guardSource)).toBe(
      '4d93dceeff811a24ca7b2efb71d8739591e9e225baf2b4a45255837c68fdbe18',
    );
    const patchedGuard = replaceExactly(
      guardSource,
      extractTaggedConstant(recoverySource, 'old_marker', 'old'),
      extractTaggedConstant(recoverySource, 'new_marker', 'new'),
    );
    expect(sha256(patchedGuard)).toBe(
      '170a1b727b58b965fe2a935c87c64aed2ff83ac527da2389b1af13597e3ff567',
    );
    expect(recoverySource).toContain(
      'ca6ef3eb6c184a3017cfaa8c38ff7a02c121de8f7b56c85a5a9c00933c09bf45',
    );
  });

  it('accepts only the exact expired four-attempt, two-evidence collision shape', () => {
    for (const fragment of [
      'attempt.verification_job_id = job.id) <> 4',
      'attempt.attempt_number between 1 and 4',
      'attempt.verification_job_id = job.id) <> 2',
      "evidence.signed_observation -> 'body' ->> 'sourceDocumentDigest'",
      'app.private_live_telebirr_source_document_bindings',
      'app.private_live_telebirr_settlement_documents',
      "'source_document_digest_collision'",
      "heartbeat.status_code = 'no_assignment'",
    ]) {
      expect(recoverySource).toContain(fragment);
    }
    expect(recoverySource).toContain('fetanagent_deposit_executor_runtime');
  });

  it('opens only a bounded job window and performs no financial or evidence insert', () => {
    const recoveryFunction = recoverySource.match(
      /create function app\.recover_private_live_telebirr_source_document_collision\([\s\S]+?\n\$\$;/u,
    )?.[0];
    expect(recoveryFunction).toBeDefined();
    expect(recoveryFunction).toContain("authorized_at + interval '5 minutes'");
    expect(recoveryFunction).toContain("recovered_expiry <= authorized_at + interval '60 seconds'");
    expect(recoveryFunction).toMatch(/update app\.private_live_telebirr_verification_jobs/iu);
    expect(recoveryFunction).not.toMatch(
      /insert\s+into\s+app\.(?:private_live_telebirr_verification_attempts|private_live_telebirr_device_evidence_staging|private_live_telebirr_observation_transcripts|private_live_telebirr_verification_outcomes|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|deposit_jobs)/iu,
    );
    expect(recoverySource).not.toMatch(/grant\s+execute/iu);
    expect(recoverySource).not.toMatch(/update\s+app\.feature_switches/iu);
  });
});
