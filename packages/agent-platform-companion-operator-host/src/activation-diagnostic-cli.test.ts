import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { activationDiagnosticReport } from './activation-diagnostic.js';

describe('diagnostic CLI fixed-output boundary', () => {
  it.each(['', '{"version":1}', '{"password":"synthetic-private-do-not-print"}'])(
    'rejects invalid stdin with only the fixed diagnostic report',
    (payload) => {
      const entry = new URL('../dist/index.js', import.meta.url).href;
      const source = `process.argv = [process.execPath,
        '/workspace/packages/agent-platform-companion-operator-host/dist/index.js',
        '--diagnose-activation']; await import(${JSON.stringify(entry)});`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        input: payload,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 4096,
      });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(1);
      expect(child.stderr).toBe('');
      expect(child.stdout).toBe(
        `${JSON.stringify(activationDiagnosticReport('input_validation'))}\n`,
      );
      expect(child.stdout).not.toContain('synthetic-private-do-not-print');
    },
  );
});
