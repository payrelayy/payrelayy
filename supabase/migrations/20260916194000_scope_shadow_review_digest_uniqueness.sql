-- Review-only TeleBirr observations can legitimately share the same deterministic no-document
-- digest (for example when the phone reports network_unavailable). Preserve replay protection for
-- actual settlement-candidate receipt evidence without treating that review sentinel as a reused
-- payment. This remains an advisory shadow-only change and grants no money-movement authority.

begin;

do $migration$
declare
  source_constraint_definition text;
  evidence_constraint_definition text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into source_constraint_definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_telebirr_shadow_verification_outcomes'::regclass
     and constraint_row.conname =
         'private_telebirr_shadow_verification_source_document_digest_key';

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into evidence_constraint_definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_telebirr_shadow_verification_outcomes'::regclass
     and constraint_row.conname =
         'private_telebirr_shadow_verification_outcom_evidence_digest_key';

  if source_constraint_definition is distinct from 'UNIQUE (source_document_digest)'
    or evidence_constraint_definition is distinct from 'UNIQUE (evidence_digest)' then
    raise exception 'The TeleBirr shadow digest uniqueness contracts are not reviewed.';
  end if;
end;
$migration$;

alter table app.private_telebirr_shadow_verification_outcomes
  drop constraint private_telebirr_shadow_verification_source_document_digest_key,
  drop constraint private_telebirr_shadow_verification_outcom_evidence_digest_key;

create unique index telebirr_shadow_outcome_settlement_source_document_uidx
  on app.private_telebirr_shadow_verification_outcomes (source_document_digest)
  where disposition = 'settlement_candidate';

create unique index telebirr_shadow_outcome_settlement_evidence_uidx
  on app.private_telebirr_shadow_verification_outcomes (evidence_digest)
  where disposition = 'settlement_candidate';

comment on index app.telebirr_shadow_outcome_settlement_source_document_uidx is
  'Prevents one authoritative receipt document from becoming more than one shadow settlement candidate while permitting repeated deterministic no-document review sentinels.';

comment on index app.telebirr_shadow_outcome_settlement_evidence_uidx is
  'Prevents one authoritative receipt evidence digest from becoming more than one shadow settlement candidate while permitting repeated deterministic no-document review sentinels.';

commit;
