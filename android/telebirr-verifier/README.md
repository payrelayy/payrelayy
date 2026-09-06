# FetanAgent TeleBirr verifier foundation

This standalone Android project is an inert, testable foundation for a future Ethiopian-network TeleBirr receipt observation relay. It preserves the version-1 `synthetic_shadow` transcript and also defines the separately domain-separated `live_private_pilot_v1` evidence protocol. It includes Android Keystore P-256 identity, a fixed official receipt route, public-IP-pinned HTTPS transport with original-host SNI and hostname verification, conservative receipt parsing, signed observations, redacted status projections, and a policy-gated one-assignment runtime coordinator.

It is intentionally **disabled and unconfigured by default**. The app now contains the jointly
versioned authenticated enrollment/assignment/heartbeat/upload client, strict JSON wire codec,
immutable `device.fetanagent.com` HTTPS exchange, bounded foreground lifecycle, persistent
notification/stop control, opt-in boot recovery, signed operational trust profile, and encrypted
one-use provisioning state. It contains no trusted production keys, pairing grant, enrollment
certificate, or open pilot. Normal debug and release builds remain inert. A separate operational
release fails at build time unless it receives both reviewed public P-256 signer files, their opaque
key IDs, an explicit `pairing_only` or `evidence_only` mode, and the separately protected Android
PKCS12 signing identity. The two server private keys are never Android build inputs.

The compatibility engine still requires an injected protected-reference binding verifier. The new
private-pilot protocol closes that contract mismatch without changing the compatibility API: a
trusted server must sign an expiring assignment that contains the exact raw lookup reference, its
provider-domain fingerprint, their canonical binding digest, the pilot revision, and the exact
receiver revision/profile/configuration digest. Android verifies that server signature before any
sensitive assignment can be opened. No trusted signer key, endpoint, or enrollment is shipped.
At the server verification boundary, those signed values must also match an independently loaded
job binding (including the provider-domain reference fingerprint and receiver configuration digest),
so an internally consistent but wrong assignment cannot be accepted by reflection.

The original TypeScript server transcript remains explicitly named `synthetic_shadow`. The new
live-pilot assignment and observation transcripts use distinct modes, signature domains, digest
domains, and cross-language canonical vectors. A payload cannot be relabeled across modes without
invalidating its signature.

The signed live-pilot assignment supplies the exact normalized expected credited-party full name to
the phone and binds it to the receiver revision/profile/configuration digest. The live parser compares
that normalized name on-device and returns only `matched`/`mismatched` plus a domain-separated name
digest. The raw receiver name and raw transaction reference are absent from the signed observation,
status projection, and `toString()` output. The synthetic parser continues to report receiver matching
as `unknown` for compatibility.

The transport does not interpret a bare HTTP `404` as proof that a transaction is absent. Until an
exact provider negative-response contract is independently attested and reviewed, a `404` is provider
uncertainty and must go to review.

The app has no database, Supabase, KemerBet, claim, settlement, enqueue, execution, or financial-action authority. A signed observation is evidence for a trusted server to assess; it cannot authorize SQL, credit a player, or move money. There are no customer-entered secrets, provider credentials, raw receipt/reference/name/URL logs, or embedded API keys.

The live-pilot coordinator now performs the safe in-process sequence: check the three explicit
runtime gates, open the device identity, obtain at most one typed assignment, authenticate its
server signature and every device/pilot/receiver binding, claim its assignment digest, construct
only the fixed official route, fetch and parse the receipt, sign the evidence, stage the exact
signed assignment/observation pair before upload, drain staged work before leasing anything new,
and reuse that same signature after an uncertain acknowledgement. A
tampered/expired/revoked assignment is rejected before provider contact. An unexpected device or
parser failure becomes review-only evidence rather than an approval assumption.

The new `device_bridge_no_money_v1` channel closes the former transport-contract gap. Android can
self-sign a one-use pairing request, authenticate a server-signed enrollment certificate, sign a
short-lived typed command, encode/decode exact duplicate-rejecting JSON, verify the server's signed
acknowledgement, poll one assignment, send redacted heartbeat state, and upload the exact staged
assignment/observation pair through injected immutable transport. TypeScript and Kotlin share fixed
canonical byte/digest vectors. No backend URL or trusted key is editable in the app UI.

Short command and assignment expiries are replay controls, not a fixed product shutdown. There is
still no global September 4 or other calendar stop in the coordinator. A healthy provisioned device
will keep receiving newly signed short-lived work until an operator gate, revocation, or pilot state
explicitly stops it.

The coordinator has no calendar shutdown date. Operational stop remains explicit, while each
assignment and enrollment still expires because stale leases must never authorize a new provider
lookup. The foreground service supplies the polling timer with state-specific bounded backoff:
idle polling grows from 10 to 60 seconds, upload recovery from 5 seconds to 5 minutes, and transient
attention from 30 seconds to 15 minutes. A production-shaped durable work store seals every
assignment state and staged observation with a non-exportable Android Keystore AES-GCM key below
the app's no-backup directory.
It atomically persists the exact original signatures across process death/reboot and retains
acknowledgement/rejection tombstones so the same assignment is not observed twice. Corruption,
unexpected files, a missing key, or a non-atomic filesystem fail closed. Android cloud backup and
device-to-device transfer are both explicitly excluded. The production coordinator will use this
implementation only after trusted enrollment is provisioned into the composition boundary.

The lifecycle and secure provisioning shell are now wired into the app, but the evidence runtime
remains **fail-closed and unprovisioned**. The enabled unprovisioned UI accepts only the canonical
short-lived package created by the authenticated Owner page. It generates the device identity in
Android Keystore, encrypts the exact signed pairing request before network use, resends that same
request after an uncertain response, verifies both build-pinned public signers, and atomically
replaces the pending record with the signed certificate. It has no editable endpoint or long-lived
shared API key. The matching Owner-side issuer is implemented as a same-origin, authenticated,
idempotent no-money operation: PostgreSQL chooses the current pilot/profile/signer and the browser
stores only the request ID, never the package. It remains disabled until its migration is deployed
and the reviewed assignment-signer identifier is configured. Activation remains blocked on all of
the following:

- a real, immutable TeleBirr receiver revision/profile/configuration digest;
- separately provisioned and rotatable trusted assignment-signing and enrolled device keys;
- deployment and provisioning of the now-defined enrollment, lease, heartbeat, upload, replay, and
  authenticated acknowledgement endpoints at the compiled bridge origin;
- server-side proof-to-reference binding and a database-global one-use provider-payment claim;
- an atomic settlement/enqueue boundary with the five-account pilot allowlist and kill switch rechecked;
- a reviewed live provider-layout attestation and controlled Ethiopian-network end-to-end tests;
- generation and independent review of the two operational public-key pins and their exact bridge
  manifest bindings;
- a signed release build, controlled install, Android battery-policy setup, clock/update health
  checks, and Ethiopian-network end-to-end validation on the Owner's dedicated phone.

None of those items is inferred or enabled by compiling this project.

## Local offline build

Use Android Studio's bundled JDK and an installed Android SDK. With Gradle 8.11.1 already available locally:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
& '<local-gradle-8.11.1>\bin\gradle.bat' --offline testDebugUnitTest assembleDebug
```

`assembleDebug` produces a debug-signed, debuggable local test artifact. It is not a production
release artifact and must not be distributed or installed as an operational verifier. Ordinary
`assembleRelease` also stays inert and unsigned.

After the server and assignment signers exist, the protected manual GitHub workflow
`Android TeleBirr operational pairing release` produces the first reviewed pairing-only artifact.
It requires the exact current `main` commit, the literal `build-pairing-only-no-money`
confirmation, both public signer pins, and the protected Android release identity. It verifies the
APK Signature Scheme v2 certificate fingerprint before retaining the APK for 14 days.

The reviewed commit `49c90225f52d8599489641664267f794d9ef282a` produced the signed 0.5.0
pairing-only prerelease at GitHub tag `android-telebirr-pairing-v0.5.0`.
Its APK SHA-256 is
`aa01425badaf81548b7b70c974c8df0d52b98d4d19874bdfcfa0cdef57932e6f`, and its signing
certificate SHA-256 is
`1580355d60fab73b2e49867a59f73dadf96f1754ad543fa652d728ebf8c5dc82`. This is a
controlled-install prerelease, not a public evidence-mode or real-money release.

Version `0.5.1` increments the Android package version for the bounded clock-skew and visible-status
fixes. The pairing workflow remains pairing-only. A separate protected manual workflow,
`Android TeleBirr evidence-only release`, requires the exact current `main` commit and the literal
`build-evidence-only-no-money` confirmation. It produces the only build that can poll a signed
assignment and inspect the fixed official TeleBirr receipt route. The evidence-only build still has
no database credential, claim, settlement, enqueue, KemerBet execution, or money-movement
authority, and it must not be installed until pairing and heartbeat have passed on the physical
device.

Version `0.5.2` fails closed before opening the device key or network when the local enrollment has
expired, distinguishes a server-side enrollment rejection from a retryable transport outage, and
uses bounded non-sensitive status codes for invalid authenticated responses. Pairing, heartbeat,
assignment polling, and evidence upload remain separate from claim, settlement, execution, and
money movement.

The equivalent controlled local invocation is:

```powershell
gradle --offline assembleRelease `
  -PfetanagentVerifierRuntimeMode=pairing_only `
  -PfetanagentVerifierServerSignerKeyId=<manifest-server-key-id> `
  -PfetanagentVerifierServerSignerSpkiFile=<public-server-spki-der-file> `
  -PfetanagentVerifierAssignmentSignerKeyId=<manifest-assignment-key-id> `
  -PfetanagentVerifierAssignmentSignerSpkiFile=<public-assignment-spki-der-file> `
  -PfetanagentVerifierSigningStoreFile=<protected-pkcs12-file> `
  -PfetanagentVerifierSigningKeyAlias=<reviewed-key-alias> `
  -PfetanagentVerifierSigningCertSha256=sha256:<reviewed-certificate-digest>
```

The two signing passwords are supplied only through
`FETANAGENT_ANDROID_SIGNING_STORE_PASSWORD` and
`FETANAGENT_ANDROID_SIGNING_KEY_PASSWORD`. The build rejects missing, symlinked, non-canonical,
non-P-256, duplicated, or mismatched public trust keys, and rejects an unknown, expired,
multi-entry, non-RSA, or fingerprint-mismatched Android signing store. Ordinary release builds stay
inert and unsigned. Use `pairing_only` for the first phone enrollment/heartbeat smoke: it never
constructs the official receipt transport and never polls for an assignment. `evidence_only` is a
later separately reviewed build decision after the no-money transport smoke passes.

The UI model supports only non-sensitive lifecycle states: `Disabled`, `Enrollment required`,
`Ready`, `Observing`, `Upload pending`, and `Attention required`, plus protocol/provider/parser
versions. Version `0.5.2-secure-provisioning-inert` remains compiled with
`VERIFIER_ENABLED=false`, so its screen remains `Disabled` and exposes no activation button. An
enabled, unenrolled operational build exposes one obscured one-use pairing-package field. After
enrollment it exposes only `Start automatic verification` and `Stop`; it still has no URL, API key,
receipt reference, receiver name, account credential, or financial control input.

## Foreground lifecycle contract

The Android service is a `specialUse` foreground service because the dedicated Ethiopian-network
operator phone must remain visibly available for short-lived signed assignments. Android 15 limits
`dataSync` foreground services to six hours in a rolling 24-hour window and prohibits starting that
type from `BOOT_COMPLETED`, so `dataSync` cannot satisfy this device role. `specialUse` requires the
declared subtype in the manifest and may require policy review for Google Play distribution. The
controlled pilot is expected to use a directly installed, signed Owner build; a public Play release
must pass the applicable foreground-service declaration review first.

The service starts only when all three conditions hold: an operational build was explicitly
compiled, the operator pressed Start, and notification permission is available. It posts the
foreground notification before work begins, runs only one cycle at a time, uses monotonic time for
retry and heartbeat cadence, retries a failed heartbeat on the next loop, and sends a heartbeat
immediately after a state change or at least every five minutes. A visible notification action stops
operation. Reboot and package-replacement recovery honor the same persisted operator gate; they do
not bypass notification permission or provisioning. Disabled, enrollment-required, revoked,
trust-binding, invalid-signature, pilot-stopped, and permanent-upload-rejection states stop
fail-closed. There is no calendar or September 4 stop.

## Qhash-informed adaptation

The Owner's [Qhash Android verifier](https://github.com/Bizuayehu18/Qhash) was studied as a provider
and operational reference. The parts carried forward are the Ethiopian-network deployment model,
the official `transactioninfo.ethiotelecom.et/receipt/{reference}` route, the observed `Invoice No`,
`Payment Date`, `Settled Amount`, and `Credited Party Name` labels, Addis Ababa time interpretation,
one-at-a-time work, and visible health states. The encrypted durable queue, encrypted exact-request
provisioning state, pinned operational public trust, bounded backoff, persistent notification,
explicit stop control, and opt-in reboot recovery are now implemented. The Owner challenge issuer
and protected trust-only signer provisioner are implemented. The provisioner refuses to insert the
immutable assignment signer unless all financial switches remain disabled and no draft or armed
pilot exists. Deployment of the three database-free bridge services, phone installation/pairing,
and real-device validation remain separate gates, so this source change cannot turn an inert review
artifact into a live verifier by itself.
The parser tests now cover those observed label and amount variants.

FetanAgent deliberately does not adopt Qhash's editable backend URL, device-entered shared API key,
backend-supplied receipt URL, redirect-following receipt fetch, floating-point money, raw receipt or
identity logs, or any default `Completed` status. It also does not let a device report authorize a
wallet or settlement mutation. Assignments and observations remain signed and replay-bound, money
uses exact minor units, unrecognized/missing facts remain review-only, and all financial authority
stays outside Android.
