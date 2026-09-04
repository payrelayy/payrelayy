import {
  OWNER_CONTROL_TELEGRAM_BOT_USERNAME,
  type OwnerControlRuntimeConfig,
} from '@fetanagent/config/owner-control';

const STAGING_SUPABASE_ORIGIN = 'https://spzpiyxheappsfyswewl.supabase.co';

export const OWNER_DASHBOARD_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  `connect-src 'self' ${STAGING_SUPABASE_ORIGIN}`,
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
].join('; ');

export const OWNER_DASHBOARD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>FetanAgent Owner</title>
    <link rel="stylesheet" href="/owner/styles.css" />
  </head>
  <body>
    <main class="shell">
      <header>
        <p class="eyebrow">Private staging control</p>
        <h1>FetanAgent Owner</h1>
        <p class="lede">Issue one-time Telegram beta invitations from this SSH-only workspace.</p>
      </header>

      <section class="panel" id="login-panel" aria-labelledby="login-title">
        <h2 id="login-title">Owner sign in</h2>
        <p class="receipt-label">
          After sign-in, this open tab securely renews the Owner access token for up to twelve
          hours. The rotating refresh token is retained only in this browser tab, survives page
          reloads, and is erased on sign-out or tab close.
        </p>
        <form id="login-form">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="username" required />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
          <button type="submit">Sign in</button>
        </form>
      </section>

      <section class="panel" id="invite-panel" aria-labelledby="invite-title" hidden>
        <div class="panel-heading">
          <div>
            <p class="status-ok">Authenticated staging Owner</p>
            <h2 id="invite-title">Telegram beta invite</h2>
          </div>
          <button class="secondary" id="logout-button" type="button">Sign out</button>
        </div>
        <p class="request-meta" id="owner-session-status"></p>
        <form id="invite-form">
          <label for="expiry">Invite lifetime</label>
          <select id="expiry" name="expiry">
            <option value="3600">1 hour</option>
            <option value="86400">24 hours</option>
            <option value="604800">7 days</option>
          </select>
          <button type="submit">Create one-time invite</button>
        </form>

        <div class="receipt" id="invite-receipt" hidden>
          <p class="receipt-label">This link is shown once. Send it only to the intended tester.</p>
          <output id="invite-url"></output>
          <div class="actions">
            <button id="copy-button" type="button">Copy invite</button>
            <a id="open-link" target="_blank" rel="noopener noreferrer">Open Telegram</a>
            <button class="danger" id="revoke-button" type="button">Revoke invite</button>
          </div>
        </div>

        <section class="review-section" aria-labelledby="player-review-title">
          <div class="panel-heading">
            <div>
              <p class="status-ok">Non-claiming review</p>
              <h2 id="player-review-title">KemerBet Player ID requests</h2>
            </div>
            <button class="secondary" id="refresh-requests-button" type="button">Refresh</button>
          </div>
          <p class="receipt-label">
            Record only whether the submitted ID was found. This does not prove ownership and
            never enables deposits. Use found or not-found only after an independent manual
            KemerBet lookup.
          </p>
          <div class="request-list" id="player-request-list"></div>
        </section>

        <section class="review-section" aria-labelledby="player-association-title">
          <div class="panel-heading">
            <div>
              <p class="status-ok">Explicit ownership confirmation</p>
              <h2 id="player-association-title">Player ID ownership associations</h2>
            </div>
          </div>
          <p class="receipt-label">
            Confirm only after independently verifying that this Telegram customer controls the
            KemerBet account. This records the ownership association only. Deposit eligibility is
            a separate financial decision below.
          </p>
          <div class="request-list" id="player-association-list"></div>
        </section>

        <section class="review-section" aria-labelledby="player-eligibility-title">
          <div class="panel-heading">
            <div>
              <p class="status-ok">Audited financial gate</p>
              <h2 id="player-eligibility-title">Deposit eligibility decisions</h2>
            </div>
          </div>
          <p class="receipt-label">
            Approve only an active, validated, Owner-associated Player ID after financial review.
            Revocation blocks future deposit intents. A decision does not open a deposit, verify a
            payment, credit KemerBet, or move money; all staging financial switches remain off.
          </p>
          <div class="request-list" id="player-eligibility-list"></div>
        </section>

        <section class="review-section" aria-labelledby="kemerbet-readiness-cohort-title">
          <div class="panel-heading">
            <div>
              <p class="status-ok">One-use no-transfer bridge</p>
              <h2 id="kemerbet-readiness-cohort-title">KemerBet readiness cohort</h2>
            </div>
          </div>
          <p class="receipt-label">
            Prepare the server-only one-use input for exactly five active, valid, currently
            eligible KemerBet Players. The browser sends no Player identifiers, amount, or digest;
            the server re-checks the current Owner eligibility records before preparing it.
          </p>
          <p class="pilot-warning">
            This does not click Transfer, enable the executor, credit KemerBet, or move money.
            A different cohort cannot replace an already prepared one-use input.
          </p>
          <p class="request-meta" id="kemerbet-readiness-cohort-status">
            Sign in to load the current eligible Player count.
          </p>
          <form id="kemerbet-readiness-cohort-form">
            <label class="confirmation-row" for="kemerbet-readiness-cohort-confirmation">
              <input id="kemerbet-readiness-cohort-confirmation" type="checkbox" />
              I approve preparing the current exact five-Player readiness cohort. Transfer remains
              disabled and no money will move.
            </label>
            <button id="kemerbet-readiness-cohort-button" type="submit" disabled>
              Prepare one-use readiness cohort
            </button>
          </form>
        </section>

        <section class="review-section" aria-labelledby="receiver-title">
          <div class="panel-heading">
            <div>
              <p class="status-ok">Immutable Owner configuration</p>
              <h2 id="receiver-title">Receiving accounts</h2>
            </div>
            <button class="secondary" id="receiver-refresh-button" type="button">Refresh</button>
          </div>
          <p class="receipt-label">
            Add or change the active TeleBirr and CBE Birr receiving accounts here. A change creates
            a new revision and retires the previous one; it never rewrites receipt history. The
            complete account number is encrypted in server memory and is never displayed again.
          </p>
          <p class="pilot-warning">
            Rotation is accepted only while every payment, provider, pilot, settlement, and KemerBet
            execution switch is disabled. Stop any pilot before changing its receiver.
          </p>
          <div class="request-list" id="receiver-list"></div>
          <form id="receiver-form" autocomplete="off">
            <label for="receiver-provider">Provider</label>
            <select id="receiver-provider" name="providerCode" required>
              <option value="telebirr">TeleBirr</option>
              <option value="cbe_birr">CBE Birr</option>
            </select>
            <label for="receiver-holder-name">Official receiver full name</label>
            <input id="receiver-holder-name" name="accountHolderName" type="text"
              minlength="2" maxlength="160" autocomplete="off" required />
            <label for="receiver-account-reference">Wallet or account number (digits only)</label>
            <input id="receiver-account-reference" name="accountReference" type="password"
              inputmode="numeric" pattern="[0-9]{9,24}" minlength="9" maxlength="24"
              autocomplete="new-password" required />
            <label for="receiver-rotation-reason">Reason</label>
            <select id="receiver-rotation-reason" name="rotationReason" required>
              <option value="initial_configuration">Initial configuration</option>
              <option value="account_rotation">Account rotation</option>
              <option value="provider_incident_recovery">Provider incident recovery</option>
              <option value="owner_correction">Owner correction</option>
            </select>
            <label class="confirmation-row" for="receiver-confirmation">
              <input id="receiver-confirmation" name="confirmation" type="checkbox" required />
              I checked the official receiver name and complete account number and approve creating
              a new immutable active revision.
            </label>
            <button id="receiver-submit-button" type="submit">Save new active receiver</button>
          </form>
        </section>

        <section class="review-section" aria-labelledby="kemerbet-companion-title">
          <div id="kemerbet-legacy-profile-controls" hidden inert>
          <div class="panel-heading">
            <div>
              <p class="status-ok">Credential-free profile control</p>
              <h2 id="kemerbet-agent-title">KemerBet agent browser profile</h2>
            </div>
            <button class="secondary" id="kemerbet-agent-refresh-button" type="button">Refresh</button>
          </div>
          <p class="receipt-label">
            Prepare the private browser-profile record used for a later supervised KemerBet login.
            FetanAgent never asks for or stores a KemerBet password, OTP, cookie, session export,
            agent ID, or username here. Rotation retires the previous profile revision.
          </p>
          <p class="pilot-warning">
            This step does not sign in, poll KemerBet, click Transfer, enable the executor, or move
            money. It is accepted only while every financial/provider/pilot switch is disabled.
          </p>
          <div class="request-list" id="kemerbet-agent-profile-list"></div>
          <form id="kemerbet-agent-profile-form" autocomplete="off">
            <label for="kemerbet-agent-profile-reason">Reason</label>
            <select id="kemerbet-agent-profile-reason" name="configurationReason" required>
              <option value="initial_configuration">Initial configuration</option>
              <option value="agent_rotation">Agent profile rotation</option>
              <option value="security_recovery">Security recovery</option>
              <option value="owner_correction">Owner correction</option>
            </select>
            <label class="confirmation-row" for="kemerbet-agent-profile-confirmation">
              <input id="kemerbet-agent-profile-confirmation" name="confirmation" type="checkbox" required />
              I approve creating a new opaque KemerBet browser-profile revision and retiring the
              current revision. I will not enter credentials in FetanAgent.
            </label>
            <button type="submit">Prepare new KemerBet agent profile</button>
          </form>
          </div>
          <div class="kemerbet-session" aria-labelledby="kemerbet-companion-title">
            <p class="status-ok">Local identity validation</p>
            <h2 id="kemerbet-companion-title">KemerBet Windows companion</h2>
            <p class="receipt-label">
              Use a separate Chrome window on this computer for KemerBet sign-in. This
              moves sign-in off the datacenter and remote preview. Complete any CAPTCHA normally
              in Chrome. The dedicated profile stays on your computer, and the companion keeps
              the guarded window open for up to twelve hours after the exact locally bound agent
              header is verified.
              KemerBet can end its own session earlier. Credentials,
              CAPTCHA values, cookies, and browser storage never pass through this Owner page.
            </p>
            <p class="pilot-warning">
              This companion release verifies the exact agent-header identity locally and stores
              only a Windows-protected fingerprint. It has no payment execution capability.
              Provider financial requests are blocked even if KemerBet shows a Transfer button.
              The pairing package below grants public-key enrollment only. A separate signed
              command can authorize exactly five find-only Player-ID lookups.
            </p>
            <div class="actions companion-actions">
              <a href="https://github.com/payrelayy/payrelayy/releases/latest/download/FetanAgent-Windows-Companion.zip"
                rel="noopener noreferrer">Download Windows companion</a>
              <a class="secondary-link"
                href="https://github.com/payrelayy/payrelayy/releases/latest/download/FetanAgent-Windows-Companion.zip.sha256"
                rel="noopener noreferrer">Download SHA-256 checksum</a>
            </div>
            <ol class="companion-steps">
              <li>Extract the ZIP once.</li>
              <li>Double-click <strong>Start FetanAgent Companion.vbs</strong>.</li>
              <li>On first use, enter the exact visible KemerBet agent-header identity locally.</li>
              <li>Sign in only in the separate Chrome window and leave it open.</li>
            </ol>
            <div class="device-pairing" aria-labelledby="companion-device-pairing-title">
              <p class="status-ok">Public-key enrollment only</p>
              <h3 id="companion-device-pairing-title">Pair this Windows companion</h3>
              <p class="receipt-label">
                Create one ten-minute package after the exact local KemerBet identity is verified.
                The companion generates its private P-256 key on this computer and protects it with
                Windows DPAPI. Only the public key is enrolled. Lookup, Amount, Notes, Transfer,
                settlement, and money movement are not granted by the pairing package.
              </p>
              <p class="request-meta" id="companion-device-pairing-status">
                Sign in to check pairing readiness.
              </p>
              <form id="companion-device-pairing-form">
                <label class="confirmation-row" for="companion-device-pairing-confirmation">
                  <input id="companion-device-pairing-confirmation" type="checkbox" />
                  I approve one public-key pairing package for this Windows companion. It grants
                  no lookup or financial authority.
                </label>
                <button id="companion-device-pairing-button" type="submit" disabled>
                  Create one-use Windows pairing package
                </button>
              </form>
              <div class="pairing-receipt" id="companion-device-pairing-receipt" hidden>
                <p class="receipt-label">Paste this only into the local FetanAgent companion launcher.</p>
                <output class="pairing-package" id="companion-device-pairing-package"></output>
                <div class="actions">
                  <button id="companion-device-pairing-copy-button" type="button">Copy package</button>
                  <button class="secondary" id="companion-device-pairing-clear-button" type="button">
                    Clear from page
                  </button>
                </div>
              </div>
            </div>
            <div class="device-pairing" aria-labelledby="companion-lookup-title">
              <p class="status-ok">Signed read-only readiness check</p>
              <h3 id="companion-lookup-title">Run exact-five KemerBet lookup</h3>
              <p class="receipt-label">
                This sends the current five eligible Player IDs only to the paired local companion.
                It performs five sequential Find actions and returns only redacted counts. Amount,
                Notes, Transfer, settlement, execution, and money movement remain disabled.
              </p>
              <p class="request-meta" id="companion-lookup-status" role="status"
                aria-live="polite" aria-atomic="true">
                Sign in to check lookup readiness.
              </p>
              <form id="companion-lookup-form">
                <label class="confirmation-row" for="companion-lookup-confirmation">
                  <input id="companion-lookup-confirmation" type="checkbox" />
                  I approve one expiring, signed command for exactly five find-only lookups. No
                  amount or final action is authorized.
                </label>
                <button id="companion-lookup-button" type="submit" disabled>
                  Run five read-only lookups
                </button>
              </form>
              <dl class="status-grid" id="companion-lookup-result" hidden></dl>
            </div>
          </div>
          <div class="kemerbet-session" aria-labelledby="kemerbet-session-title" hidden inert>
            <h3 id="kemerbet-session-title">Private KemerBet sign-in</h3>
            <p class="receipt-label">
              Open a ten-minute isolated sign-in window, then click the preview and type directly
              into KemerBet. After successful sign-in, the locked authenticated browser is retained
              for up to twelve hours, including across Owner-page re-authentication. Passwords and
              OTPs are never sent to chat, Git, Supabase, or FetanAgent logs. Transfer is blocked,
              and all input locks as soon as sign-in is detected.
            </p>
            <p class="request-meta" id="kemerbet-session-status" role="status"
              aria-live="polite" aria-atomic="true">
              Load an active KemerBet profile to check sign-in readiness.
            </p>
            <label class="confirmation-row" for="kemerbet-session-confirmation">
              <input id="kemerbet-session-confirmation" type="checkbox" />
              I approve opening a ten-minute private KemerBet sign-in browser. I will enter
              credentials only inside the preview. Transfer remains blocked.
            </label>
            <div class="review-actions">
              <button id="kemerbet-session-start-button" type="button" disabled>
                Start private sign-in
              </button>
              <button class="danger" id="kemerbet-session-stop-button" type="button" disabled>
                Stop private sign-in
              </button>
            </div>
            <canvas id="kemerbet-session-canvas" width="1280" height="720" tabindex="0"
              aria-label="Private KemerBet sign-in browser" hidden></canvas>
          </div>
        </section>

        <section class="review-section pilot-section" aria-labelledby="pilot-title">
          <div class="panel-heading">
            <div>
              <p class="status-ok">Approved fixed private pilot</p>
              <h2 id="pilot-title">TeleBirr five-Player pilot</h2>
            </div>
            <button class="secondary" id="pilot-refresh-button" type="button">Refresh status</button>
          </div>
          <p class="receipt-label">
            Fixed contract: TeleBirr only, exactly five currently eligible KemerBet Players,
            25 ETB maximum per deposit and Player, 125 ETB total, five permanent reservations,
            and exactly two hours. Customer membership is derived from the selected Player owners
            inside PostgreSQL; no customer UUID or credential is entered here.
          </p>
          <p class="pilot-warning">
            Prepare and arm configure a dormant dry run only. They do not enable payment
            verification, settlement, the executor, or a KemerBet final action.
          </p>
          <p class="request-meta" id="pilot-readiness">Loading eligible Players…</p>
          <div class="request-list" id="pilot-candidate-list"></div>
          <form id="pilot-prepare-form">
            <label class="confirmation-row" for="pilot-confirmation">
              <input id="pilot-confirmation" name="confirmation" type="checkbox" />
              I approve this exact fixed two-hour TeleBirr cohort and understand it remains
              financially disabled after preparation.
            </label>
            <button id="pilot-prepare-button" type="submit" disabled>Prepare fixed pilot</button>
          </form>
          <div class="pilot-status" id="pilot-status" hidden>
            <h3>Current pilot status</h3>
            <dl id="pilot-status-facts"></dl>
            <div class="review-actions">
              <button id="pilot-arm-button" type="button">Arm dry-run configuration</button>
              <button class="danger" id="pilot-stop-button" type="button">Emergency stop</button>
            </div>
            <label for="pilot-stop-reason">Emergency-stop reason</label>
            <select id="pilot-stop-reason">
              <option value="owner_stop">Owner stop</option>
              <option value="provider_incident">Provider incident</option>
              <option value="parser_drift">Parser drift</option>
              <option value="execution_uncertainty">Execution uncertainty</option>
              <option value="cap_review">Cap review</option>
              <option value="pilot_complete">Pilot complete</option>
            </select>
          </div>
          <div class="device-pairing" aria-labelledby="telebirr-device-pairing-title">
            <p class="status-ok">Database-free Android enrollment</p>
            <h3 id="telebirr-device-pairing-title">TeleBirr verifier phone pairing</h3>
            <p class="receipt-label">
              Create one ten-minute package for the dedicated Android phone only after the pilot
              is armed in dry-run. The package can enroll one device; it cannot poll assignments,
              verify a deposit, settle, execute, or move money.
            </p>
            <p class="pilot-warning">
              Copy this directly to the phone. Do not send it through Telegram, chat, email,
              screenshots, issue comments, or logs. A lost response is reconciled with the same
              request ID and cannot create a second package.
            </p>
            <p class="request-meta" id="telebirr-device-pairing-status">
              Sign in to check pairing readiness.
            </p>
            <form id="telebirr-device-pairing-form">
              <label class="confirmation-row" for="telebirr-device-pairing-confirmation">
                <input id="telebirr-device-pairing-confirmation" type="checkbox" />
                I approve one pairing-only package for the dedicated Android phone. Assignment
                polling and money movement remain disabled.
              </label>
              <button id="telebirr-device-pairing-button" type="submit" disabled>
                Create one-use pairing package
              </button>
            </form>
            <div class="pairing-receipt" id="telebirr-device-pairing-receipt" hidden>
              <p class="receipt-label">One-use package (sensitive until it expires)</p>
              <output class="pairing-package" id="telebirr-device-pairing-package"></output>
              <div class="review-actions">
                <button id="telebirr-device-pairing-copy-button" type="button">Copy package</button>
                <button class="secondary" id="telebirr-device-pairing-clear-button" type="button">
                  Clear from page
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="review-section" aria-labelledby="deposit-intake-title">
          <div class="panel-heading">
            <div>
              <p class="status-ok">Read-only dry run</p>
              <h2 id="deposit-intake-title">Dry-run deposit intake</h2>
            </div>
          </div>
          <p class="receipt-label">
            These are customer-entered CBE Birr intents and protected references only. Nothing here
            is verified, credited, sent to KemerBet, or eligible for execution. Redacted fixture
            assessments below are advisory simulations, never provider evidence.
          </p>
          <div class="request-list" id="deposit-intake-list"></div>
        </section>
      </section>

      <p class="notice" id="notice" role="status" aria-live="polite"></p>
      <footer>Staging only. Payments and KemerBet actions are disabled.</footer>
    </main>
    <script type="module" src="/owner/app.js"></script>
  </body>
</html>
`;

export const OWNER_DASHBOARD_CSS = `:root {
  color: #f8fafc;
  background: #09090b;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, #20243a 0, #09090b 48%); }
button, input, select { font: inherit; }
.shell { width: min(720px, calc(100% - 32px)); margin: 0 auto; padding: 72px 0 40px; }
header { margin-bottom: 28px; }
.eyebrow, .status-ok { color: #67e8f9; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
h1 { margin: 6px 0 8px; font-size: clamp(2.4rem, 8vw, 4.6rem); line-height: 0.95; letter-spacing: -0.055em; }
h2 { margin: 0 0 20px; font-size: 1.35rem; }
.lede, footer, .receipt-label { color: #a1a1aa; line-height: 1.6; }
.panel { border: 1px solid #30303a; border-radius: 18px; background: rgba(17, 17, 22, 0.94); padding: 24px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34); }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
form { display: grid; gap: 10px; }
label { color: #d4d4d8; font-size: 0.9rem; font-weight: 700; }
input, select { width: 100%; border: 1px solid #3f3f46; border-radius: 10px; color: #fafafa; background: #18181b; padding: 12px 14px; }
input:focus, select:focus, button:focus, a:focus { outline: 3px solid rgba(103, 232, 249, 0.35); outline-offset: 2px; }
button, .actions a { border: 0; border-radius: 10px; color: #071113; background: #67e8f9; padding: 12px 16px; font-weight: 850; cursor: pointer; text-align: center; text-decoration: none; }
form button { margin-top: 8px; }
button.secondary { color: #e4e4e7; background: #27272a; }
button.danger { color: #fecaca; background: #3f171b; }
button:disabled { cursor: not-allowed; opacity: 0.55; }
.receipt { margin-top: 22px; border-top: 1px solid #30303a; padding-top: 20px; }
.review-section { margin-top: 28px; border-top: 1px solid #30303a; padding-top: 24px; }
.request-list { display: grid; gap: 14px; margin-top: 16px; }
.request-card { border: 1px solid #30303a; border-radius: 12px; background: #141419; padding: 16px; }
.request-card h3 { margin: 0 0 6px; font-size: 1rem; overflow-wrap: anywhere; }
.request-meta { margin: 0; color: #a1a1aa; font-size: 0.82rem; }
.review-actions { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 14px; }
.review-actions button { padding: 10px 12px; font-size: 0.83rem; }
.empty-state { color: #a1a1aa; }
.pilot-warning { border-left: 3px solid #fcd34d; color: #fde68a; background: #211b0e; padding: 12px 14px; line-height: 1.5; }
.confirmation-row { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 10px; margin-top: 16px; line-height: 1.5; }
.confirmation-row input { width: auto; margin-top: 4px; }
.pilot-choice { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 12px; }
.pilot-choice input { width: auto; }
.pilot-status { margin-top: 20px; border: 1px solid #164e63; border-radius: 12px; background: #0c1d20; padding: 16px; }
.pilot-status h3 { margin-top: 0; }
.pilot-status dl { display: grid; grid-template-columns: minmax(150px, auto) 1fr; gap: 8px 14px; }
.pilot-status dt { color: #a1a1aa; }
.pilot-status dd { margin: 0; overflow-wrap: anywhere; }
.device-pairing { margin-top: 24px; border: 1px solid #164e63; border-radius: 12px; background: #0c1d20; padding: 16px; }
.device-pairing h3 { margin-top: 0; }
.pairing-receipt { margin-top: 18px; }
.pairing-package { display: block; max-height: 180px; overflow: auto; border: 1px solid #3f3f46; border-radius: 10px; background: #09090b; padding: 12px; color: #e4e4e7; overflow-wrap: anywhere; user-select: all; }
.kemerbet-session { margin-top: 24px; border: 1px solid #164e63; border-radius: 12px; background: #0c1d20; padding: 16px; }
.kemerbet-session h3 { margin-top: 0; }
#kemerbet-session-canvas { width: 100%; height: auto; margin-top: 16px; border: 1px solid #3f3f46; border-radius: 10px; background: #000; cursor: crosshair; }
#kemerbet-session-canvas:focus { outline: 3px solid rgba(103, 232, 249, 0.55); outline-offset: 2px; }
output { display: block; overflow-wrap: anywhere; border-radius: 10px; color: #cffafe; background: #0c1d20; padding: 14px; }
.actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px; }
.companion-actions { grid-template-columns: repeat(2, 1fr); }
.actions a.secondary-link { color: #e4e4e7; background: #27272a; }
.companion-steps { color: #d4d4d8; line-height: 1.65; padding-left: 24px; }
.notice { min-height: 24px; color: #fcd34d; font-weight: 700; }
footer { margin-top: 30px; font-size: 0.85rem; }
[hidden] { display: none !important; }
@media (max-width: 640px) { .shell { padding-top: 36px; } .actions, .review-actions, .companion-actions { grid-template-columns: 1fr; } .panel-heading { display: block; } .panel-heading .secondary { margin-bottom: 18px; } }
`;

export const OWNER_DASHBOARD_JAVASCRIPT = `const loginPanel = document.querySelector('#login-panel');
const invitePanel = document.querySelector('#invite-panel');
const loginForm = document.querySelector('#login-form');
const inviteForm = document.querySelector('#invite-form');
const passwordInput = document.querySelector('#password');
const logoutButton = document.querySelector('#logout-button');
const ownerSessionStatus = document.querySelector('#owner-session-status');
const notice = document.querySelector('#notice');
const receipt = document.querySelector('#invite-receipt');
const inviteOutput = document.querySelector('#invite-url');
const copyButton = document.querySelector('#copy-button');
const openLink = document.querySelector('#open-link');
const revokeButton = document.querySelector('#revoke-button');
const refreshRequestsButton = document.querySelector('#refresh-requests-button');
const playerRequestList = document.querySelector('#player-request-list');
const playerAssociationList = document.querySelector('#player-association-list');
const playerEligibilityList = document.querySelector('#player-eligibility-list');
const kemerbetReadinessCohortForm = document.querySelector('#kemerbet-readiness-cohort-form');
const kemerbetReadinessCohortConfirmation = document.querySelector('#kemerbet-readiness-cohort-confirmation');
const kemerbetReadinessCohortButton = document.querySelector('#kemerbet-readiness-cohort-button');
const kemerbetReadinessCohortStatus = document.querySelector('#kemerbet-readiness-cohort-status');
const receiverList = document.querySelector('#receiver-list');
const receiverForm = document.querySelector('#receiver-form');
const receiverRefreshButton = document.querySelector('#receiver-refresh-button');
const receiverAccountReference = document.querySelector('#receiver-account-reference');
const receiverConfirmation = document.querySelector('#receiver-confirmation');
const kemerbetAgentProfileList = document.querySelector('#kemerbet-agent-profile-list');
const kemerbetAgentProfileForm = document.querySelector('#kemerbet-agent-profile-form');
const kemerbetAgentProfileConfirmation = document.querySelector('#kemerbet-agent-profile-confirmation');
const kemerbetAgentProfileReason = document.querySelector('#kemerbet-agent-profile-reason');
const kemerbetAgentRefreshButton = document.querySelector('#kemerbet-agent-refresh-button');
const kemerbetSessionStatus = document.querySelector('#kemerbet-session-status');
const kemerbetSessionConfirmation = document.querySelector('#kemerbet-session-confirmation');
const kemerbetSessionStartButton = document.querySelector('#kemerbet-session-start-button');
const kemerbetSessionStopButton = document.querySelector('#kemerbet-session-stop-button');
const kemerbetSessionCanvas = document.querySelector('#kemerbet-session-canvas');
const pilotCandidateList = document.querySelector('#pilot-candidate-list');
const pilotReadiness = document.querySelector('#pilot-readiness');
const pilotPrepareForm = document.querySelector('#pilot-prepare-form');
const pilotConfirmation = document.querySelector('#pilot-confirmation');
const pilotPrepareButton = document.querySelector('#pilot-prepare-button');
const pilotRefreshButton = document.querySelector('#pilot-refresh-button');
const pilotStatusPanel = document.querySelector('#pilot-status');
const pilotStatusFacts = document.querySelector('#pilot-status-facts');
const pilotArmButton = document.querySelector('#pilot-arm-button');
const pilotStopButton = document.querySelector('#pilot-stop-button');
const pilotStopReason = document.querySelector('#pilot-stop-reason');
const telebirrDevicePairingForm = document.querySelector('#telebirr-device-pairing-form');
const telebirrDevicePairingConfirmation = document.querySelector('#telebirr-device-pairing-confirmation');
const telebirrDevicePairingButton = document.querySelector('#telebirr-device-pairing-button');
const telebirrDevicePairingStatus = document.querySelector('#telebirr-device-pairing-status');
const telebirrDevicePairingReceipt = document.querySelector('#telebirr-device-pairing-receipt');
const telebirrDevicePairingPackage = document.querySelector('#telebirr-device-pairing-package');
const telebirrDevicePairingCopyButton = document.querySelector('#telebirr-device-pairing-copy-button');
const telebirrDevicePairingClearButton = document.querySelector('#telebirr-device-pairing-clear-button');
const companionDevicePairingForm = document.querySelector('#companion-device-pairing-form');
const companionDevicePairingConfirmation = document.querySelector('#companion-device-pairing-confirmation');
const companionDevicePairingButton = document.querySelector('#companion-device-pairing-button');
const companionDevicePairingStatus = document.querySelector('#companion-device-pairing-status');
const companionDevicePairingReceipt = document.querySelector('#companion-device-pairing-receipt');
const companionDevicePairingPackage = document.querySelector('#companion-device-pairing-package');
const companionDevicePairingCopyButton = document.querySelector('#companion-device-pairing-copy-button');
const companionDevicePairingClearButton = document.querySelector('#companion-device-pairing-clear-button');
const companionLookupForm = document.querySelector('#companion-lookup-form');
const companionLookupConfirmation = document.querySelector('#companion-lookup-confirmation');
const companionLookupButton = document.querySelector('#companion-lookup-button');
const companionLookupStatus = document.querySelector('#companion-lookup-status');
const companionLookupResult = document.querySelector('#companion-lookup-result');
const depositIntakeList = document.querySelector('#deposit-intake-list');

let accessToken;
let refreshToken;
let ownerAuthConfig;
let ownerSessionExpiresAt;
let accessTokenRefreshAt;
let ownerRefreshTimer;
let ownerRefreshPromise;
let ownerAuthGeneration = 0;
let pendingKemerbetReadinessCohortRequestId;
let currentInvite;
let currentPilot;
let currentPilotLoaded = false;
let pendingTelebirrDevicePairingRequestId;
let currentTelebirrDevicePairing;
let telebirrDevicePairingExpiryTimer;
let pendingCompanionDevicePairingRequestId;
let currentCompanionDevicePairing;
let companionDevicePairingExpiryTimer;
let pendingCompanionLookupRequestId;
let currentCompanionLookup;
let companionLookupPollTimer;
let eligiblePilotPlayers = [];
let eligibleReadinessCohortPlayerCount = 0;
let readinessCohortPrepared = false;
let activeKemerbetAgentProfileId;
let currentKemerbetSession;
let kemerbetSecurityRecoveryRequired = false;
let kemerbetRecheckSpentFailedTerminal = false;
let kemerbetSecurityRecoveryCohortRequired = false;
let kemerbetSecurityRecoveryInProgress = false;
let kemerbetSecurityRecoverySessionAllowed = false;
let kemerbetSessionPollTimer;
let kemerbetSessionPollFailures = 0;
let kemerbetSessionReconnectNeeded = false;
let displayedKemerbetSessionGeneration;
let displayedKemerbetFrameSequence = 0;
let kemerbetInputPending = false;
let kemerbetInputLane = Promise.resolve();
let kemerbetPendingText = '';
let kemerbetTextFlushTimer;
const selectedPilotPlayerIds = new Set();
const expectedSupabaseUrl = '${STAGING_SUPABASE_ORIGIN}';
const OWNER_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 1_000;
const OWNER_SESSION_STORAGE_KEY = 'fetanagent.owner.session.v1';
const KEMERBET_READINESS_REQUEST_STORAGE_KEY =
  'fetanagent.owner.kemerbet-readiness-request.v1';
const TELEBIRR_DEVICE_PAIRING_REQUEST_STORAGE_KEY =
  'fetanagent.owner.telebirr-device-pairing-request.v1';
const COMPANION_DEVICE_PAIRING_REQUEST_STORAGE_KEY =
  'fetanagent.owner.companion-device-pairing-request.v1';
const COMPANION_LOOKUP_REQUEST_STORAGE_KEY =
  'fetanagent.owner.companion-exact-five-lookup-request.v1';
const OWNER_TOKEN_REQUEST_TIMEOUT_MS = 10 * 1_000;
// Caddy's Owner upstream first-header deadline is 30 seconds. Fail locally first so the UI can
// reconcile an uncertain mutation using the same idempotency key instead of waiting on a gateway
// timeout whose response shape is no longer authoritative.
const OWNER_API_REQUEST_TIMEOUT_MS = 25 * 1_000;
const OWNER_RECONCILIATION_REQUEST_TIMEOUT_MS = 4 * 1_000;
const OWNER_REFRESH_RETRY_DELAY_MS = 5 * 1_000;
const KEMERBET_TEXT_BATCH_DELAY_MS = 180;
const KEMERBET_TEXT_BATCH_MAX_CHARS = 64;

function ownerTransportTimeoutError() {
  return new Error('owner_transport_timeout');
}

function ownerTransportNetworkError() {
  return new Error('owner_transport_network');
}

function isOwnerTransportError(error) {
  return error instanceof Error &&
    (error.message === 'owner_transport_timeout' ||
      error.message === 'owner_transport_network');
}

function createRequestDeadline(timeoutMs) {
  const controller = new AbortController();
  let complete = false;
  let timer;
  let rejectDeadline;
  const deadline = new Promise((_resolve, reject) => {
    rejectDeadline = reject;
    timer = window.setTimeout(() => {
      if (complete) return;
      const error = ownerTransportTimeoutError();
      rejectDeadline(error);
      controller.abort();
    }, timeoutMs);
  });
  return {
    finish() {
      if (complete) return;
      complete = true;
      if (timer !== undefined) window.clearTimeout(timer);
    },
    async run(operation) {
      if (complete) throw ownerTransportTimeoutError();
      try {
        return await Promise.race([Promise.resolve().then(operation), deadline]);
      } catch (error) {
        if (controller.signal.aborted) throw ownerTransportTimeoutError();
        throw error;
      }
    },
    signal: controller.signal,
  };
}

const RESPONSE_BODY_READERS = new Set([
  'arrayBuffer',
  'blob',
  'formData',
  'json',
  'text',
]);

function deadlineBoundResponse(response, deadline) {
  return new Proxy(response, {
    get(target, property) {
      if (property === 'clone') {
        return () => deadlineBoundResponse(target.clone(), deadline);
      }
      if (RESPONSE_BODY_READERS.has(property)) {
        return async (...args) => {
          try {
            return await deadline.run(() => target[property](...args));
          } finally {
            deadline.finish();
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function beginDeadlineFetch(input, init, timeoutMs) {
  const deadline = createRequestDeadline(timeoutMs);
  try {
    const response = await deadline.run(() => fetch(input, { ...init, signal: deadline.signal }));
    return { deadline, response };
  } catch (error) {
    deadline.finish();
    if (isOwnerTransportError(error)) throw error;
    throw ownerTransportNetworkError();
  }
}

async function deadlineFetch(input, init, timeoutMs) {
  const request = await beginDeadlineFetch(input, init, timeoutMs);
  if (request.response.status === 204) request.deadline.finish();
  return deadlineBoundResponse(request.response, request.deadline);
}

function ordinaryKemerbetMutationAllowed() {
  return !kemerbetSecurityRecoveryRequired;
}

function readinessKemerbetMutationAllowed() {
  return ordinaryKemerbetMutationAllowed() || kemerbetSecurityRecoveryCohortRequired;
}

function privateKemerbetSessionMutationAllowed() {
  return ordinaryKemerbetMutationAllowed() || (
    kemerbetSecurityRecoveryRequired &&
    kemerbetSecurityRecoveryInProgress &&
    kemerbetSecurityRecoverySessionAllowed &&
    !kemerbetRecheckSpentFailedTerminal &&
    !kemerbetSecurityRecoveryCohortRequired
  );
}

function applyKemerbetQuarantineMutationBoundary() {
  if (!kemerbetSecurityRecoveryRequired) {
    kemerbetAgentProfileReason.disabled = false;
    for (const form of [
      receiverForm,
      kemerbetReadinessCohortForm,
      kemerbetAgentProfileForm,
      pilotPrepareForm,
    ]) {
      if (form.dataset.ownerBusy === 'true') continue;
      for (const element of form.elements) element.disabled = false;
    }
    updateKemerbetReadinessCohortAvailability();
    updatePilotPreparationAvailability();
    return;
  }
  for (const form of [receiverForm, pilotPrepareForm]) {
    for (const element of form.elements) element.disabled = true;
  }
  if (kemerbetSecurityRecoveryCohortRequired) {
    if (kemerbetReadinessCohortForm.dataset.ownerBusy !== 'true') {
      for (const element of kemerbetReadinessCohortForm.elements) element.disabled = false;
    }
  } else {
    for (const element of kemerbetReadinessCohortForm.elements) element.disabled = true;
  }
  if (
    kemerbetRecheckSpentFailedTerminal ||
    kemerbetSecurityRecoveryCohortRequired ||
    kemerbetSecurityRecoveryInProgress
  ) {
    for (const element of kemerbetAgentProfileForm.elements) element.disabled = true;
  }
  for (const element of document.querySelectorAll('[data-kemerbet-state-mutation="ordinary"]')) {
    element.disabled = true;
  }
  if (privateKemerbetSessionMutationAllowed()) {
    kemerbetSessionConfirmation.disabled = Boolean(currentKemerbetSession?.active);
    kemerbetSessionStartButton.disabled = !activeKemerbetAgentProfileId ||
      currentKemerbetSession?.phase !== 'idle';
    kemerbetSessionStopButton.disabled = !currentKemerbetSession?.active ||
      currentKemerbetSession.phase === 'stopping';
  } else {
    kemerbetSessionConfirmation.checked = false;
    kemerbetSessionConfirmation.disabled = true;
    kemerbetSessionStartButton.disabled = true;
    kemerbetSessionStopButton.disabled = true;
  }
  pilotArmButton.disabled = true;
  pilotStopButton.disabled = true;
  if (
    !kemerbetRecheckSpentFailedTerminal &&
    !kemerbetSecurityRecoveryCohortRequired &&
    !kemerbetSecurityRecoveryInProgress
  ) {
    kemerbetAgentProfileReason.value = 'security_recovery';
  }
  kemerbetAgentProfileReason.disabled = true;
  updateKemerbetReadinessCohortAvailability();
}

function requireOrdinaryKemerbetMutation() {
  if (ordinaryKemerbetMutationAllowed()) return true;
  applyKemerbetQuarantineMutationBoundary();
  setNotice(
    kemerbetRecheckSpentFailedTerminal
      ? 'The one-use KemerBet recheck authorization is spent and failed terminally. It cannot be retried; every mutation remains disabled and no money moves.'
      : kemerbetSecurityRecoverySessionAllowed
        ? 'KemerBet security recovery is in progress. Only the exact recovery private sign-in and read-only status refreshes are available; no money moves.'
        : 'KemerBet security recovery is required. Only the exact security-recovery profile action and read-only status refreshes are available; no money moves.',
  );
  return false;
}

function requirePrivateKemerbetSessionMutation() {
  if (privateKemerbetSessionMutationAllowed()) return true;
  applyKemerbetQuarantineMutationBoundary();
  const message = kemerbetRecheckSpentFailedTerminal
      ? 'The one-use KemerBet recheck authorization is terminally spent. Private sign-in cannot be reopened.'
      : 'Private KemerBet sign-in is unavailable in this recovery state. Amount, Transfer, final action, and money movement remain disabled.';
  kemerbetSessionStatus.textContent = message;
  setNotice(message);
  return false;
}

function requireKemerbetReadinessCohortMutation() {
  if (readinessKemerbetMutationAllowed()) return true;
  applyKemerbetQuarantineMutationBoundary();
  setNotice(
    kemerbetRecheckSpentFailedTerminal
      ? 'The one-use KemerBet recheck authorization is terminally spent and cannot be retried.'
      : 'KemerBet security recovery is already in progress. Another readiness cohort cannot be prepared.',
  );
  return false;
}

function setNotice(message) {
  notice.textContent = message;
}

function setBusy(form, busy) {
  form.dataset.ownerBusy = busy ? 'true' : 'false';
  for (const element of form.elements) element.disabled = busy;
}

function clearInvite() {
  currentInvite = undefined;
  inviteOutput.textContent = '';
  openLink.removeAttribute('href');
  receipt.hidden = true;
}

function clearPlayerRequests() {
  playerRequestList.replaceChildren();
}

function clearAssociationCandidates() {
  playerAssociationList.replaceChildren();
}

function clearPlayerEligibility() {
  playerEligibilityList.replaceChildren();
}

function clearKemerbetReadinessCohort() {
  eligibleReadinessCohortPlayerCount = 0;
  readinessCohortPrepared = false;
  kemerbetReadinessCohortConfirmation.checked = false;
  kemerbetReadinessCohortButton.disabled = true;
  kemerbetReadinessCohortStatus.textContent =
    'Sign in to load the current eligible Player count.';
}

function clearReceivers() {
  receiverList.replaceChildren();
  receiverAccountReference.value = '';
  receiverConfirmation.checked = false;
}

function clearKemerbetAgentProfiles() {
  activeKemerbetAgentProfileId = undefined;
  kemerbetAgentProfileList.replaceChildren();
  kemerbetAgentProfileConfirmation.checked = false;
  clearKemerbetSession();
}

function clearKemerbetSession() {
  currentKemerbetSession = undefined;
  if (kemerbetSessionPollTimer !== undefined) window.clearTimeout(kemerbetSessionPollTimer);
  kemerbetSessionPollTimer = undefined;
  kemerbetSessionPollFailures = 0;
  kemerbetSessionReconnectNeeded = false;
  displayedKemerbetSessionGeneration = undefined;
  displayedKemerbetFrameSequence = 0;
  kemerbetInputPending = false;
  kemerbetInputLane = Promise.resolve();
  clearKemerbetPendingText();
  kemerbetSessionCanvas.hidden = true;
  const context = kemerbetSessionCanvas.getContext('2d');
  if (context) context.clearRect(0, 0, kemerbetSessionCanvas.width, kemerbetSessionCanvas.height);
  kemerbetSessionConfirmation.checked = false;
  kemerbetSessionConfirmation.disabled = false;
  kemerbetSessionCanvas.tabIndex = 0;
  kemerbetSessionStartButton.disabled = true;
  kemerbetSessionStopButton.disabled = true;
  kemerbetSessionStatus.textContent = activeKemerbetAgentProfileId
    ? 'Private sign-in service is stopped.'
    : 'Load an active KemerBet profile to check sign-in readiness.';
  applyKemerbetQuarantineMutationBoundary();
}

function clearPilot() {
  currentPilot = undefined;
  currentPilotLoaded = false;
  eligiblePilotPlayers = [];
  selectedPilotPlayerIds.clear();
  pilotCandidateList.replaceChildren();
  pilotStatusFacts.replaceChildren();
  pilotStatusPanel.hidden = true;
  pilotConfirmation.checked = false;
  pilotReadiness.textContent = 'Sign in to load the approved cohort.';
  pilotPrepareButton.disabled = true;
  clearTelebirrDevicePairingPackage();
  telebirrDevicePairingConfirmation.checked = false;
  telebirrDevicePairingStatus.textContent = 'Sign in to check pairing readiness.';
  telebirrDevicePairingButton.disabled = true;
}

function clearTelebirrDevicePairingPackage() {
  if (telebirrDevicePairingExpiryTimer !== undefined) {
    window.clearTimeout(telebirrDevicePairingExpiryTimer);
  }
  telebirrDevicePairingExpiryTimer = undefined;
  currentTelebirrDevicePairing = undefined;
  telebirrDevicePairingPackage.textContent = '';
  telebirrDevicePairingReceipt.hidden = true;
}

function clearCompanionDevicePairingPackage() {
  if (companionDevicePairingExpiryTimer !== undefined) {
    window.clearTimeout(companionDevicePairingExpiryTimer);
  }
  companionDevicePairingExpiryTimer = undefined;
  currentCompanionDevicePairing = undefined;
  companionDevicePairingPackage.textContent = '';
  companionDevicePairingReceipt.hidden = true;
}

function clearDepositIntake() {
  depositIntakeList.replaceChildren();
}

function clearOwnerRefreshTimer() {
  if (ownerRefreshTimer !== undefined) window.clearTimeout(ownerRefreshTimer);
  ownerRefreshTimer = undefined;
}

function clearPersistedOwnerSession() {
  try {
    window.sessionStorage.removeItem(OWNER_SESSION_STORAGE_KEY);
  } catch {
    // An unavailable storage boundary is equivalent to having no restorable session.
  }
}

function validPersistedOwnerSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'expiresAt,refreshToken' ||
      typeof value.refreshToken !== 'string' || value.refreshToken.length < 12 ||
      value.refreshToken.length > 4_096 ||
      !Number.isInteger(value.expiresAt) || value.expiresAt <= Date.now() ||
      value.expiresAt > Date.now() + OWNER_SESSION_LIFETIME_MS) {
    return undefined;
  }
  return { expiresAt: value.expiresAt, refreshToken: value.refreshToken };
}

function readPersistedOwnerSession() {
  try {
    const stored = window.sessionStorage.getItem(OWNER_SESSION_STORAGE_KEY);
    if (!stored || stored.length > 4_256) return undefined;
    const session = validPersistedOwnerSession(JSON.parse(stored));
    if (!session) clearPersistedOwnerSession();
    return session;
  } catch {
    clearPersistedOwnerSession();
    return undefined;
  }
}

function persistOwnerSession() {
  if (!refreshToken || !ownerSessionExpiresAt) throw new Error('signed_out');
  window.sessionStorage.setItem(
    OWNER_SESSION_STORAGE_KEY,
    JSON.stringify({ expiresAt: ownerSessionExpiresAt, refreshToken }),
  );
}

function validOwnerMutationRequestId(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function readPendingKemerbetReadinessRequestId() {
  if (pendingKemerbetReadinessCohortRequestId) {
    return pendingKemerbetReadinessCohortRequestId;
  }
  try {
    const stored = window.sessionStorage.getItem(KEMERBET_READINESS_REQUEST_STORAGE_KEY);
    if (!validOwnerMutationRequestId(stored)) {
      window.sessionStorage.removeItem(KEMERBET_READINESS_REQUEST_STORAGE_KEY);
      return undefined;
    }
    pendingKemerbetReadinessCohortRequestId = stored;
    return stored;
  } catch {
    return undefined;
  }
}

function persistPendingKemerbetReadinessRequestId(requestId) {
  if (!validOwnerMutationRequestId(requestId)) throw new Error('invalid_request_id');
  pendingKemerbetReadinessCohortRequestId = requestId;
  try {
    window.sessionStorage.setItem(KEMERBET_READINESS_REQUEST_STORAGE_KEY, requestId);
  } catch {
    // The in-memory request ID still prevents a blind retry in this tab.
  }
}

function clearPendingKemerbetReadinessRequestId() {
  pendingKemerbetReadinessCohortRequestId = undefined;
  try {
    window.sessionStorage.removeItem(KEMERBET_READINESS_REQUEST_STORAGE_KEY);
  } catch {
    // The in-memory value is already cleared after a terminal response.
  }
}

function readPendingTelebirrDevicePairingRequestId() {
  if (pendingTelebirrDevicePairingRequestId) return pendingTelebirrDevicePairingRequestId;
  try {
    const stored = window.sessionStorage.getItem(TELEBIRR_DEVICE_PAIRING_REQUEST_STORAGE_KEY);
    if (!validOwnerMutationRequestId(stored)) {
      window.sessionStorage.removeItem(TELEBIRR_DEVICE_PAIRING_REQUEST_STORAGE_KEY);
      return undefined;
    }
    pendingTelebirrDevicePairingRequestId = stored;
    return stored;
  } catch {
    return undefined;
  }
}

function persistPendingTelebirrDevicePairingRequestId(requestId) {
  if (!validOwnerMutationRequestId(requestId)) throw new Error('invalid_request_id');
  pendingTelebirrDevicePairingRequestId = requestId;
  try {
    window.sessionStorage.setItem(TELEBIRR_DEVICE_PAIRING_REQUEST_STORAGE_KEY, requestId);
  } catch {
    // The in-memory request ID still prevents a blind retry in this tab.
  }
}

function clearPendingTelebirrDevicePairingRequestId() {
  pendingTelebirrDevicePairingRequestId = undefined;
  try {
    window.sessionStorage.removeItem(TELEBIRR_DEVICE_PAIRING_REQUEST_STORAGE_KEY);
  } catch {
    // The in-memory value is already cleared after a terminal response.
  }
}

function readPendingCompanionDevicePairingRequestId() {
  if (pendingCompanionDevicePairingRequestId) return pendingCompanionDevicePairingRequestId;
  try {
    const stored = window.sessionStorage.getItem(COMPANION_DEVICE_PAIRING_REQUEST_STORAGE_KEY);
    if (!validOwnerMutationRequestId(stored)) {
      window.sessionStorage.removeItem(COMPANION_DEVICE_PAIRING_REQUEST_STORAGE_KEY);
      return undefined;
    }
    pendingCompanionDevicePairingRequestId = stored;
    return stored;
  } catch {
    return undefined;
  }
}

function persistPendingCompanionDevicePairingRequestId(requestId) {
  if (!validOwnerMutationRequestId(requestId)) throw new Error('invalid_request_id');
  pendingCompanionDevicePairingRequestId = requestId;
  try {
    window.sessionStorage.setItem(COMPANION_DEVICE_PAIRING_REQUEST_STORAGE_KEY, requestId);
  } catch {
    // The in-memory request ID still prevents a blind retry in this tab.
  }
}

function clearPendingCompanionDevicePairingRequestId() {
  pendingCompanionDevicePairingRequestId = undefined;
  try {
    window.sessionStorage.removeItem(COMPANION_DEVICE_PAIRING_REQUEST_STORAGE_KEY);
  } catch {
    // The in-memory value is already cleared after a terminal response.
  }
}

function readPendingCompanionLookupRequestId() {
  if (pendingCompanionLookupRequestId) return pendingCompanionLookupRequestId;
  try {
    const stored = window.sessionStorage.getItem(COMPANION_LOOKUP_REQUEST_STORAGE_KEY);
    if (!validOwnerMutationRequestId(stored)) {
      window.sessionStorage.removeItem(COMPANION_LOOKUP_REQUEST_STORAGE_KEY);
      return undefined;
    }
    pendingCompanionLookupRequestId = stored;
    return stored;
  } catch {
    return undefined;
  }
}

function persistPendingCompanionLookupRequestId(requestId) {
  if (!validOwnerMutationRequestId(requestId)) throw new Error('invalid_request_id');
  pendingCompanionLookupRequestId = requestId;
  try {
    window.sessionStorage.setItem(COMPANION_LOOKUP_REQUEST_STORAGE_KEY, requestId);
  } catch {
    // The in-memory request ID still prevents a blind retry in this tab.
  }
}

function clearPendingCompanionLookupRequestId() {
  pendingCompanionLookupRequestId = undefined;
  try {
    window.sessionStorage.removeItem(COMPANION_LOOKUP_REQUEST_STORAGE_KEY);
  } catch {
    // The in-memory value is already cleared after an authoritative response.
  }
}

function signOut(message = 'Signed out.') {
  ownerAuthGeneration += 1;
  clearOwnerRefreshTimer();
  clearPersistedOwnerSession();
  accessToken = undefined;
  refreshToken = undefined;
  ownerAuthConfig = undefined;
  ownerSessionExpiresAt = undefined;
  accessTokenRefreshAt = undefined;
  ownerRefreshPromise = undefined;
  kemerbetSecurityRecoveryRequired = false;
  kemerbetRecheckSpentFailedTerminal = false;
  kemerbetSecurityRecoveryCohortRequired = false;
  kemerbetSecurityRecoveryInProgress = false;
  kemerbetSecurityRecoverySessionAllowed = false;
  ownerSessionStatus.textContent = '';
  passwordInput.value = '';
  clearInvite();
  clearPlayerRequests();
  clearAssociationCandidates();
  clearPlayerEligibility();
  clearKemerbetReadinessCohort();
  clearReceivers();
  clearKemerbetAgentProfiles();
  clearCompanionDevicePairingPackage();
  companionDevicePairingConfirmation.checked = false;
  companionDevicePairingStatus.textContent = 'Sign in to check pairing readiness.';
  companionDevicePairingButton.disabled = true;
  clearCompanionLookup();
  companionLookupConfirmation.checked = false;
  companionLookupStatus.textContent = 'Sign in to check lookup readiness.';
  companionLookupButton.disabled = true;
  clearPilot();
  clearDepositIntake();
  invitePanel.hidden = true;
  loginPanel.hidden = false;
  setNotice(message);
}

function validInvite(value) {
  if (!value || typeof value !== 'object') return undefined;
  const inviteId = typeof value.inviteId === 'string' ? value.inviteId : undefined;
  const inviteUrl = typeof value.inviteUrl === 'string' ? value.inviteUrl : undefined;
  const expiresAt = typeof value.expiresAt === 'string' ? value.expiresAt : undefined;
  if (!inviteId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(inviteId) || !inviteUrl || !expiresAt) return undefined;
  let url;
  try { url = new URL(inviteUrl); } catch { return undefined; }
  const start = url.searchParams.get('start');
  if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.pathname !== '/${OWNER_CONTROL_TELEGRAM_BOT_USERNAME}' ||
      url.searchParams.size !== 1 || !start || !/^[A-Za-z0-9_-]{43}$/.test(start) || url.hash) return undefined;
  return { inviteId, inviteUrl: url.toString(), expiresAt };
}

function isSignedOutError(error) {
  return error instanceof Error && error.message === 'signed_out';
}

function validOwnerAuthSession(value) {
  // Supabase still issues 12-character legacy refresh tokens for projects that
  // have not migrated to its newer encoded-token format. Treat this value as
  // opaque and enforce only the minimum accepted by Supabase Auth plus a cap.
  if (!value || typeof value !== 'object' ||
      typeof value.access_token !== 'string' || value.access_token.length < 20 ||
      typeof value.refresh_token !== 'string' || value.refresh_token.length < 12 ||
      value.refresh_token.length > 4_096 ||
      !Number.isInteger(value.expires_in) || value.expires_in < 60 || value.expires_in > 86_400) {
    return undefined;
  }
  return {
    accessToken: value.access_token,
    expiresInSeconds: value.expires_in,
    refreshToken: value.refresh_token,
  };
}

async function loadOwnerAuthConfig() {
  const response = await deadlineFetch(
    '/owner/config.json',
    { cache: 'no-store', credentials: 'omit' },
    OWNER_API_REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error('config');
  const config = await response.json();
  if (config.supabaseUrl !== expectedSupabaseUrl ||
      typeof config.companionDevicePairingConfigured !== 'boolean' ||
      typeof config.telebirrDevicePairingConfigured !== 'boolean' ||
      typeof config.publishableKey !== 'string' ||
      !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(config.publishableKey)) {
    throw new Error('config');
  }
  return config;
}

function scheduleOwnerRefresh() {
  clearOwnerRefreshTimer();
  if (!accessTokenRefreshAt || !ownerSessionExpiresAt) return;
  const nextAt = Math.min(accessTokenRefreshAt, ownerSessionExpiresAt);
  const delay = Math.max(1_000, nextAt - Date.now());
  ownerRefreshTimer = window.setTimeout(
    () => void refreshOwnerSession().catch(() => undefined),
    delay,
  );
}

function scheduleOwnerRefreshRetry() {
  clearOwnerRefreshTimer();
  if (!refreshToken || !ownerSessionExpiresAt || Date.now() >= ownerSessionExpiresAt) return;
  ownerRefreshTimer = window.setTimeout(
    () =>
      void refreshOwnerSession()
        .then(() => {
          if (!loginPanel.hidden && accessToken) {
            return loadOwnerDashboardAfterAuthentication(
              'Owner session restored after a temporary connection failure.',
            );
          }
          return undefined;
        })
        .catch(() => undefined),
    OWNER_REFRESH_RETRY_DELAY_MS,
  );
}

function applyOwnerAuthSession(session, resetLifetime) {
  const parsed = validOwnerAuthSession(session);
  if (!parsed) throw new Error('signed_out');
  const currentTime = Date.now();
  if (resetLifetime) ownerSessionExpiresAt = currentTime + OWNER_SESSION_LIFETIME_MS;
  if (!ownerSessionExpiresAt || currentTime >= ownerSessionExpiresAt) throw new Error('signed_out');
  accessToken = parsed.accessToken;
  refreshToken = parsed.refreshToken;
  accessTokenRefreshAt = Math.min(
    currentTime + parsed.expiresInSeconds * 1_000 - ACCESS_TOKEN_REFRESH_MARGIN_MS,
    ownerSessionExpiresAt,
  );
  ownerSessionStatus.textContent = 'Owner session active in this tab until ' +
    new Date(ownerSessionExpiresAt).toLocaleString() + '.';
  persistOwnerSession();
  scheduleOwnerRefresh();
}

async function refreshOwnerSession() {
  if (ownerRefreshPromise) return ownerRefreshPromise;
  const generation = ownerAuthGeneration;
  ownerRefreshPromise = (async () => {
    if (!refreshToken || !ownerAuthConfig || !ownerSessionExpiresAt ||
        Date.now() >= ownerSessionExpiresAt) {
      signOut('Your twelve-hour Owner session ended. Sign in again to continue.');
      throw new Error('signed_out');
    }
    const request = await beginDeadlineFetch(
      ownerAuthConfig.supabaseUrl + '/auth/v1/token?grant_type=refresh_token',
      {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        headers: { apikey: ownerAuthConfig.publishableKey, 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        referrerPolicy: 'no-referrer',
      },
      OWNER_TOKEN_REQUEST_TIMEOUT_MS,
    );
    if (generation !== ownerAuthGeneration) {
      request.deadline.finish();
      throw new Error('signed_out');
    }
    if ([400, 401, 403].includes(request.response.status)) {
      request.deadline.finish();
      throw new Error('owner_auth_rejected');
    }
    if (!request.response.ok) {
      request.deadline.finish();
      throw ownerTransportNetworkError();
    }
    const response = deadlineBoundResponse(request.response, request.deadline);
    applyOwnerAuthSession(await response.json(), false);
  })();
  try {
    await ownerRefreshPromise;
  } catch (error) {
    if (generation !== ownerAuthGeneration) throw new Error('signed_out');
    if (error instanceof Error &&
        (error.message === 'owner_auth_rejected' || error.message === 'signed_out')) {
      signOut('Your Owner session could not be renewed. Sign in again to continue.');
      throw new Error('signed_out');
    }
    scheduleOwnerRefreshRetry();
    throw isOwnerTransportError(error) ? error : ownerTransportNetworkError();
  } finally {
    if (generation === ownerAuthGeneration) ownerRefreshPromise = undefined;
  }
}

async function ensureFreshOwnerAccessToken() {
  if (!accessToken || !accessTokenRefreshAt || !ownerSessionExpiresAt) {
    throw new Error('signed_out');
  }
  if (Date.now() >= ownerSessionExpiresAt) {
    signOut('Your twelve-hour Owner session ended. Sign in again to continue.');
    throw new Error('signed_out');
  }
  if (Date.now() >= accessTokenRefreshAt) await refreshOwnerSession();
}

async function ownerRequest(path, init, timeoutMs = OWNER_API_REQUEST_TIMEOUT_MS) {
  await ensureFreshOwnerAccessToken();
  if (!accessToken) throw new Error('signed_out');
  const request = await beginDeadlineFetch(
    path,
    {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      headers: { ...init.headers, authorization: 'Bearer ' + accessToken },
      referrerPolicy: 'no-referrer',
    },
    timeoutMs,
  );
  if (request.response.status === 401 || request.response.status === 403) {
    request.deadline.finish();
    signOut('Your session is unavailable or is not an active Owner.');
    throw new Error('signed_out');
  }
  if (request.response.status === 409) {
    const failure = await request.deadline
      .run(() => request.response.clone().json())
      .catch(() => undefined);
    if (failure && typeof failure === 'object' && !Array.isArray(failure) &&
        Object.keys(failure).join(',') === 'error' &&
        failure.error === 'kemerbet_security_recovery_required') {
      kemerbetSecurityRecoveryRequired = true;
      applyKemerbetQuarantineMutationBoundary();
    }
  }
  if (request.response.status === 204) request.deadline.finish();
  return deadlineBoundResponse(request.response, request.deadline);
}

function validPlayerRequest(value) {
  if (!value || typeof value !== 'object') return undefined;
  const requestId = typeof value.requestId === 'string' ? value.requestId : undefined;
  const playerId = typeof value.playerId === 'string' ? value.playerId : undefined;
  const status = value.status;
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
      value.platformCode !== 'kemerbet' || !playerId || !/^[^\\s\\u0000-\\u001f\\u007f]{1,64}$/.test(playerId) ||
      (status !== 'pending_validation' && status !== 'review_required') ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return undefined;
  return { createdAt: value.createdAt, playerId, requestId, status };
}

async function recordPlayerReview(requestId, decision) {
  if (!requireOrdinaryKemerbetMutation()) return;
  if ((decision === 'exists' || decision === 'not_found') &&
      !window.confirm('Confirm that you manually checked this exact Player ID on KemerBet. This records existence only and does not prove ownership.')) return;
  setNotice('Recording Player ID review\u2026');
  try {
    const response = await ownerRequest('/v1/owner/player-registration-requests/' + encodeURIComponent(requestId) + '/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    if (!response.ok) throw new Error('review');
    setNotice('Player ID review recorded. Ownership and deposits remain disabled.');
    await loadOwnerPlayerQueues();
  } catch (error) {
    if (!isSignedOutError(error)) setNotice('Player ID review failed. Refresh before trying again.');
  }
}

function validAssociationCandidate(value) {
  if (!value || typeof value !== 'object') return undefined;
  const requestId = typeof value.requestId === 'string' ? value.requestId : undefined;
  const playerId = typeof value.playerId === 'string' ? value.playerId : undefined;
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
      value.platformCode !== 'kemerbet' || !playerId || !/^[^\\s\\u0000-\\u001f\\u007f]{1,64}$/.test(playerId) ||
      typeof value.reviewedAt !== 'string' || !Number.isFinite(Date.parse(value.reviewedAt))) return undefined;
  return { playerId, requestId, reviewedAt: value.reviewedAt };
}

function validPlayerEligibility(value) {
  if (!value || typeof value !== 'object') return undefined;
  const playerAccountId = typeof value.playerAccountId === 'string' ? value.playerAccountId : undefined;
  const playerId = typeof value.playerId === 'string' ? value.playerId : undefined;
  const decisionAbsent = value.decision === undefined && value.decisionId === undefined &&
    value.decisionVersion === undefined && value.reasonCode === undefined && value.decidedAt === undefined;
  const decisionPresent = (value.decision === 'eligible' || value.decision === 'revoked') &&
    typeof value.decisionId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.decisionId) &&
    Number.isSafeInteger(value.decisionVersion) && value.decisionVersion > 0 &&
    value.reasonCode === (value.decision === 'eligible' ? 'financial_eligibility_approved' : 'financial_eligibility_revoked') &&
    typeof value.decidedAt === 'string' && Number.isFinite(Date.parse(value.decidedAt));
  if (!playerAccountId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playerAccountId) ||
      value.platformCode !== 'kemerbet' || !playerId || !/^[^\\s\\u0000-\\u001f\\u007f]{1,64}$/.test(playerId) ||
      !['active', 'inactive', 'blocked', 'archived'].includes(value.playerStatus) ||
      !['unverified', 'valid', 'invalid', 'review_required'].includes(value.validationStatus) ||
      !(decisionAbsent || decisionPresent)) return undefined;
  return { decidedAt: value.decidedAt, decision: value.decision, decisionVersion: value.decisionVersion,
    playerAccountId, playerId, playerStatus: value.playerStatus, validationStatus: value.validationStatus };
}

function validReceiver(value) {
  if (!value || typeof value !== 'object') return undefined;
  const providerCode = value.providerCode;
  const expectedDisplay = providerCode === 'cbe_birr' ? 'CBE Birr' :
    providerCode === 'telebirr' ? 'TeleBirr' : undefined;
  if (!expectedDisplay || value.providerDisplayName !== expectedDisplay ||
      typeof value.receiverRevisionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.receiverRevisionId) ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      typeof value.accountHolderName !== 'string' ||
      !/^[^\\s\\u0000-\\u001f\\u007f](?:[^\\u0000-\\u001f\\u007f]{0,158}[^\\s\\u0000-\\u001f\\u007f])?$/.test(value.accountHolderName) ||
      typeof value.accountReferenceMasked !== 'string' || !/^\\*{3}[0-9]{4}$/.test(value.accountReferenceMasked) ||
      (value.receiverStatus !== 'active' && value.receiverStatus !== 'inactive') ||
      typeof value.activeFrom !== 'string' || !Number.isFinite(Date.parse(value.activeFrom)) ||
      typeof value.protectedReference !== 'boolean' ||
      (value.protectedReference &&
        !['initial_configuration', 'account_rotation', 'provider_incident_recovery', 'owner_correction'].includes(value.rotationReason)) ||
      (!value.protectedReference && value.rotationReason !== undefined) ||
      (value.receiverStatus === 'active' && value.retiredAt !== undefined) ||
      (value.receiverStatus === 'inactive' &&
        (typeof value.retiredAt !== 'string' || !Number.isFinite(Date.parse(value.retiredAt))))) return undefined;
  return { accountHolderName: value.accountHolderName, accountReferenceMasked: value.accountReferenceMasked,
    activeFrom: value.activeFrom, providerCode, providerDisplayName: expectedDisplay,
    receiverRevisionId: value.receiverRevisionId, receiverStatus: value.receiverStatus,
    protectedReference: value.protectedReference, retiredAt: value.retiredAt,
    revision: value.revision, rotationReason: value.rotationReason };
}

function renderReceivers(receivers) {
  receiverList.replaceChildren();
  if (receivers.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No protected receiver revisions are configured yet.';
    receiverList.append(empty);
    return;
  }
  for (const receiver of receivers) {
    const card = document.createElement('article');
    card.className = 'request-card';
    const title = document.createElement('h3');
    title.textContent = receiver.providerDisplayName + ' · ' + receiver.accountHolderName;
    const facts = document.createElement('p');
    facts.className = 'request-meta';
    facts.textContent = 'Revision ' + receiver.revision + ' · ' + receiver.receiverStatus +
      ' · ' + receiver.accountReferenceMasked + ' · ' +
      (receiver.protectedReference ? receiver.rotationReason : 'legacy protection') +
      ' · active from ' + new Date(receiver.activeFrom).toLocaleString() +
      (receiver.retiredAt ? ' · retired ' + new Date(receiver.retiredAt).toLocaleString() : '');
    card.append(title, facts);
    receiverList.append(card);
  }
}

async function loadReceivers() {
  receiverRefreshButton.disabled = true;
  try {
    const response = await ownerRequest('/v1/owner/receiver-accounts', { method: 'GET', headers: {} });
    if (!response.ok) throw new Error('receivers');
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.receivers) || payload.receivers.length > 100) throw new Error('receivers');
    const receivers = payload.receivers.map(validReceiver);
    if (receivers.some((receiver) => !receiver)) throw new Error('receivers');
    renderReceivers(receivers);
  } catch (error) {
    receiverList.replaceChildren();
    if (!isSignedOutError(error)) setNotice('Receiver-account history is unavailable. Do not rotate an account.');
  } finally {
    receiverRefreshButton.disabled = false;
  }
}

function receiverMutationHeaders(requestId) {
  return {
    'content-type': 'application/json',
    'x-fetanagent-owner-csrf': 'owner-receiver-rotation-v1',
    'x-idempotency-key': requestId,
  };
}

async function rotateReceiver() {
  if (!requireOrdinaryKemerbetMutation()) return;
  const providerCode = receiverForm.elements.providerCode.value;
  const accountHolderName = receiverForm.elements.accountHolderName.value;
  const accountReference = receiverForm.elements.accountReference.value;
  const rotationReason = receiverForm.elements.rotationReason.value;
  if (!receiverConfirmation.checked || !['cbe_birr', 'telebirr'].includes(providerCode) ||
      !/^[0-9]{9,24}$/.test(accountReference)) return;
  if (!window.confirm(
    'Create a new active ' + (providerCode === 'cbe_birr' ? 'CBE Birr' : 'TeleBirr') +
    ' receiver revision for ' + accountHolderName + ' ending ' + accountReference.slice(-4) +
    '? The previous active revision will be retired and cannot be reactivated.',
  )) return;
  const requestId = crypto.randomUUID();
  setBusy(receiverForm, true);
  setNotice('Protecting and rotating the receiver account…');
  try {
    const response = await ownerRequest('/v1/owner/receiver-accounts/rotate', {
      method: 'POST',
      headers: receiverMutationHeaders(requestId),
      body: JSON.stringify({ accountHolderName, accountReference,
        confirmation: 'owner_confirmed_receiver_rotation', providerCode, requestId, rotationReason }),
    });
    receiverAccountReference.value = '';
    if (response.status !== 201) throw new Error('receiver_rotation');
    const payload = await response.json();
    const receiver = validReceiver(payload && payload.receiver);
    if (!receiver || !receiver.protectedReference || receiver.providerCode !== providerCode) {
      throw new Error('receiver_rotation');
    }
    receiverConfirmation.checked = false;
    setNotice(receiver.providerDisplayName + ' receiver revision ' + receiver.revision +
      (receiver.receiverStatus === 'active' ? ' is active.' : ' was already applied and has since been superseded.') +
      ' Money remains disabled until later readiness gates pass.');
    await loadReceivers();
  } catch (error) {
    receiverAccountReference.value = '';
    if (!isSignedOutError(error)) {
      setNotice('Receiver rotation was rejected or unavailable. No account number was retained in this page. Refresh before retrying.');
    }
  } finally {
    setBusy(receiverForm, false);
    applyKemerbetQuarantineMutationBoundary();
  }
}

function validKemerbetAgentProfile(value) {
  if (!value || typeof value !== 'object' || value.platformCode !== 'kemerbet' ||
      typeof value.platformAgentAccountId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.platformAgentAccountId) ||
      typeof value.profileLabel !== 'string' || !/^Primary KemerBet agent revision [1-9][0-9]*$/.test(value.profileLabel) ||
      !Number.isSafeInteger(value.profileRevision) || value.profileRevision < 1 ||
      value.profileContractVersion !== 1 ||
      (value.profileStatus !== 'active' && value.profileStatus !== 'inactive') ||
      !['initial_configuration', 'agent_rotation', 'security_recovery', 'owner_correction'].includes(value.configurationReason) ||
      typeof value.configuredAt !== 'string' || !Number.isFinite(Date.parse(value.configuredAt)) ||
      (value.profileStatus === 'active' && value.retiredAt !== undefined) ||
      (value.profileStatus === 'inactive' &&
        (typeof value.retiredAt !== 'string' || !Number.isFinite(Date.parse(value.retiredAt))))) return undefined;
  return { configuredAt: value.configuredAt, configurationReason: value.configurationReason,
    platformAgentAccountId: value.platformAgentAccountId, platformCode: 'kemerbet',
    profileContractVersion: 1, profileLabel: value.profileLabel,
    profileRevision: value.profileRevision, profileStatus: value.profileStatus,
    retiredAt: value.retiredAt };
}

function renderKemerbetAgentProfiles(profiles) {
  activeKemerbetAgentProfileId = profiles.find((profile) => profile.profileStatus === 'active')
    ?.platformAgentAccountId;
  kemerbetAgentProfileList.replaceChildren();
  if (profiles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No Owner-prepared KemerBet agent profile exists yet.';
    kemerbetAgentProfileList.append(empty);
    kemerbetSessionStartButton.disabled = true;
    clearKemerbetSession();
    return;
  }
  for (const profile of profiles) {
    const card = document.createElement('article');
    card.className = 'request-card';
    const title = document.createElement('h3');
    title.textContent = profile.profileLabel;
    const facts = document.createElement('p');
    facts.className = 'request-meta';
    facts.textContent = profile.profileStatus + ' · ' + profile.configurationReason +
      ' · prepared ' + new Date(profile.configuredAt).toLocaleString() +
      (profile.retiredAt ? ' · retired ' + new Date(profile.retiredAt).toLocaleString() : '');
    card.append(title, facts);
    kemerbetAgentProfileList.append(card);
  }
  kemerbetSessionStartButton.disabled = !privateKemerbetSessionMutationAllowed() ||
    !activeKemerbetAgentProfileId ||
    Boolean(currentKemerbetSession?.active);
}

async function loadKemerbetAgentProfiles() {
  kemerbetAgentRefreshButton.disabled = true;
  try {
    const response = await ownerRequest('/v1/owner/kemerbet-agent-profiles', { method: 'GET', headers: {} });
    if (!response.ok) throw new Error('kemerbet_agent_profiles');
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.profiles) || payload.profiles.length > 100) throw new Error('kemerbet_agent_profiles');
    const profiles = payload.profiles.map(validKemerbetAgentProfile);
    if (profiles.some((profile) => !profile) ||
        profiles.filter((profile) => profile.profileStatus === 'active').length > 1) {
      throw new Error('kemerbet_agent_profiles');
    }
    renderKemerbetAgentProfiles(profiles);
    await loadKemerbetSession();
  } catch (error) {
    clearKemerbetAgentProfiles();
    if (!isSignedOutError(error)) setNotice('KemerBet agent-profile history is unavailable. Do not prepare a profile.');
  } finally {
    kemerbetAgentRefreshButton.disabled = false;
  }
}

function validKemerbetStartup(startup, session, quarantined) {
  if (startup === undefined) return true;
  if (!startup || typeof startup !== 'object') return false;
  const stages = ['browser_launch', 'cleanup', 'preflight', 'preview_ready', 'profile',
    'provider_asset', 'provider_navigation', 'recaptcha_asset', 'recaptcha_ceremony',
    'transport_guard'];
  const failureCodes = ['cleanup_unverified', 'contract_mismatch', 'deadline_exceeded',
    'dependency_unavailable', 'forbidden_request'];
  const failed = startup.status === 'failed';
  const expectedKeys = failed
    ? ['detailsRedacted', 'failureCode', 'schemaVersion', 'stage', 'status']
    : ['detailsRedacted', 'schemaVersion', 'stage', 'status'];
  if (Object.keys(startup).sort().join('\\0') !== expectedKeys.sort().join('\\0') ||
      startup.detailsRedacted !== true || startup.schemaVersion !== 1 ||
      !stages.includes(startup.stage) ||
      !['failed', 'ready', 'starting'].includes(startup.status) ||
      (failed && !failureCodes.includes(startup.failureCode)) ||
      (!failed && startup.failureCode !== undefined)) return false;
  if (failed && (startup.stage === 'preview_ready' ||
      (startup.stage === 'cleanup') !== (startup.failureCode === 'cleanup_unverified'))) {
    return false;
  }
  if (startup.status === 'starting') {
    return session.active === true && session.phase === 'starting' &&
      startup.stage !== 'preview_ready';
  }
  if (startup.status === 'ready') {
    return session.active === true && session.phase !== 'starting' &&
      startup.stage === 'preview_ready';
  }
  return !quarantined &&
    ((session.active === false && session.phase === 'idle') ||
      (session.active === true && ['faulted', 'stopping'].includes(session.phase)));
}

function validKemerbetAuthentication(authentication, session) {
  if (authentication === undefined) return true;
  if (!authentication || typeof authentication !== 'object') return false;
  const stages = ['agents_candidate', 'credential_released', 'identity_marker',
    'identity_stability', 'identity_value', 'post_login_ready', 'post_login_reload',
    'post_login_root', 'session_guard'];
  const failureCodes = ['identity_deadline_exceeded', 'identity_unavailable',
    'transition_deadline_exceeded'];
  const failed = authentication.status === 'failed';
  const expectedKeys = failed
    ? ['detailsRedacted', 'failureCode', 'schemaVersion', 'stage', 'status']
    : ['detailsRedacted', 'schemaVersion', 'stage', 'status'];
  if (Object.keys(authentication).sort().join('\\0') !== expectedKeys.sort().join('\\0') ||
      authentication.detailsRedacted !== true || authentication.schemaVersion !== 1 ||
      !stages.includes(authentication.stage) ||
      !['failed', 'verifying'].includes(authentication.status) ||
      (failed && !failureCodes.includes(authentication.failureCode)) ||
      (!failed && authentication.failureCode !== undefined)) return false;
  if (authentication.status === 'verifying') {
    return session.active === true && session.phase === 'authenticating';
  }
  return session.active === false
    ? session.phase === 'idle'
    : ['faulted', 'stopping'].includes(session.phase);
}

function validKemerbetSession(value) {
  if (!value || typeof value !== 'object' || typeof value.active !== 'boolean' ||
      typeof value.loginRequired !== 'boolean' || typeof value.signedIn !== 'boolean' ||
      typeof value.phase !== 'string' || value.transferDisabled !== true ||
      (value.signedIn && value.loginRequired)) return undefined;
  const quarantined = value.active === false && value.quarantine !== undefined;
  const expectedKeys = value.active
    ? ['active', 'expiresAt', 'frameSequence', 'generation', 'loginRequired', 'phase', 'signedIn', 'transferDisabled']
    : quarantined
      ? ['active', 'loginRequired', 'phase', 'quarantine', 'signedIn', 'transferDisabled']
      : ['active', 'loginRequired', 'phase', 'signedIn', 'transferDisabled'];
  if (value.authentication !== undefined) expectedKeys.push('authentication');
  if (value.startup !== undefined) expectedKeys.push('startup');
  if (Object.keys(value).sort().join('\\0') !== expectedKeys.sort().join('\\0')) return undefined;
  if (!validKemerbetAuthentication(value.authentication, value)) return undefined;
  if (!validKemerbetStartup(value.startup, value, quarantined)) return undefined;
  if (!value.active) {
    if (value.loginRequired || value.signedIn || !['checkpointed', 'idle'].includes(value.phase)) {
      return undefined;
    }
    if (quarantined &&
        (!value.quarantine || typeof value.quarantine !== 'object' ||
          Object.keys(value.quarantine).sort().join('\\0') !==
            ['reasonCode', 'recoveryRequired'].join('\\0') ||
          !['browser_cleanup_unverified', 'profile_integrity_unverified',
            'recheck_authorization_spent_failed_terminal',
            'security_recovery_cohort_required', 'security_recovery_in_progress',
            'unclean_session_generation'].includes(value.quarantine.reasonCode) ||
          value.quarantine.recoveryRequired !== true || value.phase !== 'idle')) return undefined;
    return value;
  }
  if (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) ||
      typeof value.generation !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.generation) ||
      !Number.isSafeInteger(value.frameSequence) || value.frameSequence < 0 ||
      !['authenticated', 'authenticating', 'faulted', 'login_required', 'starting', 'stopping'].includes(value.phase) ||
      (value.signedIn && value.phase !== 'authenticated') ||
      (value.loginRequired && value.phase !== 'login_required')) return undefined;
  return value;
}

async function drawKemerbetSessionFrame(response, generation) {
  const responseGeneration = response.headers.get('x-fetanagent-session-generation');
  const sequenceValue = response.headers.get('x-fetanagent-frame-sequence');
  if (responseGeneration !== generation || !/^[1-9][0-9]{0,9}$/.test(sequenceValue || '')) {
    throw new Error('kemerbet_frame');
  }
  const sequence = Number(sequenceValue);
  const image = await response.arrayBuffer();
  if (image.byteLength < 4 || image.byteLength > 2000000 ||
      currentKemerbetSession?.generation !== generation ||
      currentKemerbetSession.phase !== 'login_required') throw new Error('kemerbet_frame');
  const bitmap = await createImageBitmap(new Blob([image], { type: 'image/jpeg' }));
  try {
    const context = kemerbetSessionCanvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.clearRect(0, 0, kemerbetSessionCanvas.width, kemerbetSessionCanvas.height);
    context.drawImage(bitmap, 0, 0, kemerbetSessionCanvas.width, kemerbetSessionCanvas.height);
    kemerbetSessionCanvas.hidden = false;
    displayedKemerbetSessionGeneration = generation;
    displayedKemerbetFrameSequence = sequence;
  } finally {
    bitmap.close();
  }
}

async function loadKemerbetSessionFrame(session) {
  if (!session.active || session.phase !== 'login_required') return;
  const after = displayedKemerbetSessionGeneration === session.generation
    ? displayedKemerbetFrameSequence : 0;
  const response = await ownerRequest(
    '/v1/owner/kemerbet-session/frame?generation=' + encodeURIComponent(session.generation) +
      '&after=' + String(after),
    { method: 'GET', headers: {} },
  );
  if (response.status === 204) return;
  if (!response.ok || response.headers.get('content-type') !== 'image/jpeg') {
    throw new Error('kemerbet_frame');
  }
  await drawKemerbetSessionFrame(response, session.generation);
}

function scheduleKemerbetSessionPoll() {
  if (kemerbetSessionPollTimer !== undefined) window.clearTimeout(kemerbetSessionPollTimer);
  kemerbetSessionPollTimer = undefined;
  const recoveryRequired = kemerbetSecurityRecoveryRequired;
  if (!accessToken || !activeKemerbetAgentProfileId ||
      (!recoveryRequired && !currentKemerbetSession?.active && !kemerbetSessionReconnectNeeded)) return;
  const baseDelay = recoveryRequired && !currentKemerbetSession?.active ? 15000 :
    currentKemerbetSession?.phase === 'authenticated' ? 30000 :
    currentKemerbetSession?.phase === 'faulted' ? 5000 : 1500;
  const delay = kemerbetSessionPollFailures === 0 ? baseDelay :
    Math.min(30000, baseDelay * (2 ** Math.min(kemerbetSessionPollFailures, 5)));
  kemerbetSessionPollTimer = window.setTimeout(() => void loadKemerbetSession(), delay);
}

function kemerbetStartupFailureMessage(startup) {
  const stages = {
    browser_launch: 'isolated browser launch',
    cleanup: 'isolated browser cleanup',
    preflight: 'startup preflight',
    preview_ready: 'preview readiness',
    profile: 'secured browser-profile preparation',
    provider_asset: 'the reviewed KemerBet bootstrap assets',
    provider_navigation: 'KemerBet login navigation',
    recaptcha_asset: 'the reviewed reCAPTCHA assets',
    recaptcha_ceremony: 'the bounded reCAPTCHA request sequence',
    transport_guard: 'network-guard installation',
  };
  const failures = {
    cleanup_unverified: 'clean browser shutdown could not be verified',
    contract_mismatch: 'the reviewed public-resource contract changed',
    deadline_exceeded: 'the bounded startup deadline expired',
    dependency_unavailable: 'a required dependency was unavailable',
    forbidden_request: 'an unreviewed request was blocked',
  };
  return 'Private KemerBet sign-in stopped during ' + stages[startup.stage] + ' because ' +
    failures[startup.failureCode] + '. Transfer, final action, and money movement remain disabled.';
}

function kemerbetAuthenticationProgressMessage(authentication) {
  const messages = {
    agents_candidate:
      'KemerBet opened the signed-in Agents candidate page. Verifying the sealed agent identity…',
    credential_released:
      'Credential input was released after submission. Waiting for the bounded post-login reload…',
    identity_marker:
      'KemerBet agent identity marker was found. Verifying the sealed identity value…',
    identity_stability:
      'KemerBet sealed agent identity is stable. Finalizing the retained session…',
    identity_value:
      'KemerBet sealed agent identity value matched. Confirming identity stability…',
    post_login_ready:
      'KemerBet completed the reviewed post-login bootstrap. Waiting for the Agents page…',
    post_login_reload:
      'KemerBet completed the post-login reload. Verifying the reviewed root transition…',
    post_login_root:
      'KemerBet reached the reviewed post-login root. Verifying the bounded read-only bootstrap…',
    session_guard:
      'KemerBet signed-in session guard passed. Verifying the sealed agent identity marker…',
  };
  return messages[authentication.stage];
}

function kemerbetAuthenticationFailureMessage(authentication) {
  const stages = {
    agents_candidate: 'the signed-in Agents candidate page',
    credential_released: 'the credential-release transition',
    identity_marker: 'sealed identity-marker verification',
    identity_stability: 'sealed identity-stability verification',
    identity_value: 'sealed identity-value verification',
    post_login_ready: 'the reviewed post-login bootstrap',
    post_login_reload: 'the post-login reload',
    post_login_root: 'the post-login root transition',
    session_guard: 'the signed-in session guard',
  };
  const failures = {
    identity_deadline_exceeded: 'the bounded sealed-identity deadline expired',
    identity_unavailable: 'the sealed agent identity could not be verified',
    transition_deadline_exceeded: 'the bounded signed-in transition deadline expired',
  };
  return 'Private KemerBet sign-in stopped during ' + stages[authentication.stage] + ' because ' +
    failures[authentication.failureCode] + '. No credential was retained. Transfer remains disabled and no money moved.';
}

async function renderKemerbetSession(session, securityRecoverySessionAllowed = false) {
  const wasSignedIn = currentKemerbetSession?.signedIn === true;
  currentKemerbetSession = session;
  kemerbetSessionPollFailures = 0;
  kemerbetSessionReconnectNeeded = false;
  const recoveryRequired = session.quarantine?.recoveryRequired === true ||
    securityRecoverySessionAllowed;
  const recheckSpentFailedTerminal =
    session.quarantine?.reasonCode === 'recheck_authorization_spent_failed_terminal';
  const securityRecoveryCohortRequired =
    session.quarantine?.reasonCode === 'security_recovery_cohort_required';
  const securityRecoveryInProgress =
    session.quarantine?.reasonCode === 'security_recovery_in_progress' ||
    securityRecoverySessionAllowed;
  kemerbetSecurityRecoveryRequired = recoveryRequired;
  kemerbetRecheckSpentFailedTerminal = recheckSpentFailedTerminal;
  kemerbetSecurityRecoveryCohortRequired = securityRecoveryCohortRequired;
  kemerbetSecurityRecoveryInProgress = securityRecoveryInProgress;
  kemerbetSecurityRecoverySessionAllowed = securityRecoverySessionAllowed;
  kemerbetSessionStartButton.disabled = !privateKemerbetSessionMutationAllowed() ||
    !activeKemerbetAgentProfileId || session.phase !== 'idle';
  kemerbetSessionStopButton.disabled = !privateKemerbetSessionMutationAllowed() ||
    !session.active || session.phase === 'stopping';
  kemerbetSessionConfirmation.disabled = !privateKemerbetSessionMutationAllowed() || session.active;
  if (session.phase !== 'login_required') clearKemerbetPendingText();
  if (!session.active) {
    kemerbetSessionCanvas.hidden = true;
    displayedKemerbetSessionGeneration = undefined;
    displayedKemerbetFrameSequence = 0;
    if (session.authentication?.status === 'failed') {
      kemerbetSessionStatus.textContent = kemerbetAuthenticationFailureMessage(
        session.authentication,
      ) + ' Check the approval box again before retrying.';
    } else if (session.startup?.status === 'failed') {
      kemerbetSessionStatus.textContent = kemerbetStartupFailureMessage(session.startup) +
        ' Check the approval box again before retrying.';
    } else if (recoveryRequired) {
      if (!securityRecoverySessionAllowed) kemerbetSessionConfirmation.checked = false;
      kemerbetSessionCanvas.tabIndex = -1;
      kemerbetAgentProfileConfirmation.checked = false;
      if (recheckSpentFailedTerminal) {
        kemerbetSessionStatus.textContent =
          'The one-use KemerBet recheck authorization was spent before a durable successful result and is terminally failed. ' +
          'It is non-retryable. Every KemerBet mutation, Amount, Transfer, final action, and money movement remains disabled.';
      } else if (securityRecoveryCohortRequired) {
        kemerbetSessionStatus.textContent =
          'The security-recovery profile is finalized. Only the exact five-Player no-transfer readiness cohort may now be prepared. ' +
          'Every other KemerBet mutation, Amount, Transfer, final action, and money movement remains disabled.';
      } else if (securityRecoveryInProgress) {
        kemerbetSessionStatus.textContent =
          'KemerBet security recovery is in progress with its exact one-use cohort already bound. ' +
          (securityRecoverySessionAllowed
            ? 'Check the approval box, then select Start private sign-in. Another cohort, Amount, Transfer, final action, and money movement remain disabled.'
            : 'Another cohort cannot be prepared. Every mutation, Amount, Transfer, final action, and money movement remains disabled.');
      } else {
        kemerbetAgentProfileReason.value = 'security_recovery';
        kemerbetSessionStatus.textContent =
          'This KemerBet browser profile is quarantined because a clean checkpoint could not be verified. ' +
          'Security recovery must retire it before another private sign-in. Start, Stop, preview input, ' +
          'Transfer, and money movement remain disabled. Status-only recovery checks continue automatically.';
      }
    } else {
      if (kemerbetAgentProfileReason.value === 'security_recovery') {
        kemerbetAgentProfileReason.value = activeKemerbetAgentProfileId
          ? 'agent_rotation'
          : 'initial_configuration';
      }
      kemerbetAgentProfileReason.disabled = false;
      kemerbetSessionCanvas.tabIndex = 0;
      kemerbetSessionStatus.textContent =
        'Private sign-in service is stopped. Check the approval box, then select Start private sign-in.';
    }
    applyKemerbetQuarantineMutationBoundary();
    scheduleKemerbetSessionPoll();
    return;
  }
  kemerbetSessionConfirmation.disabled = true;
  kemerbetSessionCanvas.tabIndex = 0;
  if (session.phase !== 'login_required') {
    kemerbetSessionCanvas.hidden = true;
    displayedKemerbetSessionGeneration = undefined;
    displayedKemerbetFrameSequence = 0;
  }
  if (session.authentication?.status === 'failed') {
    kemerbetSessionStatus.textContent = kemerbetAuthenticationFailureMessage(
      session.authentication,
    );
  } else if (session.startup?.status === 'failed') {
    kemerbetSessionStatus.textContent = kemerbetStartupFailureMessage(session.startup);
  } else if (session.phase === 'authenticated') {
    kemerbetSessionStatus.textContent = 'KemerBet signed in and retained until ' +
      new Date(session.expiresAt).toLocaleString() +
      '. Input is locked and Transfer remains disabled.';
    if (!wasSignedIn) {
      setNotice('KemerBet sign-in complete. The authenticated session is retained and preview input is locked.');
    }
  } else if (session.phase === 'login_required') {
    await loadKemerbetSessionFrame(session);
    kemerbetSessionStatus.textContent = 'Private KemerBet login is open until ' +
      new Date(session.expiresAt).toLocaleTimeString() + '. Click the preview, then type your password or OTP.';
  } else if (session.phase === 'authenticating') {
    kemerbetSessionStatus.textContent = session.authentication?.status === 'verifying'
      ? kemerbetAuthenticationProgressMessage(session.authentication)
      : 'KemerBet opened the signed-in candidate page. Verifying the exact sealed agent identity…';
  } else if (session.phase === 'starting') {
    kemerbetSessionStatus.textContent = 'Starting the isolated KemerBet browser. This page will reconnect automatically…';
  } else if (session.phase === 'stopping') {
    kemerbetSessionStatus.textContent = 'Closing the KemerBet browser and checkpointing its profile cleanly…';
  } else {
    kemerbetSessionStatus.textContent = 'The private browser is faulted and remains locked. Stop it before retrying.';
  }
  applyKemerbetQuarantineMutationBoundary();
  scheduleKemerbetSessionPoll();
}

async function loadKemerbetSession(timeoutMs = OWNER_API_REQUEST_TIMEOUT_MS) {
  if (!activeKemerbetAgentProfileId || !accessToken || kemerbetInputPending) return;
  kemerbetSessionPollTimer = undefined;
  try {
    const response = await ownerRequest(
      '/v1/owner/kemerbet-session',
      { method: 'GET', headers: {} },
      timeoutMs,
    );
    if (!response.ok) throw new Error('kemerbet_session');
    const payload = await response.json();
    const session = validKemerbetSession(payload && payload.session);
    if (!session) throw new Error('kemerbet_session');
    await renderKemerbetSession(session, payload.securityRecoverySessionAllowed === true);
  } catch (error) {
    if (!isSignedOutError(error)) {
      kemerbetSessionPollFailures += 1;
      kemerbetSessionReconnectNeeded = true;
      kemerbetSessionStatus.textContent = currentKemerbetSession?.active
        ? 'Connection to the private browser is temporarily unavailable. The last confirmed state is retained while reconnecting…'
        : 'Private sign-in status is temporarily unavailable. Reconnecting…';
      scheduleKemerbetSessionPoll();
    }
    applyKemerbetQuarantineMutationBoundary();
  }
}

function kemerbetSessionMutationHeaders(requestId) {
  return { 'content-type': 'application/json',
    'x-fetanagent-owner-csrf': 'owner-kemerbet-session-v1',
    'x-idempotency-key': requestId };
}

async function startKemerbetSession() {
  if (!requirePrivateKemerbetSessionMutation()) return;
  if (!activeKemerbetAgentProfileId) {
    const message = 'No active KemerBet agent profile is available. No private browser was started and no money moved.';
    kemerbetSessionStatus.textContent = message;
    setNotice(message);
    return;
  }
  if (!kemerbetSessionConfirmation.checked) {
    const message =
      'Check the approval box first. No private browser was started. Transfer remains disabled and no money moved.';
    kemerbetSessionStatus.textContent = message;
    setNotice(message);
    kemerbetSessionConfirmation.focus();
    return;
  }
  const requestId = crypto.randomUUID();
  kemerbetSessionStartButton.disabled = true;
  const startingMessage = 'Starting the private KemerBet sign-in browser…';
  kemerbetSessionStatus.textContent = startingMessage;
  setNotice(startingMessage);
  try {
    const response = await ownerRequest('/v1/owner/kemerbet-session/start', {
      method: 'POST', headers: kemerbetSessionMutationHeaders(requestId),
      body: JSON.stringify({ confirmation: 'owner_confirmed_private_kemerbet_sign_in', requestId }),
    });
    if (response.status !== 202) throw new Error('kemerbet_session');
    const payload = await response.json();
    const session = validKemerbetSession(payload && payload.session);
    if (!session || !session.active ||
        !['authenticated', 'authenticating', 'login_required', 'starting'].includes(session.phase)) {
      throw new Error('kemerbet_session');
    }
    kemerbetSessionConfirmation.checked = false;
    await renderKemerbetSession(session, payload.securityRecoverySessionAllowed === true);
    if (session.phase === 'login_required') {
      kemerbetSessionCanvas.focus();
      setNotice('Private KemerBet sign-in is ready. Click the preview and type there only.');
    } else if (session.phase === 'authenticated') {
      setNotice('KemerBet is already signed in. The restored browser is locked and Transfer remains disabled.');
    } else {
      setNotice('Private KemerBet sign-in was accepted. The page will reconnect automatically when the browser is ready.');
    }
  } catch (error) {
    await loadKemerbetSession(OWNER_RECONCILIATION_REQUEST_TIMEOUT_MS);
    if (!isSignedOutError(error)) {
      if (currentKemerbetSession?.active) {
        setNotice(currentKemerbetSession.signedIn
          ? 'KemerBet is already signed in. The retained browser remains locked and Transfer is disabled.'
          : 'The private KemerBet sign-in browser is already open. Click the preview and type there only.');
        return;
      }
      if (currentKemerbetSession?.startup?.status === 'failed') {
        const failureMessage = kemerbetStartupFailureMessage(currentKemerbetSession.startup) +
          ' Check the approval box again before retrying.';
        kemerbetSessionStatus.textContent = failureMessage;
        setNotice(failureMessage);
        return;
      }
      const failureMessage =
        'Private KemerBet sign-in could not start. No credential was accepted. Check the approval box again before retrying.';
      kemerbetSessionStatus.textContent = failureMessage;
      setNotice(failureMessage);
    }
  }
}

async function stopKemerbetSession({ confirm = true } = {}) {
  if (!requirePrivateKemerbetSessionMutation() || !currentKemerbetSession?.active) return;
  if (confirm && !window.confirm('Stop the private KemerBet sign-in browser now?')) return;
  clearKemerbetPendingText();
  const requestId = crypto.randomUUID();
  kemerbetSessionStopButton.disabled = true;
  try {
    const response = await ownerRequest('/v1/owner/kemerbet-session/stop', {
      method: 'POST', headers: kemerbetSessionMutationHeaders(requestId),
      body: JSON.stringify({ confirmation: 'owner_confirmed_stop_private_kemerbet_session', requestId }),
    });
    if (response.status !== 202) throw new Error('kemerbet_session');
    const payload = await response.json();
    const session = validKemerbetSession(payload && payload.session);
    if (!session || (session.active && session.phase !== 'stopping')) {
      throw new Error('kemerbet_session');
    }
    await renderKemerbetSession(session, payload.securityRecoverySessionAllowed === true);
    setNotice(session.phase === 'stopping'
      ? 'Private KemerBet sign-in browser is closing cleanly. This page will confirm when it stops.'
      : 'Private KemerBet sign-in browser stopped.');
  } catch (error) {
    if (!isSignedOutError(error)) setNotice('Stop acknowledgement is unavailable. Retry Stop immediately.');
  }
}

async function sendKemerbetSessionInput(input) {
  if (!requirePrivateKemerbetSessionMutation() || !currentKemerbetSession?.active ||
      currentKemerbetSession.phase !== 'login_required' ||
      displayedKemerbetSessionGeneration !== currentKemerbetSession.generation ||
      displayedKemerbetFrameSequence < 1) return;
  kemerbetInputPending = true;
  if (kemerbetSessionPollTimer !== undefined) window.clearTimeout(kemerbetSessionPollTimer);
  const requestId = crypto.randomUUID();
  try {
    const response = await ownerRequest('/v1/owner/kemerbet-session/input', {
      method: 'POST', headers: kemerbetSessionMutationHeaders(requestId),
      body: JSON.stringify({ ...input, frameSequence: displayedKemerbetFrameSequence, requestId,
        sessionGeneration: displayedKemerbetSessionGeneration }),
    });
    if (!response.ok) throw new Error('kemerbet_session');
    const payload = await response.json();
    const session = validKemerbetSession(payload && payload.session);
    if (!session) throw new Error('kemerbet_session');
    await renderKemerbetSession(session, payload.securityRecoverySessionAllowed === true);
  } catch (error) {
    if (!isSignedOutError(error)) setNotice('Private browser input was rejected. Refresh the session before retrying.');
  } finally {
    kemerbetInputPending = false;
    scheduleKemerbetSessionPoll();
  }
}

function queueKemerbetSessionInput(input) {
  kemerbetInputLane = kemerbetInputLane.then(
    () => sendKemerbetSessionInput(input),
    () => sendKemerbetSessionInput(input),
  );
}

function clearKemerbetPendingText() {
  if (kemerbetTextFlushTimer !== undefined) window.clearTimeout(kemerbetTextFlushTimer);
  kemerbetTextFlushTimer = undefined;
  kemerbetPendingText = '';
}

function flushKemerbetPendingText() {
  if (kemerbetTextFlushTimer !== undefined) window.clearTimeout(kemerbetTextFlushTimer);
  kemerbetTextFlushTimer = undefined;
  const text = kemerbetPendingText;
  kemerbetPendingText = '';
  if (text) queueKemerbetSessionInput({ kind: 'text', text });
}

function bufferKemerbetSessionText(key) {
  if (!/^[\u0020-\u007e]$/.test(key) || key === '\u0060') return;
  kemerbetPendingText += key;
  if (kemerbetPendingText.length >= KEMERBET_TEXT_BATCH_MAX_CHARS) {
    flushKemerbetPendingText();
    return;
  }
  if (kemerbetTextFlushTimer !== undefined) window.clearTimeout(kemerbetTextFlushTimer);
  kemerbetTextFlushTimer = window.setTimeout(
    flushKemerbetPendingText,
    KEMERBET_TEXT_BATCH_DELAY_MS,
  );
}

async function prepareKemerbetAgentProfile() {
  const configurationReason = kemerbetAgentProfileForm.elements.configurationReason.value;
  const recoveryRequired = kemerbetSecurityRecoveryRequired;
  if (kemerbetRecheckSpentFailedTerminal || kemerbetSecurityRecoveryCohortRequired ||
      kemerbetSecurityRecoveryInProgress || !kemerbetAgentProfileConfirmation.checked ||
      !['initial_configuration', 'agent_rotation', 'security_recovery', 'owner_correction'].includes(configurationReason) ||
      (configurationReason === 'security_recovery') !== recoveryRequired) return;
  if (!window.confirm(
    'Prepare a new opaque KemerBet agent browser profile? The active profile will be retired. This does not sign in or move money.',
  )) return;
  const requestId = crypto.randomUUID();
  setBusy(kemerbetAgentProfileForm, true);
  setNotice('Preparing the credential-free KemerBet agent profile…');
  try {
    const response = await ownerRequest('/v1/owner/kemerbet-agent-profiles/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
        'x-fetanagent-owner-csrf': 'owner-kemerbet-agent-profile-v1',
        'x-idempotency-key': requestId },
      body: JSON.stringify({ configurationReason,
        confirmation: 'owner_confirmed_kemerbet_agent_profile', requestId }),
    });
    if (response.status === 409) {
      const failure = await response.json().catch(() => undefined);
      setNotice(failure?.error === 'kemerbet_security_recovery_required'
        ? 'KemerBet security recovery is required. Only the exact security-recovery profile action remains available; no money moved.'
        : 'Stop the current private KemerBet sign-in browser before preparing a new profile. The existing profile was not changed.');
      return;
    }
    if (response.status !== 201) throw new Error('kemerbet_agent_profile');
    const payload = await response.json();
    const profile = validKemerbetAgentProfile(payload && payload.profile);
    if (!profile || profile.configurationReason !== configurationReason) throw new Error('kemerbet_agent_profile');
    kemerbetAgentProfileConfirmation.checked = false;
    setNotice(profile.profileLabel + ' is prepared. KemerBet login, Transfer, and money movement remain disabled.');
    if (configurationReason === 'security_recovery') await loadOwnerPlayerQueues();
    else await loadKemerbetAgentProfiles();
  } catch (error) {
    if (!isSignedOutError(error)) {
      setNotice('KemerBet agent-profile preparation was rejected or unavailable. No credential was requested or retained.');
    }
  } finally {
    setBusy(kemerbetAgentProfileForm, false);
    applyKemerbetQuarantineMutationBoundary();
  }
}

function validPilotStatus(value) {
  if (!value || typeof value !== 'object') return undefined;
  const pilotRevisionId = typeof value.pilotRevisionId === 'string' ? value.pilotRevisionId : undefined;
  const statusValid = value.pilotStatus === 'draft' || value.pilotStatus === 'armed' || value.pilotStatus === 'stopped';
  const switchValid = value.switchMode === 'disabled' || value.switchMode === 'dry_run' || value.switchMode === 'live';
  if (!pilotRevisionId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pilotRevisionId) ||
      value.contractVersion !== 1 || !statusValid || !switchValid ||
      typeof value.configurationDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.configurationDigest) ||
      typeof value.financiallyActive !== 'boolean' || typeof value.withinActiveWindow !== 'boolean' ||
      value.playerCount !== 5 || value.providerCount !== 1 ||
      !Number.isSafeInteger(value.submittingCustomerCount) || value.submittingCustomerCount < 1 || value.submittingCustomerCount > 5 ||
      !Number.isSafeInteger(value.reservedDepositCount) || value.reservedDepositCount < 0 || value.reservedDepositCount > 5 ||
      value.maximumReservationCount !== 5 || value.maximumAggregateMinor !== '12500' ||
      typeof value.reservedAmountMinor !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value.reservedAmountMinor) ||
      BigInt(value.reservedAmountMinor) > 12500n ||
      typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) ||
      (value.financiallyActive && (value.pilotStatus !== 'armed' || value.switchMode !== 'live')) ||
      (value.pilotStatus === 'draft' && value.switchMode !== 'disabled') ||
      (value.pilotStatus === 'armed' && value.switchMode !== 'dry_run' && value.switchMode !== 'live') ||
      (value.pilotStatus === 'stopped' && value.switchMode !== 'disabled')) return undefined;
  return {
    configurationDigest: value.configurationDigest,
    expiresAt: value.expiresAt,
    financiallyActive: value.financiallyActive,
    pilotRevisionId,
    pilotStatus: value.pilotStatus,
    reservedAmountMinor: value.reservedAmountMinor,
    reservedDepositCount: value.reservedDepositCount,
    switchMode: value.switchMode,
    withinActiveWindow: value.withinActiveWindow,
  };
}

function validKemerbetReadinessCohortReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        'alreadyPrepared,identifiersRedacted,moneyMoved,playersPrepared,transferDisabled' ||
      typeof value.alreadyPrepared !== 'boolean' || value.identifiersRedacted !== true ||
      value.moneyMoved !== false || value.playersPrepared !== 5 ||
      value.transferDisabled !== true) return undefined;
  return { alreadyPrepared: value.alreadyPrepared };
}

function updateKemerbetReadinessCohortAvailability() {
  const hasOpenPilot = currentPilot?.pilotStatus === 'draft' ||
    currentPilot?.pilotStatus === 'armed';
  kemerbetReadinessCohortButton.disabled = readinessCohortPrepared ||
    !readinessKemerbetMutationAllowed() ||
    !currentPilotLoaded || hasOpenPilot ||
    eligibleReadinessCohortPlayerCount !== 5 ||
    !kemerbetReadinessCohortConfirmation.checked;
  if (readinessCohortPrepared) {
    kemerbetReadinessCohortStatus.textContent =
      'Prepared for five Players. Identifiers are redacted, Transfer is disabled, and no money moved.';
    return;
  }
  if (!currentPilotLoaded) {
    kemerbetReadinessCohortStatus.textContent =
      'Checking the current private-pilot state before readiness preparation.';
    return;
  }
  if (hasOpenPilot) {
    kemerbetReadinessCohortStatus.textContent =
      'Preparation is blocked by the current ' + currentPilot.pilotStatus +
      ' TeleBirr pilot. Stop that pilot below before preparing the one-use KemerBet readiness ' +
      'cohort. Money remains disabled.';
    return;
  }
  kemerbetReadinessCohortStatus.textContent = eligibleReadinessCohortPlayerCount +
    '/5 currently eligible Players are available. ' +
    (eligibleReadinessCohortPlayerCount === 5
      ? 'The server will independently re-check this exact count.'
      : 'Preparation remains blocked unless the current eligible count is exactly five.');
}

function renderKemerbetReadinessCohortAvailability(players) {
  eligibleReadinessCohortPlayerCount = players.filter((player) =>
    player.playerStatus === 'active' && player.validationStatus === 'valid' &&
    player.decision === 'eligible').length;
  updateKemerbetReadinessCohortAvailability();
}

function strictBase64UrlText(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const canonical = btoa(text).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    return canonical === value ? text : undefined;
  } catch {
    return undefined;
  }
}

function validCompanionDevicePairingReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        'alreadyIssued,devicePlatform,expiresAt,lookupAllowed,moneyMovementAllowed,pairingOnly,pairingPackage,transferDisabled' ||
      typeof value.alreadyIssued !== 'boolean' ||
      value.devicePlatform !== 'windows' ||
      value.lookupAllowed !== false ||
      value.moneyMovementAllowed !== false ||
      value.pairingOnly !== true ||
      value.transferDisabled !== true ||
      typeof value.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      new Date(value.expiresAt).toISOString() !== value.expiresAt ||
      typeof value.pairingPackage !== 'string' ||
      value.pairingPackage.length > 8_192 ||
      !value.pairingPackage.startsWith('fetanagent-companion-pairing-v1.')) return undefined;
  const encoded = value.pairingPackage.slice('fetanagent-companion-pairing-v1.'.length);
  const canonicalJson = strictBase64UrlText(encoded);
  if (!canonicalJson) return undefined;
  try {
    const grant = JSON.parse(canonicalJson);
    const requiredKeys = [
      'schemaVersion', 'protocolMode', 'pairingId', 'pairingNonceDigest', 'issuedAt',
      'expiresAt', 'endpoint', 'signerKeyId', 'serverSigningPublicKeySpki',
      'serverSigningPublicKeySpkiSha256', 'minimumCompanionVersion', 'oneUse',
      'accountMutationAllowed', 'balanceMutationAllowed', 'providerMutationAllowed',
      'paymentAllowed', 'depositAllowed', 'withdrawAllowed', 'transferAllowed',
      'settlementAllowed', 'finalActionAllowed', 'financialActionAllowed',
      'moneyMovementAllowed', 'transferDisabled', 'identifiersRedacted', 'moneyMoved',
    ].sort().join(',');
    if (!grant || typeof grant !== 'object' || Array.isArray(grant) ||
        Object.keys(grant).sort().join(',') !== requiredKeys ||
        grant.schemaVersion !== 1 ||
        grant.protocolMode !== 'local_companion_no_transfer_v1' ||
        typeof grant.pairingId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(grant.pairingId) ||
        typeof grant.pairingNonceDigest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/.test(grant.pairingNonceDigest) ||
        typeof grant.issuedAt !== 'string' ||
        new Date(grant.issuedAt).toISOString() !== grant.issuedAt ||
        grant.expiresAt !== value.expiresAt ||
        Date.parse(grant.expiresAt) <= Date.parse(grant.issuedAt) ||
        Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt) > 10 * 60 * 1_000 ||
        grant.endpoint !== 'https://device.fetanagent.com/v1/companion/device/enrollments:pair' ||
        typeof grant.signerKeyId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(grant.signerKeyId) ||
        typeof grant.serverSigningPublicKeySpki !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(grant.serverSigningPublicKeySpki) ||
        typeof grant.serverSigningPublicKeySpkiSha256 !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/.test(grant.serverSigningPublicKeySpkiSha256) ||
        grant.minimumCompanionVersion !== '0.1.5' || grant.oneUse !== true ||
        grant.accountMutationAllowed !== false || grant.balanceMutationAllowed !== false ||
        grant.providerMutationAllowed !== false || grant.paymentAllowed !== false ||
        grant.depositAllowed !== false || grant.withdrawAllowed !== false ||
        grant.transferAllowed !== false || grant.settlementAllowed !== false ||
        grant.finalActionAllowed !== false || grant.financialActionAllowed !== false ||
        grant.moneyMovementAllowed !== false || grant.transferDisabled !== true ||
        grant.identifiersRedacted !== true || grant.moneyMoved !== false) return undefined;
  } catch {
    return undefined;
  }
  return {
    alreadyIssued: value.alreadyIssued,
    expiresAt: value.expiresAt,
    pairingPackage: value.pairingPackage,
  };
}

function updateCompanionDevicePairingAvailability() {
  if (currentCompanionDevicePairing &&
      Date.parse(currentCompanionDevicePairing.expiresAt) <= Date.now()) {
    clearCompanionDevicePairingPackage();
    clearPendingCompanionDevicePairingRequestId();
  }
  const configured = ownerAuthConfig?.companionDevicePairingConfigured === true;
  companionDevicePairingButton.disabled = !configured ||
    Boolean(currentCompanionDevicePairing) ||
    !companionDevicePairingConfirmation.checked ||
    companionDevicePairingForm.dataset.ownerBusy === 'true';
  if (!ownerAuthConfig) {
    companionDevicePairingStatus.textContent = 'Sign in to check pairing readiness.';
  } else if (!configured) {
    companionDevicePairingStatus.textContent =
      'Windows pairing is disabled until the independent server signing key and bridge are provisioned.';
  } else if (currentCompanionDevicePairing) {
    companionDevicePairingStatus.textContent =
      'One public-key pairing package is ready until ' +
      new Date(currentCompanionDevicePairing.expiresAt).toLocaleString() + '.';
  } else if (readPendingCompanionDevicePairingRequestId()) {
    companionDevicePairingStatus.textContent =
      'A prior request is pending reconciliation. Create will recover that exact package only.';
  } else {
    companionDevicePairingStatus.textContent =
      'Ready to create one ten-minute public-key pairing package. Lookup and money authority remain disabled.';
  }
}

function showCompanionDevicePairing(receipt) {
  clearCompanionDevicePairingPackage();
  currentCompanionDevicePairing = receipt;
  companionDevicePairingPackage.textContent = receipt.pairingPackage;
  companionDevicePairingReceipt.hidden = false;
  companionDevicePairingConfirmation.checked = false;
  const delay = Math.max(1, Date.parse(receipt.expiresAt) - Date.now());
  companionDevicePairingExpiryTimer = window.setTimeout(() => {
    if (currentCompanionDevicePairing?.pairingPackage !== receipt.pairingPackage) return;
    clearCompanionDevicePairingPackage();
    clearPendingCompanionDevicePairingRequestId();
    updateCompanionDevicePairingAvailability();
  }, delay);
  updateCompanionDevicePairingAvailability();
}

function validCompanionLookupStatus(value, issueReceipt = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const terminal = value.state === 'completed' || value.state === 'review_required';
  const keys = [
    'assignmentId', 'state', 'issuedAt', 'expiresAt', 'playerCount', 'platformCode',
    'lookupMode', 'identifiersRedacted', 'transferDisabled', 'moneyMovementAllowed',
    'moneyMoved',
  ];
  if (terminal) keys.push('completedAt', 'foundCount', 'notFoundCount', 'reviewRequiredCount');
  if (issueReceipt) keys.push('alreadyIssued');
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',') ||
      typeof value.assignmentId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.assignmentId) ||
      !['pending', 'claimed', 'signed', 'completed', 'review_required', 'expired'].includes(value.state) ||
      typeof value.issuedAt !== 'string' || new Date(value.issuedAt).toISOString() !== value.issuedAt ||
      typeof value.expiresAt !== 'string' || new Date(value.expiresAt).toISOString() !== value.expiresAt ||
      Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) ||
      Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 10 * 60 * 1_000 ||
      value.playerCount !== 5 || value.platformCode !== 'kemerbet' ||
      value.lookupMode !== 'find_only' || value.identifiersRedacted !== true ||
      value.transferDisabled !== true || value.moneyMovementAllowed !== false ||
      value.moneyMoved !== false ||
      (issueReceipt && typeof value.alreadyIssued !== 'boolean')) return undefined;
  if (terminal) {
    if (typeof value.completedAt !== 'string' ||
        new Date(value.completedAt).toISOString() !== value.completedAt ||
        !Number.isInteger(value.foundCount) || value.foundCount < 0 || value.foundCount > 5 ||
        !Number.isInteger(value.notFoundCount) || value.notFoundCount < 0 || value.notFoundCount > 5 ||
        !Number.isInteger(value.reviewRequiredCount) || value.reviewRequiredCount < 0 ||
        value.reviewRequiredCount > 5 ||
        value.foundCount + value.notFoundCount + value.reviewRequiredCount !== 5) return undefined;
  }
  return value;
}

function clearCompanionLookup() {
  if (companionLookupPollTimer !== undefined) window.clearTimeout(companionLookupPollTimer);
  companionLookupPollTimer = undefined;
  currentCompanionLookup = undefined;
  companionLookupResult.replaceChildren();
  companionLookupResult.hidden = true;
}

function updateCompanionLookupAvailability() {
  const configured = ownerAuthConfig?.companionDevicePairingConfigured === true;
  const active = currentCompanionLookup &&
    ['pending', 'claimed', 'signed'].includes(currentCompanionLookup.state) &&
    Date.parse(currentCompanionLookup.expiresAt) > Date.now();
  companionLookupButton.disabled = !configured || active ||
    !companionLookupConfirmation.checked || companionLookupForm.dataset.ownerBusy === 'true';
  if (!ownerAuthConfig) {
    companionLookupStatus.textContent = 'Sign in to check lookup readiness.';
  } else if (!configured) {
    companionLookupStatus.textContent =
      'Signed companion lookup is disabled until the bridge signer is provisioned.';
  } else if (!currentCompanionLookup) {
    companionLookupStatus.textContent =
      'Ready to issue one exact-five find-only assignment. All money actions remain disabled.';
  } else if (currentCompanionLookup.state === 'pending') {
    companionLookupStatus.textContent = 'Signed assignment is waiting for the paired companion.';
  } else if (currentCompanionLookup.state === 'claimed') {
    companionLookupStatus.textContent = 'The bridge is signing the exact assignment.';
  } else if (currentCompanionLookup.state === 'signed') {
    companionLookupStatus.textContent = 'The paired companion is running five read-only lookups.';
  } else if (currentCompanionLookup.state === 'completed') {
    companionLookupStatus.textContent = 'Five signed read-only lookups completed successfully.';
  } else if (currentCompanionLookup.state === 'review_required') {
    companionLookupStatus.textContent = 'The signed lookup finished and requires review.';
  } else {
    companionLookupStatus.textContent = 'The prior assignment expired without a final result.';
  }
}

function renderCompanionLookup(status) {
  currentCompanionLookup = status;
  companionLookupResult.replaceChildren();
  companionLookupResult.hidden = !status;
  if (status) {
    const facts = [
      ['State', status.state.replace('_', ' ')],
      ['Players', '5'],
      ['Mode', 'Find only'],
      ['Transfer', 'Disabled'],
      ['Money moved', 'No'],
      ['Expires', new Date(status.expiresAt).toLocaleString()],
    ];
    if (status.state === 'completed' || status.state === 'review_required') {
      facts.push(
        ['Found', String(status.foundCount)],
        ['Not found', String(status.notFoundCount)],
        ['Review required', String(status.reviewRequiredCount)],
      );
    }
    for (const [label, value] of facts) {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      companionLookupResult.append(term, detail);
    }
  }
  updateCompanionLookupAvailability();
}

function scheduleCompanionLookupStatus() {
  if (companionLookupPollTimer !== undefined) window.clearTimeout(companionLookupPollTimer);
  companionLookupPollTimer = undefined;
  if (!currentCompanionLookup ||
      !['pending', 'claimed', 'signed'].includes(currentCompanionLookup.state)) return;
  companionLookupPollTimer = window.setTimeout(() => void loadCompanionLookupStatus(), 2_000);
}

async function loadCompanionLookupStatus() {
  try {
    const response = await ownerRequest('/v1/owner/companion-exact-five-lookup/status', {
      method: 'GET', headers: {},
    });
    if (!response.ok) throw new Error('companion_lookup_status');
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        Object.keys(payload).join(',') !== 'lookup') throw new Error('companion_lookup_status');
    const status = payload.lookup === null ? undefined : validCompanionLookupStatus(payload.lookup);
    if (payload.lookup !== null && !status) throw new Error('companion_lookup_status');
    renderCompanionLookup(status);
    if (status) clearPendingCompanionLookupRequestId();
  } catch (error) {
    if (!isSignedOutError(error)) {
      companionLookupStatus.textContent =
        'Signed lookup status is temporarily unavailable. Transfer remains disabled.';
    }
  } finally {
    scheduleCompanionLookupStatus();
  }
}

function companionLookupMutationHeaders(requestId) {
  return {
    'content-type': 'application/json',
    'x-fetanagent-owner-csrf': 'owner-companion-exact-five-lookup-v1',
    'x-idempotency-key': requestId,
  };
}

async function issueCompanionLookup() {
  if (ownerAuthConfig?.companionDevicePairingConfigured !== true ||
      !companionLookupConfirmation.checked ||
      (currentCompanionLookup && ['pending', 'claimed', 'signed'].includes(currentCompanionLookup.state))) return;
  if (!window.confirm(
    'Run exactly five find-only KemerBet Player-ID lookups on the paired local companion? ' +
    'Amount, Notes, Transfer, settlement, execution, and money movement remain disabled.',
  )) return;
  const requestId = readPendingCompanionLookupRequestId() ?? crypto.randomUUID();
  persistPendingCompanionLookupRequestId(requestId);
  setBusy(companionLookupForm, true);
  setNotice('Issuing the signed exact-five read-only lookup assignment…');
  let terminalFailure = false;
  try {
    const response = await ownerRequest('/v1/owner/companion-exact-five-lookup', {
      method: 'POST',
      headers: companionLookupMutationHeaders(requestId),
      body: JSON.stringify({
        confirmation: 'owner_confirmed_exact_five_find_only_no_money',
        requestId,
      }),
    });
    if (response.status !== 200 && response.status !== 201) {
      const failure = await response.json().catch(() => undefined);
      if (response.status === 400 || response.status === 409) {
        terminalFailure = true;
        clearPendingCompanionLookupRequestId();
      }
      if (response.status === 409 && failure?.error === 'companion_lookup_not_ready') {
        setNotice(
          'Lookup is not ready: keep every money switch disabled and verify exactly five eligible Players plus one active paired companion.',
        );
      }
      throw new Error('companion_lookup_issue');
    }
    const receipt = validCompanionLookupStatus(await response.json(), true);
    if (!receipt || (response.status === 200) !== receipt.alreadyIssued) {
      throw new Error('companion_lookup_receipt');
    }
    clearPendingCompanionLookupRequestId();
    companionLookupConfirmation.checked = false;
    renderCompanionLookup(receipt);
    scheduleCompanionLookupStatus();
    setNotice(
      receipt.alreadyIssued
        ? 'The exact signed assignment was reconciled. Waiting for its redacted result.'
        : 'Signed exact-five assignment issued. The local companion will return redacted counts only.',
    );
  } catch (error) {
    if (!isSignedOutError(error) && !terminalFailure) {
      setNotice(
        'Lookup acknowledgement is uncertain. The same request ID is retained and status will be reconciled without issuing a blind duplicate.',
      );
      await loadCompanionLookupStatus();
    }
  } finally {
    setBusy(companionLookupForm, false);
    updateCompanionLookupAvailability();
  }
}

function validTelebirrDevicePairingReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        'alreadyIssued,assignmentPollingAllowed,expiresAt,moneyMovementAllowed,pairingOnly,pairingPackage' ||
      typeof value.alreadyIssued !== 'boolean' ||
      value.assignmentPollingAllowed !== false ||
      value.moneyMovementAllowed !== false ||
      value.pairingOnly !== true ||
      typeof value.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      new Date(value.expiresAt).toISOString() !== value.expiresAt ||
      typeof value.pairingPackage !== 'string' ||
      value.pairingPackage.length > 1_024 ||
      !value.pairingPackage.startsWith('fetanagent-pairing-v1.')) return undefined;
  const encoded = value.pairingPackage.slice('fetanagent-pairing-v1.'.length);
  const canonicalJson = strictBase64UrlText(encoded);
  if (!canonicalJson) return undefined;
  try {
    const grant = JSON.parse(canonicalJson);
    if (!grant || typeof grant !== 'object' || Array.isArray(grant) ||
        Object.keys(grant).sort().join(',') !==
          'expiresAt,pairingId,pairingNonceDigest,schemaVersion' ||
        grant.schemaVersion !== 1 ||
        typeof grant.pairingId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(grant.pairingId) ||
        typeof grant.pairingNonceDigest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/.test(grant.pairingNonceDigest) ||
        grant.expiresAt !== value.expiresAt ||
        JSON.stringify({
          schemaVersion: 1,
          pairingId: grant.pairingId,
          pairingNonceDigest: grant.pairingNonceDigest,
          expiresAt: grant.expiresAt,
        }) !== canonicalJson) return undefined;
  } catch {
    return undefined;
  }
  return {
    alreadyIssued: value.alreadyIssued,
    expiresAt: value.expiresAt,
    pairingPackage: value.pairingPackage,
  };
}

function telebirrDevicePairingPilotReady() {
  return currentPilotLoaded && currentPilot &&
    currentPilot.pilotStatus === 'armed' &&
    currentPilot.switchMode === 'dry_run' &&
    !currentPilot.financiallyActive &&
    currentPilot.withinActiveWindow &&
    Date.parse(currentPilot.expiresAt) > Date.now();
}

function updateTelebirrDevicePairingAvailability() {
  if (currentTelebirrDevicePairing &&
      Date.parse(currentTelebirrDevicePairing.expiresAt) <= Date.now()) {
    clearTelebirrDevicePairingPackage();
    clearPendingTelebirrDevicePairingRequestId();
  }
  const configured = ownerAuthConfig?.telebirrDevicePairingConfigured === true;
  const ready = configured && telebirrDevicePairingPilotReady();
  telebirrDevicePairingButton.disabled = !ready ||
    Boolean(currentTelebirrDevicePairing) ||
    !telebirrDevicePairingConfirmation.checked ||
    telebirrDevicePairingForm.dataset.ownerBusy === 'true';

  if (!ownerAuthConfig) {
    telebirrDevicePairingStatus.textContent = 'Sign in to check pairing readiness.';
  } else if (!configured) {
    telebirrDevicePairingStatus.textContent =
      'Pairing is disabled until the reviewed server and assignment signing keys are provisioned.';
  } else if (!currentPilotLoaded) {
    telebirrDevicePairingStatus.textContent = 'Checking the current private-pilot state.';
  } else if (!currentPilot) {
    telebirrDevicePairingStatus.textContent =
      'Prepare and arm the fixed TeleBirr pilot in dry-run before pairing the phone.';
  } else if (currentPilot.financiallyActive || currentPilot.switchMode === 'live') {
    telebirrDevicePairingStatus.textContent =
      'Pairing is blocked because financial authority is active. Emergency-stop the pilot.';
  } else if (currentPilot.pilotStatus === 'draft') {
    telebirrDevicePairingStatus.textContent =
      'Arm the reviewed dry-run configuration before pairing the phone.';
  } else if (currentPilot.pilotStatus !== 'armed' ||
      currentPilot.switchMode !== 'dry_run' ||
      !currentPilot.withinActiveWindow ||
      Date.parse(currentPilot.expiresAt) <= Date.now()) {
    telebirrDevicePairingStatus.textContent =
      'The current pilot is stopped, outside its active window, or expired. Pairing remains blocked.';
  } else if (currentTelebirrDevicePairing) {
    telebirrDevicePairingStatus.textContent =
      'One pairing-only package is ready until ' +
      new Date(currentTelebirrDevicePairing.expiresAt).toLocaleString() + '.';
  } else if (readPendingTelebirrDevicePairingRequestId()) {
    telebirrDevicePairingStatus.textContent =
      'A prior request is pending reconciliation. Create will recover that exact package only.';
  } else {
    telebirrDevicePairingStatus.textContent =
      'Ready to create one ten-minute pairing-only package. Money authority remains disabled.';
  }
}

function showTelebirrDevicePairing(receipt) {
  clearTelebirrDevicePairingPackage();
  currentTelebirrDevicePairing = receipt;
  telebirrDevicePairingPackage.textContent = receipt.pairingPackage;
  telebirrDevicePairingReceipt.hidden = false;
  telebirrDevicePairingConfirmation.checked = false;
  const delay = Math.max(1, Date.parse(receipt.expiresAt) - Date.now());
  telebirrDevicePairingExpiryTimer = window.setTimeout(() => {
    if (currentTelebirrDevicePairing?.pairingPackage !== receipt.pairingPackage) return;
    clearTelebirrDevicePairingPackage();
    clearPendingTelebirrDevicePairingRequestId();
    updateTelebirrDevicePairingAvailability();
  }, delay);
  updateTelebirrDevicePairingAvailability();
}

function updatePilotPreparationAvailability() {
  pilotPrepareButton.disabled = !ordinaryKemerbetMutationAllowed() || Boolean(currentPilot) ||
    selectedPilotPlayerIds.size !== 5 ||
    !pilotConfirmation.checked;
}

function renderPilotCandidates(players) {
  eligiblePilotPlayers = players.filter((player) => player.playerStatus === 'active' &&
    player.validationStatus === 'valid' && player.decision === 'eligible');
  for (const selected of [...selectedPilotPlayerIds]) {
    if (!eligiblePilotPlayers.some((player) => player.playerId === selected)) {
      selectedPilotPlayerIds.delete(selected);
    }
  }
  pilotCandidateList.replaceChildren();
  pilotReadiness.textContent = eligiblePilotPlayers.length + '/5 currently eligible Players are available. ' +
    (eligiblePilotPlayers.length < 5
      ? 'Preparation remains blocked until exactly five are ready.'
      : 'Select exactly five for the fixed cohort.');
  if (eligiblePilotPlayers.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No active, valid, currently eligible Player IDs.';
    pilotCandidateList.append(empty);
  }
  for (const player of eligiblePilotPlayers) {
    const label = document.createElement('label');
    label.className = 'request-card pilot-choice';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.kemerbetStateMutation = 'ordinary';
    checkbox.checked = selectedPilotPlayerIds.has(player.playerId);
    checkbox.disabled = !ordinaryKemerbetMutationAllowed() || Boolean(currentPilot);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedPilotPlayerIds.add(player.playerId);
      else selectedPilotPlayerIds.delete(player.playerId);
      updatePilotPreparationAvailability();
    });
    const text = document.createElement('span');
    text.textContent = player.playerId + ' · active · valid · eligible';
    label.append(checkbox, text);
    pilotCandidateList.append(label);
  }
  updatePilotPreparationAvailability();
}

function renderPilotStatus(pilot, statusLoaded = true) {
  currentPilotLoaded = statusLoaded;
  currentPilot = pilot;
  if (statusLoaded && !telebirrDevicePairingPilotReady()) {
    clearTelebirrDevicePairingPackage();
    clearPendingTelebirrDevicePairingRequestId();
  }
  pilotStatusFacts.replaceChildren();
  pilotStatusPanel.hidden = !pilot;
  if (!pilot) {
    renderPilotCandidates(eligiblePilotPlayers);
    updateKemerbetReadinessCohortAvailability();
    updateTelebirrDevicePairingAvailability();
    return;
  }
  const facts = [
    ['State', pilot.pilotStatus],
    ['Financial switch', pilot.switchMode],
    ['Financially active', pilot.financiallyActive ? 'YES — stop immediately' : 'No'],
    ['Within two-hour window', pilot.withinActiveWindow ? 'Yes' : 'No'],
    ['Reservations', String(pilot.reservedDepositCount) + '/5'],
    ['Reserved amount', String(Number(pilot.reservedAmountMinor) / 100) + ' / 125 ETB'],
    ['Expires', new Date(pilot.expiresAt).toLocaleString()],
  ];
  for (const [label, value] of facts) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    pilotStatusFacts.append(term, detail);
  }
  pilotArmButton.disabled = !ordinaryKemerbetMutationAllowed() ||
    pilot.pilotStatus !== 'draft' || pilot.financiallyActive ||
    Date.parse(pilot.expiresAt) <= Date.now();
  pilotStopButton.disabled = !ordinaryKemerbetMutationAllowed() || pilot.pilotStatus === 'stopped';
  renderPilotCandidates(eligiblePilotPlayers);
  updateKemerbetReadinessCohortAvailability();
  updateTelebirrDevicePairingAvailability();
}

async function loadCurrentPilot() {
  pilotRefreshButton.disabled = true;
  try {
    const response = await ownerRequest('/v1/owner/private-live-deposit-pilots/current', {
      method: 'GET', headers: {},
    });
    if (!response.ok) throw new Error('pilot_status');
    const payload = await response.json();
    if (!payload || (payload.pilot !== null && !validPilotStatus(payload.pilot))) throw new Error('pilot_status');
    renderPilotStatus(payload.pilot === null ? undefined : validPilotStatus(payload.pilot));
  } catch (error) {
    currentPilotLoaded = false;
    if (!currentPilot) renderPilotStatus(undefined, false);
    else {
      updateKemerbetReadinessCohortAvailability();
      updateTelebirrDevicePairingAvailability();
    }
    if (!isSignedOutError(error)) setNotice('Current private-pilot status is unavailable. Do not prepare or arm.');
  } finally {
    pilotRefreshButton.disabled = false;
  }
}

function validDepositIntake(value) {
  if (!value || typeof value !== 'object') return undefined;
  const depositIntentId = typeof value.depositIntentId === 'string' ? value.depositIntentId : undefined;
  const playerId = typeof value.playerId === 'string' ? value.playerId : undefined;
  const amountMinor = typeof value.amountMinor === 'string' ? value.amountMinor : undefined;
  const receiverAccountMasked = typeof value.receiverAccountMasked === 'string' ? value.receiverAccountMasked : undefined;
  const reference = value.submittedReferenceMasked;
  const hasSubmission = value.submissionStatus === 'received' && typeof value.submittedAt === 'string' &&
    Number.isFinite(Date.parse(value.submittedAt)) && typeof reference === 'string' && /^\\*{3}[A-Z0-9._-]{4}$/.test(reference);
  const hasNoSubmission = value.submissionStatus === undefined && value.submittedAt === undefined && reference === undefined;
  if (!depositIntentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(depositIntentId) ||
      !playerId || !/^[^\\s\\u0000-\\u001f\\u007f]{1,64}$/.test(playerId) || !amountMinor || !/^[1-9][0-9]*$/.test(amountMinor) ||
      value.currencyCode !== 'ETB' || value.providerCode !== 'cbe_birr' || value.depositStatus !== 'intake_received' ||
      !receiverAccountMasked || !/^\\*{3,}[A-Za-z0-9._-]{2,16}$/.test(receiverAccountMasked) ||
      typeof value.openedAt !== 'string' || !Number.isFinite(Date.parse(value.openedAt)) ||
      typeof value.paymentDeadline !== 'string' || !Number.isFinite(Date.parse(value.paymentDeadline)) ||
      !(hasSubmission || hasNoSubmission)) return undefined;
  return { amountMinor, depositIntentId, openedAt: value.openedAt, paymentDeadline: value.paymentDeadline,
    playerId, receiverAccountMasked, reference };
}

const dryRunFixtureChoices = [
  ['valid-completed', 'Completed fixture'],
  ['wrong-receiver', 'Wrong receiver fixture'],
  ['wrong-amount', 'Wrong amount fixture'],
  ['stale-completed', 'Stale fixture'],
  ['future-completed', 'Future timestamp fixture'],
  ['pending-status', 'Pending fixture'],
  ['failed-status', 'Failed fixture'],
  ['malformed-layout', 'Malformed fixture'],
  ['unknown-status', 'Unknown status fixture'],
  ['duplicate-reference', 'Duplicate reference fixture'],
  ['unavailable-source', 'Unavailable source fixture'],
];

function validDryRunAssessment(value) {
  if (!value || typeof value !== 'object') return undefined;
  const assessmentId = typeof value.assessmentId === 'string' ? value.assessmentId : undefined;
  const depositIntentId = typeof value.depositIntentId === 'string' ? value.depositIntentId : undefined;
  const fixtureId = typeof value.fixtureId === 'string' ? value.fixtureId : undefined;
  const outcome = value.outcome;
  const reasonCode = typeof value.reasonCode === 'string' ? value.reasonCode : undefined;
  const reviewed =
    (value.reviewDecision === undefined && value.reviewedAt === undefined) ||
    ((value.reviewDecision === 'acknowledged' ||
      value.reviewDecision === 'manual_review_required') &&
      typeof value.reviewedAt === 'string' &&
      Number.isFinite(Date.parse(value.reviewedAt)));
  if (!assessmentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assessmentId) ||
      !depositIntentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(depositIntentId) ||
      !fixtureId || !dryRunFixtureChoices.some(([id]) => id === fixtureId) ||
      (outcome !== 'would_verify' && outcome !== 'would_reject' && outcome !== 'would_review') ||
      !reasonCode || typeof value.assessedAt !== 'string' || !Number.isFinite(Date.parse(value.assessedAt)) || !reviewed) return undefined;
  return { assessedAt: value.assessedAt, assessmentId, depositIntentId, fixtureId, outcome,
    reasonCode, reviewDecision: value.reviewDecision, reviewedAt: value.reviewedAt };
}

async function assessDryRunDeposit(deposit, fixtureId) {
  if (!deposit.reference) return;
  setNotice('Running redacted advisory fixture assessment\u2026');
  try {
    const response = await ownerRequest('/v1/owner/dry-run-deposit-intake/' +
      encodeURIComponent(deposit.depositIntentId) + '/fixture-assessments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixtureId }),
    });
    if (!response.ok) throw new Error('assessment');
    setNotice('Advisory fixture result recorded. No payment was verified or approved.');
    await loadDepositIntake();
  } catch (error) {
    if (!isSignedOutError(error)) setNotice('Advisory fixture assessment failed. The payment ledger was not changed.');
  }
}

async function reviewDryRunAssessment(assessmentId, decision) {
  if (!window.confirm('This records an advisory review only. It does not verify, approve, credit, or execute a payment.')) return;
  setNotice('Recording advisory Owner review\u2026');
  try {
    const response = await ownerRequest('/v1/owner/dry-run-fixture-assessments/' +
      encodeURIComponent(assessmentId) + '/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    if (!response.ok) throw new Error('review');
    setNotice('Advisory review recorded. Financial actions remain disabled.');
    await loadDepositIntake();
  } catch (error) {
    if (!isSignedOutError(error)) setNotice('Advisory review failed. No payment action was started.');
  }
}

function renderDepositIntake(deposits, assessments) {
  clearDepositIntake();
  if (deposits.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No dry-run deposit intents.';
    depositIntakeList.append(empty);
    return;
  }
  for (const deposit of deposits) {
    const card = document.createElement('article');
    card.className = 'request-card';
    const title = document.createElement('h3');
    title.textContent = deposit.playerId + ' \u00b7 ' + (Number(deposit.amountMinor) / 100).toFixed(2) + ' ETB';
    const metadata = document.createElement('p');
    metadata.className = 'request-meta';
    metadata.textContent = 'CBE Birr \u00b7 ' + deposit.receiverAccountMasked + ' \u00b7 opened ' +
      new Date(deposit.openedAt).toLocaleString() + (deposit.reference ? ' \u00b7 reference ' + deposit.reference : ' \u00b7 awaiting reference');
    card.append(title, metadata);
    const latest = assessments.find((assessment) => assessment.depositIntentId === deposit.depositIntentId);
    if (latest) {
      const result = document.createElement('p');
      result.className = 'request-meta';
      result.textContent = 'Advisory only: ' + latest.outcome.replaceAll('_', ' ') + ' \u00b7 ' +
        latest.reasonCode.replaceAll('_', ' ') + (latest.reviewDecision ? ' \u00b7 ' + latest.reviewDecision.replaceAll('_', ' ') : '');
      card.append(result);
      if (!latest.reviewDecision) {
        const reviewActions = document.createElement('div');
        reviewActions.className = 'review-actions';
        const acknowledge = document.createElement('button');
        acknowledge.type = 'button';
        acknowledge.textContent = 'Acknowledge simulation';
        acknowledge.addEventListener('click', () => reviewDryRunAssessment(latest.assessmentId, 'acknowledged'));
        const manual = document.createElement('button');
        manual.type = 'button';
        manual.className = 'secondary';
        manual.textContent = 'Require manual review';
        manual.addEventListener('click', () => reviewDryRunAssessment(latest.assessmentId, 'manual_review_required'));
        reviewActions.append(acknowledge, manual);
        card.append(reviewActions);
      }
    }
    if (deposit.reference) {
      const controls = document.createElement('div');
      controls.className = 'review-actions';
      const fixtureSelect = document.createElement('select');
      for (const [id, label] of dryRunFixtureChoices) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = label;
        fixtureSelect.append(option);
      }
      const assessButton = document.createElement('button');
      assessButton.type = 'button';
      assessButton.textContent = 'Run advisory fixture';
      assessButton.addEventListener('click', () => assessDryRunDeposit(deposit, fixtureSelect.value));
      controls.append(fixtureSelect, assessButton);
      card.append(controls);
    }
    depositIntakeList.append(card);
  }
}

async function associatePlayerRequest(requestId) {
  if (!requireOrdinaryKemerbetMutation()) return;
  if (!window.confirm('Confirm that you independently verified this Telegram customer controls the exact KemerBet account. This records ownership only and does not grant deposit eligibility.')) return;
  setNotice('Recording explicit Player ID ownership association\u2026');
  try {
    const response = await ownerRequest('/v1/owner/player-registration-requests/' + encodeURIComponent(requestId) + '/associate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'owner_verified_platform_ownership' }),
    });
    if (!response.ok) throw new Error('association');
    setNotice('Player ID ownership association recorded. Deposit eligibility remains separate and unavailable.');
    await loadOwnerPlayerQueues();
  } catch (error) {
    if (!isSignedOutError(error)) setNotice('Player ID association failed. Refresh and verify before trying again.');
  }
}

function renderAssociationCandidates(candidates) {
  clearAssociationCandidates();
  if (candidates.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No reviewed Player IDs awaiting ownership confirmation.';
    playerAssociationList.append(empty);
    return;
  }
  for (const candidate of candidates) {
    const card = document.createElement('article');
    card.className = 'request-card';
    const title = document.createElement('h3');
    title.textContent = candidate.playerId;
    const metadata = document.createElement('p');
    metadata.className = 'request-meta';
    metadata.textContent = 'found on KemerBet \u00b7 reviewed ' + new Date(candidate.reviewedAt).toLocaleString();
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.kemerbetStateMutation = 'ordinary';
    button.textContent = 'Confirm ownership only';
    button.disabled = !ordinaryKemerbetMutationAllowed();
    button.addEventListener('click', () => associatePlayerRequest(candidate.requestId));
    card.append(title, metadata, button);
    playerAssociationList.append(card);
  }
}

async function decidePlayerEligibility(player, decision) {
  if (!requireOrdinaryKemerbetMutation()) return;
  const approving = decision === 'eligible';
  const warning = approving
    ? 'Approve this exact Player ID for future deposit intake? Confirm that ownership, validation, and financial review are complete. This does not open a deposit or move money.'
    : 'Revoke this exact Player ID from future deposit intake? Existing immutable records remain retained.';
  if (!window.confirm(warning)) return;
  setNotice(approving ? 'Recording deposit-eligibility approval\u2026' : 'Recording deposit-eligibility revocation\u2026');
  try {
    const response = await ownerRequest('/v1/owner/player-deposit-eligibility/' +
      encodeURIComponent(player.playerAccountId) + '/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirmation: approving
          ? 'owner_confirmed_financial_eligibility'
          : 'owner_confirmed_financial_revocation',
        decision,
      }),
    });
    if (!response.ok) throw new Error('eligibility_decision');
    setNotice(approving
      ? 'Deposit eligibility approved. No deposit or financial action was started.'
      : 'Deposit eligibility revoked for future deposits.');
    await loadPlayerEligibility();
  } catch (error) {
    if (!isSignedOutError(error)) setNotice('Deposit-eligibility decision failed. No financial action was started.');
  }
}

function renderPlayerEligibility(players) {
  clearPlayerEligibility();
  renderKemerbetReadinessCohortAvailability(players);
  renderPilotCandidates(players);
  if (players.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No Owner-associated Player IDs.';
    playerEligibilityList.append(empty);
    return;
  }
  for (const player of players) {
    const card = document.createElement('article');
    card.className = 'request-card';
    const title = document.createElement('h3');
    title.textContent = player.playerId;
    const metadata = document.createElement('p');
    metadata.className = 'request-meta';
    metadata.textContent = player.playerStatus + ' \u00b7 validation ' + player.validationStatus +
      ' \u00b7 eligibility ' + (player.decision || 'not decided') +
      (player.decisionVersion ? ' v' + player.decisionVersion : '') +
      (player.decidedAt ? ' \u00b7 ' + new Date(player.decidedAt).toLocaleString() : '');
    const actions = document.createElement('div');
    actions.className = 'review-actions';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.dataset.kemerbetStateMutation = 'ordinary';
    approve.textContent = 'Approve deposit eligibility';
    approve.disabled = !ordinaryKemerbetMutationAllowed() ||
      player.playerStatus !== 'active' || player.validationStatus !== 'valid' ||
      player.decision === 'eligible';
    approve.addEventListener('click', () => decidePlayerEligibility(player, 'eligible'));
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.dataset.kemerbetStateMutation = 'ordinary';
    revoke.className = 'danger';
    revoke.textContent = 'Revoke deposit eligibility';
    revoke.disabled = !ordinaryKemerbetMutationAllowed() || player.decision === 'revoked';
    revoke.addEventListener('click', () => decidePlayerEligibility(player, 'revoked'));
    actions.append(approve, revoke);
    card.append(title, metadata, actions);
    playerEligibilityList.append(card);
  }
}

function reviewButton(label, requestId, decision, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.kemerbetStateMutation = 'ordinary';
  button.textContent = label;
  button.disabled = !ordinaryKemerbetMutationAllowed();
  if (className) button.className = className;
  button.addEventListener('click', () => recordPlayerReview(requestId, decision));
  return button;
}

function renderPlayerRequests(requests) {
  clearPlayerRequests();
  if (requests.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No pending KemerBet Player ID requests.';
    playerRequestList.append(empty);
    return;
  }
  for (const request of requests) {
    const card = document.createElement('article');
    card.className = 'request-card';
    const title = document.createElement('h3');
    title.textContent = request.playerId;
    const metadata = document.createElement('p');
    metadata.className = 'request-meta';
    metadata.textContent = request.status.replaceAll('_', ' ') + ' \u00b7 submitted ' + new Date(request.createdAt).toLocaleString();
    const actions = document.createElement('div');
    actions.className = 'review-actions';
    actions.append(
      reviewButton('Found on KemerBet', request.requestId, 'exists'),
      reviewButton('Not found', request.requestId, 'not_found'),
      reviewButton('Needs more evidence', request.requestId, 'review_required', 'secondary'),
      reviewButton('Cancel request', request.requestId, 'cancelled', 'danger'),
    );
    card.append(title, metadata, actions);
    playerRequestList.append(card);
  }
}

async function loadPlayerRequests() {
  refreshRequestsButton.disabled = true;
  try {
    const response = await ownerRequest('/v1/owner/player-registration-requests?limit=25', {
      method: 'GET',
      headers: {},
    });
    if (!response.ok) throw new Error('queue');
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.requests) || payload.requests.length > 25) throw new Error('queue');
    const requests = payload.requests.map(validPlayerRequest);
    if (requests.some((request) => !request)) throw new Error('queue');
    renderPlayerRequests(requests);
  } catch (error) {
    clearPlayerRequests();
    if (!isSignedOutError(error)) setNotice('Player ID review queue is unavailable.');
  } finally {
    refreshRequestsButton.disabled = false;
  }
}

async function loadAssociationCandidates() {
  try {
    const response = await ownerRequest('/v1/owner/player-registration-association-candidates?limit=25', {
      method: 'GET',
      headers: {},
    });
    if (!response.ok) throw new Error('association_queue');
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.candidates) || payload.candidates.length > 25) throw new Error('association_queue');
    const candidates = payload.candidates.map(validAssociationCandidate);
    if (candidates.some((candidate) => !candidate)) throw new Error('association_queue');
    renderAssociationCandidates(candidates);
  } catch (error) {
    clearAssociationCandidates();
    if (!isSignedOutError(error)) setNotice('Player ID association queue is unavailable.');
  }
}

async function loadPlayerEligibility() {
  try {
    const response = await ownerRequest('/v1/owner/player-deposit-eligibility?limit=50', {
      method: 'GET',
      headers: {},
    });
    if (!response.ok) throw new Error('eligibility_queue');
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.players) || payload.players.length > 50) throw new Error('eligibility_queue');
    const players = payload.players.map(validPlayerEligibility);
    if (players.some((player) => !player)) throw new Error('eligibility_queue');
    renderPlayerEligibility(players);
  } catch (error) {
    clearPlayerEligibility();
    eligibleReadinessCohortPlayerCount = 0;
    updateKemerbetReadinessCohortAvailability();
    if (!isSignedOutError(error)) setNotice('Player-ID deposit eligibility is unavailable.');
  }
}

async function loadDepositIntake() {
  const [response, assessmentResponse] = await Promise.all([
    ownerRequest('/v1/owner/dry-run-deposit-intake?limit=25', { method: 'GET', headers: {} }),
    ownerRequest('/v1/owner/dry-run-fixture-assessments?limit=50', { method: 'GET', headers: {} }),
  ]);
  if (!response.ok || !assessmentResponse.ok) throw new Error('deposit_queue');
  const [payload, assessmentPayload] = await Promise.all([response.json(), assessmentResponse.json()]);
  if (!payload || !Array.isArray(payload.deposits) || payload.deposits.length > 25) throw new Error('deposit_queue');
  if (!assessmentPayload || !Array.isArray(assessmentPayload.assessments) || assessmentPayload.assessments.length > 50) throw new Error('deposit_queue');
  const deposits = payload.deposits.map(validDepositIntake);
  const assessments = assessmentPayload.assessments.map(validDryRunAssessment);
  if (deposits.some((deposit) => !deposit)) throw new Error('deposit_queue');
  if (assessments.some((assessment) => !assessment)) throw new Error('deposit_queue');
  renderDepositIntake(deposits, assessments);
}

function kemerbetReadinessCohortMutationHeaders(requestId) {
  return {
    'content-type': 'application/json',
    'x-fetanagent-owner-csrf': 'owner-kemerbet-readiness-cohort-v1',
    'x-idempotency-key': requestId,
  };
}

function confirmKemerbetReadinessCohortPrepared() {
  readinessCohortPrepared = true;
  kemerbetReadinessCohortConfirmation.checked = false;
  clearPendingKemerbetReadinessRequestId();
  setNotice(
    'One-use readiness cohort prepared for five Players. Identifiers are redacted, ' +
      'Transfer is disabled, and no money moved.',
  );
}

async function reconcilePendingKemerbetReadinessCohort() {
  try {
    const response = await ownerRequest('/v1/owner/kemerbet-session', {
      method: 'GET',
      headers: {},
    }, OWNER_RECONCILIATION_REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      await response.json().catch(() => undefined);
      return 'uncertain';
    }
    const payload = await response.json();
    const session = validKemerbetSession(payload && payload.session);
    if (!session) return 'uncertain';
    const securityRecoverySessionAllowed = payload.securityRecoverySessionAllowed === true;
    await renderKemerbetSession(session, securityRecoverySessionAllowed);
    if (securityRecoverySessionAllowed ||
        session.quarantine?.reasonCode === 'security_recovery_in_progress') {
      confirmKemerbetReadinessCohortPrepared();
      return 'prepared';
    }
    return 'retry_same_request';
  } catch (error) {
    if (isSignedOutError(error)) throw error;
    return 'uncertain';
  }
}

async function prepareKemerbetReadinessCohort() {
  if (!requireKemerbetReadinessCohortMutation()) return;
  const hasOpenPilot = currentPilot?.pilotStatus === 'draft' ||
    currentPilot?.pilotStatus === 'armed';
  if (readinessCohortPrepared || !currentPilotLoaded || hasOpenPilot ||
      eligibleReadinessCohortPlayerCount !== 5 ||
      !kemerbetReadinessCohortConfirmation.checked) return;
  if (!window.confirm(
    'Prepare the server-only one-use input from the current exact five eligible KemerBet Players? No identifier or amount is sent by this browser, Transfer remains disabled, and no money moves.',
  )) return;
  setBusy(kemerbetReadinessCohortForm, true);
  try {
    let requestId = readPendingKemerbetReadinessRequestId();
    if (requestId) {
      setNotice(
        'Reconciling the previous readiness request before any retry. Transfer remains disabled ' +
          'and no money moves…',
      );
      const reconciliation = await reconcilePendingKemerbetReadinessCohort();
      if (reconciliation === 'prepared') return;
      if (reconciliation === 'uncertain') {
        setNotice(
          'The previous readiness request is still uncertain. Its same one-use request is ' +
            'retained; no retry was sent, Transfer remains disabled, and no money moved.',
        );
        return;
      }
    } else {
      requestId = crypto.randomUUID();
      persistPendingKemerbetReadinessRequestId(requestId);
    }
    setNotice('Preparing the one-use KemerBet readiness cohort with identifiers redacted…');
    const response = await ownerRequest('/v1/owner/kemerbet-readiness-cohort/prepare', {
      method: 'POST',
      headers: kemerbetReadinessCohortMutationHeaders(requestId),
      body: JSON.stringify({
        confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
        requestId,
      }),
    });
    if (response.status !== 200 && response.status !== 201) {
      const failure = await response.json().catch(() => undefined);
      if (response.status === 409 && failure?.error === 'readiness_cohort_open_pilot') {
        await loadCurrentPilot();
        clearPendingKemerbetReadinessRequestId();
        setNotice(
          'Stop the current TeleBirr pilot below before preparing the one-use KemerBet readiness cohort. Money remains disabled.',
        );
        return;
      }
      if (response.status === 400 ||
          (response.status === 409 && failure?.error === 'readiness_cohort_not_ready')) {
        clearPendingKemerbetReadinessRequestId();
      }
      throw new Error('readiness_cohort_prepare');
    }
    const prepared = validKemerbetReadinessCohortReceipt(await response.json());
    if (!prepared || (response.status === 200) !== prepared.alreadyPrepared) {
      throw new Error('readiness_cohort_prepare');
    }
    confirmKemerbetReadinessCohortPrepared();
  } catch (error) {
    if (!isSignedOutError(error)) {
      if (readPendingKemerbetReadinessRequestId()) {
        const reconciliation = await reconcilePendingKemerbetReadinessCohort();
        if (reconciliation === 'prepared') return;
        setNotice(
          reconciliation === 'uncertain'
            ? 'Readiness preparation is temporarily unreachable. The same one-use request is ' +
                'retained for reconciliation; no retry was sent and no money moved.'
            : 'No completed readiness cohort was found. The same one-use request is retained ' +
                'for the next confirmed retry; Transfer remains disabled and no money moved.',
        );
      } else {
        setNotice(
          'Readiness-cohort preparation was rejected. Nothing was transferred and no money moved.',
        );
      }
    }
  } finally {
    setBusy(kemerbetReadinessCohortForm, false);
    updateKemerbetReadinessCohortAvailability();
    applyKemerbetQuarantineMutationBoundary();
  }
}

function companionDevicePairingMutationHeaders(requestId) {
  return {
    'content-type': 'application/json',
    'x-fetanagent-owner-csrf': 'owner-companion-device-pairing-v1',
    'x-idempotency-key': requestId,
  };
}

async function issueCompanionDevicePairing() {
  if (ownerAuthConfig?.companionDevicePairingConfigured !== true ||
      currentCompanionDevicePairing || !companionDevicePairingConfirmation.checked) return;
  if (!window.confirm(
    'Create one ten-minute public-key pairing package for this Windows companion? ' +
    'Player lookup, Amount, Notes, Transfer, settlement, execution, and money movement remain disabled.',
  )) return;
  const requestId = readPendingCompanionDevicePairingRequestId() ?? crypto.randomUUID();
  persistPendingCompanionDevicePairingRequestId(requestId);
  setBusy(companionDevicePairingForm, true);
  setNotice('Creating or reconciling the one-use Windows companion pairing package…');
  let terminalFailure = false;
  let specificFailureNotice = false;
  try {
    const response = await ownerRequest('/v1/owner/companion-device-pairing', {
      method: 'POST',
      headers: companionDevicePairingMutationHeaders(requestId),
      body: JSON.stringify({
        confirmation: 'owner_confirmed_windows_companion_pairing_only_no_money',
        requestId,
      }),
    });
    if (response.status !== 200 && response.status !== 201) {
      const failure = await response.json().catch(() => undefined);
      if (response.status === 400 || response.status === 409) {
        terminalFailure = true;
        clearPendingCompanionDevicePairingRequestId();
      }
      if (response.status === 409 &&
          failure?.error === 'companion_device_pairing_not_configured') {
        specificFailureNotice = true;
        setNotice('Windows companion pairing is not provisioned on the server yet.');
      } else if (response.status === 409 &&
          failure?.error === 'companion_device_pairing_not_ready') {
        specificFailureNotice = true;
        setNotice(
          'Windows companion pairing is not ready. Keep money disabled and verify the independent bridge signer and Supabase state.',
        );
      }
      throw new Error('companion_device_pairing_issue');
    }
    const receipt = validCompanionDevicePairingReceipt(await response.json());
    if (!receipt || (response.status === 200) !== receipt.alreadyIssued) {
      throw new Error('companion_device_pairing_receipt');
    }
    if (Date.parse(receipt.expiresAt) <= Date.now()) {
      terminalFailure = true;
      clearPendingCompanionDevicePairingRequestId();
      throw new Error('companion_device_pairing_expired');
    }
    showCompanionDevicePairing(receipt);
    setNotice(
      receipt.alreadyIssued
        ? 'The exact Windows pairing package was recovered. Paste it only into the local companion before it expires.'
        : 'Windows pairing package created. Paste it only into the local companion before it expires.',
    );
  } catch (error) {
    if (!isSignedOutError(error) && !terminalFailure) {
      setNotice(
        'Windows pairing acknowledgement is uncertain. The same request ID is retained; the next confirmed attempt can recover only that exact package.',
      );
    } else if (!isSignedOutError(error) && !specificFailureNotice) {
      setNotice('No Windows companion pairing package was created. Review readiness before retrying.');
    }
  } finally {
    setBusy(companionDevicePairingForm, false);
    updateCompanionDevicePairingAvailability();
  }
}

function telebirrDevicePairingMutationHeaders(requestId) {
  return {
    'content-type': 'application/json',
    'x-fetanagent-owner-csrf': 'owner-telebirr-device-pairing-v1',
    'x-idempotency-key': requestId,
  };
}

async function issueTelebirrDevicePairing() {
  if (!telebirrDevicePairingPilotReady() ||
      ownerAuthConfig?.telebirrDevicePairingConfigured !== true ||
      currentTelebirrDevicePairing ||
      !telebirrDevicePairingConfirmation.checked) return;
  if (!window.confirm(
    'Create one ten-minute pairing-only package for the dedicated Android phone? ' +
    'Assignment polling, verification, execution, and money movement remain disabled.',
  )) return;

  const requestId = readPendingTelebirrDevicePairingRequestId() ?? crypto.randomUUID();
  persistPendingTelebirrDevicePairingRequestId(requestId);
  setBusy(telebirrDevicePairingForm, true);
  setNotice('Creating or reconciling the one-use Android pairing package…');
  let terminalFailure = false;
  let specificFailureNotice = false;
  try {
    const response = await ownerRequest('/v1/owner/telebirr-device-pairing', {
      method: 'POST',
      headers: telebirrDevicePairingMutationHeaders(requestId),
      body: JSON.stringify({
        confirmation: 'owner_confirmed_pairing_only_no_money',
        requestId,
      }),
    });
    if (response.status !== 200 && response.status !== 201) {
      const failure = await response.json().catch(() => undefined);
      if (response.status === 400 || response.status === 409) {
        terminalFailure = true;
        clearPendingTelebirrDevicePairingRequestId();
      }
      if (response.status === 409 && failure?.error === 'device_pairing_not_configured') {
        specificFailureNotice = true;
        setNotice(
          'Android pairing is not provisioned on the Owner server yet. No package was created.',
        );
      } else if (response.status === 409 && failure?.error === 'device_pairing_not_ready') {
        specificFailureNotice = true;
        setNotice(
          'Android pairing is not ready. Keep money disabled and verify the armed pilot, receiver profile, and signing-key state.',
        );
      }
      throw new Error('device_pairing_issue');
    }
    const receipt = validTelebirrDevicePairingReceipt(await response.json());
    if (!receipt || (response.status === 200) !== receipt.alreadyIssued) {
      throw new Error('device_pairing_receipt');
    }
    if (Date.parse(receipt.expiresAt) <= Date.now()) {
      terminalFailure = true;
      clearPendingTelebirrDevicePairingRequestId();
      throw new Error('device_pairing_expired');
    }
    showTelebirrDevicePairing(receipt);
    setNotice(
      receipt.alreadyIssued
        ? 'The exact one-use package was recovered. Copy it directly to the Android phone before it expires.'
        : 'One-use package created. Copy it directly to the Android phone before it expires.',
    );
  } catch (error) {
    if (!isSignedOutError(error) && !terminalFailure) {
      setNotice(
        'Pairing acknowledgement is uncertain. The same request ID is retained; the next confirmed attempt can recover only that exact package.',
      );
    } else if (!isSignedOutError(error) && !specificFailureNotice) {
      setNotice('No Android pairing package was created. Review readiness before trying again.');
    }
  } finally {
    setBusy(telebirrDevicePairingForm, false);
    updateTelebirrDevicePairingAvailability();
  }
}

function pilotMutationHeaders(requestId) {
  return {
    'content-type': 'application/json',
    'x-fetanagent-owner-csrf': 'private-live-pilot-v1',
    'x-idempotency-key': requestId,
  };
}

async function prepareFixedPilot() {
  if (!requireOrdinaryKemerbetMutation() || currentPilot ||
      selectedPilotPlayerIds.size !== 5 || !pilotConfirmation.checked) return;
  if (!window.confirm(
    'Prepare exactly five selected Players for the fixed TeleBirr pilot: 25 ETB each, 125 ETB total, one reservation each, and two hours? This remains financially disabled.',
  )) return;
  const requestId = crypto.randomUUID();
  const activeFrom = new Date(Date.now() + 5_000);
  const expiresAt = new Date(activeFrom.getTime() + 2 * 60 * 60 * 1_000);
  setBusy(pilotPrepareForm, true);
  setNotice('Preparing the fixed dormant TeleBirr pilot…');
  try {
    const response = await ownerRequest('/v1/owner/private-live-deposit-pilots/prepare', {
      method: 'POST',
      headers: pilotMutationHeaders(requestId),
      body: JSON.stringify({
        activeFrom: activeFrom.toISOString(),
        confirmation: 'owner_confirmed_fixed_telebirr_five_player_pilot',
        expiresAt: expiresAt.toISOString(),
        playerIds: [...selectedPilotPlayerIds].sort(),
        requestId,
      }),
    });
    if (response.status !== 201) throw new Error('pilot_prepare');
    const payload = await response.json();
    const pilot = validPilotStatus(payload && payload.pilot);
    if (!pilot || pilot.pilotStatus !== 'draft' || pilot.switchMode !== 'disabled' || pilot.financiallyActive) {
      throw new Error('pilot_prepare');
    }
    renderPilotStatus(pilot);
    setNotice('Fixed pilot prepared. Money remains disabled; review status before dry-run arming.');
  } catch (error) {
    if (!isSignedOutError(error)) {
      setNotice('Pilot preparation was rejected or unavailable. Readiness remains blocked; checking for an idempotent result…');
      await loadCurrentPilot();
    }
  } finally {
    setBusy(pilotPrepareForm, false);
    updatePilotPreparationAvailability();
    applyKemerbetQuarantineMutationBoundary();
  }
}

async function armFixedPilot() {
  if (!requireOrdinaryKemerbetMutation() || !currentPilot ||
      currentPilot.pilotStatus !== 'draft') return;
  if (!window.confirm(
    'Arm this pilot configuration in dry-run only? This must not enable payment verification, settlement, the executor, or KemerBet actions.',
  )) return;
  const requestId = currentPilot.pilotRevisionId;
  pilotArmButton.disabled = true;
  setNotice('Arming the dormant dry-run configuration…');
  try {
    const response = await ownerRequest('/v1/owner/private-live-deposit-pilots/' +
      encodeURIComponent(requestId) + '/arm', {
      method: 'POST',
      headers: pilotMutationHeaders(requestId),
      body: JSON.stringify({ confirmation: 'owner_confirmed_dry_run_only', requestId }),
    });
    if (!response.ok) throw new Error('pilot_arm');
    const payload = await response.json();
    const pilot = validPilotStatus(payload && payload.status);
    if (!pilot || pilot.pilotStatus !== 'armed' || pilot.switchMode !== 'dry_run' || pilot.financiallyActive) {
      throw new Error('pilot_arm');
    }
    renderPilotStatus(pilot);
    setNotice('Pilot configuration armed in dry-run. Every real-money switch remains disabled.');
  } catch (error) {
    if (!isSignedOutError(error)) {
      setNotice('Dry-run arm was rejected or unavailable. Checking the fail-closed status…');
      await loadCurrentPilot();
    }
  } finally {
    if (currentPilot) {
      pilotArmButton.disabled = !ordinaryKemerbetMutationAllowed() ||
        currentPilot.pilotStatus !== 'draft' ||
        Date.parse(currentPilot.expiresAt) <= Date.now();
    }
    applyKemerbetQuarantineMutationBoundary();
  }
}

async function stopCurrentPilot() {
  if (!requireOrdinaryKemerbetMutation() || !currentPilot) return;
  const requestId = currentPilot.pilotRevisionId;
  const reasonCode = pilotStopReason.value;
  if (!['owner_stop', 'provider_incident', 'parser_drift', 'execution_uncertainty', 'cap_review', 'pilot_complete'].includes(reasonCode) ||
      !window.confirm('Emergency-stop this pilot now? New verification, settlement, lease, and final-action authority will be disabled.')) return;
  pilotStopButton.disabled = true;
  setNotice('Applying the private-pilot emergency stop…');
  try {
    const response = await ownerRequest('/v1/owner/private-live-deposit-pilots/' +
      encodeURIComponent(requestId) + '/stop', {
      method: 'POST',
      headers: pilotMutationHeaders(requestId),
      body: JSON.stringify({ confirmation: 'owner_confirmed_emergency_stop', reasonCode, requestId }),
    });
    if (!response.ok) throw new Error('pilot_stop');
    const payload = await response.json();
    const pilot = validPilotStatus(payload && payload.pilot);
    if (!pilot || pilot.pilotStatus !== 'stopped' || pilot.switchMode !== 'disabled' || pilot.financiallyActive) {
      throw new Error('pilot_stop');
    }
    renderPilotStatus(pilot);
    setNotice('Emergency stop confirmed. The private pilot is disabled.');
  } catch (error) {
    if (!isSignedOutError(error)) {
      setNotice('Emergency-stop acknowledgement is unavailable. Retry the same stop immediately.');
      pilotStopButton.disabled = false;
    }
  } finally {
    applyKemerbetQuarantineMutationBoundary();
  }
}

async function loadOwnerPlayerQueues() {
  refreshRequestsButton.disabled = true;
  try {
    // Establish the KemerBet quarantine boundary before rendering any mutation control that can
    // change Player, receiver, readiness, or pilot state.
    await loadKemerbetAgentProfiles();
    await Promise.all([
      loadPlayerRequests(),
      loadAssociationCandidates(),
      loadPlayerEligibility(),
      loadReceivers(),
      loadDepositIntake(),
      loadCurrentPilot(),
      loadCompanionLookupStatus(),
    ]);
  } finally {
    refreshRequestsButton.disabled = false;
    applyKemerbetQuarantineMutationBoundary();
  }
}

async function loadOwnerDashboardAfterAuthentication(successNotice) {
  loginPanel.hidden = true;
  invitePanel.hidden = false;
  setNotice(successNotice);
  try {
    await loadOwnerPlayerQueues();
  } catch (error) {
    // Authentication and dashboard hydration are separate boundaries. A transient read failure
    // must not discard a valid, rotating Owner session or misreport it as a password failure.
    // ownerRequest already signs out on an actual 401/403 and marks that path with signed_out.
    if (!isSignedOutError(error)) {
      setNotice(
        'Owner authentication succeeded, but dashboard data is temporarily unavailable. ' +
        'Your session remains active; select Refresh to retry.',
      );
    }
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setBusy(loginForm, true);
  setNotice('Signing in…');
  let failureNotice = 'Sign-in failed. Check the staging Owner account and try again.';
  try {
    const config = await loadOwnerAuthConfig();
    const response = await deadlineFetch(
      config.supabaseUrl + '/auth/v1/token?grant_type=password',
      {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        headers: { apikey: config.publishableKey, 'content-type': 'application/json' },
        body: JSON.stringify({ email: loginForm.elements.email.value, password: passwordInput.value }),
        referrerPolicy: 'no-referrer',
      },
      OWNER_TOKEN_REQUEST_TIMEOUT_MS,
    );
    passwordInput.value = '';
    if (!response.ok) throw new Error('login');
    const session = await response.json();
    const parsedSession = validOwnerAuthSession(session);
    if (!parsedSession) {
      failureNotice = 'Supabase accepted sign-in but returned an unusable session. Refresh and try again.';
      throw new Error('session');
    }
    ownerAuthGeneration += 1;
    ownerAuthConfig = config;
    updateCompanionDevicePairingAvailability();
    updateCompanionLookupAvailability();
    applyOwnerAuthSession(session, true);
  } catch {
    passwordInput.value = '';
    signOut(failureNotice);
    return;
  } finally {
    setBusy(loginForm, false);
  }
  await loadOwnerDashboardAfterAuthentication(
    'Signed in. This Owner session survives reloads in this tab for up to twelve hours.',
  );
});

async function restoreOwnerSession() {
  const persisted = readPersistedOwnerSession();
  if (!persisted) return;
  setBusy(loginForm, true);
  setNotice('Restoring your Owner session…');
  try {
    const config = await loadOwnerAuthConfig();
    ownerAuthGeneration += 1;
    ownerAuthConfig = config;
    updateCompanionDevicePairingAvailability();
    updateCompanionLookupAvailability();
    ownerSessionExpiresAt = persisted.expiresAt;
    refreshToken = persisted.refreshToken;
    await refreshOwnerSession();
  } catch (error) {
    if (isSignedOutError(error)) {
      if (refreshToken || readPersistedOwnerSession()) {
        signOut('Your saved Owner session was rejected or expired. Sign in again to continue.');
      }
    } else {
      setNotice(
        'Your saved Owner session is temporarily unreachable. Its twelve-hour credential remains ' +
          'saved in this tab; reload or wait for the automatic retry.',
      );
    }
    return;
  } finally {
    setBusy(loginForm, false);
  }
  await loadOwnerDashboardAfterAuthentication('Owner session restored after reload.');
}

inviteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setBusy(inviteForm, true);
  clearInvite();
  setNotice('Creating one-time invite…');
  try {
    const response = await ownerRequest('/v1/owner/telegram-beta-invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expiresInSeconds: Number(inviteForm.elements.expiry.value) }),
    });
    if (!response.ok) throw new Error('issue');
    const invite = validInvite(await response.json());
    if (!invite) throw new Error('receipt');
    currentInvite = invite;
    inviteOutput.textContent = invite.inviteUrl;
    openLink.href = invite.inviteUrl;
    receipt.hidden = false;
    setNotice('Invite created. It will not be recoverable after this page is closed.');
  } catch (error) {
    if (!isSignedOutError(error)) setNotice('Invite creation failed. No reusable link was stored here.');
  } finally {
    setBusy(inviteForm, false);
  }
});

copyButton.addEventListener('click', async () => {
  if (!currentInvite) return;
  try {
    await navigator.clipboard.writeText(currentInvite.inviteUrl);
    setNotice('Invite copied.');
  } catch {
    setNotice('Copy was unavailable. Select the displayed link manually.');
  }
});

revokeButton.addEventListener('click', async () => {
  if (!currentInvite) return;
  revokeButton.disabled = true;
  setNotice('Revoking invite…');
  try {
    const response = await ownerRequest('/v1/owner/telegram-beta-invites/' + encodeURIComponent(currentInvite.inviteId) + '/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reasonCode: 'owner_cancelled' }),
    });
    if (response.status !== 204) throw new Error('revoke');
    clearInvite();
    setNotice('Invite revoked.');
  } catch (error) {
    if (!isSignedOutError(error)) setNotice('Invite revocation failed. Stop and verify before sharing it.');
  } finally {
    revokeButton.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  if (currentKemerbetSession?.active) await stopKemerbetSession({ confirm: false });
  const config = ownerAuthConfig;
  const token = accessToken;
  if (config && token) {
    await deadlineFetch(
      config.supabaseUrl + '/auth/v1/logout?scope=local',
      {
        method: 'POST', cache: 'no-store', credentials: 'omit',
        headers: { apikey: config.publishableKey, authorization: 'Bearer ' + token },
        referrerPolicy: 'no-referrer',
      },
      OWNER_TOKEN_REQUEST_TIMEOUT_MS,
    ).catch(() => undefined);
  }
  signOut();
});
refreshRequestsButton.addEventListener('click', loadOwnerPlayerQueues);
kemerbetReadinessCohortConfirmation.addEventListener(
  'change',
  updateKemerbetReadinessCohortAvailability,
);
kemerbetReadinessCohortForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await prepareKemerbetReadinessCohort();
});
receiverRefreshButton.addEventListener('click', loadReceivers);
receiverForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await rotateReceiver();
});
kemerbetAgentRefreshButton.addEventListener('click', loadKemerbetAgentProfiles);
kemerbetAgentProfileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await prepareKemerbetAgentProfile();
});
kemerbetSessionConfirmation.addEventListener('change', () => {
  kemerbetSessionStartButton.disabled = !privateKemerbetSessionMutationAllowed() ||
    !activeKemerbetAgentProfileId ||
    currentKemerbetSession?.phase !== 'idle';
});
kemerbetSessionStartButton.addEventListener('click', startKemerbetSession);
kemerbetSessionStopButton.addEventListener('click', () => stopKemerbetSession());
kemerbetSessionCanvas.addEventListener('pointerdown', (event) => {
  if (!privateKemerbetSessionMutationAllowed() || !currentKemerbetSession?.active ||
      currentKemerbetSession.phase !== 'login_required' ||
      displayedKemerbetSessionGeneration !== currentKemerbetSession.generation ||
      displayedKemerbetFrameSequence < 1) return;
  event.preventDefault();
  kemerbetSessionCanvas.focus();
  const bounds = kemerbetSessionCanvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(1279,
    Math.floor((event.clientX - bounds.left) * kemerbetSessionCanvas.width / bounds.width)));
  const y = Math.max(0, Math.min(719,
    Math.floor((event.clientY - bounds.top) * kemerbetSessionCanvas.height / bounds.height)));
  flushKemerbetPendingText();
  queueKemerbetSessionInput({ kind: 'pointer', x, y });
});
kemerbetSessionCanvas.addEventListener('keydown', (event) => {
  if (!privateKemerbetSessionMutationAllowed() || !currentKemerbetSession?.active ||
      currentKemerbetSession.phase !== 'login_required' ||
      displayedKemerbetSessionGeneration !== currentKemerbetSession.generation ||
      displayedKemerbetFrameSequence < 1 ||
      event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  const accepted = ['Backspace', 'Delete', 'Enter', 'Escape', 'Tab'].includes(event.key) ||
    (/^[\\u0020-\\u007e]$/.test(event.key) && event.key !== '\u0060');
  if (!accepted) return;
  event.preventDefault();
  if (/^[\u0020-\u007e]$/.test(event.key) && event.key !== '\u0060') {
    bufferKemerbetSessionText(event.key);
    return;
  }
  flushKemerbetPendingText();
  queueKemerbetSessionInput({ key: event.key, kind: 'key' });
});
pilotConfirmation.addEventListener('change', updatePilotPreparationAvailability);
pilotPrepareForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await prepareFixedPilot();
});
pilotRefreshButton.addEventListener('click', loadCurrentPilot);
pilotArmButton.addEventListener('click', armFixedPilot);
pilotStopButton.addEventListener('click', stopCurrentPilot);
companionDevicePairingConfirmation.addEventListener(
  'change',
  updateCompanionDevicePairingAvailability,
);
companionDevicePairingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await issueCompanionDevicePairing();
});
companionLookupConfirmation.addEventListener('change', updateCompanionLookupAvailability);
companionLookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await issueCompanionLookup();
});
companionDevicePairingCopyButton.addEventListener('click', async () => {
  if (!currentCompanionDevicePairing ||
      Date.parse(currentCompanionDevicePairing.expiresAt) <= Date.now()) {
    updateCompanionDevicePairingAvailability();
    return;
  }
  try {
    await navigator.clipboard.writeText(currentCompanionDevicePairing.pairingPackage);
    setNotice(
      'Windows pairing package copied. Paste it only into the local FetanAgent Companion launcher.',
    );
  } catch {
    setNotice(
      'Copy was unavailable. Select the displayed package and paste it only into the local FetanAgent Companion launcher.',
    );
  }
});
companionDevicePairingClearButton.addEventListener('click', () => {
  if (!currentCompanionDevicePairing) return;
  clearCompanionDevicePairingPackage();
  updateCompanionDevicePairingAvailability();
  setNotice(
    'The Windows pairing package was cleared from this page. Its request ID is retained until expiry so a confirmed retry can recover only the same package.',
  );
});
telebirrDevicePairingConfirmation.addEventListener(
  'change',
  updateTelebirrDevicePairingAvailability,
);
telebirrDevicePairingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await issueTelebirrDevicePairing();
});
telebirrDevicePairingCopyButton.addEventListener('click', async () => {
  if (!currentTelebirrDevicePairing ||
      Date.parse(currentTelebirrDevicePairing.expiresAt) <= Date.now()) {
    updateTelebirrDevicePairingAvailability();
    return;
  }
  try {
    await navigator.clipboard.writeText(currentTelebirrDevicePairing.pairingPackage);
    setNotice('Pairing package copied. Paste it only into the dedicated FetanAgent Android app.');
  } catch {
    setNotice('Copy was unavailable. Select the displayed package and paste it only into the phone.');
  }
});
telebirrDevicePairingClearButton.addEventListener('click', () => {
  if (!currentTelebirrDevicePairing) return;
  clearTelebirrDevicePairingPackage();
  updateTelebirrDevicePairingAvailability();
  setNotice(
    'The package was cleared from this page. Its request ID is retained until expiry so a confirmed retry can recover only the same package.',
  );
});
void restoreOwnerSession();
`;

export function ownerDashboardPublicConfig(
  runtime: Extract<OwnerControlRuntimeConfig, { enabled: true }>,
) {
  return {
    companionDevicePairingConfigured: runtime.companionDevicePairing.configured,
    publishableKey: runtime.publishableKey,
    supabaseUrl: runtime.supabaseUrl,
    telebirrDevicePairingConfigured: runtime.devicePairing.configured,
  } as const;
}
