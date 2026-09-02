# FetanAgent Windows companion

This is the local, headed-browser replacement for the unreliable DigitalOcean KemerBet sign-in
preview. It runs in the signed-in Windows desktop session and opens the installed stable Chrome.

The first slice is deliberately enrollment/read-only:

- the owner types KemerBet credentials and CAPTCHA directly into the local Chrome window;
- the dedicated Chrome profile stays on this Windows account;
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
- the guarded browser stops after ten minutes without a signed-in candidate or twelve hours after
  a candidate account-info response. KemerBet may end its own server session earlier.

An HTTP 200 `Account/Info` response produces only `signed_in_candidate`, not authentication proof.
The companion does not validate the response schema or exact account identity yet, and the Owner's
sign-in has not been observed in a companion validation run. Exact account/session validation,
signed device pairing, and exact-five lookup remain unwired.

Sensitive request data may pass through the companion's local Node process memory during forwarding;
it remains on this device and is not retained in logs or sent to remote FetanAgent services. Browser
HTTP caching is disabled while request routing is active.

## Run from this workspace

```powershell
$env:FETANAGENT_COMPANION_DATA_ROOT = 'D:\FetanAgent Companion'
pnpm --filter @fetanagent/windows-companion build
pnpm --filter @fetanagent/windows-companion start
```

Use `Ctrl+C` in the launching terminal to close the guarded browser. The next phase adds device
pairing and one signed exact-five lookup assignment; it does not add Amount or Transfer.
