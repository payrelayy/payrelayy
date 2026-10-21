-- Name signed receiver-phone SMS explicitly in immutable payment evidence.
-- PostgreSQL requires the enum value to commit before the next migration uses it.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
alter type app.provider_evidence_source add value if not exists 'receiver_sms';
commit;
