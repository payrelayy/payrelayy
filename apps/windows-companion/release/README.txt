FetanAgent Windows Companion — public-key pairing / no-transfer release
=======================================================================

1. Extract the complete ZIP file.
2. In the FetanAgent Owner page, create a one-use Windows pairing package. It is valid for ten
   minutes. Keep that page open; do not send the package through Telegram, email, chat, or an issue.
3. Double-click "Start FetanAgent Companion.vbs". Select Yes when asked whether to pair, then paste
   the complete package into the dedicated multiline pairing window.
4. On the first run only, enter the exact agent identity displayed in the KemerBet account header.
   This is not your password. It stays on this Windows account and becomes only a DPAPI-protected
   local fingerprint; the raw value is not stored or uploaded.
5. A separate Chrome window opens with a dedicated KemerBet profile.
6. Enter your KemerBet username, password, and CAPTCHA only in that Chrome window.
7. Leave that Chrome window open. The companion observes the exact reviewed account header twice
   and verifies it against the protected local binding before reporting the session as locally
   verified. KemerBet may end its own server session earlier. If the login page returns, sign in
   within ten minutes. Closing Chrome stops the companion.
8. After local identity verification, the companion generates a P-256 key on this computer,
   protects the private key with Windows DPAPI, and sends only the signed public pairing request.
9. Close the companion Chrome window to stop it.

This release adds server-signed public-key device enrollment after local exact-identity
verification. It has no Player lookup or payment execution capability.
KemerBet wallet and transaction requests are blocked even if the provider page displays a
Transfer button. Exact-five lookup is not wired into this release. It does not move money.
Detecting the agent page is only a candidate until the exact locally bound header is
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
