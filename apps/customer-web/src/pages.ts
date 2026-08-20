import type {
  CustomerDepositInstructions,
  CustomerDepositSummary,
  CustomerWorkspaceRegistration,
} from '@fetanagent/customer-web-workspace-runtime';

export interface PageNotice {
  readonly kind: 'info' | 'error';
  readonly message: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function noticeMarkup(notice: PageNotice | undefined): string {
  if (!notice) return '';
  const className = notice.kind === 'error' ? 'notice error' : 'notice';
  return `<p class="${className}" role="status">${escapeHtml(notice.message)}</p>`;
}

function layout(title: string, content: string, nav: 'public' | 'signed-in' = 'public'): string {
  const navigation =
    nav === 'signed-in'
      ? '<nav class="nav" aria-label="Account"><a href="/workspace">Workspace</a></nav>'
      : '<nav class="nav" aria-label="Account"><a href="/sign-in">Sign in</a><a href="/create-account">Create account</a></nav>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#07090d">
    <meta name="description" content="A secure, responsive workspace for your FetanAgent account.">
    <title>${escapeHtml(title)} · FetanAgent</title>
    <link rel="icon" href="/assets/mark.v1.svg" type="image/svg+xml">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="stylesheet" href="/assets/app.v1.css">
    <script src="/assets/register-sw.v1.js" defer></script>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="/" aria-label="FetanAgent home">
          <img src="/assets/mark.v1.svg" alt="" width="40" height="40">
          <span>FetanAgent</span>
        </a>
        ${navigation}
      </header>
      ${content}
    </div>
  </body>
</html>`;
}

function csrfField(csrfToken: string): string {
  return `<input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">`;
}

export function homePage(): string {
  return layout(
    'Home',
    `<main class="hero">
      <p class="eyebrow">Your FetanAgent workspace</p>
      <h1>Simple account access, wherever you are.</h1>
      <p class="lede">Use a focused, responsive experience on your phone or computer. Create your account or sign in to continue.</p>
      <div class="actions">
        <a class="button" href="/create-account">Create account</a>
        <a class="button secondary" href="/sign-in">Sign in</a>
      </div>
    </main>`,
  );
}

export function createAccountPage(csrfToken: string, notice?: PageNotice): string {
  return layout(
    'Create account',
    `<main class="auth-layout">
      <section class="card" aria-labelledby="create-title">
        <p class="eyebrow">Get started</p>
        <h2 id="create-title">Create your account</h2>
        <p class="supporting">Use an email address you can access and a strong password.</p>
        ${noticeMarkup(notice)}
        <form method="post" action="/create-account" accept-charset="utf-8">
          ${csrfField(csrfToken)}
          <label>Email address
            <input name="email" type="email" inputmode="email" autocomplete="email" maxlength="254" required>
          </label>
          <label>Password
            <input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required>
          </label>
          <button type="submit">Create account</button>
        </form>
        <p class="quiet">Already have an account? <a class="text-link" href="/sign-in">Sign in</a>.</p>
      </section>
    </main>`,
  );
}

export function signInPage(csrfToken: string, notice?: PageNotice): string {
  return layout(
    'Sign in',
    `<main class="auth-layout">
      <section class="card" aria-labelledby="sign-in-title">
        <p class="eyebrow">Welcome back</p>
        <h2 id="sign-in-title">Sign in</h2>
        <p class="supporting">Continue to your FetanAgent workspace.</p>
        ${noticeMarkup(notice)}
        <form method="post" action="/sign-in" accept-charset="utf-8">
          ${csrfField(csrfToken)}
          <label>Email address
            <input name="email" type="email" inputmode="email" autocomplete="email" maxlength="254" required>
          </label>
          <label>Password
            <input name="password" type="password" autocomplete="current-password" maxlength="128" required>
          </label>
          <div class="form-row">
            <a class="text-link" href="/forgot-password">Forgot password?</a>
            <button type="submit">Sign in</button>
          </div>
        </form>
      </section>
    </main>`,
  );
}

export function forgotPasswordPage(csrfToken: string, notice?: PageNotice): string {
  return layout(
    'Forgot password',
    `<main class="auth-layout">
      <section class="card" aria-labelledby="recovery-title">
        <p class="eyebrow">Account recovery</p>
        <h2 id="recovery-title">Reset your password</h2>
        <p class="supporting">Enter your email address. We will send recovery instructions when the account can use that address.</p>
        ${noticeMarkup(notice)}
        <form method="post" action="/forgot-password" accept-charset="utf-8">
          ${csrfField(csrfToken)}
          <label>Email address
            <input name="email" type="email" inputmode="email" autocomplete="email" maxlength="254" required>
          </label>
          <button type="submit">Send recovery instructions</button>
        </form>
        <p class="quiet"><a class="text-link" href="/sign-in">Return to sign in</a>.</p>
      </section>
    </main>`,
  );
}

export function updatePasswordPage(csrfToken: string, notice?: PageNotice): string {
  return layout(
    'Update password',
    `<main class="auth-layout">
      <section class="card" aria-labelledby="update-title">
        <p class="eyebrow">Account recovery</p>
        <h2 id="update-title">Choose a new password</h2>
        <p class="supporting">Use at least 12 characters for your new password.</p>
        ${noticeMarkup(notice)}
        <form method="post" action="/update-password" accept-charset="utf-8">
          ${csrfField(csrfToken)}
          <label>New password
            <input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required>
          </label>
          <button type="submit">Update password</button>
        </form>
      </section>
    </main>`,
  );
}

function statusLabel(status: CustomerWorkspaceRegistration['status']): string {
  switch (status) {
    case 'checking':
      return 'Checking';
    case 'ready':
      return 'Ready';
    case 'needs_attention':
      return 'Could not confirm';
  }
}

function statusClass(status: CustomerWorkspaceRegistration['status']): string {
  return status === 'needs_attention' ? 'status-unconfirmed' : `status-${status}`;
}

function registrationList(registrations: readonly CustomerWorkspaceRegistration[]): string {
  if (registrations.length === 0) {
    return '<p class="empty-state">No Player IDs added yet.</p>';
  }
  return `<ul class="player-id-list">${registrations
    .map(
      (registration) => `<li>
        <span class="player-id-value">${escapeHtml(registration.playerId)}</span>
        <span class="status ${statusClass(registration.status)}">${statusLabel(registration.status)}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function amountEtb(amountMinor: string): string {
  if (!/^[1-9][0-9]*$/u.test(amountMinor)) return '—';
  const minor = BigInt(amountMinor);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
}

function depositStatusClass(tone: CustomerDepositSummary['status']['tone']): string {
  return tone === 'attention' ? 'status-unconfirmed' : `status-${tone}`;
}

function depositList(deposits: readonly CustomerDepositSummary[]): string {
  if (deposits.length === 0) return '<p class="empty-state">No deposits yet.</p>';
  return `<ul class="player-id-list">${deposits
    .map(
      (deposit) => `<li>
        <span class="player-id-value">${amountEtb(deposit.amountMinor)} ETB</span>
        <span class="status ${depositStatusClass(deposit.status.tone)}">${escapeHtml(deposit.status.label)}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function depositPlayerOptions(registrations: readonly CustomerWorkspaceRegistration[]): string {
  return registrations
    .filter((registration) => registration.status === 'ready')
    .map(
      (registration) =>
        `<option value="${escapeHtml(registration.playerId)}">${escapeHtml(registration.playerId)}</option>`,
    )
    .join('');
}

export function workspacePage(
  email: string,
  csrfToken: string,
  requestKey: string,
  registrations: readonly CustomerWorkspaceRegistration[],
  deposits: readonly CustomerDepositSummary[],
  notice?: PageNotice,
  dryRunProofAvailable = false,
): string {
  const readyOptions = depositPlayerOptions(registrations);
  return layout(
    'Workspace',
    `<main class="workspace-layout">
      <section class="card wide" aria-labelledby="workspace-title">
        <p class="eyebrow">Workspace</p>
        <h2 id="workspace-title">Good to see you.</h2>
        <p class="supporting">Signed in as ${escapeHtml(email)}.</p>
        ${noticeMarkup(notice)}
        <div class="workspace-grid">
          <article class="workspace-panel">
            <h3>Submit deposit proof</h3>
            <p>Choose a provider and submit only its transaction ID for a saved KemerBet Player ID. To deposit to another Player ID, type that eligible ID below instead.</p>
            <p class="quiet">Simulation only. This does not verify a payment or issue credit.</p>
            ${
              dryRunProofAvailable
                ? `<form method="post" action="/deposits/proof" accept-charset="utf-8">
              ${csrfField(csrfToken)}
              <input type="hidden" name="requestKey" value="${escapeHtml(requestKey)}">
              <label>Payment provider
                <select name="provider" required>
                  <option value="cbe_birr">CBE Birr</option>
                  <option value="telebirr">TeleBirr</option>
                </select>
              </label>
              <label>Destination KemerBet Player ID
                <input name="playerId" type="text" list="ready-player-ids" autocomplete="off" maxlength="64" required>
              </label>
              <datalist id="ready-player-ids">${readyOptions}</datalist>
              <label>Transaction ID
                <input name="transactionId" type="text" inputmode="text" autocomplete="off" minlength="8" maxlength="32" pattern="[A-Za-z0-9]{8,32}" required>
              </label>
              <button type="submit">Submit simulation proof</button>
            </form>`
                : '<p class="empty-state">Deposit proof intake is temporarily unavailable.</p>'
            }
          </article>
          <article class="workspace-panel">
            <h3>Recent deposits</h3>
            ${depositList(deposits)}
          </article>
        </div>
        <div class="workspace-grid">
          <article class="workspace-panel">
            <h3>Player IDs</h3>
            <p>Add a Player ID to keep its status in one place.</p>
            <form method="post" action="/player-ids" accept-charset="utf-8">
              ${csrfField(csrfToken)}
              <input type="hidden" name="requestKey" value="${escapeHtml(requestKey)}">
              <label>Player ID
                <input name="playerId" type="text" autocomplete="off" maxlength="64" required>
              </label>
              <button type="submit">Add Player ID</button>
            </form>
          </article>
          <article class="workspace-panel">
            <h3>Your Player IDs</h3>
            ${registrationList(registrations)}
          </article>
        </div>
        <form method="post" action="/sign-out" accept-charset="utf-8">
          ${csrfField(csrfToken)}
          <button class="secondary" type="submit">Sign out</button>
        </form>
      </section>
    </main>`,
    'signed-in',
  );
}

export function depositInstructionsPage(
  email: string,
  csrfToken: string,
  requestKey: string,
  depositToken: string,
  instructions: CustomerDepositInstructions,
): string {
  return layout(
    'Deposit instructions',
    `<main class="workspace-layout">
      <section class="card wide" aria-labelledby="deposit-title">
        <p class="eyebrow">Deposit</p>
        <h2 id="deposit-title">Send ${amountEtb(instructions.amountMinor)} ETB</h2>
        <p class="supporting">Signed in as ${escapeHtml(email)}. Complete this payment in CBE Birr, then submit its transaction reference.</p>
        <div class="workspace-grid">
          <article class="workspace-panel">
            <h3>Payment details</h3>
            <dl>
              <dt>Provider</dt><dd>${escapeHtml(instructions.providerName)}</dd>
              <dt>Receiver</dt><dd>${escapeHtml(instructions.receiverAccountHolderName)}</dd>
              <dt>Account</dt><dd>${escapeHtml(instructions.receiverAccountMasked)}</dd>
              <dt>Status</dt><dd>${escapeHtml(instructions.status.label)}</dd>
            </dl>
            <p>${escapeHtml(instructions.customerInstruction)}</p>
            <p class="quiet">Complete payment before ${escapeHtml(instructions.paymentDeadline)}.</p>
          </article>
          <article class="workspace-panel">
            <h3>Submit transaction reference</h3>
            <form method="post" action="/deposits/reference" accept-charset="utf-8">
              ${csrfField(csrfToken)}
              <input type="hidden" name="requestKey" value="${escapeHtml(requestKey)}">
              <input type="hidden" name="depositToken" value="${escapeHtml(depositToken)}">
              <label>CBE Birr transaction reference
                <input name="transactionReference" type="text" autocomplete="off" minlength="5" maxlength="128" required>
              </label>
              <button type="submit">Check payment</button>
            </form>
          </article>
        </div>
        <div class="actions"><a class="button secondary" href="/workspace">Return to workspace</a></div>
      </section>
    </main>`,
    'signed-in',
  );
}

export function offlinePage(): string {
  return layout(
    'Offline',
    `<main class="auth-layout">
      <section class="card" aria-labelledby="offline-title">
        <p class="eyebrow">Connection unavailable</p>
        <h2 id="offline-title">You are offline.</h2>
        <p class="supporting">Reconnect before opening account pages or submitting a request.</p>
        <div class="actions"><a class="button" href="/">Try again</a></div>
      </section>
    </main>`,
  );
}

export function genericErrorPage(statusCode: number): string {
  const unavailable = statusCode >= 500;
  return layout(
    unavailable ? 'Temporarily unavailable' : 'Request not completed',
    `<main class="auth-layout">
      <section class="card" aria-labelledby="error-title">
        <p class="eyebrow">FetanAgent</p>
        <h2 id="error-title">${
          unavailable ? 'Temporarily unavailable.' : 'We could not complete that request.'
        }</h2>
        <p class="supporting">${
          unavailable ? 'Please try again shortly.' : 'Check the details and try again.'
        }</p>
        <div class="actions"><a class="button secondary" href="/">Return home</a></div>
      </section>
    </main>`,
  );
}
