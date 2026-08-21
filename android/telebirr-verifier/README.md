# FetanAgent TeleBirr verifier foundation

This standalone Android project is an inert, testable foundation for a future Ethiopian-network TeleBirr receipt observation relay. It implements the version-1 signed relay transcript, Android Keystore P-256 identity, a fixed official receipt route, public-IP-pinned HTTPS transport with original-host SNI and hostname verification, conservative receipt parsing, signed observations, and redacted status projections.

It is intentionally **disabled and unconfigured by default**. The application contains no enrollment server endpoint and no lease server endpoint. Those trusted server interfaces have not been designed or provisioned, so this app cannot be activated yet.

The compatibility engine also requires an injected protected-reference binding verifier before it
will perform a lookup. No production implementation is shipped. The existing v1 lease exposes only
a protected fingerprint, which the phone cannot safely recompute from the raw lookup reference
without a new jointly reviewed binding design. An unavailable or mismatched binding stops before
network access or signing.

The current TypeScript server transcript is explicitly named `synthetic_shadow`. This project preserves that exact value only for cross-language byte compatibility. It must not label or submit a live observation as synthetic. Production activation requires a separately reviewed, jointly deployed live protocol mode on both Android and the trusted server; changing one side alone would invalidate every signature.

The published lease binds a receiver-profile digest but does not give the phone protected comparison material for the configured receiver name. This foundation therefore reports receiver matching as `unknown`; it never guesses from a masked number or accepts a receipt merely because other fields match. A future jointly reviewed contract must solve that comparison before automatic settlement can be considered.

The transport does not interpret a bare HTTP `404` as proof that a transaction is absent. Until an
exact provider negative-response contract is independently attested and reviewed, a `404` is provider
uncertainty and must go to review.

The app has no database, Supabase, KemerBet, claim, settlement, enqueue, execution, or financial-action authority. A signed observation is evidence for a trusted server to assess; it cannot authorize SQL, credit a player, or move money. There are no customer-entered secrets, provider credentials, raw receipt/reference/name/URL logs, or embedded API keys.

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
