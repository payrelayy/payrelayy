import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const [workflow, host] = await Promise.all([
  readFile(
    new URL('.github/workflows/production-companion-operator-host-startup-diagnostic.yml', root),
    'utf8',
  ),
  readFile(new URL('packages/agent-platform-companion-operator-host/src/index.ts', root), 'utf8'),
]);

test('startup diagnostic is exact-main, read-only, and never opens an execution session', () => {
  assert.match(workflow, /require-production-ci\.mjs/u);
  assert.match(workflow, /default_transaction_read_only=on/u);
  assert.match(workflow, /\.allFinancialSwitchesDisabled/u);
  assert.match(workflow, /\.companionExecutionControlDisabled/u);
  assert.match(workflow, /inspect '\$GITHUB_SHA'/u);
  assert.match(workflow, /diagnose '\$GITHUB_SHA'/u);
  assert.match(workflow, /protected_operator_diagnostic=ready/u);
  assert.doesNotMatch(workflow, /operator-session-prepare|\bactivate\b|deposit-job-execute/u);

  const diagnostic = host.slice(
    host.indexOf('export async function diagnoseOperatorHost('),
    host.indexOf(
      '/** A container-private, one-shot process:',
      host.indexOf('diagnoseOperatorHost('),
    ),
  );
  assert.match(diagnostic, /begin read only/u);
  assert.match(diagnostic, /runPsql\('probe'/u);
  assert.match(diagnostic, /createServer\(\)/u);
  assert.doesNotMatch(
    diagnostic,
    /runPsql\('disable'|openProtectedOperatorQueryHost|createProtectedOperatorBootstrapRequestHandler|signHandoff/u,
  );
});
