import { describe, expect, it, vi } from 'vitest';

import {
  parseOneJobOperatorArguments,
  redactedOneJobOperatorFailure,
  runOneJobOperatorCommand,
} from './one-job-operator-cli.js';
import * as operator from './one-job-operator.js';
import { OneJobOperatorUnavailableError } from './one-job-operator.js';

describe('one-job operator diagnostic output', () => {
  it('logs a source-defined activation category but never a caller-supplied value', () => {
    const fixed = new OneJobOperatorUnavailableError('guarded_activation', 'handoff_http_response');
    expect(JSON.parse(redactedOneJobOperatorFailure(fixed, 'configuration'))).toEqual({
      component: 'fetanagent_one_job_operator',
      result: 'stopped',
      failureStage: 'guarded_activation',
      activationStage: 'handoff_http_response',
      identifiersRedacted: true,
    });
    Object.assign(fixed, { activationStage: 'private request or response' });
    const output = redactedOneJobOperatorFailure(fixed, 'configuration');
    expect(JSON.parse(output)).not.toHaveProperty('activationStage');
    expect(output).not.toContain('private');
  });

  it('emits only a fixed stage even when the underlying error carries private data', () => {
    const privateError = new Error('private request, host, and response details');
    Object.assign(privateError, { requestKey: 'private request key' });
    const output = redactedOneJobOperatorFailure(privateError, 'configuration');
    expect(JSON.parse(output)).toEqual({
      component: 'fetanagent_one_job_operator',
      result: 'stopped',
      failureStage: 'configuration',
      identifiersRedacted: true,
    });
    expect(output).not.toContain('private');
    expect(
      JSON.parse(
        redactedOneJobOperatorFailure(
          new OneJobOperatorUnavailableError('bootstrap_http_response'),
          'configuration',
        ),
      ),
    ).toMatchObject({ failureStage: 'bootstrap_http_response' });
  });
});

describe('explicit connection-preview command mode', () => {
  it('retains the existing default and accepts only the one exact preview flag', () => {
    expect(parseOneJobOperatorArguments([])).toBe('execute');
    expect(parseOneJobOperatorArguments(['--preview-connection'])).toBe('preview_connection');
    for (const args of [
      ['--preview-connection', '--execute'],
      ['--preview-connection', '--preview-connection'],
      ['--preview-connection=true'],
      ['--unknown'],
    ])
      expect(() => parseOneJobOperatorArguments(args)).toThrow('Unsupported');
  });

  it('routes preview only to the read-only runner and leaves execution untouched', async () => {
    const preview = vi
      .spyOn(operator, 'previewOneJobOperatorConnection')
      .mockResolvedValue('connection_ready');
    const execute = vi.spyOn(operator, 'runOneJobOperator').mockResolvedValue('confirmed');
    const document = {} as Parameters<typeof runOneJobOperatorCommand>[0];
    const context = {} as Parameters<typeof runOneJobOperatorCommand>[1];
    try {
      await expect(runOneJobOperatorCommand(document, context, 'preview_connection')).resolves.toBe(
        'connection_ready',
      );
      expect(preview).toHaveBeenCalledExactlyOnceWith(document, context);
      expect(execute).not.toHaveBeenCalled();
      await expect(runOneJobOperatorCommand(document, context, 'execute')).resolves.toBe(
        'confirmed',
      );
      expect(execute).toHaveBeenCalledExactlyOnceWith(document, context);
      expect(() => runOneJobOperatorCommand(document, context, 'invalid' as never)).toThrow(
        'Unsupported',
      );
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
