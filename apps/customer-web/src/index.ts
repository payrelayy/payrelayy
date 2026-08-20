import {
  loadCustomerWebAuthConfig,
  loadCustomerWebDryRunDepositProofConfig,
  loadCustomerWebRateLimitConfig,
  loadCustomerWebWorkspaceConfig,
} from '@fetanagent/config/customer-web';
import { createCustomerWebAuthPort } from '@fetanagent/customer-web-auth-runtime';
import { createCustomerWorkspacePostgresRuntime } from '@fetanagent/customer-web-workspace-runtime';

import { buildCustomerWebApp, createDurableCustomerWebRateLimiter } from './app.js';

function customerWebPort(value: string | undefined): number {
  const port = value === undefined ? 3003 : Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('CUSTOMER_WEB_PORT must be a valid TCP port.');
  }
  return port;
}

function customerWebHost(value: string | undefined): '0.0.0.0' | '127.0.0.1' {
  const host = value ?? (process.env.NODE_ENV === 'production' ? undefined : '127.0.0.1');
  if (host !== '0.0.0.0' && host !== '127.0.0.1') {
    throw new Error('CUSTOMER_WEB_HOST must explicitly select 0.0.0.0 or 127.0.0.1 in production.');
  }
  return host;
}

const config = loadCustomerWebAuthConfig();
if (!config.enabled) throw new Error('The customer web Auth runtime gate is disabled.');
const workspaceConfig = loadCustomerWebWorkspaceConfig();
if (!workspaceConfig.enabled) {
  throw new Error('The customer workspace runtime gate is disabled.');
}
const depositProofConfig = loadCustomerWebDryRunDepositProofConfig();
const rateLimitConfig = loadCustomerWebRateLimitConfig();
if (!rateLimitConfig.enabled) {
  throw new Error('The durable customer-web rate-limit gate is disabled.');
}
const workspace = await createCustomerWorkspacePostgresRuntime(workspaceConfig);

const app = buildCustomerWebApp({
  auth: createCustomerWebAuthPort(config),
  ...(depositProofConfig.enabled
    ? {
        dryRunDepositProof: {
          financialActionsMode: depositProofConfig.financialActionsMode,
          liveFinancialActionsEnabled: depositProofConfig.liveFinancialActionsEnabled,
          protectionProfileVersion: depositProofConfig.referenceProfileVersion,
          secrets: {
            encryptionSecret: depositProofConfig.referenceEncryptionMasterSecret,
            fingerprintSecret: depositProofConfig.referenceFingerprintMasterSecret,
          },
        },
      }
    : {}),
  publicOrigin: 'https://fetanagent.com',
  rateLimiter: createDurableCustomerWebRateLimiter(workspace, rateLimitConfig.hmacSecret),
  trustProxy: 1,
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
  await app.listen({
    host: customerWebHost(process.env.CUSTOMER_WEB_HOST),
    port: customerWebPort(process.env.CUSTOMER_WEB_PORT),
  });
} catch {
  await closeGracefully();
  throw new Error('The customer web service could not start.');
}
