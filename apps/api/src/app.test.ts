import { loadApiConfig } from '@fetanagent/config/api';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

describe('health endpoint', () => {
  it('reports the safe financial-action mode', async () => {
    const app = buildApp(
      loadApiConfig({ FINANCIAL_ACTIONS_MODE: 'dry_run', LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
    );
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      financialActionsMode: 'dry_run',
      runtimeContract: {
        financialActionsMode: 'dry_run',
        playerActionRuntimeEnabled: false,
        depositProofReferenceMastersConfigured: false,
        depositProofReferenceProfileVersion: null,
      },
    });

    await app.close();
  });

  it('stays unready until the database migration has been initialized', async () => {
    const app = buildApp(loadApiConfig({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ready: false,
      reason: 'database_not_initialized',
    });

    await app.close();
  });
});
