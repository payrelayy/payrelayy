import {
  projectCustomerDepositStatus,
  type CustomerDepositStatusProjection,
} from '@fetanagent/contracts';

export type ProductPreviewSection =
  'dashboard' | 'deposits' | 'player-ids' | 'activity' | 'account';

export type PreviewDepositStage =
  | 'details'
  | 'review'
  | 'payment'
  | 'checking_payment'
  | 'preparing_deposit'
  | 'completed'
  | 'needs_attention';

export type TelegramPreviewScreen =
  | 'start'
  | 'deposit'
  | 'player'
  | 'amount'
  | 'review'
  | 'payment'
  | 'checking_payment'
  | 'preparing_deposit'
  | 'completed'
  | 'needs_attention';

export interface ProductPreviewModel {
  readonly amountEtb: number;
  readonly depositStage: PreviewDepositStage;
  readonly playerId: 'PLAYER-DEMO-42';
}

const sectionLabels: Readonly<Record<ProductPreviewSection, string>> = {
  dashboard: 'Home',
  deposits: 'Deposits',
  'player-ids': 'Player IDs',
  activity: 'Activity',
  account: 'Account',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function previewDepositStatus(stage: PreviewDepositStage): CustomerDepositStatusProjection {
  switch (stage) {
    case 'details':
    case 'review':
    case 'payment':
      return projectCustomerDepositStatus('intake_received');
    case 'checking_payment':
      return projectCustomerDepositStatus('verification_pending');
    case 'preparing_deposit':
      return projectCustomerDepositStatus('execution_pending');
    case 'completed':
      return projectCustomerDepositStatus('executed');
    case 'needs_attention':
      return projectCustomerDepositStatus('execution_review');
  }
}

export function previewDepositStatusLabel(stage: PreviewDepositStage): string {
  return previewDepositStatus(stage).label;
}

function previewBadge(): string {
  return '<span class="product-preview-badge">Preview · No money moves</span>';
}

function productNavigation(active: ProductPreviewSection): string {
  return `<nav class="product-nav" aria-label="FetanAgent workspace">${(
    Object.entries(sectionLabels) as [ProductPreviewSection, string][]
  )
    .map(
      ([section, label]) =>
        `<a class="${section === active ? 'active' : ''}" href="/preview/${
          section === 'dashboard' ? 'dashboard' : section
        }">${label}</a>`,
    )
    .join('')}</nav>`;
}

function productLayout(title: string, active: ProductPreviewSection, content: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#07090d">
    <meta name="description" content="Interactive FetanAgent product preview.">
    <title>${escapeHtml(title)} · FetanAgent Preview</title>
    <link rel="icon" href="/assets/mark.v1.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/assets/app.v1.css?product-preview=3">
  </head>
  <body>
    <div class="product-shell">
      <header class="product-topbar">
        <a class="brand" href="/preview/dashboard" aria-label="FetanAgent preview home">
          <img src="/assets/mark.v1.svg" alt="" width="40" height="40">
          <span>FetanAgent</span>
        </a>
        ${productNavigation(active)}
        <a class="telegram-preview-link" href="/preview/telegram">Telegram Preview</a>
      </header>
      ${content}
    </div>
  </body>
</html>`;
}

function progressPanel(): string {
  return `<section class="progress-panel" aria-labelledby="progress-title">
    <div class="section-heading compact">
      <div><p class="product-kicker">Build progress</p><h2 id="progress-title">What you can see now</h2></div>
      ${previewBadge()}
    </div>
    <div class="progress-grid">
      <article class="progress-item progress-now"><span>Working now</span><strong>Unified customer product</strong><p>Web workspace, Telegram deposit flow, Player IDs, activity, account, and shared customer statuses.</p></article>
      <article class="progress-item progress-building"><span>In progress</span><strong>Production activation</strong><p>Authoritative CBE verification, deployment secrets, live switches, and a supervised first deposit.</p></article>
      <article class="progress-item progress-later"><span>Preview boundary</span><strong>No live money movement</strong><p>This local preview uses simulated state. Provider connections and financial switches stay off.</p></article>
    </div>
  </section>`;
}

function statusChip(stage: PreviewDepositStage): string {
  const status = previewDepositStatus(stage);
  const tone = status.tone === 'neutral' ? 'ready' : status.tone;
  return `<span class="product-status ${tone}">${status.label}</span>`;
}

function dashboardPage(model: ProductPreviewModel): string {
  return productLayout(
    'Home',
    'dashboard',
    `<main class="product-main">
      <section class="dashboard-hero">
        <div><p class="product-kicker">Customer workspace</p><h1>Good to see you, Preview User.</h1><p>Manage Player IDs and follow every deposit from one simple place.</p></div>
        <a class="button" href="/preview/deposits">Start deposit</a>
      </section>
      <div class="summary-grid">
        <article class="summary-card"><span>Ready Player ID</span><strong>${model.playerId}</strong><small>KemerBet · Ready</small></article>
        <article class="summary-card"><span>Recent deposit</span><strong>${model.amountEtb} ETB</strong>${statusChip(model.depositStage)}</article>
        <article class="summary-card"><span>Account</span><strong>Active</strong><small>Signed in on this device</small></article>
      </div>
      <section class="product-grid-two">
        <article class="product-card recent-card">
          <div class="section-heading compact"><div><p class="product-kicker">Recent activity</p><h2>Latest update</h2></div><a href="/preview/activity">View all</a></div>
          <div class="activity-row"><div class="activity-icon">D</div><div><strong>${model.amountEtb} ETB deposit</strong><span>${model.playerId} · Just now</span></div>${statusChip(model.depositStage)}</div>
        </article>
        <article class="product-card quick-card"><p class="product-kicker">Quick actions</p><h2>What would you like to do?</h2><div class="quick-actions"><a href="/preview/deposits">Deposit</a><a href="/preview/player-ids">Player IDs</a><a href="/preview/telegram">Telegram</a></div></article>
      </section>
      ${progressPanel()}
    </main>`,
  );
}

function depositSteps(stage: PreviewDepositStage): string {
  const order: PreviewDepositStage[] = [
    'details',
    'review',
    'payment',
    'checking_payment',
    'preparing_deposit',
    'completed',
  ];
  const index = stage === 'needs_attention' ? 4 : order.indexOf(stage);
  return `<ol class="deposit-stepper" aria-label="Deposit progress">
    ${[
      ['Details', 0],
      ['Review', 1],
      ['Payment', 2],
      ['Deposit', 4],
    ]
      .map(
        ([label, step], stepIndex) =>
          `<li class="${index >= Number(step) ? 'reached' : ''}"><span>${stepIndex + 1}</span>${label}</li>`,
      )
      .join('')}
  </ol>`;
}

function timeline(stage: PreviewDepositStage): string {
  const rank: Record<PreviewDepositStage, number> = {
    completed: 5,
    checking_payment: 3,
    details: 0,
    needs_attention: 4,
    payment: 2,
    preparing_deposit: 4,
    review: 1,
  };
  const current = rank[stage];
  const items = [
    ['Request created', 1],
    ['Payment details received', 2],
    [projectCustomerDepositStatus('verification_pending').label, 3],
    [projectCustomerDepositStatus('execution_pending').label, 4],
    [
      projectCustomerDepositStatus(stage === 'needs_attention' ? 'execution_review' : 'executed')
        .label,
      5,
    ],
  ] as const;
  return `<ol class="status-timeline">${items
    .map(
      ([label, itemRank]) =>
        `<li class="${current > itemRank ? 'done' : current === itemRank ? 'current' : ''}"><span></span><div><strong>${label}</strong><small>${
          current > itemRank ? 'Finished' : current === itemRank ? 'Current status' : 'Pending'
        }</small></div></li>`,
    )
    .join('')}</ol>`;
}

function depositsPage(model: ProductPreviewModel): string {
  const base = `/preview/deposits?amount=${model.amountEtb}`;
  let body: string;
  if (model.depositStage === 'details') {
    body = `<form class="deposit-form" method="get" action="/preview/deposits">
      <input type="hidden" name="step" value="review">
      <label>Ready Player ID<select name="playerId"><option value="PLAYER-DEMO-42">PLAYER-DEMO-42 · KemerBet</option></select></label>
      <label>Amount in ETB<div class="amount-input"><span>ETB</span><input name="amount" type="number" inputmode="decimal" min="25" max="25000" step="1" value="${model.amountEtb}" required></div></label>
      <p class="field-help">Preview limits: 25–25,000 ETB.</p>
      <button type="submit">Review deposit</button>
    </form>`;
  } else if (model.depositStage === 'review') {
    body = `<div class="review-card"><dl><div><dt>Player ID</dt><dd>${model.playerId}</dd></div><div><dt>Amount</dt><dd>${model.amountEtb} ETB</dd></div><div><dt>Platform</dt><dd>KemerBet</dd></div></dl><p>Check the details before continuing to payment instructions.</p><div class="actions"><a class="button" href="${base}&step=payment">Continue</a><a class="button secondary" href="/preview/deposits">Edit</a></div></div>`;
  } else if (model.depositStage === 'payment') {
    body = `<div class="payment-instructions"><div class="instruction-head"><div><p class="product-kicker">CBE Birr</p><h3>Send ${model.amountEtb} ETB</h3></div><span class="deadline">15:00 remaining</span></div><dl><div><dt>Receiver</dt><dd>***DEMO</dd></div><div><dt>Amount</dt><dd>${model.amountEtb} ETB</dd></div></dl><p>After payment, submit the transaction reference so FetanAgent can check it.</p><div class="preview-reference"><span>Preview reference</span><strong>PREVIEW-REF-2026</strong></div><a class="button" href="${base}&step=checking_payment">Submit preview reference</a></div>`;
  } else {
    const next =
      model.depositStage === 'checking_payment'
        ? 'preparing_deposit'
        : model.depositStage === 'preparing_deposit'
          ? 'completed'
          : undefined;
    body = `<div class="deposit-status-view"><div class="status-amount"><span>${model.amountEtb} ETB</span>${statusChip(model.depositStage)}</div>${timeline(model.depositStage)}<p class="preview-truth">Preview only — these status changes are simulated and no money moved.</p>${
      next
        ? `<a class="button secondary" href="${base}&step=${next}">Preview next status</a>`
        : '<a class="button secondary" href="/preview/dashboard">Return home</a>'
    }</div>`;
  }
  return productLayout(
    'Deposits',
    'deposits',
    `<main class="product-main narrow-main"><section class="section-heading"><div><p class="product-kicker">Deposits</p><h1>Start a deposit</h1><p>Choose a Player ID, enter an amount, and follow the status in one place.</p></div>${previewBadge()}</section>${depositSteps(model.depositStage)}<section class="product-card deposit-workflow">${body}</section></main>`,
  );
}

function playerIdsPage(): string {
  return productLayout(
    'Player IDs',
    'player-ids',
    `<main class="product-main"><section class="section-heading"><div><p class="product-kicker">Player IDs</p><h1>Your linked accounts</h1><p>Keep the accounts you use for deposits in one place.</p></div><button type="button">Add Player ID</button></section><div class="linked-player-grid"><article class="linked-player ready"><div><span>KemerBet</span><strong>PLAYER-DEMO-42</strong></div><span class="product-status success">Ready</span><p>Available for deposits in this preview.</p></article><article class="linked-player"><div><span>KemerBet</span><strong>KM-CHECKING-0192</strong></div><span class="product-status working">Checking</span><p>FetanAgent is checking this Player ID.</p></article></div>${progressPanel()}</main>`,
  );
}

function activityPage(model: ProductPreviewModel): string {
  return productLayout(
    'Activity',
    'activity',
    `<main class="product-main"><section class="section-heading"><div><p class="product-kicker">Activity</p><h1>Your recent updates</h1><p>Clear status history across your account.</p></div>${previewBadge()}</section><section class="product-card activity-list"><div class="activity-row"><div class="activity-icon">D</div><div><strong>${model.amountEtb} ETB deposit</strong><span>${model.playerId} · Today, 3:12 PM</span></div>${statusChip(model.depositStage)}</div><div class="activity-row"><div class="activity-icon">P</div><div><strong>Player ID ready</strong><span>PLAYER-DEMO-42 · Today, 2:48 PM</span></div><span class="product-status success">Ready</span></div><div class="activity-row"><div class="activity-icon">A</div><div><strong>Signed in</strong><span>This device · Today, 2:40 PM</span></div><span class="product-status ready">Account</span></div></section></main>`,
  );
}

function accountPage(): string {
  return productLayout(
    'Account',
    'account',
    `<main class="product-main"><section class="section-heading"><div><p class="product-kicker">Account</p><h1>Your account</h1><p>Profile, devices, and customer preferences.</p></div>${previewBadge()}</section><div class="account-grid"><article class="product-card"><h2>Profile</h2><dl class="account-details"><div><dt>Name</dt><dd>Preview User</dd></div><div><dt>Email</dt><dd>preview@fetanagent.local</dd></div><div><dt>Status</dt><dd>Active</dd></div></dl></article><article class="product-card"><h2>Trusted devices</h2><div class="device-row"><div><strong>This device</strong><span>Active now</span></div><span class="product-status success">Trusted</span></div><button class="secondary" type="button">Manage devices</button></article><article class="product-card"><h2>Updates</h2><p>Deposit status updates will appear in your workspace and connected channels.</p><button class="secondary" type="button">Preferences</button></article></div></main>`,
  );
}

export function productPreviewPage(
  section: ProductPreviewSection,
  model: ProductPreviewModel,
): string {
  switch (section) {
    case 'dashboard':
      return dashboardPage(model);
    case 'deposits':
      return depositsPage(model);
    case 'player-ids':
      return playerIdsPage();
    case 'activity':
      return activityPage(model);
    case 'account':
      return accountPage();
  }
}

function telegramButtons(buttons: readonly [string, string][]): string {
  return `<div class="telegram-buttons">${buttons
    .map(([label, href]) => `<a href="${href}">${escapeHtml(label)}</a>`)
    .join('')}</div>`;
}

function telegramConversation(screen: TelegramPreviewScreen, model: ProductPreviewModel): string {
  const url = '/preview/telegram?screen=';
  const bot = (content: string) =>
    `<div class="chat-message bot"><span>F</span><p>${content}</p></div>`;
  const user = (content: string) => `<div class="chat-message user"><p>${content}</p></div>`;
  const menu = telegramButtons([
    ['Deposit', `${url}deposit`],
    ['Player IDs', `${url}player`],
    ['Activity', `${url}checking_payment`],
  ]);
  if (screen === 'start')
    return `${bot('Welcome to FetanAgent. What would you like to do?')}${menu}`;
  if (screen === 'deposit')
    return `${user('Deposit')}${bot('Choose a Ready Player ID.')}${telegramButtons([
      ['PLAYER-DEMO-42 · Ready', `${url}player`],
      ['Back', `${url}start`],
    ])}`;
  if (screen === 'player')
    return `${user('PLAYER-DEMO-42')}${bot('How much would you like to deposit?')}${telegramButtons(
      [
        ['100 ETB', `${url}amount`],
        ['250 ETB', `${url}amount&amount=250`],
        ['Enter another amount', `${url}amount`],
      ],
    )}`;
  if (screen === 'amount')
    return `${user(`${model.amountEtb} ETB`)}${bot(`<strong>Review deposit</strong><br>Player ID: ${model.playerId}<br>Amount: ${model.amountEtb} ETB`)}${telegramButtons(
      [
        ['Continue', `${url}review&amount=${model.amountEtb}`],
        ['Change amount', `${url}player`],
      ],
    )}`;
  if (screen === 'review')
    return `${bot(`<strong>CBE Birr payment instructions</strong><br>Receiver: ***DEMO<br>Amount: ${model.amountEtb} ETB<br>Deadline: 15 minutes`)}${telegramButtons(
      [
        ['I paid · add reference', `${url}payment&amount=${model.amountEtb}`],
        ['Cancel preview', `${url}start`],
      ],
    )}`;
  if (screen === 'payment')
    return `${user('PREVIEW-REF-2026')}${bot('Transaction reference received. FetanAgent will check the payment before preparing the deposit.')}${telegramButtons([['Check preview status', `${url}checking_payment&amount=${model.amountEtb}`]])}`;
  if (screen === 'checking_payment')
    return `${bot(`<strong>${projectCustomerDepositStatus('verification_pending').label}</strong><br>${model.amountEtb} ETB · ${model.playerId}<br>This is simulated preview status.`)}${telegramButtons(
      [
        ['Preview next status', `${url}preparing_deposit&amount=${model.amountEtb}`],
        ['Show needs attention', `${url}needs_attention&amount=${model.amountEtb}`],
      ],
    )}`;
  if (screen === 'preparing_deposit')
    return `${bot(`<strong>${projectCustomerDepositStatus('execution_pending').label}</strong><br>Payment check passed in the preview. No real deposit is being submitted.`)}${telegramButtons([['Preview completion', `${url}completed&amount=${model.amountEtb}`]])}`;
  if (screen === 'completed')
    return `${bot(`<strong>${projectCustomerDepositStatus('executed').label}</strong><br>${model.amountEtb} ETB · ${model.playerId}<br>No money moved in this product preview.`)}${menu}`;
  return `${bot(`<strong>${projectCustomerDepositStatus('execution_review').label}</strong><br>The result could not be confirmed. No automatic retry will be made.`)}${telegramButtons([['Return to menu', `${url}start`]])}`;
}

export function telegramProductPreviewPage(
  screen: TelegramPreviewScreen,
  model: ProductPreviewModel,
): string {
  return productLayout(
    'Telegram',
    'dashboard',
    `<main class="product-main telegram-preview-main"><section class="section-heading"><div><p class="product-kicker">Telegram Bot</p><h1>Interactive deposit experience</h1><p>The same Player IDs, deposit details, and customer statuses as the web workspace.</p></div><span class="product-preview-badge">Interactive product Preview</span></section><div class="telegram-preview-grid"><section class="phone-frame" aria-label="FetanAgent Telegram preview"><header><div class="telegram-avatar">F</div><div><strong>FetanAgent</strong><span>Preview bot</span></div></header><div class="chat-body">${telegramConversation(screen, model)}</div><footer>Message interactions are simulated</footer></section><aside>${progressPanel()}<a class="button secondary telegram-back" href="/preview/dashboard">Open web workspace</a></aside></div></main>`,
  );
}
