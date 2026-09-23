import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260923164500_retry_one_reviewed_receipt_transport_diagnostic.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let sourceValidator = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  sourceValidator =
    migrationSource.match(
      /create function app\.private_telebirr_receipt_transport_diagnostic_source_is_valid\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  expect(sourceValidator).not.toBe('');
});

describe('one reviewed receipt transport diagnostic child', () => {
  it('caps lineage at the first network child', () => {
    expect(sourceValidator).toContain(
      'private_telebirr_receipt_shape_network_source_is_valid(parent.id)',
    );
    expect(sourceValidator).toContain('proof.source_unavailable_retry_source_id = parent.id');
    expect(sourceValidator).toContain('proof.source_binding_layout_retry_source_id is null');
    expect(migrationSource).toContain(
      'not app.private_telebirr_receipt_transport_diagnostic_source_is_valid(',
    );
  });

  it('binds immutable retry, reference, outcome, and terminal signed observation', () => {
    expect(sourceValidator).toContain('retry.retry_request_digest =');
    expect(sourceValidator).toContain('private_telebirr_shadow_source_unavailable_retry_digest');
    expect(sourceValidator).toContain(
      'proof.candidate_reference_fingerprint = parent.candidate_reference_fingerprint',
    );
    expect(sourceValidator).toContain("outcome.reason_code = 'source_unavailable'");
    expect(sourceValidator).toContain('observation.observation_body_digest');
    expect(sourceValidator).toContain("= 'network_unavailable'");
    expect(sourceValidator).toContain('private_telebirr_shadow_evidence_quarantine');
  });

  it('permits only the two reviewed no-money reasons in earlier signed attempts', () => {
    expect(sourceValidator).toContain('observation.review_reason is null');
    expect(sourceValidator).toContain("'network_unavailable', 'unknown_layout_invoice_number'");
    expect(sourceValidator).toContain('observation.principal_amount_minor is not null');
    expect(sourceValidator).toContain('observation.occurred_at is not null');
    expect(sourceValidator).toContain('observation.receiver_identity_digest is not null');
  });

  it('preserves the exact existing function authority and never creates a financial row', () => {
    expect(migrationSource).toContain('routine.proacl is not distinct from original_acl');
    expect(migrationSource).toContain('routine.proconfig is not distinct from original_config');
    expect(migrationSource).toContain('routine.prosecdef = original_security_definer');
    expect(migrationSource).not.toMatch(/grant execute|update app\.feature_switches/iu);
    expect(migrationSource).not.toMatch(/(?:insert|update|delete)\s+(?:into\s+|from\s+)?app\./iu);
  });
});
