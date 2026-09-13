-- Cover every non-unique activation-receipt foreign key identified by the Supabase advisor.
-- This migration is metadata-only and neither invokes activation nor changes runtime state.

begin;

create index private_tt_activation_requests_companion_assignment_idx
  on app.private_trusted_telebirr_activation_requests (companion_assignment_id);

create index private_tt_activation_requests_receiver_profile_idx
  on app.private_trusted_telebirr_activation_requests (receiver_profile_id);

create index private_tt_activation_requests_admin_idx
  on app.private_trusted_telebirr_activation_requests (requested_by_admin_id);

commit;
