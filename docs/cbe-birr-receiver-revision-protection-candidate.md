# CBE Birr receiver-revision protection candidate

`packages/deposit-reference-protection/src/cbe-birr-receiver-lookup.ts` is an **offline, internal**
candidate for protecting the full CBE Birr receiving phone used by a future official receipt
lookup. It is not exported from the package entry point, imported by an application, called by
SQL, or connected to a payment switch. Its synthetic tests do not contact CBE or store an actual
phone or receipt.

The candidate requires an exact full `251` plus nine-digit receiving phone, a preassigned
canonical v4 receiver-revision UUID, and a positive PostgreSQL-sized revision version. The
encryption and fingerprint subkeys are derived for that exact revision, and the encrypted value
also authenticates both revision identifiers as AES-GCM additional data. The fingerprint is scoped
to that revision, so the same phone under a different revision is not a global correlation token.
Only the last four digits are returned for display.
The offline candidate now derives a decryption child key for one revision/version from the Owner
encryption master. Its opener accepts that child key, an exact nonsecret opening manifest, and an
independently approved identity for the Owner lookup-key profile; it never accepts the master.
It checks the child-key identity before opening and exposes the phone only inside a synchronous
trusted callback. It rejects altered revision identifiers, ciphertext, masks, versions, keys,
manifests, and legacy v1 envelopes. All errors are fixed and omit the phone and ciphertext.
JavaScript strings cannot be erased, so the trusted callback must not retain the phone. A narrow
verifier-facing package subpath exports the opener without exporting Owner key derivation.

This is deliberately **not** proof of key provenance. The pure code can check that its two
provided secrets differ, but it cannot tell whether they were freshly and independently
provisioned, whether either equals a legacy API secret, who can read them, or whether the caller
loaded the ciphertext from the Owner's immutable revision. The opening manifest and approved
root identity still need an audited, immutable delivery path. No child key has been provisioned or
mounted in a worker, and no app imports this opener. A separate default-off worker custody
candidate can read one receiver-revision child key from a guarded Linux file, require a matching
opening profile and independently supplied release pins, and reject Owner masters in its
environment. Synthetic tests exercise opening and reject stale revisions, altered keys, profile
drift, and unsafe files. No real key or approved pin is installed, and the loader is not imported
by an app. It does not prove derivation from the Owner master or active SQL-revision identity.
No existing receiver is re-encrypted or
backfilled. Existing v1 revisions remain unusable for authoritative CBE Birr lookup.

The private SQL migration `20261016232538_cbe_birr_receiver_lookup_revision_v2.sql` adds a
separate, immutable v2 lookup row and an atomic rotation function. A follow-up grant migration
gives only the Owner-control role execution access. The function requires a newly
assigned UUID/version, matching v1/v2 display masks, and all payment switches disabled. An
existing v1 account may only gain v2 material through a **new** same-account receiver revision
with reason `protection_upgrade`; it cannot be updated in place. A later migration permits that
one-time upgrade while the exact two shared TeleBirr deposit switches are live, only if CBE
verification, the private pilot, and TeleBirr's legacy verifier remain disabled and there are no
CBE deposit intents, proofs, instructions, routine candidates, or earlier v2 lookup revisions. The existing switch lock order,
Owner-only grant, same-account check, immutable revision, and idempotent replay remain in place.
Other rotations still require all payment switches disabled. The migration changes no receiver or
switch by itself. SQL can validate only envelope
shape, not cryptographic authenticity or independent key provenance. The migration does not
upgrade an existing receiver, grant a worker access, make a
provider request, enable CBE Birr, or move money.

The `cbe-birr-receiver-rotation.ts` candidate prepares the existing v1 display-protected receiver
and the revision-bound v2 lookup envelope from one exact full phone. It rejects reuse of any master
across those two domains and requires matching display masks. Its tests use synthetic phones and
keys only. A narrow package subpath now exposes this preparation to the Owner server. Syntactic key
separation still cannot establish independent provisioning or an approved key lifecycle.

The Owner configuration also has a **default-off key-loading contract** for two dedicated CBE
Birr lookup masters. When explicitly enabled, it requires distinct 64-character hex keys that
do not equal either existing Owner receiver-reference master, plus an exact version-2,
purpose-bound profile whose SHA-256 fingerprints match the loaded keys. Production accepts only
the approved private secret and profile paths. The runtime log reports configuration state, not
key material. Only the new default-off Owner API route consumes these keys; no worker or provider
request uses them. The configuration flag defaults off and is changed only as a separate deployment
decision. Matching profile fingerprints do **not** prove that the masters were independently
generated, provisioned, or stored. This code does not install real secrets or authorize a
receiving-wallet change.

The new Owner API path is registered only when
`INTERNAL_OWNER_CBE_BIRR_V2_RECEIVER_ROTATION_ENABLED=true` and the separate lookup key profile
loads successfully. It accepts only a `protection_upgrade` of the same active CBE Birr receiver,
with an exact Owner confirmation, expected next version, idempotency UUID, full `251` phone, and
the existing Owner origin and CSRF headers. The request UUID is also the new immutable revision
UUID, so a retry uses the same identity. The adapter protects both v1 display and v2 lookup
material in memory and passes only ciphertext, fingerprints, masks, and metadata to the existing
atomic SQL function. The Owner response contains no full phone, ciphertext, or fingerprint. A
guarded dashboard form is rendered only when the same default-off route flag and key profile are
enabled. It requires a successful masked receiver-history read, checks the entered phone against the
active mask, and clears the phone after a request. The SQL function remains the final same-account
guard. This dashboard change does not deploy the app, provision keys, change a receiver or switch,
make a provider request, or credit a Player.

Before any verifier runtime use, a separately reviewed change must:

1. Provision the exact active receiver revision's derived child key to a dedicated verifier, with
   an independently approved opening manifest, narrow custody, and audited rotation/recovery.
   The Owner's two lookup masters must remain outside that verifier.
2. Verify the exact Owner key profile, private mounts, and active receiver revision before
   provisioning a verifier key. The Owner-only grant and guarded form exist; the form is absent
   whenever its route flag is off. Check saved results without exposing the phone or lookup
   material; SQL envelope-shape checks alone do not prove a valid key or phone. Obtain separate
   approval before changing the active receiver revision.
3. Bind each new CBE Birr payment instruction and proof to that exact revision. A lookup must not
   substitute whichever receiver happens to be active later.
4. Add a narrow, prelease-safe worker access boundary that returns only the needed protected
   material for the bound revision, with no table-wide read or customer-facing exposure.
5. Separately resolve the remaining source, normalization, timing, duplicate, settlement, and
   operational guards before any provider request or Player credit.

The authoritative-lookup prerequisite inventory remains blocked, including receiver protection
and key provenance. A passing synthetic round trip is not a payment verification result.
