import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_PLATFORM_COMPANION_SESSION_STATUS_PATH,
  digestCompanionSessionStatusContent,
} from '@fetanagent/agent-platform-companion-contracts';

import type { CompanionDeviceSigningRuntime } from './device-enrollment.js';
import { reportCompanionSessionStatusOnce } from './session-status-reporter.js';

const accountId = 'd992b42a-16f6-445e-b904-922b0c3faacc';
const certDigest = `sha256:${'a'.repeat(64)}`;

describe('Companion session status report', () => {
  it('binds the actual verified sign-in state to the paired device request', async () => {
    const createSignedHttpRequest = vi.fn((_path: string, digest: string) => ({
      body: { contentDigest: digest },
    }));
    let sent: Record<string, unknown> | undefined;
    const fetchImplementation = vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string) as Record<string, unknown>;
      return { status: 204, body: null } as Response;
    }) as unknown as typeof fetch;
    const device = {
      certificate: { bodyDigest: certDigest },
      sessionStatusEndpoint: `https://device.fetanagent.com${AGENT_PLATFORM_COMPANION_SESSION_STATUS_PATH}`,
      createSignedHttpRequest,
    } as unknown as Pick<
      CompanionDeviceSigningRuntime,
      'certificate' | 'sessionStatusEndpoint' | 'createSignedHttpRequest'
    >;
    const result = await reportCompanionSessionStatusOnce(
      device,
      { isSignedInVerified: () => true, state: () => 'checking' },
      accountId,
      new AbortController().signal,
      fetchImplementation,
    );
    expect(result).toBe(true);
    expect(createSignedHttpRequest).toHaveBeenCalledWith(
      AGENT_PLATFORM_COMPANION_SESSION_STATUS_PATH,
      digestCompanionSessionStatusContent(certDigest, accountId, 'signed_in_verified'),
    );
    expect(sent).toMatchObject({ platformAgentAccountId: accountId, state: 'signed_in_verified' });
    expect(JSON.stringify(sent)).not.toContain('password');
  });
});
