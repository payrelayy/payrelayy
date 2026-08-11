import {
  OWNER_CONTROL_TELEGRAM_BOT_USERNAME,
  type OwnerControlRuntimeConfig,
} from '@payreplayy/config/owner-control';

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
    <title>PayReplayy Owner</title>
    <link rel="stylesheet" href="/owner/styles.css" />
  </head>
  <body>
    <main class="shell">
      <header>
        <p class="eyebrow">Private staging control</p>
        <h1>PayReplayy Owner</h1>
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

function signOut(message = 'Signed out.') {
  accessToken = undefined;
  passwordInput.value = '';
  clearInvite();
  clearPlayerRequests();
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
    await loadPlayerRequests();
  } catch (error) {
    if (!isSignedOutError(error)) setNotice('Player ID review failed. Refresh before trying again.');
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
    await loadPlayerRequests();
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
refreshRequestsButton.addEventListener('click', loadPlayerRequests);
`;

export function ownerDashboardPublicConfig(
  runtime: Extract<OwnerControlRuntimeConfig, { enabled: true }>,
) {
  return {
    publishableKey: runtime.publishableKey,
    supabaseUrl: runtime.supabaseUrl,
  } as const;
}
