-- Cover the two retained activation-epoch foreign keys used by pilot and Owner audits.

begin;

create index private_tt_activation_epochs_pilot_idx
  on app.private_trusted_telebirr_activation_epochs (pilot_revision_id);

create index private_tt_activation_epochs_activated_by_idx
  on app.private_trusted_telebirr_activation_epochs (activated_by_admin_id);

commit;
