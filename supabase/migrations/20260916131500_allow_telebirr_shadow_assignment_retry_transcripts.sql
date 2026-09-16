-- A payment reference is stable across assignment retries, while the assignment body, lease, and
-- signature are attempt-bound. Keep the per-attempt transcript immutable and unique, but allow a
-- later attempt to record the same reference-binding digest after an earlier delivery was lost.

begin;

alter table app.private_telebirr_shadow_assignment_transcripts
  drop constraint if exists private_telebirr_shadow_assignment_reference_binding_digest_key;

create index if not exists private_telebirr_shadow_assignment_reference_binding_digest_idx
  on app.private_telebirr_shadow_assignment_transcripts (
    reference_binding_digest,
    created_at,
    id
  );

comment on index app.private_telebirr_shadow_assignment_reference_binding_digest_idx is
  'Auditable reference-binding lookup across immutable, attempt-bound shadow assignment retries.';

commit;
