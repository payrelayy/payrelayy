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

export function workspacePage(email: string, csrfToken: string): string {
  return layout(
    'Workspace',
    `<main class="workspace-layout">
      <section class="card wide" aria-labelledby="workspace-title">
        <p class="eyebrow">Workspace</p>
        <h2 id="workspace-title">Good to see you.</h2>
        <p class="supporting">Signed in as ${escapeHtml(email)}.</p>
        <div class="workspace-grid">
          <article class="workspace-panel">
            <h3>Account status</h3>
            <p>Your account is signed in and ready.</p>
          </article>
          <article class="workspace-panel">
            <h3>Security</h3>
            <p>Use Sign out below when you finish on a shared device.</p>
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
