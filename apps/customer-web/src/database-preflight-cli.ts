import { loadCustomerWebWorkspaceConfig } from '@fetanagent/config/customer-web';
import { createCustomerWorkspacePostgresRuntime } from '@fetanagent/customer-web-workspace-runtime';

const config = loadCustomerWebWorkspaceConfig();
if (!config.enabled) throw new Error('The customer workspace runtime gate is disabled.');

const runtime = await createCustomerWorkspacePostgresRuntime(config);
try {
  if (!(await runtime.ready())) throw new Error('The customer workspace runtime is unavailable.');
} finally {
  await runtime.close();
}

console.log('Customer web database preflight passed.');
