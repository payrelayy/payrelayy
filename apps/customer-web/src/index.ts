import {
  loadCustomerWebAuthConfig,
  loadCustomerWebDepositConfig,
  loadCustomerWebWorkspaceConfig,
} from '@fetanagent/config/customer-web';
import { createCustomerWebAuthPort } from '@fetanagent/customer-web-auth-runtime';
import { createCustomerWorkspacePostgresRuntime } from '@fetanagent/customer-web-workspace-runtime';

import { buildCustomerWebApp } from './app.js';

function customerWebPort(value: string | undefined): number {
  const port = value === undefined ? 3003 : Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('CUSTOMER_WEB_PORT must be a valid TCP port.');
  }
  return port;
}

const config = loadCustomerWebAuthConfig();
if (!config.enabled) throw new Error('The customer web Auth runtime gate is disabled.');
const workspaceConfig = loadCustomerWebWorkspaceConfig();
if (!workspaceConfig.enabled) {
  throw new Error('The customer workspace runtime gate is disabled.');
}
const workspace = await createCustomerWorkspacePostgresRuntime(workspaceConfig);
const depositConfig = loadCustomerWebDepositConfig();

const app = buildCustomerWebApp({
  auth: createCustomerWebAuthPort(config),
  ...(depositConfig.enabled
    ? {
        depositReferenceProtectionSecrets: {
          encryptionSecret: depositConfig.referenceEncryptionSecret,
          fingerprintSecret: depositConfig.referenceFingerprintSecret,
        },
      }
    : {}),
  publicOrigin: 'https://fetanagent.com',
  workspace,
});
let closing = false;

const closeGracefully = async () => {
  if (closing) return;
  closing = true;
  try {
    await app.close();
  } catch {
    process.exitCode = 1;
  }
};

process.once('SIGINT', closeGracefully);
process.once('SIGTERM', closeGracefully);

try {
  await app.listen({ host: '127.0.0.1', port: customerWebPort(process.env.CUSTOMER_WEB_PORT) });
} catch {
  await closeGracefully();
  throw new Error('The customer web service could not start.');
}
