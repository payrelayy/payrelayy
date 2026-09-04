# FetanAgent Windows companion

This is the local, headed-browser replacement for the unreliable DigitalOcean KemerBet sign-in
preview. It runs in the signed-in Windows desktop session and opens the installed stable Chrome.

The current slice is deliberately local-identity/read-only:

- the owner types KemerBet credentials and CAPTCHA directly into the local Chrome window;
- the dedicated Chrome profile stays on this Windows account;
- on first use, the owner types the exact visible agent-header identity into the launcher; the
  companion compares the reviewed header twice and stores only a random-keyed fingerprint whose
  key is protected with Windows DPAPI for the current user;
- later launches must reproduce that same protected local identity binding before the session is
  reported as locally verified;
- only the exact KemerBet login POST and non-financial session-refresh POST are permitted;
- the KemerBet transfer endpoint and every other provider mutation are blocked;
- the exact non-financial KemerBet session-refresh request remains available so the signed-in
  session can stay healthy;
- no screenshot, keystroke, credential, cookie, browser-storage value, Player ID, or provider
  response body is sent to remote FetanAgent services, Git, or logs;
- Chrome starts offline until context-wide request guards are installed; approved provider HTTP
  requests are forwarded locally, with every redirect checked before it is followed;
- provider service workers and provider WebSockets are disabled so they cannot bypass the HTTP
  enrollment boundary;
- the guarded browser stops after ten minutes on the login page or twelve hours after detecting
  the exact reviewed agent page. Repeated agent-page events do not extend that deadline, and each
  guarded session has an overall twelve-hour-ten-minute cap. KemerBet may end its own server
  session earlier.

The exact reviewed main-frame `/agents` page first produces only `signed_in_candidate`. The
companion then rejects visible login/CAPTCHA state, observes exactly one reviewed identity header
twice, and matches it to the DPAPI-protected local binding before reporting `signed_in_verified`.
Window retention does not depend on a particular background `Account/Info` response or locale.
Returning to the actual login page resets the state and starts a new non-sliding ten-minute login
window within the overall session cap. Server-signed device pairing and exact-five lookup remain
unwired.

Sensitive request data may pass through the companion's local Node process memory during forwarding;
it remains on this device and is not retained in logs or sent to remote FetanAgent services. Browser
HTTP caching is disabled while request routing is active.

## Run from this workspace

```powershell
$env:FETANAGENT_COMPANION_DATA_ROOT = 'D:\FetanAgent Companion'
pnpm --filter @fetanagent/windows-companion build
pnpm --filter @fetanagent/windows-companion start
```

For a first local-development run, set
`FETANAGENT_COMPANION_EXPECTED_AGENT_IDENTITY` to the exact visible agent-header value before
starting. Use `Ctrl+C` in the launching terminal to close the guarded browser. The next phase adds
device pairing and one signed exact-five lookup assignment; it does not add Amount or Transfer.
