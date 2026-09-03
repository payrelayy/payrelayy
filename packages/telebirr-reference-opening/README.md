# TeleBirr protected-reference opening boundary

This package opens only the existing provider-bound `v2.telebirr` deposit-proof envelope. Its
runtime key is the 32-byte TeleBirr/purpose-scoped child key produced during offline provisioning;
it cannot derive another provider key and never accepts the API encryption master or fingerprint
master.

Opening is synchronous and callback-scoped. The plaintext buffer is validated as the exact
canonical TeleBirr reference and wiped immediately after the callback returns. Callers must use the
reference only to construct the authenticated short-lived assignment; they must not return it
directly, log it, persist it, place it in an error, or retain it in an asynchronous closure.

The package has no filesystem, environment, PostgreSQL, Supabase, HTTP, settlement, or execution
surface. Key derivation and secret-file provisioning deliberately live outside this runtime
package.
