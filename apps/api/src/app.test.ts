import { loadConfig } from '@payreplayy/config';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

describe('health endpoint', () => {
  it('reports the safe financial-action mode', async () => {
    const app = buildApp(
      loadConfig({ FINANCIAL_ACTIONS_MODE: 'dry_run', LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
    );
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      financialActionsMode: 'dry_run',
    });

    await app.close();
  });

  it('stays unready until the database migration has been initialized', async () => {
    const app = buildApp(loadConfig({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ready: false,
      reason: 'database_not_initialized',
    });

    await app.close();
  });
});
