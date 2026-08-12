-- Stage 18A: reserve exactly-once Telegram consumer kinds for dry-run deposit intake.
--
-- PostgreSQL enum values must be committed before a later migration can use them safely. This
-- migration therefore contains only the two additive values. It creates no function, grant,
-- login, scheduler, verification path, provider action, or deployment activation.

alter type app.telegram_inbound_consumer_kind
  add value if not exists 'open_dry_run_deposit_intent';

alter type app.telegram_inbound_consumer_kind
  add value if not exists 'capture_dry_run_deposit_reference';
