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
const depositIntakeList = document.querySelector('#deposit-intake-list');

let accessToken;
let currentInvite;
const expectedSupabaseUrl = '${STAGING_SUPABASE_ORIGIN}';

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

function clearDepositIntake() {
  depositIntakeList.replaceChildren();
}

function signOut(message = 'Signed out.') {
  accessToken = undefined;
  passwordInput.value = '';
  clearInvite();
  clearPlayerRequests();
  clearAssociationCandidates();
  clearPlayerEligibility();
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

async function ownerRequest(path, init) {
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

async function loadOwnerPlayerQueues() {
  refreshRequestsButton.disabled = true;
  try {
    await Promise.all([
      loadPlayerRequests(),
      loadAssociationCandidates(),
      loadPlayerEligibility(),
      loadDepositIntake(),
    ]);
  } finally {
    refreshRequestsButton.disabled = false;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setBusy(loginForm, true);
  setNotice('Signing in…');
  try {
    const configResponse = await fetch('/owner/config.json', { cache: 'no-store', credentials: 'omit' });
    if (!configResponse.ok) throw new Error('config');
    const config = await configResponse.json();
    if (config.supabaseUrl !== expectedSupabaseUrl ||
        typeof config.publishableKey !== 'string' ||
        !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(config.publishableKey)) throw new Error('config');
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
    if (typeof session.access_token !== 'string' || session.access_token.length < 20) throw new Error('login');
    accessToken = session.access_token;
    loginPanel.hidden = true;
    invitePanel.hidden = false;
    setNotice('Signed in. Create an invite when you are ready to send it.');
    await loadOwnerPlayerQueues();
  } catch {
    passwordInput.value = '';
    accessToken = undefined;
    setNotice('Sign-in failed. Check the staging Owner account and try again.');
  } finally {
    setBusy(loginForm, false);
  }
});

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

logoutButton.addEventListener('click', () => signOut());
refreshRequestsButton.addEventListener('click', loadOwnerPlayerQueues);
`;

export function ownerDashboardPublicConfig(
  runtime: Extract<OwnerControlRuntimeConfig, { enabled: true }>,
) {
  return {
    publishableKey: runtime.publishableKey,
    supabaseUrl: runtime.supabaseUrl,
  } as const;
}
