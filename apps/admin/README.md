# Owner/Admin control service

This package now contains the first narrow Owner-only backend operation: issue or revoke a
Telegram beta invite. It is not a general dashboard and it has no browser database grant. The
service verifies the caller's bearer token with the exact staging Supabase Auth project, derives
the Auth user ID from that verified response, and passes it to private database procedures. The
database independently requires that subject to map to the one active Owner.

The raw 32-byte invite token is generated in process, returned once in a `Cache-Control: no-store`
Telegram deep link, and discarded. PostgreSQL stores only its domain-separated SHA-256 digest;
audit metadata contains only the opaque invite ID, expiry, or allowlisted revocation reason. The
service never receives a caller-supplied admin/actor ID and never uses a Supabase service-role key.

The runtime remains disabled by default. Its staging container binds only to host loopback for an
SSH-forwarded operator session; there is no public proxy or Internet-facing Owner endpoint. A
future dashboard will remain private to the Owner and Administrators, is not a customer-facing PWA
in version 1, and will keep English-only interface and validation copy.

Do not add a locale preference or language selector to Owner/Admin accounts in version 1.
`display_name` remains identity data and may use the administrator's own language; it is not
interface copy.
