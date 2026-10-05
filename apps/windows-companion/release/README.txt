FetanAgent Windows Companion — paired, guarded Automatic Deposit-capable release
=================================================================================

1. Extract the complete ZIP file.
2. In the FetanAgent Owner page, create a one-use Windows pairing package. It is valid for twelve
   hours. Keep that page open; do not send the package through Telegram, email, chat, or an issue.
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
9. By default, an authenticated Owner approval can authorize one exact-five read-only lookup. The
   companion performs exactly five sequential KemerBet Find requests and returns only signed,
   redacted outcomes and aggregate counts.
10. Close the companion Chrome window to stop it.

The standard Companion launcher remains Find-only. Money-capable modes require a separate launcher,
the exact paired device and account, a measured installed release, and independently enabled server
authority. Setting an internal switch or account ID yourself cannot replace those inputs.

"Start FetanAgent One-Job Operator.cmd" is the fixed 25 ETB execution-v2 pilot. It is for a
separately reviewed, current Owner-approved session only. It needs a protected local operator
document at operator\one-job-launch.json, an installed pinned SSH identity and host key, an
independently opened short-lived server session, a signed handoff, and the exact published release.
Its PowerShell script supports -CheckOnly and -PreviewConnection; neither starts a deposit or proves
that a live deposit will succeed. A permitted session can issue one Transfer request for the one
approved Player and then requires signed server reconciliation.

"Start FetanAgent Automatic Deposits.cmd" is the separate routine mode. It remains off unless the
Owner routine policy is current, FetanAgent has activated a dedicated production database login for
this exact paired certificate and account, and the production bridge has loaded the separately
marked routine overlay. It also requires operator\routine-deposit-launch.json with this installed
release SHA and exact platform-agent account UUID. The file contains no password, payment reference,
or request key. The PowerShell launcher supports -CheckOnly and will not connect or open KemerBet in
that mode. Do not copy or edit an operator document from another machine, account, or release.

Before routine work begins, a protected parent remeasures every package file, starts the exact child,
verifies its fresh paired-device launch proof, and returns a permit bound to those exact proof bytes.
Routine mode processes one admitted TeleBirr/ETB job at a time, using the verified receipt amount from
25.00 through 25,000.00 ETB. It requires the exact Player and amount, empty Notes, a one-use database
fence, the exact success and Player-credit messages, and positive durable reconciliation. A duplicate,
changed page, redirect, malformed response, timeout, crash, database failure, or uncertain provider
outcome stops without a blind retry. Do not run the one-job and routine launchers together.

When Automatic Deposit is off, KemerBet wallet and transaction requests remain blocked even if the
provider page displays a Transfer button. The read-only exact-five flow never enters Amount or Notes
and never clicks Transfer.
Detecting the agent page is only a candidate until the exact locally bound header is
observed twice, visible signed-out/CAPTCHA markers are absent, and the protected fingerprint
matches. Repeated page events do not extend the fixed one-job pilot deadline; that guarded pilot
session has an overall twelve-hour-ten-minute cap. Routine mode has no client-renewed testing
window, but every command still requires the current server policy, certificate, account binding,
runtime activation, one-use claim and fence. Losing any of those stops new work.

The dedicated browser profile is stored at D:\FetanAgent Companion when drive D exists, otherwise
under the current Windows user's Local AppData folder. Credentials are submitted to KemerBet, and
CAPTCHA uses the provider's normal flow. The saved browser profile remains on this device. Approved
provider requests may pass through the companion's local process memory, but sensitive values are
never sent to remote FetanAgent services, Git, or logs.

Chrome starts offline until its request guards are installed. Provider redirects are checked before
following, and provider service workers and WebSockets are blocked. HTTP caching is disabled while
the request guards are active.

Verify the downloaded ZIP against the accompanying .sha256 file before extracting it.
