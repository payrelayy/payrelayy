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
Opening the candidate envelope needs the encryption master but not the fingerprint master. It
rejects altered revision identifiers, ciphertext, masks, versions, keys, and legacy v1 envelopes.
All errors are fixed and omit the phone and ciphertext.

This is deliberately **not** proof of key provenance. The pure code can check that its two
provided secrets differ, but it cannot tell whether they were freshly and independently
provisioned, whether either equals a legacy API secret, who can read them, or whether the caller
loaded the ciphertext from the Owner's immutable revision. No existing receiver is re-encrypted or
backfilled. Existing v1 revisions remain unusable for authoritative CBE Birr lookup.

The private SQL migration `20261016232538_cbe_birr_receiver_lookup_revision_v2.sql` adds a
separate, immutable v2 lookup row and an atomic rotation function **not granted to any application
role yet**. It requires a newly
assigned UUID/version, matching v1/v2 display masks, and all payment switches disabled. An
existing v1 account may only gain v2 material through a **new** same-account receiver revision
with reason `protection_upgrade`; it cannot be updated in place. No application calls this function
yet, and SQL can validate only envelope shape, not cryptographic authenticity or independent key
provenance. The migration does not upgrade an existing receiver, grant a worker access, make a
provider request, enable CBE Birr, or move money.

Before any runtime use, a separately reviewed change must:

1. Provision fresh, independently managed encryption and fingerprint masters, with the worker
   receiving only the minimum decryption material and an audited rotation/recovery path.
2. Wire a reviewed Owner flow to assign the new revision UUID and version before protection and
   use the private atomic rotation function. Check the saved result without exposing the phone or
   lookup material; do not treat SQL envelope-shape checks as proof of a valid key or phone.
3. Bind each new CBE Birr payment instruction and proof to that exact revision. A lookup must not
   substitute whichever receiver happens to be active later.
4. Add a narrow, prelease-safe worker access boundary that returns only the needed protected
   material for the bound revision, with no table-wide read or customer-facing exposure.
5. Separately resolve the remaining source, normalization, timing, duplicate, settlement, and
   operational guards before any provider request or Player credit.

The authoritative-lookup prerequisite inventory remains blocked, including receiver protection
and key provenance. A passing synthetic round trip is not a payment verification result.
