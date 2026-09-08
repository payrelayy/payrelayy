import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  REQUIRED_WORKFLOWS,
  requireProductionCi,
  selectLatestRun,
} from './require-production-ci.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const TOKEN = 'private-token-must-never-be-logged';
const configuration = {
  repository: 'payrelayy/payrelayy',
  sha: SHA,
  ref: 'refs/heads/main',
  token: TOKEN,
};

function run(workflow = 'quality.yml', overrides = {}) {
  return {
    id: 42,
    workflow_id: 7,
    run_number: 10,
    run_attempt: 1,
    head_sha: SHA,
    head_branch: 'main',
    event: 'push',
    path: `.github/workflows/${workflow}`,
    repository: { full_name: configuration.repository },
    head_repository: { full_name: configuration.repository },
    created_at: '2026-09-08T12:00:00Z',
    run_started_at: '2026-09-08T12:00:00Z',
    updated_at: '2026-09-08T12:01:00Z',
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}

function response(data, status = 200) {
  return { status, text: async () => JSON.stringify(data) };
}

function passingFetch(requests, transform = (data) => data) {
  const ids = new Map();
  return async (url, options) => {
    requests.push({ url, options });
    const parsed = new URL(url);
    const file = parsed.pathname.match(/\/workflows\/([^/]+)\/runs$/u)?.[1];
    if (file) {
      const data = run(file, { id: 100 + REQUIRED_WORKFLOWS.indexOf(file) });
      ids.set(data.id, data);
      return response(transform({ total_count: 1, workflow_runs: [data] }, parsed));
    }
    const id = Number(parsed.pathname.split('/').at(-1));
    return response(transform(ids.get(id), parsed));
  };
}

test('the seven required workflows are fixed and all run on main pushes', async () => {
  assert.equal(REQUIRED_WORKFLOWS.length, 7);
  assert.equal(new Set(REQUIRED_WORKFLOWS).size, 7);
  assert.ok(REQUIRED_WORKFLOWS.includes('quality.yml'));
  assert.ok(REQUIRED_WORKFLOWS.includes('sql-integration.yml'));
  for (const file of REQUIRED_WORKFLOWS) {
    const text = await readFile(
      new URL(`../../.github/workflows/${file}`, import.meta.url),
      'utf8',
    );
    assert.match(text, /push:\s+branches:\s+- main/u);
  }
});

test('requires all seven exact-SHA runs and rereads every current attempt', async () => {
  const requests = [];
  const checks = await requireProductionCi({ ...configuration, fetchImpl: passingFetch(requests) });
  assert.equal(checks.length, 7);
  assert.equal(requests.length, 21);
  for (const request of requests) {
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://api.github.com');
    assert.match(url.pathname, /^\/repos\/payrelayy\/payrelayy\/actions\//u);
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.options.headers.Authorization, `Bearer ${TOKEN}`);
    if (url.pathname.includes('/workflows/')) {
      assert.equal(url.searchParams.get('head_sha'), SHA);
      assert.equal(url.searchParams.get('branch'), 'main');
      assert.equal(url.searchParams.get('event'), 'push');
      assert.equal(url.searchParams.has('status'), false);
    }
  }
});

for (const [name, overrides] of [
  ['different SHA', { head_sha: OTHER_SHA }],
  ['pull request event', { event: 'pull_request' }],
  ['manual event', { event: 'workflow_dispatch' }],
  ['different branch', { head_branch: 'codex/example' }],
  ['fork head repository', { head_repository: { full_name: 'other/repo' } }],
  ['different repository', { repository: { full_name: 'other/repo' } }],
  ['wrong workflow path', { path: '.github/workflows/other.yml' }],
  ['missing attempt', { run_attempt: undefined }],
  ['invalid attempt', { run_attempt: 0 }],
  ['invalid date', { run_started_at: 'invalid' }],
  ['null run', null],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() =>
      selectLatestRun(
        [overrides === null ? null : run('quality.yml', overrides)],
        SHA,
        'quality.yml',
      ),
    );
  });
}

for (const conclusion of [
  'failure',
  'cancelled',
  'timed_out',
  'neutral',
  'skipped',
  'action_required',
  null,
]) {
  test(`rejects latest conclusion ${String(conclusion)}`, () => {
    assert.throws(() => selectLatestRun([run('quality.yml', { conclusion })], SHA, 'quality.yml'));
  });
}

for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
  test(`rejects an unfinished ${status} run even with a successful sibling`, () => {
    assert.throws(() =>
      selectLatestRun(
        [run(), run('quality.yml', { id: 1, run_number: 1, status, conclusion: null })],
        SHA,
        'quality.yml',
      ),
    );
  });
}

test('a later successful run supersedes an older failure', () => {
  const older = run('quality.yml', { id: 1, run_number: 1, conclusion: 'failure' });
  const newer = run('quality.yml', {
    id: 2,
    run_number: 2,
    run_started_at: '2026-09-08T13:00:00Z',
    updated_at: '2026-09-08T13:01:00Z',
  });
  assert.equal(selectLatestRun([newer, older], SHA, 'quality.yml').id, 2);
});

test('a newer rerun of an older run supersedes the previous success', () => {
  assert.throws(() =>
    selectLatestRun(
      [
        run(),
        run('quality.yml', {
          id: 1,
          run_number: 1,
          run_attempt: 2,
          run_started_at: '2026-09-08T13:00:00Z',
          updated_at: '2026-09-08T13:01:00Z',
          conclusion: 'failure',
        }),
      ],
      SHA,
      'quality.yml',
    ),
  );
});

test('does not combine conflicting historical versions of a run', () => {
  assert.throws(() =>
    selectLatestRun([run(), run('quality.yml', { run_attempt: 2 })], SHA, 'quality.yml'),
  );
});

test('rejects missing required runs', async () => {
  await assert.rejects(
    requireProductionCi({
      ...configuration,
      fetchImpl: async () => response({ total_count: 0, workflow_runs: [] }),
    }),
  );
});

for (const total of [501, -1, 1.5, '1', undefined]) {
  test(`rejects invalid or excessive pagination total ${String(total)}`, async () => {
    await assert.rejects(
      requireProductionCi({
        ...configuration,
        fetchImpl: async () => response({ total_count: total, workflow_runs: [run()] }),
      }),
    );
  });
}

test('rejects incomplete pagination instead of accepting a visible success', async () => {
  await assert.rejects(
    requireProductionCi({
      ...configuration,
      fetchImpl: async () => response({ total_count: 2, workflow_runs: [run()] }),
    }),
  );
});

test('reads all pages and fails on a newer failed attempt on page two', async () => {
  const requests = [];
  const fetchImpl = passingFetch(requests, (data, url) => {
    if (!url.pathname.includes('/workflows/quality.yml/')) return data;
    const page = url.searchParams.get('page');
    return {
      total_count: 101,
      workflow_runs:
        page === '1'
          ? Array.from({ length: 100 }, (_, index) =>
              run('quality.yml', { id: 1000 + index, run_number: index + 1 }),
            )
          : [
              run('quality.yml', {
                id: 1,
                run_number: 1,
                run_attempt: 2,
                run_started_at: '2026-09-08T13:00:00Z',
                updated_at: '2026-09-08T13:01:00Z',
                conclusion: 'failure',
              }),
            ],
    };
  });
  await assert.rejects(requireProductionCi({ ...configuration, fetchImpl }));
  assert.ok(
    requests.some(({ url }) => url.includes('quality.yml/runs?') && url.endsWith('page=2')),
  );
});

test('accepts complete stable pagination only after checking the full result', async () => {
  const requests = [];
  const fetchImpl = passingFetch(requests, (data, url) => {
    if (url.pathname.endsWith('/actions/runs/99')) {
      return run('quality.yml', { id: 99, run_number: 101 });
    }
    if (!url.pathname.includes('/workflows/quality.yml/')) return data;
    return {
      total_count: 101,
      workflow_runs:
        url.searchParams.get('page') === '1'
          ? Array.from({ length: 100 }, (_, index) =>
              run('quality.yml', { id: 1000 + index, run_number: index + 1 }),
            )
          : [run('quality.yml', { id: 99, run_number: 101 })],
    };
  });
  const results = await requireProductionCi({ ...configuration, fetchImpl });
  assert.equal(results[0].runId, 99);
  assert.equal(requests.length, 23);
});

test('changing page totals fail closed', async () => {
  const fetchImpl = passingFetch([], (data, url) => {
    if (!url.pathname.includes('/workflows/quality.yml/')) return data;
    return {
      total_count: url.searchParams.get('page') === '1' ? 101 : 102,
      workflow_runs: Array.from({ length: 100 }, (_, index) =>
        run('quality.yml', { id: 1000 + index, run_number: index + 1 }),
      ),
    };
  });
  await assert.rejects(requireProductionCi({ ...configuration, fetchImpl }));
});

test('a rerun beginning after the list read revokes approval', async () => {
  const fetchImpl = passingFetch([], (data, url) =>
    url.pathname.endsWith('/actions/runs/100')
      ? { ...data, run_attempt: 2, status: 'in_progress', conclusion: null }
      : data,
  );
  await assert.rejects(requireProductionCi({ ...configuration, fetchImpl }));
});

test('even a changed successful attempt requires a fresh complete check', async () => {
  const fetchImpl = passingFetch([], (data, url) =>
    url.pathname.endsWith('/actions/runs/100') ? { ...data, run_attempt: 2 } : data,
  );
  await assert.rejects(requireProductionCi({ ...configuration, fetchImpl }));
});

test('a sibling rerun starting after the first listing revokes approval', async () => {
  let selectedWasRead = false;
  const fetchImpl = passingFetch([], (data, url) => {
    if (url.pathname.endsWith('/actions/runs/100')) selectedWasRead = true;
    if (!url.pathname.includes('/workflows/quality.yml/')) return data;
    const sibling = run('quality.yml', {
      id: 80,
      run_number: 1,
      run_started_at: '2026-09-08T11:00:00Z',
      updated_at: '2026-09-08T11:01:00Z',
      ...(selectedWasRead ? { run_attempt: 2, status: 'in_progress', conclusion: null } : {}),
    });
    return { total_count: 2, workflow_runs: [data.workflow_runs[0], sibling] };
  });
  await assert.rejects(requireProductionCi({ ...configuration, fetchImpl }));
  assert.equal(selectedWasRead, true);
});

test('a newly added successful run requires a new full verification', async () => {
  let selectedWasRead = false;
  const fetchImpl = passingFetch([], (data, url) => {
    if (url.pathname.endsWith('/actions/runs/100')) selectedWasRead = true;
    if (!url.pathname.includes('/workflows/quality.yml/') || !selectedWasRead) return data;
    return {
      total_count: 2,
      workflow_runs: [data.workflow_runs[0], run('quality.yml', { id: 80, run_number: 1 })],
    };
  });
  await assert.rejects(requireProductionCi({ ...configuration, fetchImpl }));
});

test('a removed sibling run cannot silently change the evidence set', async () => {
  let selectedWasRead = false;
  const fetchImpl = passingFetch([], (data, url) => {
    if (url.pathname.endsWith('/actions/runs/100')) selectedWasRead = true;
    if (!url.pathname.includes('/workflows/quality.yml/') || selectedWasRead) return data;
    return {
      total_count: 2,
      workflow_runs: [data.workflow_runs[0], run('quality.yml', { id: 80, run_number: 1 })],
    };
  });
  await assert.rejects(requireProductionCi({ ...configuration, fetchImpl }));
});

test('activation repeats the gate before marking or executing the live attempt', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/production-runtime.yml', import.meta.url),
    'utf8',
  );
  const activation = workflow
    .split('      - name: Atomically activate production and switch the public edge')[1]
    ?.split('      - name: ')[0];
  assert.ok(activation);
  assert.match(activation, /GH_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(
    activation,
    /set -euo pipefail\s+node infra\/operations\/require-production-ci\.mjs/u,
  );
  const gatePosition = activation.indexOf('node infra/operations/require-production-ci.mjs');
  const markerPosition = activation.indexOf("echo 'attempted=true'");
  const invocationPosition = activation.indexOf(" activate '$GITHUB_SHA'");
  assert.ok(
    gatePosition >= 0 && markerPosition > gatePosition && invocationPosition > markerPosition,
  );
  assert.equal(workflow.match(/node infra\/operations\/require-production-ci\.mjs/gu)?.length, 3);
});

for (const value of [
  { repository: 'untrusted/repo' },
  { ref: 'refs/heads/other' },
  { sha: 'short' },
  { token: '' },
]) {
  test(`rejects invalid target input ${Object.keys(value)[0]} before networking`, async () => {
    await assert.rejects(
      requireProductionCi({
        ...configuration,
        ...value,
        fetchImpl: () => assert.fail('must not send a request'),
      }),
    );
  });
}

for (const fetchImpl of [
  async () => {
    throw new Error(TOKEN);
  },
  async () => response({ secret: TOKEN }, 403),
  async () => ({ status: 200, text: async () => TOKEN }),
]) {
  test('redacts network errors and invalid response contents', async () => {
    await assert.rejects(requireProductionCi({ ...configuration, fetchImpl }), (error) => {
      assert.doesNotMatch(error.message, new RegExp(TOKEN, 'u'));
      assert.match(error.message, /^Production CI gate denied:/u);
      return true;
    });
  });
}

test('CLI exits nonzero and does not expose malformed environment input', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./require-production-ci.mjs', import.meta.url))],
    {
      env: { ...process.env, GITHUB_REPOSITORY: TOKEN, GH_TOKEN: TOKEN },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production CI gate denied: invalid deployment target/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(TOKEN, 'u'));
});
