# Windows-to-server transport preview

This is one connection test before another paid test. It needs no pilot, phone
pairing, execution request, Owner approval, database login, or new SSH identity.
It does not start the companion's one-job operator.

The temporary server answers one nonce-bound POST on `127.0.0.1:743` and closes.
It also closes after 90 seconds if no valid request arrives. Every production
operator RPC is unavailable: there are no database, signing, or execution
handlers. The response is diagnostic evidence, not a signed activation handoff.

The Windows client uses the existing v2 launch document's **connection fields
only**, the installed companion's Node runtime, native Windows OpenSSH, and the
same pinned host-key policy, one-port forwarding arguments, minimal environment,
10-second round-trip bound, and delayed-EOF framing as the companion. SSH stderr
is bounded and mapped to fixed categories; it is never printed. There is one SSH
spawn and no retry. A parity test prevents silent drift from the shipped flags.

## Run once

After source checks and exact merged-main checks pass:

1. Record the existing job's read-only fingerprint and confirm disabled execution,
   zero approvals/attempts/logins/sessions, no operator process, and a free port 743.
2. Hash-check the merged script staged on the host. Use the already-installed
   credential-free operator image's **Node executable directly**, not its operator
   entry point. Mount only this script read-only; supply no credentials, keys,
   database URLs, execution documents, or other mounts. Run non-root, read-only,
   with only `NET_BIND_SERVICE`, host networking, and a unique diagnostic container
   name. The script binds loopback only. Preserve the installed image and launcher.
3. Wait for `transport_preview_ready`; do not probe its one-use endpoint.
4. On Windows run the checked script with the installed Node runtime:
   `node operator-transport-preview.mjs client <existing-launch-document> <nonce>`.
   A stopped report consumes the one preview; do not retry automatically.
5. Remove only that diagnostic container. Independently confirm port 743 is free,
   the installed image/launcher unchanged, and the job fingerprint and financial
   state unchanged. Keep fixed diagnostic reports, not raw transport logs.

Generate one 32-character lowercase hexadecimal nonce for this preview. It is
non-secret diagnostic correlation material, not a credential or payment ID.
No live operator should be started while the diagnostic listener exists.

`passed` proves the Windows restricted SSH connection and HTTP framing work.
It does **not** prove paired-device bootstrap, signed activation, database session,
Owner approval, or a KemerBet deposit. Those remain separate boundaries.

Local regression tests:
`node --test infra/operations/operator-transport-preview.test.mjs`.
