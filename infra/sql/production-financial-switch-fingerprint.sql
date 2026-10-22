\set ON_ERROR_STOP on

-- Read-only fingerprint for the seven payment switches. The release workflow
-- compares this before and after deployment without exposing settings or IDs.
select pg_catalog.md5(pg_catalog.string_agg(
  feature_switch.feature_key || ':' ||
  feature_switch.mode::text || ':' ||
  feature_switch.settings::text || ':' ||
  feature_switch.updated_at::text,
  E'\n' order by feature_switch.feature_key
)) as financial_switch_fingerprint
from app.feature_switches feature_switch
where feature_switch.feature_key in (
  'cbe_birr_authoritative_verification',
  'deposit_execution',
  'payment_verification',
  'private_live_deposit_pilot',
  'telebirr_authoritative_verification',
  'withdrawal_collection',
  'withdrawal_validation'
);
