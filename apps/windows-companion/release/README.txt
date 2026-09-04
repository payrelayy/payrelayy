FetanAgent Windows Companion — local identity / no-transfer release
===================================================================

1. Extract the complete ZIP file.
2. Double-click "Start FetanAgent Companion.vbs".
3. On the first run only, enter the exact agent identity displayed in the KemerBet account header.
   This is not your password. It stays on this Windows account and becomes only a DPAPI-protected
   local fingerprint; the raw value is not stored or uploaded.
4. A separate Chrome window opens with a dedicated KemerBet profile.
5. Enter your KemerBet username, password, and CAPTCHA only in that Chrome window.
6. Leave that Chrome window open. The companion observes the exact reviewed account header twice
   and verifies it against the protected local binding before reporting the session as locally
   verified. KemerBet may end its own server session earlier. If the login page returns, sign in
   within ten minutes. Closing Chrome stops the companion.
7. Close the companion Chrome window to stop it.

This release adds local exact-identity verification to the sign-in check. It has no payment
execution capability.
KemerBet wallet and transaction requests are blocked even if the provider page displays a
Transfer button. Server pairing and exact-five lookup are not wired into this release. It does not
move money. Detecting the agent page is only a candidate until the exact locally bound header is
observed twice, visible signed-out/CAPTCHA markers are absent, and the protected fingerprint
matches. Repeated page events do not extend the twelve-hour deadline. Each guarded session has an
overall twelve-hour-ten-minute cap.

The dedicated browser profile is stored at D:\FetanAgent Companion when drive D exists, otherwise
under the current Windows user's Local AppData folder. Credentials are submitted to KemerBet, and
CAPTCHA uses the provider's normal flow. The saved browser profile remains on this device. Approved
provider requests may pass through the companion's local process memory, but sensitive values are
never sent to remote FetanAgent services, Git, or logs.

Chrome starts offline until its request guards are installed. Provider redirects are checked before
following, and provider service workers and WebSockets are blocked. HTTP caching is disabled while
the request guards are active.

Verify the downloaded ZIP against the accompanying .sha256 file before extracting it.
