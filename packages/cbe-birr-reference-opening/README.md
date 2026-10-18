# CBE Birr protected-reference opening boundary

This dormant package opens only provider-bound `v2.cbe_birr` deposit-proof envelopes. Its runtime
key is the 32-byte CBE Birr/purpose-scoped child key produced during offline provisioning. It
cannot derive another provider key and never accepts the API encryption master or fingerprint
master.

Every opening also requires a nonsecret worker profile and an independently approved v2 producer
root profile. The worker profile fixes the CBE provider, proof-opening purpose, reserved source
label, envelope/key versions, child-key ID, and both producer root identities. The module rejects
profile or key drift before the callback runs. The child-key fingerprint proves only that the
supplied child key and ID match; the caller must establish the profiles' provenance and immutability
through a separately reviewed deployment contract.

Opening is synchronous and callback-scoped. The authenticated plaintext buffer is checked against
the stored display mask and wiped when the callback returns. The callback must use the reference
only for the later, separately reviewed short-lived lookup assignment; it must not return it,
log it, persist it, place it in an error, or retain it for asynchronous work. JavaScript strings
cannot be reliably erased, so this contract relies on a trusted callback and narrow lifetime.

The package has no filesystem, environment, PostgreSQL, Supabase, HTTP, provider, settlement, or
execution surface. Key derivation, independent worker provisioning and rotation, profile-file
custody, and any runtime or lease integration remain separate prerequisites. No application imports
this package and its existence does not authorize authoritative lookup or financial action.
