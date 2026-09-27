import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
  digestCompanionExecutionHandoffSigningContent,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { CompanionDeviceSigningRuntime } from './device-enrollment.js';
import {
  ProtectedHandoffSigningClientUnavailableError,
  createProtectedHandoffSigningClient,
} from './protected-handoff-signing-client.js';

const certificateDigest = `sha256:${'a'.repeat(64)}`;
const requestKey = randomUUID();
const reply = {
  body: { requestKey },
  signerKeyId: 'test-execution-signer',
  signature: 'test-signature',
};

function device() {
  const createSignedHttpRequest = vi.fn((path: string, contentDigest: string) => ({
    path,
    contentDigest,
  }));
  return {
    runtime: {
      certificate: { bodyDigest: certificateDigest },
      createSignedHttpRequest,
    } as unknown as Pick<CompanionDeviceSigningRuntime, 'certificate' | 'createSignedHttpRequest'>,
    createSignedHttpRequest,
  };
}

async function withServer(
  statusCode: number,
  responseBody: string,
  run: (port: number, received: () => readonly string[]) => Promise<void>,
): Promise<void> {
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    requests.push(body);
    expect(request.method).toBe('POST');
    expect(request.url).toBe(COMPANION_EXECUTION_HANDOFF_SIGN_PATH);
    response.writeHead(statusCode, {
      'cache-control': 'no-store',
      'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
    });
    response.end(responseBody);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error();
  try {
    await run(address.port, () => requests);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe('protected Windows handoff signing client', () => {
  it('makes one paired, content-bound loopback request without an automatic retry', async () => {
    await withServer(200, JSON.stringify(reply), async (port, received) => {
      const paired = device();
      const signHandoff = createProtectedHandoffSigningClient(paired.runtime, port);
      expect(await signHandoff(requestKey)).toEqual(reply);
      expect(paired.createSignedHttpRequest).toHaveBeenCalledExactlyOnceWith(
        COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
        digestCompanionExecutionHandoffSigningContent(requestKey, certificateDigest),
      );
      expect(received()).toHaveLength(1);
      const sent = JSON.parse(received()[0]!);
      expect(Object.keys(sent)).toEqual(['requestKey', 'certificate', 'httpRequest']);
      expect(sent.httpRequest.contentDigest).toBe(
        digestCompanionExecutionHandoffSigningContent(requestKey, certificateDigest),
      );
      await expect(signHandoff(requestKey)).rejects.toThrow(
        ProtectedHandoffSigningClientUnavailableError,
      );
      expect(received()).toHaveLength(1);
    });
  });

  it('fails closed on a remote error or oversized response, without retrying', async () => {
    for (const [status, body] of [
      [503, '{"code":"temporarily_unavailable"}'],
      [200, 'x'.repeat(4_097)],
    ] as const) {
      await withServer(status, body, async (port, received) => {
        const signHandoff = createProtectedHandoffSigningClient(device().runtime, port);
        await expect(signHandoff(requestKey)).rejects.toThrow(
          ProtectedHandoffSigningClientUnavailableError,
        );
        expect(received()).toHaveLength(1);
        await expect(signHandoff(requestKey)).rejects.toThrow(
          ProtectedHandoffSigningClientUnavailableError,
        );
        expect(received()).toHaveLength(1);
      });
    }
  });

  it('rejects invalid ports and request keys before sending anything', async () => {
    expect(() => createProtectedHandoffSigningClient(device().runtime, 0)).toThrow(
      ProtectedHandoffSigningClientUnavailableError,
    );
    await withServer(200, JSON.stringify(reply), async (port, received) => {
      const paired = device();
      const signHandoff = createProtectedHandoffSigningClient(paired.runtime, port);
      await expect(signHandoff('not-a-request-key')).rejects.toThrow(
        ProtectedHandoffSigningClientUnavailableError,
      );
      expect(paired.createSignedHttpRequest).not.toHaveBeenCalled();
      expect(received()).toHaveLength(0);
    });
  });
});
