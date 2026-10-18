-- The Owner runtime may call the existing same-receiver v2 protection-upgrade function.
-- The application route is separately default-off; this grant cannot bypass the SQL Owner,
-- stopped-payment-switch, active-provider, idempotency, or immutable-revision checks.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

grant execute on function app.rotate_owner_cbe_birr_receiver_lookup_v2(
  uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text
) to fetanagent_owner_control;

comment on function app.rotate_owner_cbe_birr_receiver_lookup_v2(
  uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text
) is
  'Owner-only immutable CBE Birr v2 receiver protection rotation. The application route is default-off; SQL requires all payment switches disabled. No lookup, payment, or credit authority.';

commit;
