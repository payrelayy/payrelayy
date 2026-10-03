import { describe, expect, it } from 'vitest';

import { redactedOneJobOperatorFailure } from './one-job-operator-cli.js';
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
