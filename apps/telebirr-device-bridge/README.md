# FetanAgent TeleBirr device bridge

This package is an export-only, evidence-only HTTP handler foundation for the dedicated Ethiopian
Android verifier. It defines and enforces the authenticated device transport boundary without
opening a port, selecting a hostname, provisioning a key, reading PostgreSQL, or enabling money.

The four exact version-1 routes are:

- `POST /v1/telebirr/device/enrollments:pair`
- `POST /v1/telebirr/device/assignments:poll`
- `POST /v1/telebirr/device/heartbeat`
- `POST /v1/telebirr/device/observations:upload`

Every route requires the exact vendor content type and an uncompressed bounded UTF-8 JSON body.
Duplicate `Content-Type`, content encoding, query-bearing paths, extra JSON keys, malformed public
keys, wrong command paths, altered payloads, and capability escalation fail closed.

Enrollment is a one-use Owner-created challenge. The phone self-signs its pairing request with the
P-256 key generated in Android Keystore. The bridge atomically consumes the challenge and returns a
server-signed certificate binding that device/key to one pilot revision, receiver revision/profile,
receiver configuration digest, app floor, and assignment signer. Only public keys cross this
boundary.

Commands are short-lived and device-signed. The request signature binds the exact command, path,
typed payload digest, enrollment, nonce, and validity window. Short request expiry prevents a stale
captured request from authorizing a later provider lookup; it is not a calendar shutdown and does
not stop the product on a fixed date. Enrollment remains explicitly revocable.

The replay dependency is intentionally atomic. A first request claims its replay identity; after
dispatch the bridge stores the exact signed response. An exact retry after an uncertain network
response gets the original acknowledgement and does not dispatch a second assignment poll or
evidence stage. In-progress duplicates receive a non-sensitive retry response.

Assignments are accepted from the injected source only after their signer key, signature, expiry,
device, pilot, and every receiver binding match the certificate. Uploads additionally verify the
device's signed observation before reaching the evidence-only sink. The sink API is named
`stageEvidenceOnly` and cannot express a claim, settlement, queue execution, wallet mutation, or
financial action.

The reviewed assignment-source adapter now maps that injected poll to one canonical local broker
request over the fixed Unix socket
`/run/fetanagent-telebirr-assignment-broker/assignment.sock`. It binds the authenticated bridge
request body digest and exact requested lease duration, accepts no URL/host/port, caps every reply,
rejects compressed, chunked, duplicate, non-canonical, or malformed responses, and converts every
transport detail into the bridge's non-sensitive `retry` outcome. The public bridge still imports no
PostgreSQL client, database credential, protected-reference key, or private broker implementation.

## Deliberately not composed

There is no executable start entrypoint and no listener. The package imports neither `pg` nor a
Supabase client and accepts no `service_role`, database password, wallet, settlement, or executor
dependency. Server and assignment private keys are injected signers; they are not present in Git.

Operational composition remains blocked until reviewed implementations exist for:

- one-use Owner pairing challenge storage and device enrollment/revocation;
- atomic replay/response storage and redacted heartbeat health;
- a least-privilege evidence staging queue for the isolated trusted verifier;
- strict file-backed broker configuration and separately provisioned scoped opening/signing keys,
  followed by process/container composition of the implemented local socket adapter; and
- immutable HTTPS origin, DNS/TLS/firewall, key rotation, metrics, and deployment manifests.

The existing protected-reference package deliberately has no general decrypt API. This bridge
therefore does not fake one, reuse an API encryption master as a device key, or send protected
database material to Android. `pollAssignment` stays dependency-injected; the fixed Unix-socket
adapter is the reviewed production candidate once the isolated broker lifecycle is provisioned.

## Verification

The package tests cover valid pairing, certificate issuance, signed polling, exact cached replay,
payload alteration, duplicate headers, content encoding, query paths, wrong receiver bindings,
wrong assignment signer material, exact local broker request mapping, transport fail-closed
behavior, and the absence of database/Supabase/settlement runtime imports. The shared protocol
package adds canonical local broker codecs, hostile accessor/proxy checks, and stable
TypeScript/Android canonical vectors.
