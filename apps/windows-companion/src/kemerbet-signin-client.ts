import {
  AGENT_PLATFORM_COMPANION_KEMERBET_SIGNIN_PATH,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  digestCompanionKemerBetSigninContent,
} from '@fetanagent/agent-platform-companion-contracts';

import type { CompanionDeviceSigningRuntime } from './device-enrollment.js';

const ENDPOINT = `https://device.fetanagent.com${AGENT_PLATFORM_COMPANION_KEMERBET_SIGNIN_PATH}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface KemerBetSigninCredentials {
  readonly username: string;
  readonly password: string;
  readonly revision: number;
}

/** Read on demand through the paired, signed device lane. No credential is written to disk. */
export async function readKemerBetSigninCredentials(
  device: CompanionDeviceSigningRuntime,
  platformAgentAccountId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<KemerBetSigninCredentials | undefined> {
  if (!UUID.test(platformAgentAccountId)) return undefined;
  const digest = digestCompanionKemerBetSigninContent(
    device.certificate.bodyDigest,
    platformAgentAccountId,
  );
  if (!digest) return undefined;
  const httpRequest = device.createSignedHttpRequest(
    AGENT_PLATFORM_COMPANION_KEMERBET_SIGNIN_PATH,
    digest,
  );
  const response = await fetchImplementation(ENDPOINT, {
    method: 'POST',
    headers: {
      accept: AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
      'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
    },
    body: JSON.stringify({ certificate: device.certificate, httpRequest, platformAgentAccountId }),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(7_000),
  });
  if (
    !response.ok ||
    response.status !== 200 ||
    response.headers.get('content-type') !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE
  )
    return undefined;
  const length = response.headers.get('content-length');
  if (length && Number(length) > 4_096) return undefined;
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 4_096) return undefined;
      chunks.push(part.value);
    }
    const joined = Buffer.concat(chunks, total);
    let parsed: unknown;
    try {
      parsed = JSON.parse(joined.toString('utf8'));
    } finally {
      joined.fill(0);
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      !Object.hasOwn(parsed, 'settings')
    )
      return undefined;
    const value = (parsed as { settings: unknown }).settings;
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 3
    )
      return undefined;
    const settings = value as Record<string, unknown>;
    if (
      typeof settings.username !== 'string' ||
      settings.username.length < 1 ||
      settings.username.length > 128 ||
      typeof settings.password !== 'string' ||
      settings.password.length < 1 ||
      settings.password.length > 256 ||
      !Number.isSafeInteger(settings.revision) ||
      (settings.revision as number) < 1
    )
      return undefined;
    return {
      username: settings.username,
      password: settings.password,
      revision: settings.revision as number,
    };
  } catch {
    return undefined;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    reader.releaseLock();
  }
}
