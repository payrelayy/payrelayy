# FetanAgent TeleBirr device bridge

This package is the executable, evidence-only internal HTTP bridge for the dedicated Ethiopian
Android verifier. It defines and enforces the authenticated device transport boundary without
reading PostgreSQL, holding a database credential, or enabling money. Its fixed
`0.0.0.0:8084` listener is for a private Docker network only; the image deliberately declares no
exposed port and requires a separately reviewed HTTPS gateway for Internet ingress.

The four exact version-1 routes are:

- `POST /v1/telebirr/device/enrollments:pair`
- `POST /v1/telebirr/device/assignments:poll`
- `POST /v1/telebirr/device/heartbeat`
- `POST /v1/telebirr/device/observations:upload`

Every route requires the exact vendor content type and an uncompressed bounded UTF-8 JSON body.
Duplicate `Content-Type`, content encoding, query-bearing paths, extra JSON keys, malformed public
keys, wrong command paths, altered payloads, and capability escalation fail closed.

Enrollment is a one-use Owner-created challenge. The phone self-signs its pairing request with the
P-256 key generated in Android Keystore. The bridge atomically claims the exact signed request,
signs the certificate, and completes the claim before replying. If that reply is lost, an exact
retry receives the original signed certificate—even after the short pairing-request window has
closed, provided the certificate itself is still active. A different request cannot consume or
recover that claim. The certificate binds the device/key to one pilot revision, receiver
revision/profile, receiver configuration digest, app floor, and assignment signer. Only public keys
cross this boundary.

Commands are short-lived and device-signed. The request signature binds the exact command, path,
typed payload digest, enrollment, nonce, and validity window. Short request expiry prevents a stale
captured request from authorizing a later provider lookup; it is not a calendar shutdown and does
not stop the product on a fixed date. Enrollment remains explicitly revocable.

The pairing and command replay dependencies are intentionally atomic. A first request claims its
replay identity; after signing or dispatch the bridge stores the exact signed response. An exact
retry after an uncertain network response gets the original certificate or acknowledgement and
does not consume another pairing challenge, dispatch a second assignment poll, or stage evidence a
second time. In-progress duplicates receive a non-sensitive retry response. An uncertain pairing
completion is never released because it may already have committed; a later exact retry resolves
that state safely.

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

The nine durable device-state dependencies now have a separate canonical local adapter over
`/run/fetanagent-telebirr-device-state/state.sock`. Pairing claim/complete/release, enrollment load,
command replay claim/complete/release, heartbeat recording, and evidence staging each use a
distinct fixed path in one closed protocol. Opaque public IDs are rejected before PostgreSQL UUID
casts; request, payload, certificate, assignment, receiver, and signer bindings are rechecked at
the local boundary. The client accepts no host, URL, TCP port, credential, SQL, or generic RPC
method and reduces every transport detail to one non-sensitive local-unavailable error.

## Runtime boundary and remaining composition

The package now has a fail-closed executable lifecycle and a dedicated non-root container target.
Startup is disabled by default. Enabled startup requires production Node mode,
`FINANCIAL_ACTIONS_MODE=dry_run`, the internal bridge gate, the bridge-specific no-money gate, and
the staging target. It imports neither `pg` nor a Supabase client and accepts no `service_role`,
database password, wallet, settlement, or executor dependency.

Before it opens the internal listener, the lifecycle verifies both fixed local broker directories
are owned by its non-root UID at mode `0700` and both Unix sockets are owned by that UID at mode
`0600`. Symlinks, path substitution, inode replacement, a missing broker, root execution, or a
non-Linux runtime fail closed. The same checks run after listening and during readiness. The bridge
container shares UID/GID `10001:10001` with the two private broker containers so the mode-`0600`
sockets need no broader group or world permissions.

The P-256 server signer is loaded only from the fixed guarded secret file
`/run/secrets/telebirr_device_bridge_server_signer.pkcs8.der`. The assignment public key and
canonical runtime manifest are loaded from fixed read-only files under `/run/configs`; their SPKI
digests and signer key ID must cross-bind exactly. The image contains no key. Every proxy
environment variable is empty and non-empty proxy configuration is rejected.

The dormant Supabase migration
`20260904013000_private_telebirr_device_state_runtime.sql` now provides the reviewed durable database
surface for one-use Owner pairing, exact certificate and command replay, redacted heartbeat health,
and append-only evidence staging. It stores only the pairing nonce digest and gives its unconfigured
NOLOGIN runtime no table, settlement, execution, or money authority. Operational composition remains
blocked until:

- an isolated verifier consumer for staged evidence that independently revalidates both signatures
  before invoking the existing trusted-verifier completion boundary;
- the implemented bridge, assignment broker, and device-state broker images are deployed on one
  private network with only their scoped guarded files and shared socket volumes;
- separately provisioned scoped opening/signing keys are mounted only into the assignment broker;
  and
- immutable HTTPS origin, DNS/TLS/firewall, key rotation, metrics, and deployment manifests.

The existing protected-reference package deliberately has no general decrypt API. This bridge
therefore does not fake one, reuse an API encryption master as a device key, or send protected
database material to Android. `pollAssignment` and all durable device-state operations stay
dependency-injected; the two fixed Unix-socket adapters and executable lifecycle are the reviewed
production candidates once the isolated runtime composition is provisioned.

## Verification

The package tests cover valid pairing, certificate issuance, lost pairing responses, uncertain
pairing completion, in-progress pairing, signer failure, signed polling, exact cached command
replay, payload alteration, duplicate headers, content encoding, query paths, wrong receiver
bindings, wrong assignment signer material, exact local broker request mapping, transport
fail-closed behavior, all nine device-state mappings, operation/path confusion, guarded key-file
attacks, private-socket ownership and replacement, lifecycle cleanup, real network framing, and the
absence of database/Supabase/settlement runtime imports. The image smoke gate independently builds
the bridge target, verifies the non-root/no-exposed-port/no-proxy boundary, checks both private
socket directories, and runs the real entrypoint without credentials to prove redacted fail-closed
startup. The shared protocol package adds canonical local broker codecs, hostile accessor/proxy
checks, per-operation byte ceilings, and stable TypeScript/Android canonical vectors.
