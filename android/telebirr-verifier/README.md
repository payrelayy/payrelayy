# FetanAgent TeleBirr verifier foundation

This standalone Android project is an inert, testable foundation for a future Ethiopian-network TeleBirr receipt observation relay. It preserves the version-1 `synthetic_shadow` transcript and also defines the separately domain-separated `live_private_pilot_v1` evidence protocol. It includes Android Keystore P-256 identity, a fixed official receipt route, public-IP-pinned HTTPS transport with original-host SNI and hostname verification, conservative receipt parsing, signed observations, redacted status projections, and a policy-gated one-assignment runtime coordinator.

It is intentionally **disabled and unconfigured by default**. The application contains no enrollment server endpoint and no lease server endpoint. Those trusted server interfaces have not been designed or provisioned, so this app cannot be activated yet.

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

The coordinator has no polling timer or calendar shutdown date. Operational stop remains explicit,
while each assignment and enrollment still expires because stale leases must never authorize a new
provider lookup. The current in-memory work store is test/development-only; production wiring must
provide a durable encrypted implementation.

The live-pilot code remains **unwired to the shipped application lifecycle**. Activation remains
blocked on all of the following:

- a real, immutable TeleBirr receiver revision/profile/configuration digest;
- separately provisioned and rotatable trusted assignment-signing and enrolled device keys;
- authenticated enrollment, lease, heartbeat, upload, and reconciliation endpoints plus strict
  JSON codecs and authenticated server acknowledgements;
- server-side proof-to-reference binding and a database-global one-use provider-payment claim;
- an atomic settlement/enqueue boundary with the five-account pilot allowlist and kill switch rechecked;
- a reviewed live provider-layout attestation and controlled Ethiopian-network end-to-end tests;
- an encrypted durable Android queue and foreground runtime with bounded backoff, reboot recovery,
  notification permission handling, clock, update, and device-health controls.

None of those items is inferred or enabled by compiling this project.

## Local offline build

Use Android Studio's bundled JDK and an installed Android SDK. With Gradle 8.11.1 already available locally:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
& '<local-gradle-8.11.1>\bin\gradle.bat' --offline testDebugUnitTest assembleDebug
```

`assembleDebug` produces a debug-signed, debuggable local test artifact. It is not a production
release artifact and must not be distributed or installed as an operational verifier.

The UI model supports only non-sensitive lifecycle states: `Disabled`, `Enrollment required`,
`Ready`, `Observing`, `Upload pending`, and `Attention required`, plus protocol/provider/parser
versions. The currently compiled screen remains `Disabled`. It has no input fields and no action
button.

## Qhash-informed adaptation

The Owner's [Qhash Android verifier](https://github.com/Bizuayehu18/Qhash) was studied as a provider
and operational reference. The parts carried forward are the Ethiopian-network deployment model,
the official `transactioninfo.ethiotelecom.et/receipt/{reference}` route, the observed `Invoice No`,
`Payment Date`, `Settled Amount`, and `Credited Party Name` labels, Addis Ababa time interpretation,
one-at-a-time work, and visible health states. Bounded backoff and the foreground/durable queue stay
as explicit work for the next Android lifecycle slice.
The parser tests now cover those observed label and amount variants.

FetanAgent deliberately does not adopt Qhash's editable backend URL, device-entered shared API key,
backend-supplied receipt URL, redirect-following receipt fetch, floating-point money, raw receipt or
identity logs, or any default `Completed` status. It also does not let a device report authorize a
wallet or settlement mutation. Assignments and observations remain signed and replay-bound, money
uses exact minor units, unrecognized/missing facts remain review-only, and all financial authority
stays outside Android.
