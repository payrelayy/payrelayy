// Explicit coordinator; never changes the live launcher or its sudo rule.
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

function requireCondition(value) {
  if (!value) throw new Error('Read-only diagnostic receiver unavailable.');
}

let receiverStarted = false;
let finalReportSeen = false;

try {
  requireCondition(
    process.argv.length === 3 && process.argv[2] === '--run-one-readonly-diagnostic',
  );
  const alias = process.env.FETANAGENT_DIAGNOSTIC_SSH_ALIAS;
  requireCondition(typeof alias === 'string' && /^[a-z0-9-]{1,80}$/u.test(alias));
  const result = spawnSync(
    'gh',
    ['pr', 'view', '619', '--repo', 'payrelayy/payrelayy', '--json', 'state,mergeCommit'],
    { encoding: 'utf8', timeout: 30_000, windowsHide: true },
  );
  requireCondition(result.status === 0);
  const pr = JSON.parse(result.stdout);
  requireCondition(pr.state === 'MERGED' && /^[0-9a-f]{40}$/u.test(pr.mergeCommit?.oid));
  const options = Buffer.from(JSON.stringify({ imageRevision: pr.mergeCommit.oid })).toString(
    'base64',
  );
  const source = await readFile(
    new URL('./operator-activation-diagnostic-receiver.py', import.meta.url),
    'utf8',
  );
  const child = spawn(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', alias, 'python3 -'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let pending = '';
  let invalid = false;
  const stages = new Set([
    'waiting_for_delivery',
    'input_validation',
    'node_database',
    'database_request',
    'database_boundary',
    'financial_state',
    'request_binding',
    'historical_window',
    'certificate_binding',
    'snapshot_shape',
    'published_release',
    'handoff_derivation',
    'execution_signer',
    'state_changed',
    'cleanup',
    'inspected',
  ]);
  const keys = new Set([
    'component',
    'result',
    'stage',
    'inspectionMode',
    'liveReadinessProven',
    'requestCreated',
    'handoffSigned',
    'executionEnabled',
    'moneyMoved',
    'identifiersRedacted',
    'containerRemoved',
    'signerCopyRemoved',
    'deliveryPipeRemoved',
    'currentImageUnchanged',
    'launcherUnchanged',
    'listenerAbsent',
    'diagnosisRun',
    'credentialDocumentPersisted',
  ]);
  child.stdout.on('data', (part) => {
    try {
      pending += part;
      requireCondition(pending.length <= 16 * 1024);
      while (pending.includes('\n')) {
        const offset = pending.indexOf('\n');
        const line = pending.slice(0, offset);
        pending = pending.slice(offset + 1);
        const report = JSON.parse(line);
        requireCondition(
          Object.keys(report).every((key) => keys.has(key)) &&
            [
              'fetanagent_operator_activation_diagnostic',
              'fetanagent_activation_diagnostic_receiver',
            ].includes(report.component) &&
            ['ready', 'passed', 'stopped'].includes(report.result) &&
            stages.has(report.stage) &&
            report.moneyMoved === false &&
            report.identifiersRedacted === true &&
            (report.requestCreated === undefined || report.requestCreated === false) &&
            (report.executionEnabled === undefined || report.executionEnabled === false) &&
            (report.handoffSigned === undefined || report.handoffSigned === false) &&
            (report.liveReadinessProven === undefined || report.liveReadinessProven === false),
        );
        for (const [key, value] of Object.entries(report)) {
          if (!['component', 'result', 'stage', 'inspectionMode'].includes(key)) {
            requireCondition(typeof value === 'boolean');
          }
        }
        requireCondition(
          report.inspectionMode === undefined ||
            report.inspectionMode === 'historical_reconstruction',
        );
        if (
          report.component === 'fetanagent_activation_diagnostic_receiver' &&
          report.result === 'ready'
        ) {
          receiverStarted = true;
        }
        if (report.component === 'fetanagent_operator_activation_diagnostic') {
          finalReportSeen = true;
        }
        process.stdout.write(JSON.stringify(report) + '\n');
      }
    } catch {
      invalid = true;
      child.kill();
    }
  });
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.stdin.end(
    "import json,base64\nOPTIONS=json.loads(base64.b64decode('" + options + "'))\n" + source,
  );
  const timer = setTimeout(() => child.kill(), 600_000);
  const status = await new Promise((resolve, reject) => {
    child.once('close', resolve);
    child.once('error', reject);
  });
  clearTimeout(timer);
  requireCondition(!invalid && pending === '' && finalReportSeen);
  process.exitCode = status === 0 ? 0 : 1;
} catch {
  process.stdout.write(
    JSON.stringify({
      component: 'fetanagent_activation_diagnostic_receiver',
      result: 'stopped',
      stage: receiverStarted ? 'cleanup' : 'input_validation',
      diagnosisRun: receiverStarted ? null : false,
      moneyMoved: false,
      identifiersRedacted: true,
    }) + '\n',
  );
  process.exitCode = 1;
}
