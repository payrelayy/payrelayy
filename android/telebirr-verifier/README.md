# FetanAgent TeleBirr verifier foundation

This standalone Android project is an inert, testable foundation for a future Ethiopian-network TeleBirr receipt observation relay. It preserves the version-1 `synthetic_shadow` transcript and also defines the separately domain-separated `live_private_pilot_v1` evidence protocol. It includes Android Keystore P-256 identity, a fixed official receipt route, public-IP-pinned HTTPS transport with original-host SNI and hostname verification, conservative receipt parsing, signed observations, and redacted status projections.

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

The live-pilot code is still **unwired**. Activation remains blocked on all of the following:

- a real, immutable TeleBirr receiver revision/profile/configuration digest;
- separately provisioned and rotatable trusted assignment-signing and enrolled device keys;
- authenticated enrollment, lease, heartbeat, upload, replay-ledger, and reconciliation endpoints;
- server-side proof-to-reference binding and a database-global one-use provider-payment claim;
- an atomic settlement/enqueue boundary with the five-account pilot allowlist and kill switch rechecked;
- a reviewed live provider-layout attestation and controlled Ethiopian-network end-to-end tests;
- an operational Android foreground/background queue with retry, clock, update, and device-health controls.

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

The UI exposes only three non-sensitive lifecycle states: `Disabled`, `Enrollment required`, and `Ready`, plus protocol/parser/normalizer versions. It has no input fields and no action button.
