import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const [host, inspection, dockerfile] = await Promise.all([
  readFile(new URL('packages/agent-platform-companion-operator-host/src/index.ts', root), 'utf8'),
  readFile(
    new URL('packages/agent-platform-companion-operator-host/src/activation-diagnostic.ts', root),
    'utf8',
  ),
  readFile(new URL('infra/Dockerfile.sql-integration', root), 'utf8'),
]);

test('activation inspection has no signing, listening, publication, execution, or stop transition', () => {
  const runner = host.slice(
    host.indexOf('export async function diagnoseOperatorActivation('),
    host.indexOf('/** A container-private, one-shot process:'),
  );
  assert.match(runner, /begin read only/u);
  assert.match(runner, /client!\.query\('rollback'\)/u);
  assert.match(runner, /client\.end\(\)/u);
  assert.match(runner, /executionSignerPrivateKey\(\)/u);
  assert.doesNotMatch(
    runner,
    /createServer|spawn\(|runPsql|openProtectedOperator|createProtected|signHandoff|runOperatorHost/u,
  );
  assert.doesNotMatch(
    inspection,
    /signGuarded|signCompanion|publishGuarded|openProtected|writeFile|createServer|spawn\(/u,
  );
  assert.match(inspection, /deriveGuardedCompanionHandoffBody\(/u);
  assert.match(inspection, /liveReadinessProven: false/u);
  assert.match(inspection, /inspectionMode: 'historical_reconstruction'/u);
  assert.match(inspection, /where request\.request_key = \$1::uuid/u);
  assert.doesNotMatch(inspection, /pg_read_file|pg_ls_dir|lo_import|for update|pg_advisory/u);
});

test('the opt-in diagnostic exits before the unchanged live entry point', () => {
  const main = host.slice(host.indexOf('async function main()'));
  const diagnostic = main.slice(0, main.indexOf('\n  const raw = await readOneLaunchDocument();'));
  assert.match(
    diagnostic,
    /process\.argv\.length === 3 && process\.argv\[2\] === '--diagnose-activation'/u,
  );
  assert.match(diagnostic, /diagnoseOperatorActivation\(parseOperatorHostLaunchDocument\(raw\)\)/u);
  assert.match(diagnostic, /JSON\.stringify\(report\)/u);
  assert.match(diagnostic, /raw\?\.fill\(0\)/u);
  assert.match(diagnostic, /return;/u);
  assert.doesNotMatch(diagnostic, /runOperatorHost\(/u);
  assert.match(
    main,
    /else if \(process\.argv\.length === 2\) \{\s+await runOperatorHost\(document\);/u,
  );
});

test('disposable SQL tests receive only diagnostic query source, not an operator runtime', () => {
  assert.match(
    dockerfile,
    /COPY packages\/agent-platform-companion-operator-host\/src\/activation-diagnostic\.ts/u,
  );
  assert.doesNotMatch(
    dockerfile,
    /COPY packages\/agent-platform-companion-operator-host\/src\s|COPY packages\/agent-platform-companion-operator-host\/dist/u,
  );
});
