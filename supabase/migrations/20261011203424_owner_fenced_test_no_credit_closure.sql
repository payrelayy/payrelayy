-- Reserve a distinct terminal disposition for an Owner-funded, fenced test.
-- The next migration installs its guarded transition and closure receipt after
-- this enum change has committed. This does not close any existing payment.
alter type app.deposit_execution_attempt_status
  add value if not exists 'owner_test_closed_uncredited';
