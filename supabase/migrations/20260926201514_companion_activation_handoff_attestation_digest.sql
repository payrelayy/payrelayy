-- Preserve the verified execution handoff binding in the digest-only witness.
-- The predecessor activation migration remains dormant; refuse to retrofit any
-- pre-existing witness that could not have contained this binding.
begin;

do $companion_activation_handoff_preflight$
begin
  if exists (
    select 1 from app.agent_platform_companion_execution_activation_attestations
  ) then
    raise exception 'Companion handoff attestation migration requires an empty witness table.';
  end if;
end;
$companion_activation_handoff_preflight$;

alter table app.agent_platform_companion_execution_activation_attestations
  add column execution_handoff_sha256 text not null unique
    check (execution_handoff_sha256 ~ '^sha256:[0-9a-f]{64}$');

comment on column
  app.agent_platform_companion_execution_activation_attestations.execution_handoff_sha256 is
  'Digest of the independently validated, request-bound signed execution handoff; no handoff or signature is stored.';

commit;
