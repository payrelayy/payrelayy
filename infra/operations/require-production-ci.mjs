import { pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

export const REQUIRED_WORKFLOWS = Object.freeze([
  'quality.yml',
  'sql-integration.yml',
  'customer-web-image-smoke.yml',
  'executor-image-smoke.yml',
  'telebirr-assignment-broker-image-smoke.yml',
  'telebirr-device-bridge-image-smoke.yml',
  'telebirr-device-state-broker-image-smoke.yml',
]);

const REPOSITORY = 'payrelayy/payrelayy';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const READ_TIMEOUT_MS = 25_000;
const READ_RETRY_DELAYS_MS = Object.freeze([3_000, 9_000, 20_000]);
const RETRYABLE_STATUSES = new Set([403, 429, 500, 502, 503, 504]);

class GateError extends Error {
  constructor(code, workflow) {
    // Only constants and allowlisted filenames reach an operator-visible error.
    super(`Production CI gate denied: ${code}${workflow ? ` (${workflow})` : ''}.`);
  }
}

function requireCondition(condition, code, workflow) {
  if (!condition) throw new GateError(code, workflow);
}

function integer(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function timestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateRun(run, sha, workflow) {
  requireCondition(
    run !== null &&
      typeof run === 'object' &&
      integer(run.id) &&
      integer(run.workflow_id) &&
      integer(run.run_number) &&
      integer(run.run_attempt) &&
      run.head_sha === sha &&
      run.head_branch === 'main' &&
      run.event === 'push' &&
      run.path === `.github/workflows/${workflow}` &&
      run.repository?.full_name === REPOSITORY &&
      run.head_repository?.full_name === REPOSITORY &&
      timestamp(run.created_at) &&
      timestamp(run.run_started_at) &&
      timestamp(run.updated_at) &&
      typeof run.status === 'string' &&
      (run.conclusion === null || typeof run.conclusion === 'string'),
    'invalid or mismatched run metadata',
    workflow,
  );
}

export function selectLatestRun(runs, sha, workflow) {
  requireCondition(REQUIRED_WORKFLOWS.includes(workflow), 'unknown required workflow');
  requireCondition(Array.isArray(runs) && runs.length > 0, 'required run missing', workflow);
  const ids = new Set();
  const workflowIds = new Set();
  for (const run of runs) {
    validateRun(run, sha, workflow);
    requireCondition(!ids.has(run.id), 'duplicate run metadata', workflow);
    ids.add(run.id);
    workflowIds.add(run.workflow_id);
    // An unfinished rerun of an older run must not be hidden by a newer success.
    requireCondition(run.status === 'completed', 'a required run is unfinished', workflow);
  }
  requireCondition(workflowIds.size === 1, 'workflow identity changed', workflow);
  // Re-running a run preserves its ID/number. Attempt start time therefore takes
  // precedence over run number, so a newer rerun supersedes an older success.
  const latest = [...runs].sort(
    (left, right) =>
      Date.parse(right.run_started_at) - Date.parse(left.run_started_at) ||
      Date.parse(right.updated_at) - Date.parse(left.updated_at) ||
      right.run_number - left.run_number ||
      right.run_attempt - left.run_attempt ||
      right.id - left.id,
  )[0];
  requireCondition(latest.conclusion === 'success', 'latest attempt did not pass', workflow);
  return latest;
}

function retryDelayMs(response, attempt) {
  // GitHub may provide Retry-After during a temporary secondary limit. Never
  // trust an unbounded header to hold a production operation indefinitely.
  const header = response?.headers?.get?.('retry-after');
  const seconds = Number(header);
  return Number.isSafeInteger(seconds) && seconds > 0
    ? Math.max(READ_RETRY_DELAYS_MS[attempt], Math.min(seconds * 1_000, 60_000))
    : READ_RETRY_DELAYS_MS[attempt];
}

async function requestJson(path, token, fetchImpl, waitImpl) {
  for (let attempt = 0; attempt <= READ_RETRY_DELAYS_MS.length; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2026-03-10',
        },
      });
    } catch {
      if (attempt === READ_RETRY_DELAYS_MS.length) break;
      await waitImpl(READ_RETRY_DELAYS_MS[attempt]);
      continue;
    }
    if (response?.status !== 200) {
      if (!RETRYABLE_STATUSES.has(response?.status) || attempt === READ_RETRY_DELAYS_MS.length)
        break;
      await waitImpl(retryDelayMs(response, attempt));
      continue;
    }
    let body;
    try {
      body = await response.text();
    } catch {
      if (attempt === READ_RETRY_DELAYS_MS.length) break;
      await waitImpl(READ_RETRY_DELAYS_MS[attempt]);
      continue;
    }
    // A successful HTTP response with malformed data is an integrity failure,
    // not a transport retry. The full CI evidence is still checked below.
    requireCondition(
      typeof body === 'string' && body.length <= 2_000_000,
      'GitHub response exceeded the size limit',
    );
    try {
      return JSON.parse(body);
    } catch {
      break;
    }
  }
  // Do not echo response bodies, URLs, credentials, or arbitrary exception text.
  throw new GateError('GitHub read request failed or returned invalid data');
}

async function loadCommitChecks(path, arrayKey, token, fetchImpl, waitImpl) {
  const items = [];
  let expectedTotal;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      filter: 'all',
      per_page: String(PAGE_SIZE),
      page: String(page),
    });
    const result = await requestJson(`${path}?${query}`, token, fetchImpl, waitImpl);
    requireCondition(
      result !== null &&
        Number.isSafeInteger(result.total_count) &&
        result.total_count > 0 &&
        result.total_count <= MAX_PAGES * PAGE_SIZE &&
        Array.isArray(result[arrayKey]),
      'missing commit checks or pagination limit exceeded',
    );
    expectedTotal ??= result.total_count;
    requireCondition(
      expectedTotal === result.total_count &&
        result[arrayKey].length === Math.min(PAGE_SIZE, expectedTotal - items.length),
      'incomplete or changing commit check pagination',
    );
    items.push(...result[arrayKey]);
    if (items.length === expectedTotal) break;
  }
  requireCondition(items.length === expectedTotal, 'commit check pagination incomplete');
  return items;
}

async function loadCommitWorkflowRuns(sha, token, fetchImpl, waitImpl) {
  // GitHub's workflow-list head_sha filter sometimes returns zero for runs
  // already present on the exact commit. Commit checks provide a second index.
  // Check suites without jobs prevent an unfinished Actions workflow from
  // disappearing behind an older passing run.
  const [checks, suites] = await Promise.all([
    loadCommitChecks(`commits/${sha}/check-runs`, 'check_runs', token, fetchImpl, waitImpl),
    loadCommitChecks(`commits/${sha}/check-suites`, 'check_suites', token, fetchImpl, waitImpl),
  ]);
  const actionsSuiteIds = new Set();
  for (const suite of suites) {
    if (suite?.app?.slug !== 'github-actions') continue;
    requireCondition(
      integer(suite.id) && integer(suite.latest_check_runs_count),
      'unfinished Actions suite',
    );
    actionsSuiteIds.add(suite.id);
  }
  const runIds = new Set();
  const seenSuiteIds = new Set();
  for (const check of checks) {
    if (check?.app?.slug !== 'github-actions') continue;
    requireCondition(
      integer(check.id) &&
        check.head_sha === sha &&
        integer(check.check_suite?.id) &&
        actionsSuiteIds.has(check.check_suite.id),
      'invalid commit Actions check',
    );
    seenSuiteIds.add(check.check_suite.id);
    const match =
      /^https:\/\/github\.com\/payrelayy\/payrelayy\/actions\/runs\/(\d+)\/job\/\d+$/u.exec(
        check.html_url,
      );
    requireCondition(match && integer(Number(match[1])), 'invalid Actions run link');
    runIds.add(Number(match[1]));
  }
  requireCondition(
    actionsSuiteIds.size > 0 &&
      [...actionsSuiteIds].every((id) => seenSuiteIds.has(id)) &&
      runIds.size > 0,
    'missing or unfinished Actions checks',
  );
  const runs = await Promise.all(
    [...runIds].map((id) => requestJson(`actions/runs/${id}`, token, fetchImpl, waitImpl)),
  );
  requireCondition(
    runs.every(
      (run) =>
        integer(run?.id) &&
        run.head_sha === sha &&
        run.repository?.full_name === REPOSITORY &&
        run.head_repository?.full_name === REPOSITORY,
    ),
    'commit Actions run identity mismatch',
  );
  return runs.filter(
    (run) =>
      run.head_branch === 'main' &&
      run.event === 'push' &&
      REQUIRED_WORKFLOWS.some((workflow) => run.path === `.github/workflows/${workflow}`),
  );
}

async function loadWorkflowRuns(workflow, sha, token, fetchImpl, waitImpl, commitRuns) {
  const runs = [];
  let expectedTotal;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      branch: 'main',
      event: 'push',
      head_sha: sha,
      per_page: String(PAGE_SIZE),
      page: String(page),
    });
    // Deliberately no status/conclusion filter: failures and reruns must be visible.
    const result = await requestJson(
      `actions/workflows/${workflow}/runs?${query}`,
      token,
      fetchImpl,
      waitImpl,
    );
    if (page === 1 && result?.total_count === 0 && Array.isArray(result.workflow_runs)) {
      return (await commitRuns()).filter((run) => run.path === `.github/workflows/${workflow}`);
    }
    requireCondition(
      result !== null &&
        Number.isSafeInteger(result.total_count) &&
        result.total_count > 0 &&
        result.total_count <= MAX_PAGES * PAGE_SIZE &&
        Array.isArray(result.workflow_runs),
      'missing runs or pagination limit exceeded',
      workflow,
    );
    expectedTotal ??= result.total_count;
    requireCondition(
      expectedTotal === result.total_count &&
        result.workflow_runs.length === Math.min(PAGE_SIZE, expectedTotal - runs.length),
      'incomplete or changing pagination',
      workflow,
    );
    runs.push(...result.workflow_runs);
    if (runs.length === expectedTotal) break;
  }
  requireCondition(runs.length === expectedTotal, 'pagination incomplete', workflow);
  return runs;
}

function runSetIdentity(runs) {
  return JSON.stringify(
    [...runs]
      .sort((left, right) => left.id - right.id)
      .map((run) => [
        run.id,
        run.workflow_id,
        run.run_number,
        run.run_attempt,
        run.created_at,
        run.run_started_at,
        run.updated_at,
        run.status,
        run.conclusion,
      ]),
  );
}

async function checkWorkflow(
  workflow,
  sha,
  token,
  fetchImpl,
  waitImpl,
  commitRuns,
  refreshedCommitRuns,
) {
  const runs = await loadWorkflowRuns(workflow, sha, token, fetchImpl, waitImpl, commitRuns);
  const selected = selectLatestRun(runs, sha, workflow);
  // Re-read the current run, not an immutable successful historical attempt.
  const current = await requestJson(`actions/runs/${selected.id}`, token, fetchImpl, waitImpl);
  validateRun(current, sha, workflow);
  requireCondition(
    current.id === selected.id &&
      current.workflow_id === selected.workflow_id &&
      current.run_number === selected.run_number &&
      current.run_attempt === selected.run_attempt &&
      current.run_started_at === selected.run_started_at &&
      current.status === 'completed' &&
      current.conclusion === 'success',
    'selected run changed or no longer passes',
    workflow,
  );
  // A different listed run can be rerun while the selected run is being read.
  // Re-list the complete bounded set, including failures/unfinished runs, so
  // sibling attempts and newly created runs cannot hide behind that success.
  // This is a fresh read, not an atomic lock on GitHub; deployment checks again
  // immediately before activation as well as before using production secrets.
  const refreshed = await loadWorkflowRuns(
    workflow,
    sha,
    token,
    fetchImpl,
    waitImpl,
    refreshedCommitRuns,
  );
  selectLatestRun(refreshed, sha, workflow);
  requireCondition(
    runSetIdentity(runs) === runSetIdentity(refreshed),
    'run membership or attempt metadata changed during verification',
    workflow,
  );
  return { workflow, runId: current.id, attempt: current.run_attempt };
}

export async function requireProductionCi({
  repository,
  sha,
  ref,
  token,
  fetchImpl = fetch,
  waitImpl = wait,
}) {
  requireCondition(
    repository === REPOSITORY &&
      ref === 'refs/heads/main' &&
      typeof sha === 'string' &&
      /^[0-9a-f]{40}$/u.test(sha) &&
      typeof token === 'string' &&
      token.length > 0,
    'invalid deployment target or missing read credential',
  );
  let initialCommitRuns;
  let refreshedCommitRuns;
  const loadInitial = () =>
    (initialCommitRuns ??= loadCommitWorkflowRuns(sha, token, fetchImpl, waitImpl));
  const loadRefreshed = () =>
    (refreshedCommitRuns ??= loadCommitWorkflowRuns(sha, token, fetchImpl, waitImpl));
  return Promise.all(
    REQUIRED_WORKFLOWS.map((workflow) =>
      checkWorkflow(workflow, sha, token, fetchImpl, waitImpl, loadInitial, loadRefreshed),
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const checks = await requireProductionCi({
      repository: process.env.GITHUB_REPOSITORY,
      sha: process.env.GITHUB_SHA,
      ref: process.env.GITHUB_REF,
      token: process.env.GH_TOKEN,
    });
    for (const check of checks) {
      console.log(`${check.workflow}: success (run ${check.runId}, attempt ${check.attempt})`);
    }
    console.log('All seven required exact-main-SHA push workflows passed their latest attempts.');
  } catch (error) {
    console.error(error instanceof GateError ? error.message : 'Production CI gate denied.');
    process.exitCode = 1;
  }
}
