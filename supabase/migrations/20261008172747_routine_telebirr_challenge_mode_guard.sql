-- A no-money phone challenge must never be relabeled as a paid challenge.
-- Challenge rows are otherwise append-only until the existing seven-day
-- candidate-retention cascade removes them. This changes no runtime grant or
-- financial switch and leaves that retention path intact.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create trigger routine_telebirr_lookup_challenge_no_update
before update on app.routine_telebirr_lookup_challenges
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();

comment on trigger routine_telebirr_lookup_challenge_no_update
  on app.routine_telebirr_lookup_challenges is
  'Prevents a historical no-money challenge from being promoted to paid or changing its signed lookup binding; candidate-retention deletes still cascade.';

commit;
