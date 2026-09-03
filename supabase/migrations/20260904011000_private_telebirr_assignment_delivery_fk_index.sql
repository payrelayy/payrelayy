-- Cover the private assignment-delivery composite foreign key without retaining a redundant
-- single-column transcript index. The parent transcript id determines the paired attempt and
-- signature digest, while the delivery primary key already enforces one row per attempt.

begin;

alter table app.private_live_telebirr_assignment_deliveries
  drop constraint private_live_telebirr_assignment_d_assignment_transcript_id_key;

alter table app.private_live_telebirr_assignment_deliveries
  add constraint private_live_telebirr_assignment_delivery_cover_key
  unique (
    assignment_transcript_id,
    verification_attempt_id,
    assignment_signature_digest
  );

comment on constraint private_live_telebirr_assignment_delivery_cover_key
  on app.private_live_telebirr_assignment_deliveries is
  'Preserves one delivery per transcript while covering the transcript lineage foreign key.';

commit;
