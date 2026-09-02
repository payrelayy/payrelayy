FetanAgent Windows Companion — no-transfer release
==================================================

1. Extract the complete ZIP file.
2. Double-click "Start FetanAgent Companion.vbs".
3. A separate Chrome window opens with a dedicated KemerBet profile.
4. Enter your KemerBet username, password, and CAPTCHA only in that Chrome window.
5. Leave that Chrome window open. Detecting the agent page can keep the guarded window open
   for up to twelve hours. KemerBet may end its own server session earlier. If the login page
   returns, sign in within ten minutes. Closing Chrome stops the companion.
6. Close the companion Chrome window to stop it.

This release is for local sign-in validation only. It has no payment execution capability.
KemerBet wallet and transaction requests are blocked even if the provider page displays a
Transfer button. Server pairing and exact-five lookup are not wired into this release. It does not
move money.
Detecting the agent page is only a signed-in candidate, not proof of the exact account or
authenticated session. That validation remains to be implemented. Repeated page events do not
extend the twelve-hour deadline. Each guarded session has an overall twelve-hour-ten-minute cap.

The dedicated browser profile is stored at D:\FetanAgent Companion when drive D exists, otherwise
under the current Windows user's Local AppData folder. Credentials are submitted to KemerBet, and
CAPTCHA uses the provider's normal flow. The saved browser profile remains on this device. Approved
provider requests may pass through the companion's local process memory, but sensitive values are
never sent to remote FetanAgent services, Git, or logs.

Chrome starts offline until its request guards are installed. Provider redirects are checked before
following, and provider service workers and WebSockets are blocked. HTTP caching is disabled while
the request guards are active.

Verify the downloaded ZIP against the accompanying .sha256 file before extracting it.
