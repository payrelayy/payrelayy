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

        <section class="review-section" aria-labelledby="kemerbet-agent-title">
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
          <div class="kemerbet-session" aria-labelledby="kemerbet-session-title">
            <h3 id="kemerbet-session-title">Private KemerBet sign-in</h3>
            <p class="receipt-label">
              Open a ten-minute isolated sign-in window, then click the preview and type directly
              into KemerBet. After successful sign-in, the locked authenticated browser is retained
              for up to twelve hours, including across Owner-page re-authentication. Passwords and
              OTPs are never sent to chat, Git, Supabase, or FetanAgent logs. Transfer is blocked,
              and all input locks as soon as sign-in is detected.
            </p>
            <p class="request-meta" id="kemerbet-session-status">
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
button:disabled { cursor: wait; opacity: 0.55; }
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
.kemerbet-session { margin-top: 24px; border: 1px solid #164e63; border-radius: 12px; background: #0c1d20; padding: 16px; }
.kemerbet-session h3 { margin-top: 0; }
#kemerbet-session-canvas { width: 100%; height: auto; margin-top: 16px; border: 1px solid #3f3f46; border-radius: 10px; background: #000; cursor: crosshair; }
#kemerbet-session-canvas:focus { outline: 3px solid rgba(103, 232, 249, 0.55); outline-offset: 2px; }
output { display: block; overflow-wrap: anywhere; border-radius: 10px; color: #cffafe; background: #0c1d20; padding: 14px; }
.actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px; }
.notice { min-height: 24px; color: #fcd34d; font-weight: 700; }
footer { margin-top: 30px; font-size: 0.85rem; }
[hidden] { display: none !important; }
@media (max-width: 640px) { .shell { padding-top: 36px; } .actions, .review-actions { grid-template-columns: 1fr; } .panel-heading { display: block; } .panel-heading .secondary { margin-bottom: 18px; } }
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
const receiverList = document.querySelector('#receiver-list');
const receiverForm = document.querySelector('#receiver-form');
const receiverRefreshButton = document.querySelector('#receiver-refresh-button');
const receiverAccountReference = document.querySelector('#receiver-account-reference');
const receiverConfirmation = document.querySelector('#receiver-confirmation');
const kemerbetAgentProfileList = document.querySelector('#kemerbet-agent-profile-list');
const kemerbetAgentProfileForm = document.querySelector('#kemerbet-agent-profile-form');
const kemerbetAgentProfileConfirmation = document.querySelector('#kemerbet-agent-profile-confirmation');
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
const depositIntakeList = document.querySelector('#deposit-intake-list');

let accessToken;
let refreshToken;
let ownerAuthConfig;
let ownerSessionExpiresAt;
let accessTokenRefreshAt;
let ownerRefreshTimer;
let ownerRefreshPromise;
let ownerAuthGeneration = 0;
let currentInvite;
let currentPilot;
let eligiblePilotPlayers = [];
let activeKemerbetAgentProfileId;
let currentKemerbetSession;
let kemerbetSessionPollTimer;
let kemerbetInputPending = false;
let kemerbetInputLane = Promise.resolve();
const selectedPilotPlayerIds = new Set();
const expectedSupabaseUrl = '${STAGING_SUPABASE_ORIGIN}';
const OWNER_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 1_000;
const OWNER_SESSION_STORAGE_KEY = 'fetanagent.owner.session.v1';

function setNotice(message) {
  notice.textContent = message;
}

function setBusy(form, busy) {
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
  kemerbetInputPending = false;
  kemerbetInputLane = Promise.resolve();
  kemerbetSessionCanvas.hidden = true;
  const context = kemerbetSessionCanvas.getContext('2d');
  if (context) context.clearRect(0, 0, kemerbetSessionCanvas.width, kemerbetSessionCanvas.height);
  kemerbetSessionConfirmation.checked = false;
  kemerbetSessionStartButton.disabled = true;
  kemerbetSessionStopButton.disabled = true;
  kemerbetSessionStatus.textContent = activeKemerbetAgentProfileId
    ? 'Private sign-in service is stopped.'
    : 'Load an active KemerBet profile to check sign-in readiness.';
}

function clearPilot() {
  currentPilot = undefined;
  eligiblePilotPlayers = [];
  selectedPilotPlayerIds.clear();
  pilotCandidateList.replaceChildren();
  pilotStatusFacts.replaceChildren();
  pilotStatusPanel.hidden = true;
  pilotConfirmation.checked = false;
  pilotReadiness.textContent = 'Sign in to load the approved cohort.';
  pilotPrepareButton.disabled = true;
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
  ownerSessionStatus.textContent = '';
  passwordInput.value = '';
  clearInvite();
  clearPlayerRequests();
  clearAssociationCandidates();
  clearPlayerEligibility();
  clearReceivers();
  clearKemerbetAgentProfiles();
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
  const response = await fetch('/owner/config.json', { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('config');
  const config = await response.json();
  if (config.supabaseUrl !== expectedSupabaseUrl ||
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
    const response = await fetch(
      ownerAuthConfig.supabaseUrl + '/auth/v1/token?grant_type=refresh_token',
      {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        headers: { apikey: ownerAuthConfig.publishableKey, 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        referrerPolicy: 'no-referrer',
      },
    );
    if (!response.ok || generation !== ownerAuthGeneration) throw new Error('signed_out');
    applyOwnerAuthSession(await response.json(), false);
  })();
  try {
    await ownerRefreshPromise;
  } catch {
    if (generation === ownerAuthGeneration) {
      signOut('Your Owner session could not be renewed. Sign in again to continue.');
    }
    throw new Error('signed_out');
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

async function ownerRequest(path, init) {
  await ensureFreshOwnerAccessToken();
  if (!accessToken) throw new Error('signed_out');
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    credentials: 'omit',
    headers: { ...init.headers, authorization: 'Bearer ' + accessToken },
    referrerPolicy: 'no-referrer',
  });
  if (response.status === 401 || response.status === 403) {
    signOut('Your session is unavailable or is not an active Owner.');
    throw new Error('signed_out');
  }
  return response;
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
  kemerbetSessionStartButton.disabled = !activeKemerbetAgentProfileId ||
    Boolean(currentKemerbetSession?.active) || !kemerbetSessionConfirmation.checked;
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

function validKemerbetSession(value) {
  if (!value || typeof value !== 'object' || typeof value.active !== 'boolean' ||
      typeof value.loginRequired !== 'boolean' || typeof value.signedIn !== 'boolean' ||
      value.transferDisabled !== true || (value.signedIn && value.loginRequired)) return undefined;
  const expectedKeys = value.active
    ? ['active', 'expiresAt', 'imageBase64', 'imageContentType', 'loginRequired', 'signedIn', 'transferDisabled']
    : ['active', 'loginRequired', 'signedIn', 'transferDisabled'];
  if (Object.keys(value).sort().join('\\0') !== expectedKeys.sort().join('\\0')) return undefined;
  if (!value.active) {
    return value.loginRequired || value.signedIn ? undefined :
      { active: false, loginRequired: false, signedIn: false, transferDisabled: true };
  }
  if (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) ||
      value.imageContentType !== 'image/jpeg' || typeof value.imageBase64 !== 'string' ||
      value.imageBase64.length < 4 || value.imageBase64.length > 1900000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.imageBase64)) return undefined;
  return value;
}

async function drawKemerbetSession(imageBase64) {
  const binary = atob(imageBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  try {
    const context = kemerbetSessionCanvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.clearRect(0, 0, kemerbetSessionCanvas.width, kemerbetSessionCanvas.height);
    context.drawImage(bitmap, 0, 0, kemerbetSessionCanvas.width, kemerbetSessionCanvas.height);
    kemerbetSessionCanvas.hidden = false;
  } finally {
    bitmap.close();
  }
}

function scheduleKemerbetSessionPoll() {
  if (kemerbetSessionPollTimer !== undefined) window.clearTimeout(kemerbetSessionPollTimer);
  kemerbetSessionPollTimer = currentKemerbetSession?.active
    ? window.setTimeout(() => void loadKemerbetSession(), 1500)
    : undefined;
}

async function renderKemerbetSession(session) {
  const wasSignedIn = currentKemerbetSession?.signedIn === true;
  currentKemerbetSession = session;
  kemerbetSessionStartButton.disabled = !activeKemerbetAgentProfileId || session.active ||
    !kemerbetSessionConfirmation.checked;
  kemerbetSessionStopButton.disabled = !session.active;
  if (!session.active) {
    kemerbetSessionCanvas.hidden = true;
    kemerbetSessionStatus.textContent = 'Private sign-in service is stopped.';
    scheduleKemerbetSessionPoll();
    return;
  }
  await drawKemerbetSession(session.imageBase64);
  if (session.signedIn) {
    kemerbetSessionStatus.textContent = 'KemerBet signed in and retained until ' +
      new Date(session.expiresAt).toLocaleString() +
      '. Input is locked and Transfer remains disabled.';
    if (!wasSignedIn) {
      setNotice('KemerBet sign-in complete. The authenticated session is retained and preview input is locked.');
    }
  } else {
    kemerbetSessionStatus.textContent = 'Private KemerBet login is open until ' +
      new Date(session.expiresAt).toLocaleTimeString() + '. Click the preview, then type your password or OTP.';
  }
  scheduleKemerbetSessionPoll();
}

async function loadKemerbetSession() {
  if (!activeKemerbetAgentProfileId || !accessToken || kemerbetInputPending) return;
  try {
    const response = await ownerRequest('/v1/owner/kemerbet-session', { method: 'GET', headers: {} });
    if (!response.ok) throw new Error('kemerbet_session');
    const payload = await response.json();
    const session = validKemerbetSession(payload && payload.session);
    if (!session) throw new Error('kemerbet_session');
    await renderKemerbetSession(session);
  } catch (error) {
    if (!isSignedOutError(error)) {
      clearKemerbetSession();
      kemerbetSessionStatus.textContent = 'Private sign-in service is not running yet.';
    }
  }
}

function kemerbetSessionMutationHeaders(requestId) {
  return { 'content-type': 'application/json',
    'x-fetanagent-owner-csrf': 'owner-kemerbet-session-v1',
    'x-idempotency-key': requestId };
}

async function startKemerbetSession() {
  if (!activeKemerbetAgentProfileId || !kemerbetSessionConfirmation.checked) return;
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
    if (response.status !== 201) throw new Error('kemerbet_session');
    const payload = await response.json();
    const session = validKemerbetSession(payload && payload.session);
    if (!session || !session.active || !session.loginRequired) throw new Error('kemerbet_session');
    kemerbetSessionConfirmation.checked = false;
    await renderKemerbetSession(session);
    kemerbetSessionCanvas.focus();
    setNotice('Private KemerBet sign-in is ready. Click the preview and type there only.');
  } catch (error) {
    await loadKemerbetSession();
    if (!isSignedOutError(error)) {
      if (currentKemerbetSession?.active) {
        setNotice(currentKemerbetSession.signedIn
          ? 'KemerBet is already signed in. The retained browser remains locked and Transfer is disabled.'
          : 'The private KemerBet sign-in browser is already open. Click the preview and type there only.');
        return;
      }
      const failureMessage =
        'Private KemerBet sign-in could not start. No credential was accepted. Please try once more; if it still fails, contact support.';
      kemerbetSessionStatus.textContent = failureMessage;
      setNotice(failureMessage);
    }
  }
}

async function stopKemerbetSession({ confirm = true } = {}) {
  if (!currentKemerbetSession?.active) return;
  if (confirm && !window.confirm('Stop the private KemerBet sign-in browser now?')) return;
  const requestId = crypto.randomUUID();
  kemerbetSessionStopButton.disabled = true;
  try {
    const response = await ownerRequest('/v1/owner/kemerbet-session/stop', {
      method: 'POST', headers: kemerbetSessionMutationHeaders(requestId),
      body: JSON.stringify({ confirmation: 'owner_confirmed_stop_private_kemerbet_session', requestId }),
    });
    if (!response.ok) throw new Error('kemerbet_session');
    const payload = await response.json();
    const session = validKemerbetSession(payload && payload.session);
    if (!session || session.active) throw new Error('kemerbet_session');
    await renderKemerbetSession(session);
    setNotice('Private KemerBet sign-in browser stopped.');
  } catch (error) {
    if (!isSignedOutError(error)) setNotice('Stop acknowledgement is unavailable. Retry Stop immediately.');
  }
}

async function sendKemerbetSessionInput(input) {
  if (!currentKemerbetSession?.active || currentKemerbetSession.signedIn) return;
  kemerbetInputPending = true;
  if (kemerbetSessionPollTimer !== undefined) window.clearTimeout(kemerbetSessionPollTimer);
  const requestId = crypto.randomUUID();
  try {
    const response = await ownerRequest('/v1/owner/kemerbet-session/input', {
      method: 'POST', headers: kemerbetSessionMutationHeaders(requestId),
      body: JSON.stringify({ ...input, requestId }),
    });
    if (!response.ok) throw new Error('kemerbet_session');
    const payload = await response.json();
    const session = validKemerbetSession(payload && payload.session);
    if (!session) throw new Error('kemerbet_session');
    await renderKemerbetSession(session);
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

async function prepareKemerbetAgentProfile() {
  const configurationReason = kemerbetAgentProfileForm.elements.configurationReason.value;
  if (!kemerbetAgentProfileConfirmation.checked ||
      !['initial_configuration', 'agent_rotation', 'security_recovery', 'owner_correction'].includes(configurationReason)) return;
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
    if (response.status !== 201) throw new Error('kemerbet_agent_profile');
    const payload = await response.json();
    const profile = validKemerbetAgentProfile(payload && payload.profile);
    if (!profile || profile.configurationReason !== configurationReason) throw new Error('kemerbet_agent_profile');
    kemerbetAgentProfileConfirmation.checked = false;
    setNotice(profile.profileLabel + ' is prepared. KemerBet login, Transfer, and money movement remain disabled.');
    await loadKemerbetAgentProfiles();
  } catch (error) {
    if (!isSignedOutError(error)) {
      setNotice('KemerBet agent-profile preparation was rejected or unavailable. No credential was requested or retained.');
    }
  } finally {
    setBusy(kemerbetAgentProfileForm, false);
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

function updatePilotPreparationAvailability() {
  pilotPrepareButton.disabled = Boolean(currentPilot) || selectedPilotPlayerIds.size !== 5 ||
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
    checkbox.checked = selectedPilotPlayerIds.has(player.playerId);
    checkbox.disabled = Boolean(currentPilot);
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

function renderPilotStatus(pilot) {
  currentPilot = pilot;
  pilotStatusFacts.replaceChildren();
  pilotStatusPanel.hidden = !pilot;
  if (!pilot) {
    renderPilotCandidates(eligiblePilotPlayers);
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
  pilotArmButton.disabled = pilot.pilotStatus !== 'draft' || pilot.financiallyActive;
  pilotStopButton.disabled = pilot.pilotStatus === 'stopped';
  renderPilotCandidates(eligiblePilotPlayers);
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
    if (!currentPilot) renderPilotStatus(undefined);
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
    button.textContent = 'Confirm ownership only';
    button.addEventListener('click', () => associatePlayerRequest(candidate.requestId));
    card.append(title, metadata, button);
    playerAssociationList.append(card);
  }
}

async function decidePlayerEligibility(player, decision) {
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
    approve.textContent = 'Approve deposit eligibility';
    approve.disabled = player.playerStatus !== 'active' || player.validationStatus !== 'valid' ||
      player.decision === 'eligible';
    approve.addEventListener('click', () => decidePlayerEligibility(player, 'eligible'));
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.className = 'danger';
    revoke.textContent = 'Revoke deposit eligibility';
    revoke.disabled = player.decision === 'revoked';
    revoke.addEventListener('click', () => decidePlayerEligibility(player, 'revoked'));
    actions.append(approve, revoke);
    card.append(title, metadata, actions);
    playerEligibilityList.append(card);
  }
}

function reviewButton(label, requestId, decision, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
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

function pilotMutationHeaders(requestId) {
  return {
    'content-type': 'application/json',
    'x-fetanagent-owner-csrf': 'private-live-pilot-v1',
    'x-idempotency-key': requestId,
  };
}

async function prepareFixedPilot() {
  if (currentPilot || selectedPilotPlayerIds.size !== 5 || !pilotConfirmation.checked) return;
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
  }
}

async function armFixedPilot() {
  if (!currentPilot || currentPilot.pilotStatus !== 'draft') return;
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
    if (currentPilot) pilotArmButton.disabled = currentPilot.pilotStatus !== 'draft';
  }
}

async function stopCurrentPilot() {
  if (!currentPilot) return;
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
  }
}

async function loadOwnerPlayerQueues() {
  refreshRequestsButton.disabled = true;
  try {
    await Promise.all([
      loadPlayerRequests(),
      loadAssociationCandidates(),
      loadPlayerEligibility(),
      loadReceivers(),
      loadKemerbetAgentProfiles(),
      loadDepositIntake(),
      loadCurrentPilot(),
    ]);
  } finally {
    refreshRequestsButton.disabled = false;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setBusy(loginForm, true);
  setNotice('Signing in…');
  let failureNotice = 'Sign-in failed. Check the staging Owner account and try again.';
  try {
    const config = await loadOwnerAuthConfig();
    const response = await fetch(config.supabaseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: { apikey: config.publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: loginForm.elements.email.value, password: passwordInput.value }),
      referrerPolicy: 'no-referrer',
    });
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
    applyOwnerAuthSession(session, true);
    loginPanel.hidden = true;
    invitePanel.hidden = false;
    setNotice('Signed in. This Owner session survives reloads in this tab for up to twelve hours.');
    await loadOwnerPlayerQueues();
  } catch {
    passwordInput.value = '';
    signOut(failureNotice);
  } finally {
    setBusy(loginForm, false);
  }
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
    ownerSessionExpiresAt = persisted.expiresAt;
    refreshToken = persisted.refreshToken;
    await refreshOwnerSession();
    loginPanel.hidden = true;
    invitePanel.hidden = false;
    setNotice('Owner session restored after reload.');
    await loadOwnerPlayerQueues();
  } catch {
    signOut('Your saved Owner session could not be restored. Sign in again to continue.');
  } finally {
    setBusy(loginForm, false);
  }
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
    await fetch(config.supabaseUrl + '/auth/v1/logout?scope=local', {
      method: 'POST', cache: 'no-store', credentials: 'omit',
      headers: { apikey: config.publishableKey, authorization: 'Bearer ' + token },
      referrerPolicy: 'no-referrer',
    }).catch(() => undefined);
  }
  signOut();
});
refreshRequestsButton.addEventListener('click', loadOwnerPlayerQueues);
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
  kemerbetSessionStartButton.disabled = !activeKemerbetAgentProfileId ||
    Boolean(currentKemerbetSession?.active) || !kemerbetSessionConfirmation.checked;
});
kemerbetSessionStartButton.addEventListener('click', startKemerbetSession);
kemerbetSessionStopButton.addEventListener('click', () => stopKemerbetSession());
kemerbetSessionCanvas.addEventListener('pointerdown', (event) => {
  if (!currentKemerbetSession?.active || currentKemerbetSession.signedIn) return;
  event.preventDefault();
  kemerbetSessionCanvas.focus();
  const bounds = kemerbetSessionCanvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(1279,
    Math.floor((event.clientX - bounds.left) * kemerbetSessionCanvas.width / bounds.width)));
  const y = Math.max(0, Math.min(719,
    Math.floor((event.clientY - bounds.top) * kemerbetSessionCanvas.height / bounds.height)));
  queueKemerbetSessionInput({ kind: 'pointer', x, y });
});
kemerbetSessionCanvas.addEventListener('keydown', (event) => {
  if (!currentKemerbetSession?.active || currentKemerbetSession.signedIn ||
      event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  const accepted = ['Backspace', 'Delete', 'Enter', 'Escape', 'Tab'].includes(event.key) ||
    (/^[\\u0020-\\u007e]$/.test(event.key) && event.key !== '\u0060');
  if (!accepted) return;
  event.preventDefault();
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
void restoreOwnerSession();
`;

export function ownerDashboardPublicConfig(
  runtime: Extract<OwnerControlRuntimeConfig, { enabled: true }>,
) {
  return {
    publishableKey: runtime.publishableKey,
    supabaseUrl: runtime.supabaseUrl,
  } as const;
}
