import { createHash, createHmac, createPublicKey, X509Certificate } from 'node:crypto';
import { request as requestHttps } from 'node:https';
import { connect, type AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN } from './kemerbet-agent-identity-fingerprint.js';
import {
  createKemerBetReadinessLayer7AuthorizationVerifier,
  createKemerBetReadinessLayer7LookupAuthorization,
  KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER,
  type KemerBetReadinessLayer7AuthorizationVerifier,
} from './kemerbet-readiness-layer7-authorization.js';
import {
  KEMERBET_READINESS_LAYER7_TLS_CERTIFICATE_PEM,
  KEMERBET_READINESS_LAYER7_TLS_HOSTS,
  KEMERBET_READINESS_LAYER7_TLS_PRIVATE_KEY_PEM,
  KEMERBET_READINESS_LAYER7_TLS_SPKI_SHA256_BASE64,
} from './kemerbet-readiness-layer7-certificate.js';
import {
  attestKemerBetReadinessLayer7NetworkTopology,
  classifyKemerBetReadinessLayer7Request,
  createKemerBetReadinessLayer7Proxy,
  KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS,
  KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT,
  KEMERBET_READINESS_LAYER7_RUNTIME_CONTRACT,
  KEMERBET_READINESS_LAYER7_TIMEOUT_CONTRACT,
  KemerBetReadinessLayer7UnavailableError,
  productionKemerBetReadinessLayer7Upstream,
  sanitizeKemerBetReadinessLayer7RequestHeaders,
  sanitizeKemerBetReadinessLayer7ResponseHeaders,
  type KemerBetReadinessLayer7ClassifierInput,
  type KemerBetReadinessLayer7ProxyControl,
  type KemerBetReadinessLayer7UpstreamRequest,
  type KemerBetReadinessLayer7UpstreamResponse,
} from './kemerbet-readiness-layer7-proxy.js';
import {
  createKemerBetReadinessSameAgentIdentityVerifier,
  KEMERBET_READINESS_AGENT_PROFILE_PATH,
  type KemerBetReadinessSameAgentIdentityVerifier,
} from './kemerbet-readiness-same-agent-identity.js';

const WEB_HOST = 'agentsystem.admindigi.com';
const ASSET_HOST = 'agt-client-akm.agent-digi.com';
const API_HOST = 'admin-api.agt-digi.com';
const LOOKUP_PATH = '/Player/GeneralInfoByExternalId';
const AUTHORIZATION = 'Bearer abcdefghijklmnop.qrstuvwxyz012345.ABCDEFGHIJKLMNOP';
const OTHER_AUTHORIZATION = 'Bearer abcdefghijklmnop.qrstuvwxyz012345.DIFFERENTTOKEN';
const HMAC_KEY = Buffer.from('11'.repeat(32), 'hex');
const RUN_NONCE = Buffer.from('22'.repeat(16), 'hex');
const RELEASE_SHA = 'a'.repeat(40);
const AGENT_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_USER_NAME = 'private-agent@example.invalid';
const AGENT_IDENTITY_HMAC_KEY = Buffer.from('33'.repeat(32), 'hex');
const PLAYER_IDS = Object.freeze([
  'PLAYER-ALPHA',
  'PLAYER-BRAVO',
  'PLAYER-CHARLIE',
  'PLAYER-DELTA',
  'PLAYER-ECHO',
]);
const RELEASED_PROXY_TOPOLOGY = Object.freeze({
  defaultRouteInterfaceNames: Object.freeze(['eth1']),
  nonLoopbackInterfaceNames: Object.freeze(['eth0', 'eth1']),
});

function classify(
  overrides: Partial<KemerBetReadinessLayer7ClassifierInput> = {},
): ReturnType<typeof classifyKemerBetReadinessLayer7Request> {
  return classifyKemerBetReadinessLayer7Request({
    headers: { host: WEB_HOST },
    method: 'GET',
    rawTarget: '/agents',
    sniServername: WEB_HOST,
    ...overrides,
  });
}

function lookupAuthorization(sequence: number, playerId = PLAYER_IDS[sequence - 1] ?? ''): string {
  return createKemerBetReadinessLayer7LookupAuthorization({
    hmacKey: HMAC_KEY,
    playerId,
    runNonce: RUN_NONCE,
    sequence,
  });
}

function authorizationVerifier(): KemerBetReadinessLayer7AuthorizationVerifier {
  return createKemerBetReadinessLayer7AuthorizationVerifier({
    hmacKey: HMAC_KEY,
    releaseSha: RELEASE_SHA,
    runNonce: RUN_NONCE,
  });
}

function agentIdentityBinding(accountId = AGENT_ACCOUNT_ID, userName = AGENT_USER_NAME): string {
  const digest = createHmac('sha256', AGENT_IDENTITY_HMAC_KEY)
    .update(KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN, 'utf8')
    .update(accountId, 'utf8')
    .update('\0', 'utf8')
    .update(userName, 'utf8')
    .digest('hex');
  return `${accountId} hmac-sha256-agent-identity-v1:${digest} hmac-sha256-agent-profile-pin-v3:${digest}\n`;
}

function sameAgentIdentityVerifier(
  bindingFile = agentIdentityBinding(),
): KemerBetReadinessSameAgentIdentityVerifier {
  return createKemerBetReadinessSameAgentIdentityVerifier({
    bindingFile: Buffer.from(bindingFile, 'utf8'),
    hmacKeyFile: Buffer.from(AGENT_IDENTITY_HMAC_KEY.toString('hex'), 'ascii'),
  });
}

function successfulAgentProfileBody(userName = AGENT_USER_NAME): Buffer {
  return Buffer.from(
    JSON.stringify({
      resultCode: 0,
      value: { userName },
    }),
    'utf8',
  );
}

function successfulLookupBody(playerId = PLAYER_IDS[0] ?? ''): Buffer {
  return Buffer.from(
    JSON.stringify({
      value: {
        currencyCode: 'ETB',
        email: 'redacted@example.invalid',
        externalId: playerId,
        id: 7001,
        userName: 'redacted@example.invalid',
      },
    }),
    'utf8',
  );
}

function successfulBootstrapResponse(
  input: KemerBetReadinessLayer7UpstreamRequest,
): KemerBetReadinessLayer7UpstreamResponse | null {
  const isWeb = input.hostname === WEB_HOST && input.path === '/agents';
  const isAsset =
    input.hostname === ASSET_HOST &&
    KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS.includes(
      input.path as (typeof KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS)[number],
    );
  if (!isWeb && !isAsset) return null;
  return {
    body: Buffer.from(`prefetched:${input.hostname}${input.path}`, 'utf8'),
    headers: { 'content-encoding': 'identity', 'content-type': 'text/plain' },
    statusCode: 200,
  };
}

function requireProxyClassification(
  classification: ReturnType<typeof classifyKemerBetReadinessLayer7Request>,
): Extract<ReturnType<typeof classifyKemerBetReadinessLayer7Request>, { decision: 'proxy' }> {
  if (classification.decision !== 'proxy') throw new Error('expected proxy classification');
  return classification;
}

function requestLocalProxy(input: {
  readonly control: KemerBetReadinessLayer7ProxyControl;
  readonly headers?: Readonly<Record<string, string>>;
  readonly host: string;
  readonly method?: string;
  readonly path: string;
}): Promise<{
  readonly body: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly statusCode: number;
}> {
  const address = input.control.address() as AddressInfo;
  return new Promise((resolvePromise, rejectPromise) => {
    const request = requestHttps({
      agent: false,
      headers: { host: input.host, ...input.headers },
      hostname: '127.0.0.1',
      method: input.method ?? 'GET',
      path: input.path,
      port: address.port,
      rejectUnauthorized: false,
      servername: input.host,
    });
    request.once('error', rejectPromise);
    request.once('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer | string) =>
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
      );
      response.once('error', rejectPromise);
      response.once('end', () =>
        resolvePromise({
          body: Buffer.concat(chunks).toString('utf8'),
          headers: response.headers,
          statusCode: response.statusCode ?? 0,
        }),
      );
    });
    request.end();
  });
}

function emptyTcpHealthProbe(control: KemerBetReadinessLayer7ProxyControl): Promise<void> {
  const address = control.address() as AddressInfo;
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = connect(address.port, '127.0.0.1');
    socket.setTimeout(1_000);
    socket.once('connect', () => socket.end());
    socket.once('close', () => resolvePromise());
    socket.once('error', rejectPromise);
    socket.once('timeout', () => {
      socket.destroy();
      rejectPromise(new Error('health timeout'));
    });
  });
}

describe('KemerBet readiness Layer-7 TLS identity', () => {
  it('contains exactly the three reviewed SAN hosts and exports Chromium-compatible SPKI', () => {
    const certificate = new X509Certificate(KEMERBET_READINESS_LAYER7_TLS_CERTIFICATE_PEM);
    const observedSans = (certificate.subjectAltName ?? '')
      .split(',')
      .map((value) => value.trim().replace(/^DNS:/u, ''))
      .filter((value) => value !== '');
    expect(observedSans).toEqual([...KEMERBET_READINESS_LAYER7_TLS_HOSTS]);

    const certificateSpki = certificate.publicKey.export({ format: 'der', type: 'spki' });
    const privateKeySpki = createPublicKey(KEMERBET_READINESS_LAYER7_TLS_PRIVATE_KEY_PEM).export({
      format: 'der',
      type: 'spki',
    });
    expect(privateKeySpki.equals(certificateSpki)).toBe(true);
    expect(createHash('sha256').update(certificateSpki).digest('base64')).toBe(
      KEMERBET_READINESS_LAYER7_TLS_SPKI_SHA256_BASE64,
    );
  });
});

describe('classifyKemerBetReadinessLayer7Request', () => {
  it('permits only the exact agent page', () => {
    expect(classify()).toEqual({
      decision: 'proxy',
      hostname: WEB_HOST,
      method: 'GET',
      path: '/agents',
      route: 'agent_web',
    });
    for (const rawTarget of ['/agents?', '/agents/', '/agents?et=1', '/payments/history']) {
      expect(classify({ rawTarget })).toEqual({ decision: 'reject' });
    }
    expect(classify({ method: 'HEAD' })).toEqual({ decision: 'reject' });
    expect(classify({ method: 'POST' })).toEqual({ decision: 'reject' });
  });

  it('permits exactly all seven reviewed v84 bootstrap assets without query strings', () => {
    expect(KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS).toHaveLength(7);
    for (const path of KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS) {
      expect(
        classify({
          headers: { host: ASSET_HOST },
          rawTarget: path,
          sniServername: ASSET_HOST,
        }),
      ).toEqual({
        decision: 'proxy',
        hostname: ASSET_HOST,
        method: 'GET',
        path,
        route: 'bootstrap_asset',
      });
      expect(
        classify({
          headers: { host: ASSET_HOST },
          rawTarget: `${path}?cache=1`,
          sniServername: ASSET_HOST,
        }),
      ).toEqual({ decision: 'reject' });
    }
    expect(
      classify({
        headers: { host: ASSET_HOST },
        rawTarget: '/prd/agt-admin-client/v84/unreviewed.js',
        sniServername: ASSET_HOST,
      }),
    ).toEqual({ decision: 'reject' });
  });

  it('permits exact GET lookup requests only for one of the loaded five Players', () => {
    for (const playerId of PLAYER_IDS) {
      const path = `${LOOKUP_PATH}?externalId=${playerId}`;
      expect(
        classify({
          headers: {
            authorization: AUTHORIZATION,
            host: API_HOST,
            [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(
              PLAYER_IDS.indexOf(playerId) + 1,
              playerId,
            ),
          },
          rawTarget: path,
          sniServername: API_HOST,
        }),
      ).toEqual({
        decision: 'proxy',
        hostname: API_HOST,
        method: 'GET',
        path,
        route: 'player_lookup',
      });
    }
    for (const path of [
      `${LOOKUP_PATH}?externalId=PLAYER-ALPHA&externalId=PLAYER-ALPHA`,
      `${LOOKUP_PATH}?externalId=PLAYER-ALPHA&extra=1`,
      `${LOOKUP_PATH}?externalId=PLAYER%2DALPHA`,
      `${LOOKUP_PATH}?%65xternalId=PLAYER-ALPHA`,
      `${LOOKUP_PATH}?externalId=`,
      `${LOOKUP_PATH}?externalId=PLAYER-ALPHA#fragment`,
    ]) {
      expect(
        classify({
          headers: {
            authorization: AUTHORIZATION,
            host: API_HOST,
            [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(1),
          },
          rawTarget: path,
          sniServername: API_HOST,
        }),
      ).toEqual({ decision: 'reject' });
    }
  });

  it('permits only the tightly constrained browser lookup preflight', () => {
    const rawTarget = `${LOOKUP_PATH}?externalId=PLAYER-ALPHA`;
    for (const requestedHeaders of [
      'authorization',
      'content-type',
      'authorization, content-type',
    ]) {
      expect(
        classify({
          headers: {
            'access-control-request-headers': requestedHeaders,
            'access-control-request-method': 'GET',
            host: API_HOST,
            origin: `https://${WEB_HOST}`,
          },
          method: 'OPTIONS',
          rawTarget,
          sniServername: API_HOST,
        }),
      ).toMatchObject({ decision: 'local_preflight', method: 'OPTIONS' });
    }
    for (const headers of [
      {
        'access-control-request-headers': 'authorization',
        'access-control-request-method': 'POST',
        host: API_HOST,
        origin: `https://${WEB_HOST}`,
      },
      {
        'access-control-request-headers': 'authorization, authorization',
        'access-control-request-method': 'GET',
        host: API_HOST,
        origin: `https://${WEB_HOST}`,
      },
      {
        'access-control-request-headers': 'x-unreviewed',
        'access-control-request-method': 'GET',
        host: API_HOST,
        origin: `https://${WEB_HOST}`,
      },
      {
        'access-control-request-headers': 'authorization',
        'access-control-request-method': 'GET',
        host: API_HOST,
        origin: 'https://untrusted.invalid',
      },
    ]) {
      expect(classify({ headers, method: 'OPTIONS', rawTarget, sniServername: API_HOST })).toEqual({
        decision: 'reject',
      });
    }
  });

  it('rejects authority, SNI, body-framing, upgrade, and header-count ambiguity', () => {
    for (const overrides of [
      { headers: { host: [WEB_HOST, WEB_HOST] } },
      { headers: { host: `${WEB_HOST}:443` } },
      { headers: { host: WEB_HOST }, sniServername: API_HOST },
      { headers: { host: WEB_HOST }, sniServername: false },
      { headers: { host: WEB_HOST, 'content-length': '1' } },
      { headers: { host: WEB_HOST, 'content-length': ['0', '0'] } },
      { headers: { host: WEB_HOST, 'transfer-encoding': 'chunked' } },
      { headers: { connection: 'keep-alive, Upgrade', host: WEB_HOST } },
      { headers: { host: WEB_HOST, upgrade: 'websocket' } },
      { headerCount: 65 },
      { isUpgrade: true },
      { rawTarget: 'https://agentsystem.admindigi.com/agents' },
      { rawTarget: '//agentsystem.admindigi.com/agents' },
    ] satisfies readonly Partial<KemerBetReadinessLayer7ClassifierInput>[]) {
      expect(classify(overrides)).toEqual({ decision: 'reject' });
    }
    expect(
      classify({
        headers: { authorization: AUTHORIZATION, host: API_HOST },
        rawTarget: `${LOOKUP_PATH}?externalId=PLAYER-ALPHA`,
        sniServername: API_HOST,
      }),
    ).toEqual({ decision: 'reject' });
  });
});

describe('KemerBet readiness Layer-7 header sanitizers', () => {
  it('uses fixed positive headers for web and assets and drops every renderer value', () => {
    const untrustedHeaders = {
      authorization: AUTHORIZATION,
      connection: 'keep-alive, x-remove',
      cookie: ['a=1', 'b=2'],
      forwarded: 'for=untrusted',
      host: WEB_HOST,
      origin: 'https://untrusted.invalid',
      referer: 'https://untrusted.invalid/id/PLAYER-ALPHA',
      'x-exfiltrate': 'PLAYER-ALPHA',
    };
    const webHeaders = sanitizeKemerBetReadinessLayer7RequestHeaders(
      untrustedHeaders,
      requireProxyClassification(classify()),
    );
    expect(Object.keys(webHeaders).sort()).toEqual([
      'accept',
      'accept-encoding',
      'sec-fetch-dest',
      'sec-fetch-mode',
      'sec-fetch-site',
      'upgrade-insecure-requests',
      'user-agent',
    ]);
    expect(webHeaders.authorization).toBeUndefined();
    expect(webHeaders.cookie).toBeUndefined();
    expect(webHeaders.origin).toBeUndefined();
    expect(webHeaders.referer).toBeUndefined();

    const assetClassification = requireProxyClassification(
      classify({
        headers: { host: ASSET_HOST },
        rawTarget: KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS[0],
        sniServername: ASSET_HOST,
      }),
    );
    const assetHeaders = sanitizeKemerBetReadinessLayer7RequestHeaders(
      untrustedHeaders,
      assetClassification,
    );
    expect(Object.keys(assetHeaders).sort()).toEqual([
      'accept',
      'accept-encoding',
      'sec-fetch-dest',
      'sec-fetch-mode',
      'sec-fetch-site',
      'user-agent',
    ]);
    expect(assetHeaders.authorization).toBeUndefined();
    expect(assetHeaders.cookie).toBeUndefined();
    expect(assetHeaders.origin).toBeUndefined();
    expect(assetHeaders.referer).toBeUndefined();
  });

  it('forwards the bounded authorization only on lookup GET and strips the internal token', () => {
    const lookupPath = `${LOOKUP_PATH}?externalId=PLAYER-ALPHA`;
    const lookupHeaders = {
      authorization: AUTHORIZATION,
      host: API_HOST,
      [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(1),
    };
    const lookupClassification = requireProxyClassification(
      classify({ headers: lookupHeaders, rawTarget: lookupPath, sniServername: API_HOST }),
    );
    expect(
      sanitizeKemerBetReadinessLayer7RequestHeaders(lookupHeaders, lookupClassification),
    ).toMatchObject({
      authorization: AUTHORIZATION,
      origin: `https://${WEB_HOST}`,
      referer: `https://${WEB_HOST}/agents`,
      'sec-fetch-site': 'cross-site',
    });
    expect(
      sanitizeKemerBetReadinessLayer7RequestHeaders(lookupHeaders, lookupClassification)[
        KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER
      ],
    ).toBeUndefined();
  });

  it('strips response hop-by-hop, alternate-service, and reporting headers', () => {
    expect(
      sanitizeKemerBetReadinessLayer7ResponseHeaders({
        'alt-svc': 'h3=":443"',
        connection: 'x-remove',
        'content-length': '999',
        'content-type': 'application/javascript',
        nel: '{"report_to":"default"}',
        'report-to': '{"group":"default"}',
        'reporting-endpoints': 'default="https://report.invalid"',
        'set-cookie': ['session=opaque'],
        'x-remove': 'nominated',
      }),
    ).toEqual({
      'content-type': 'application/javascript',
      'set-cookie': 'session=opaque',
    });
  });
});

describe('KemerBet readiness Layer-7 topology attestation', () => {
  it('accepts exactly two interfaces with every usable default on exactly one', () => {
    expect(attestKemerBetReadinessLayer7NetworkTopology(RELEASED_PROXY_TOPOLOGY)).toEqual({
      egressInterfaceName: 'eth1',
      isolatedInterfaceName: 'eth0',
    });
  });

  it.each([
    { defaultRouteInterfaceNames: [], nonLoopbackInterfaceNames: ['eth0', 'eth1'] },
    { defaultRouteInterfaceNames: ['eth0', 'eth1'], nonLoopbackInterfaceNames: ['eth0', 'eth1'] },
    { defaultRouteInterfaceNames: ['eth2'], nonLoopbackInterfaceNames: ['eth0', 'eth1'] },
    { defaultRouteInterfaceNames: ['eth0'], nonLoopbackInterfaceNames: ['eth0'] },
    { defaultRouteInterfaceNames: ['eth0'], nonLoopbackInterfaceNames: ['eth0', 'eth0'] },
    { defaultRouteInterfaceNames: ['eth0'], nonLoopbackInterfaceNames: ['eth0', 'eth1', 'eth2'] },
  ])('rejects a non-exact proxy topology', (topology) => {
    expect(() => attestKemerBetReadinessLayer7NetworkTopology(topology)).toThrow(
      KemerBetReadinessLayer7UnavailableError,
    );
  });
});

describe('KemerBet readiness production upstream abort handoff', () => {
  it('rejects a signal that was already aborted without constructing a usable request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      productionKemerBetReadinessLayer7Upstream({
        headers: {},
        hostname: 'localhost',
        method: 'GET',
        path: '/',
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessLayer7UnavailableError);
  });

  it('closes the construction-to-listener race when aborted at request handoff', async () => {
    const controller = new AbortController();
    const pending = productionKemerBetReadinessLayer7Upstream({
      headers: {},
      hostname: 'localhost',
      method: 'GET',
      path: '/',
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(KemerBetReadinessLayer7UnavailableError);
  });
});

describe('KemerBet readiness Layer-7 timeout budget', () => {
  it('keeps both downstream deadlines above the two-operation upstream budget plus margin', async () => {
    const contract = KEMERBET_READINESS_LAYER7_TIMEOUT_CONTRACT;
    const serialUpstreamBudgetMs =
      contract.maximumSerialUpstreamOperationsPerRequest * contract.upstreamOperationTimeoutMs;

    expect(Object.isFrozen(contract)).toBe(true);
    expect(contract).toEqual({
      downstreamRequestTimeoutMs: 25_000,
      downstreamSocketTimeoutMs: 25_000,
      downstreamTimeoutMarginMs: 5_000,
      maximumSerialUpstreamOperationsPerRequest: 2,
      upstreamOperationTimeoutMs: 10_000,
    });
    expect(contract.downstreamRequestTimeoutMs).toBeGreaterThan(serialUpstreamBudgetMs);
    expect(contract.downstreamRequestTimeoutMs - serialUpstreamBudgetMs).toBeGreaterThanOrEqual(
      contract.downstreamTimeoutMarginMs,
    );
    expect(contract.downstreamSocketTimeoutMs).toBeGreaterThanOrEqual(
      contract.downstreamRequestTimeoutMs,
    );

    const control = createKemerBetReadinessLayer7Proxy({
      allowEphemeralTestPort: true,
      authorizationVerifier: authorizationVerifier(),
      sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
      effectiveGroupId: 10003,
      effectiveUserId: 10003,
      port: 0,
    });
    try {
      expect(control.server.requestTimeout).toBe(contract.downstreamRequestTimeoutMs);
      expect(control.server.timeout).toBe(contract.downstreamSocketTimeoutMs);
    } finally {
      await control.close();
    }
  });
});

describe('KemerBet readiness Layer-7 server seams', () => {
  it('publishes exactly one generic receipt only after five serialized valid 200 responses', async () => {
    const completionReceiptPublisher = vi.fn(async () => undefined);
    const control = createKemerBetReadinessLayer7Proxy({
      allowEphemeralTestPort: true,
      authorizationVerifier: authorizationVerifier(),
      sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
      captureNetworkTopology: async () => RELEASED_PROXY_TOPOLOGY,
      completionReceiptPublisher,
      effectiveGroupId: 10003,
      effectiveUserId: 10003,
      port: 0,
      upstream: async (input) => {
        const bootstrap = successfulBootstrapResponse(input);
        if (bootstrap !== null) return bootstrap;
        if (input.path === KEMERBET_READINESS_AGENT_PROFILE_PATH) {
          return {
            body: successfulAgentProfileBody(),
            headers: { 'content-encoding': 'identity', 'content-type': 'application/json' },
            statusCode: 200,
          };
        }
        const playerId = new URL(`https://${input.hostname}${input.path}`).searchParams.get(
          'externalId',
        );
        return {
          body: Buffer.from(
            JSON.stringify({
              value: {
                currencyCode: 'ETB',
                email: 'redacted@example.invalid',
                externalId: playerId,
                id: 7001,
                userName: 'redacted@example.invalid',
              },
            }),
            'utf8',
          ),
          headers: { 'content-type': 'application/json' },
          statusCode: 200,
        };
      },
    });
    try {
      await control.start();
      for (const [index, playerId] of PLAYER_IDS.entries()) {
        const result = await requestLocalProxy({
          control,
          headers: {
            authorization: AUTHORIZATION,
            [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(
              index + 1,
              playerId,
            ),
          },
          host: API_HOST,
          path: `${LOOKUP_PATH}?externalId=${playerId}`,
        });
        expect(result.statusCode).toBe(200);
        expect(completionReceiptPublisher).toHaveBeenCalledTimes(index === 4 ? 1 : 0);
      }
      const bindingSha256 = createHash('sha256')
        .update(agentIdentityBinding(), 'utf8')
        .digest('hex');
      expect(completionReceiptPublisher).toHaveBeenCalledWith({
        agentIdentityBindingSha256: bindingSha256,
        releaseSha: RELEASE_SHA,
        runNonceSha256: createHash('sha256').update(RUN_NONCE).digest('hex'),
        sameAgentIdentityValidated: true,
        sequences: [1, 2, 3, 4, 5],
      });
      expect(JSON.stringify(completionReceiptPublisher.mock.calls)).not.toContain('PLAYER-');
    } finally {
      await control.close();
    }
  });

  it('never forwards a lookup when the signed-in Profile belongs to the wrong bound account', async () => {
    const upstreamCalls: KemerBetReadinessLayer7UpstreamRequest[] = [];
    const wrongBinding = agentIdentityBinding(AGENT_ACCOUNT_ID, AGENT_USER_NAME).replace(
      AGENT_ACCOUNT_ID,
      '22222222-2222-4222-8222-222222222222',
    );
    const completionReceiptPublisher = vi.fn(async () => undefined);
    const control = createKemerBetReadinessLayer7Proxy({
      allowEphemeralTestPort: true,
      authorizationVerifier: authorizationVerifier(),
      captureNetworkTopology: async () => RELEASED_PROXY_TOPOLOGY,
      completionReceiptPublisher,
      effectiveGroupId: 10003,
      effectiveUserId: 10003,
      port: 0,
      sameAgentIdentityVerifier: sameAgentIdentityVerifier(wrongBinding),
      upstream: async (input) => {
        const bootstrap = successfulBootstrapResponse(input);
        if (bootstrap !== null) return bootstrap;
        upstreamCalls.push(input);
        return {
          body: successfulAgentProfileBody(),
          headers: { 'content-encoding': 'identity' },
          statusCode: 200,
        };
      },
    });
    try {
      await control.start();
      const result = await requestLocalProxy({
        control,
        headers: {
          authorization: AUTHORIZATION,
          [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(1),
        },
        host: API_HOST,
        path: `${LOOKUP_PATH}?externalId=${PLAYER_IDS[0]}`,
      });
      expect(result).toMatchObject({ body: '{"status":"unavailable"}\n', statusCode: 502 });
      expect(upstreamCalls.map((call) => call.path)).toEqual(['/Account/Profile']);
      expect(completionReceiptPublisher).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(AGENT_ACCOUNT_ID);
      expect(JSON.stringify(result)).not.toContain(AGENT_USER_NAME);
      expect(JSON.stringify(result)).not.toContain(AUTHORIZATION);
    } finally {
      await control.close();
    }
  });

  it('accepts a fresh bearer only after its Profile matches the stable v3 agent pin', async () => {
    const upstreamCalls: KemerBetReadinessLayer7UpstreamRequest[] = [];
    const completionReceiptPublisher = vi.fn(async () => undefined);
    const control = createKemerBetReadinessLayer7Proxy({
      allowEphemeralTestPort: true,
      authorizationVerifier: authorizationVerifier(),
      captureNetworkTopology: async () => RELEASED_PROXY_TOPOLOGY,
      completionReceiptPublisher,
      effectiveGroupId: 10003,
      effectiveUserId: 10003,
      port: 0,
      sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
      upstream: async (input) => {
        const bootstrap = successfulBootstrapResponse(input);
        if (bootstrap !== null) return bootstrap;
        upstreamCalls.push(input);
        if (input.path === KEMERBET_READINESS_AGENT_PROFILE_PATH) {
          return {
            body: successfulAgentProfileBody(),
            headers: { 'content-encoding': 'identity' },
            statusCode: 200,
          };
        }
        return {
          body: successfulLookupBody(),
          headers: { 'content-encoding': 'identity' },
          statusCode: 200,
        };
      },
    });
    try {
      await control.start();
      const result = await requestLocalProxy({
        control,
        headers: {
          authorization: OTHER_AUTHORIZATION,
          [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(1),
        },
        host: API_HOST,
        path: `${LOOKUP_PATH}?externalId=${PLAYER_IDS[0]}`,
      });
      expect(result.statusCode).toBe(200);
      expect(upstreamCalls.map((call) => call.path)).toEqual([
        KEMERBET_READINESS_AGENT_PROFILE_PATH,
        `${LOOKUP_PATH}?externalId=${PLAYER_IDS[0]}`,
      ]);
      expect(
        upstreamCalls.every((call) => call.headers.authorization === OTHER_AUTHORIZATION),
      ).toBe(true);
      expect(completionReceiptPublisher).not.toHaveBeenCalled();
    } finally {
      await control.close();
    }
  });

  it('pins the complete first bearer and makes sequence-two bearer drift terminal pre-lookup', async () => {
    const upstreamCalls: KemerBetReadinessLayer7UpstreamRequest[] = [];
    const completionReceiptPublisher = vi.fn(async () => undefined);
    const control = createKemerBetReadinessLayer7Proxy({
      allowEphemeralTestPort: true,
      authorizationVerifier: authorizationVerifier(),
      captureNetworkTopology: async () => RELEASED_PROXY_TOPOLOGY,
      completionReceiptPublisher,
      effectiveGroupId: 10003,
      effectiveUserId: 10003,
      port: 0,
      sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
      upstream: async (input) => {
        const bootstrap = successfulBootstrapResponse(input);
        if (bootstrap !== null) return bootstrap;
        upstreamCalls.push(input);
        if (input.path === KEMERBET_READINESS_AGENT_PROFILE_PATH) {
          return {
            body: successfulAgentProfileBody(),
            headers: {},
            statusCode: 200,
          };
        }
        const playerId = new URL(`https://${input.hostname}${input.path}`).searchParams.get(
          'externalId',
        );
        return {
          body: Buffer.from(
            JSON.stringify({
              value: {
                currencyCode: 'ETB',
                externalId: playerId,
                id: 7001,
                userName: 'redacted@example.invalid',
              },
            }),
          ),
          headers: { 'content-type': 'application/json' },
          statusCode: 200,
        };
      },
    });
    try {
      await control.start();
      const first = await requestLocalProxy({
        control,
        headers: {
          authorization: AUTHORIZATION,
          [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(1),
        },
        host: API_HOST,
        path: `${LOOKUP_PATH}?externalId=${PLAYER_IDS[0]}`,
      });
      expect(first.statusCode).toBe(200);
      expect(upstreamCalls.map((call) => call.path)).toEqual([
        '/Account/Profile',
        `${LOOKUP_PATH}?externalId=${PLAYER_IDS[0]}`,
      ]);

      const drift = await requestLocalProxy({
        control,
        headers: {
          authorization: OTHER_AUTHORIZATION,
          [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(2),
        },
        host: API_HOST,
        path: `${LOOKUP_PATH}?externalId=${PLAYER_IDS[1]}`,
      });
      expect(drift).toMatchObject({ body: '{"status":"unavailable"}\n', statusCode: 502 });
      expect(upstreamCalls).toHaveLength(2);
      expect(completionReceiptPublisher).not.toHaveBeenCalled();

      const retry = await requestLocalProxy({
        control,
        headers: {
          authorization: AUTHORIZATION,
          [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(2),
        },
        host: API_HOST,
        path: `${LOOKUP_PATH}?externalId=${PLAYER_IDS[1]}`,
      });
      expect(retry.statusCode).toBe(404);
      expect(upstreamCalls).toHaveLength(2);
    } finally {
      await control.close();
    }
  });

  it('makes concurrent first lookup reservations sticky-fatal before either lookup is forwarded', async () => {
    const upstreamCalls: KemerBetReadinessLayer7UpstreamRequest[] = [];
    const completionReceiptPublisher = vi.fn(async () => undefined);
    let profileStarted = false;
    const control = createKemerBetReadinessLayer7Proxy({
      allowEphemeralTestPort: true,
      authorizationVerifier: authorizationVerifier(),
      captureNetworkTopology: async () => RELEASED_PROXY_TOPOLOGY,
      completionReceiptPublisher,
      effectiveGroupId: 10003,
      effectiveUserId: 10003,
      port: 0,
      sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
      upstream: async (input) => {
        const bootstrap = successfulBootstrapResponse(input);
        if (bootstrap !== null) return bootstrap;
        upstreamCalls.push(input);
        if (input.path !== KEMERBET_READINESS_AGENT_PROFILE_PATH) {
          throw new Error('No Player lookup may cross the proxy during a first-request race.');
        }
        profileStarted = true;
        return new Promise((_resolvePromise, rejectPromise) => {
          const reject = () => rejectPromise(new Error('aborted'));
          input.signal.addEventListener('abort', reject, { once: true });
          if (input.signal.aborted) reject();
        });
      },
    });
    try {
      await control.start();
      const first = requestLocalProxy({
        control,
        headers: {
          authorization: AUTHORIZATION,
          [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(1),
        },
        host: API_HOST,
        path: `${LOOKUP_PATH}?externalId=${PLAYER_IDS[0]}`,
      });
      await vi.waitFor(() => expect(profileStarted).toBe(true));
      const raced = await requestLocalProxy({
        control,
        headers: {
          authorization: AUTHORIZATION,
          [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(2),
        },
        host: API_HOST,
        path: `${LOOKUP_PATH}?externalId=${PLAYER_IDS[1]}`,
      });
      expect(raced.statusCode).toBe(404);
      await expect(first).resolves.toMatchObject({ statusCode: 502 });
      expect(upstreamCalls.map((call) => call.path)).toEqual(['/Account/Profile']);
      expect(completionReceiptPublisher).not.toHaveBeenCalled();
    } finally {
      await control.close();
    }
  });

  it('never publishes after non-200 or invalid/fabricated lookup JSON and stays terminal', async () => {
    for (const response of [
      { body: Buffer.from('{}'), statusCode: 200 },
      {
        body: Buffer.from(
          JSON.stringify({
            value: {
              currencyCode: 'USD',
              externalId: PLAYER_IDS[0],
              id: 1,
              userName: 'redacted@example.invalid',
            },
          }),
        ),
        statusCode: 200,
      },
      {
        body: Buffer.from(
          JSON.stringify({
            value: {
              currencyCode: 'ETB',
              externalId: PLAYER_IDS[0],
              id: 1,
              userName: 'redacted@example.invalid',
            },
          }),
        ),
        statusCode: 500,
      },
    ]) {
      const completionReceiptPublisher = vi.fn(async () => undefined);
      const control = createKemerBetReadinessLayer7Proxy({
        allowEphemeralTestPort: true,
        authorizationVerifier: authorizationVerifier(),
        sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
        captureNetworkTopology: async () => RELEASED_PROXY_TOPOLOGY,
        completionReceiptPublisher,
        effectiveGroupId: 10003,
        effectiveUserId: 10003,
        port: 0,
        upstream: async (input) => {
          const bootstrap = successfulBootstrapResponse(input);
          if (bootstrap !== null) return bootstrap;
          return input.path === KEMERBET_READINESS_AGENT_PROFILE_PATH
            ? {
                body: successfulAgentProfileBody(),
                headers: { 'content-encoding': 'identity' },
                statusCode: 200,
              }
            : { ...response, headers: {} };
        },
      });
      try {
        await control.start();
        const first = await requestLocalProxy({
          control,
          headers: {
            authorization: AUTHORIZATION,
            [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(1),
          },
          host: API_HOST,
          path: `${LOOKUP_PATH}?externalId=${PLAYER_IDS[0]}`,
        });
        expect(first.statusCode).toBe(502);
        const retry = await requestLocalProxy({
          control,
          headers: {
            authorization: AUTHORIZATION,
            [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(1),
          },
          host: API_HOST,
          path: `${LOOKUP_PATH}?externalId=${PLAYER_IDS[0]}`,
        });
        expect(retry.statusCode).toBe(404);
        expect(completionReceiptPublisher).not.toHaveBeenCalled();
      } finally {
        await control.close();
      }
    }
  });

  it('prefetches in fixed order before ready and serves repeated/concurrent bootstrap only from cache', async () => {
    const upstreamCalls: KemerBetReadinessLayer7UpstreamRequest[] = [];
    const readinessEvents: string[] = [];
    let topologyCaptures = 0;
    let releaseFirstPrefetch: () => void = () => undefined;
    let markFirstPrefetchObserved: () => void = () => undefined;
    const firstPrefetchObserved = new Promise<void>((resolvePromise) => {
      markFirstPrefetchObserved = resolvePromise;
    });
    const firstPrefetchRelease = new Promise<void>((resolvePromise) => {
      releaseFirstPrefetch = resolvePromise;
    });
    let firstPrefetch = true;
    let control!: KemerBetReadinessLayer7ProxyControl;
    control = createKemerBetReadinessLayer7Proxy({
      allowEphemeralTestPort: true,
      authorizationVerifier: authorizationVerifier(),
      sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
      captureNetworkTopology: async () => {
        topologyCaptures += 1;
        return RELEASED_PROXY_TOPOLOGY;
      },
      effectiveGroupId: 10003,
      effectiveUserId: 10003,
      port: 0,
      readinessSignal: {
        clear: async () => {
          readinessEvents.push('clear');
        },
        publish: async () => {
          expect(topologyCaptures).toBe(2);
          expect(control.health()).toEqual({ status: 'ready' });
          expect((control.address() as AddressInfo).port).toBeGreaterThan(0);
          readinessEvents.push('publish');
        },
      },
      upstream: async (input) => {
        upstreamCalls.push(input);
        const bootstrap = successfulBootstrapResponse(input);
        if (bootstrap !== null) {
          if (firstPrefetch) {
            firstPrefetch = false;
            markFirstPrefetchObserved();
            await firstPrefetchRelease;
          }
          return {
            ...bootstrap,
            headers: {
              'alt-svc': 'h3=":443"',
              connection: 'x-remove',
              'content-encoding': 'identity',
              'content-type': 'text/plain; charset=utf-8',
              'report-to': '{"group":"default"}',
              'set-cookie': 'untrusted=1',
              'x-remove': 'nominated',
            },
          };
        }
        if (input.path === KEMERBET_READINESS_AGENT_PROFILE_PATH) {
          return {
            body: successfulAgentProfileBody(),
            headers: { 'content-encoding': 'identity', 'content-type': 'application/json' },
            statusCode: 200,
          };
        }
        return {
          body: Buffer.from(
            JSON.stringify({
              value: {
                currencyCode: 'ETB',
                email: 'redacted@example.invalid',
                externalId: 'PLAYER-ALPHA',
                id: 123,
                userName: 'redacted@example.invalid',
              },
            }),
            'utf8',
          ),
          headers: { 'content-type': 'application/json' },
          statusCode: 200,
        };
      },
    });
    expect(control.health()).toEqual({ status: 'created' });
    try {
      const starting = control.start();
      await firstPrefetchObserved;
      expect(control.health()).toEqual({ status: 'starting' });
      expect(control.address()).toBeNull();
      expect(control.bootstrapCacheBytes()).toBe(0);
      expect(readinessEvents).toEqual(['clear']);
      releaseFirstPrefetch();
      await starting;

      expect(control.health()).toEqual({ status: 'ready' });
      expect(readinessEvents).toEqual(['clear', 'publish']);
      expect(topologyCaptures).toBe(2);
      expect((control.address() as AddressInfo).port).toBeGreaterThan(0);
      await emptyTcpHealthProbe(control);
      expect(control.health()).toEqual({ status: 'ready' });
      expect(upstreamCalls).toHaveLength(
        KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT.sequence.length,
      );
      expect(
        upstreamCalls.map(({ hostname, method, path }) => ({ hostname, method, path })),
      ).toEqual(
        KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT.sequence.map(
          ({ hostname, path }) => ({ hostname, method: 'GET', path }),
        ),
      );
      for (const [index, call] of upstreamCalls.entries()) {
        expect(call.headers.host).toBeUndefined();
        expect(call.headers.authorization).toBeUndefined();
        expect(call.headers['accept-encoding']).toBe('identity');
        expect(call.signal.aborted).toBe(false);
        if (index === 0) expect(call.headers['sec-fetch-dest']).toBe('document');
        else expect(['script', 'style']).toContain(call.headers['sec-fetch-dest']);
      }
      const bootstrapUpstreamCount = upstreamCalls.length;
      expect(control.bootstrapCacheBytes()).toBeGreaterThan(bootstrapUpstreamCount);

      const rejected = await requestLocalProxy({
        control,
        host: WEB_HOST,
        path: '/agents?unreviewed=1',
      });
      expect(rejected.statusCode).toBe(404);
      expect(rejected.body).toBe('{"status":"rejected"}\n');
      expect(upstreamCalls).toHaveLength(bootstrapUpstreamCount);

      const repeated = await Promise.all([
        requestLocalProxy({ control, host: WEB_HOST, path: '/agents' }),
        requestLocalProxy({ control, host: WEB_HOST, path: '/agents' }),
        ...KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS.map((path) =>
          requestLocalProxy({ control, host: ASSET_HOST, path }),
        ),
        requestLocalProxy({
          control,
          host: ASSET_HOST,
          path: KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS[0]!,
        }),
      ]);
      expect(repeated.every(({ statusCode }) => statusCode === 200)).toBe(true);
      expect(repeated[0]?.body).toBe(`prefetched:${WEB_HOST}/agents`);
      expect(repeated[0]?.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(repeated[2]?.headers['access-control-allow-origin']).toBe('*');
      expect(repeated[2]?.headers['content-type']).toBe(
        KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS[0]?.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'application/javascript; charset=utf-8',
      );
      for (const result of repeated) {
        expect(result.headers['alt-svc']).toBeUndefined();
        expect(result.headers['report-to']).toBeUndefined();
        expect(result.headers['set-cookie']).toBeUndefined();
        expect(result.headers['x-remove']).toBeUndefined();
      }
      expect(upstreamCalls).toHaveLength(bootstrapUpstreamCount);

      const lookupPath = `${LOOKUP_PATH}?externalId=PLAYER-ALPHA`;
      const localPreflight = await requestLocalProxy({
        control,
        headers: {
          'access-control-request-headers': 'authorization, content-type',
          'access-control-request-method': 'GET',
          origin: `https://${WEB_HOST}`,
        },
        host: API_HOST,
        method: 'OPTIONS',
        path: lookupPath,
      });
      expect(localPreflight.statusCode).toBe(204);
      expect(localPreflight.body).toBe('');
      expect(localPreflight.headers['access-control-allow-origin']).toBe(`https://${WEB_HOST}`);
      expect(localPreflight.headers['access-control-allow-methods']).toBe('GET');
      expect(localPreflight.headers['access-control-allow-headers']).toBe(
        'authorization, content-type',
      );
      expect(localPreflight.headers.vary).toBe(
        'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      );
      expect(upstreamCalls).toHaveLength(bootstrapUpstreamCount);

      const signedLookup = await requestLocalProxy({
        control,
        headers: {
          authorization: AUTHORIZATION,
          [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(1),
        },
        host: API_HOST,
        path: lookupPath,
      });
      expect(signedLookup.statusCode).toBe(200);
      expect(upstreamCalls).toHaveLength(bootstrapUpstreamCount + 2);
      expect(upstreamCalls[bootstrapUpstreamCount]).toMatchObject({
        headers: {
          accept: 'application/json',
          'accept-encoding': 'identity',
          authorization: AUTHORIZATION,
          'sec-fetch-site': 'cross-site',
        },
        hostname: API_HOST,
        method: 'GET',
        path: '/Account/Profile',
      });
      expect(Object.keys(upstreamCalls[bootstrapUpstreamCount]?.headers ?? {}).sort()).toEqual([
        'accept',
        'accept-encoding',
        'authorization',
        'origin',
        'referer',
        'sec-fetch-dest',
        'sec-fetch-mode',
        'sec-fetch-site',
        'user-agent',
      ]);
      expect(upstreamCalls[bootstrapUpstreamCount + 1]).toMatchObject({
        hostname: API_HOST,
        method: 'GET',
        path: lookupPath,
      });
      expect(
        upstreamCalls[bootstrapUpstreamCount + 1]?.headers[
          KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER
        ],
      ).toBeUndefined();
      expect(upstreamCalls[bootstrapUpstreamCount + 1]?.headers.authorization).toBe(AUTHORIZATION);
      expect(upstreamCalls[bootstrapUpstreamCount + 1]?.headers['sec-fetch-site']).toBe(
        'cross-site',
      );

      const replayedLookup = await requestLocalProxy({
        control,
        headers: {
          authorization: AUTHORIZATION,
          [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: lookupAuthorization(1),
        },
        host: API_HOST,
        path: lookupPath,
      });
      expect(replayedLookup.statusCode).toBe(404);
      expect(upstreamCalls).toHaveLength(bootstrapUpstreamCount + 2);
    } finally {
      expect(control.bootstrapCacheBytes()).toBeGreaterThan(0);
      await control.close();
    }
    expect(control.bootstrapCacheBytes()).toBe(0);
    expect(control.health()).toEqual({ status: 'stopped' });
    expect(readinessEvents).toEqual(['clear', 'publish', 'clear']);
  });

  it('fails startup and clears partial cache on redirect, encoding, per-entry, or aggregate overflow', async () => {
    const fiveMiB = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const scenarios = [
      {
        name: 'redirect',
        response: () => ({
          body: Buffer.from('redirect'),
          headers: { 'content-encoding': 'identity' },
          statusCode: 302,
        }),
      },
      {
        name: 'gzip',
        response: () => ({
          body: Buffer.from('compressed'),
          headers: { 'content-encoding': 'gzip' },
          statusCode: 200,
        }),
      },
      {
        name: 'per-entry overflow',
        response: () => ({
          body: Buffer.alloc(
            KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT.maximumEntryBytes + 1,
          ),
          headers: { 'content-encoding': 'identity' },
          statusCode: 200,
        }),
      },
      {
        name: 'aggregate overflow',
        response: () => ({
          body: fiveMiB,
          headers: { 'content-encoding': 'identity' },
          statusCode: 200,
        }),
      },
    ] as const;
    for (const scenario of scenarios) {
      let calls = 0;
      const readinessSignal = {
        clear: vi.fn(async () => undefined),
        publish: vi.fn(async () => undefined),
      };
      const control = createKemerBetReadinessLayer7Proxy({
        allowEphemeralTestPort: true,
        authorizationVerifier: authorizationVerifier(),
        sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
        captureNetworkTopology: async () => RELEASED_PROXY_TOPOLOGY,
        effectiveGroupId: 10003,
        effectiveUserId: 10003,
        port: 0,
        readinessSignal,
        upstream: async (input) => {
          const expected = KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT.sequence[calls];
          expect({ hostname: input.hostname, path: input.path }).toEqual(expected);
          calls += 1;
          return scenario.response();
        },
      });
      await expect(control.start(), scenario.name).rejects.toBeInstanceOf(
        KemerBetReadinessLayer7UnavailableError,
      );
      expect(control.health()).toEqual({ status: 'failed' });
      expect(control.address()).toBeNull();
      expect(control.bootstrapCacheBytes()).toBe(0);
      expect(readinessSignal.publish).not.toHaveBeenCalled();
      expect(readinessSignal.clear).toHaveBeenCalledTimes(2);
      if (scenario.name === 'aggregate overflow') expect(calls).toBe(7);
      else expect(calls).toBe(1);
      await control.close();
    }
    fiveMiB.fill(0);
  });

  it('fails closed when startup topology changes after bind', async () => {
    let capture = 0;
    const control = createKemerBetReadinessLayer7Proxy({
      allowEphemeralTestPort: true,
      authorizationVerifier: authorizationVerifier(),
      sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
      captureNetworkTopology: async () => {
        capture += 1;
        return capture === 1
          ? RELEASED_PROXY_TOPOLOGY
          : {
              defaultRouteInterfaceNames: ['eth0'],
              nonLoopbackInterfaceNames: ['eth0', 'eth1'],
            };
      },
      effectiveGroupId: 10003,
      effectiveUserId: 10003,
      port: 0,
      readinessSignal: {
        clear: vi.fn(async () => undefined),
        publish: vi.fn(async () => undefined),
      },
      upstream: async (input) => {
        const response = successfulBootstrapResponse(input);
        if (response === null) throw new Error('unexpected upstream request');
        return response;
      },
    });
    await expect(control.start()).rejects.toBeInstanceOf(KemerBetReadinessLayer7UnavailableError);
    expect(control.health()).toEqual({ status: 'failed' });
    expect(control.address()).toBeNull();
  });

  it('refuses a non-executor UID and non-production listen configuration', () => {
    expect(KEMERBET_READINESS_LAYER7_RUNTIME_CONTRACT).toEqual({
      command: ['node', 'apps/executor/dist/kemerbet-readiness-layer7-proxy.js'],
      environment: [],
      groupId: 10003,
      host: '0.0.0.0',
      port: 18443,
      outputRoot: '/run/output',
      readinessFile: '/tmp/fetanagent-kemerbet-readiness-layer7-proxy.ready',
      secretFiles: [
        '/run/secrets/kemerbet_readiness_proxy_hmac_key',
        '/run/secrets/kemerbet_readiness_proxy_run_nonce',
        '/run/secrets/kemerbet_readiness_release_sha',
        '/run/secrets/kemerbet_readiness_proxy_agent_identity_bindings',
        '/run/secrets/kemerbet_readiness_proxy_agent_identity_hmac_key',
      ],
      userId: 10003,
    });
    expect(() =>
      createKemerBetReadinessLayer7Proxy({
        authorizationVerifier: authorizationVerifier(),
        sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
        effectiveGroupId: 10003,
        effectiveUserId: 0,
      }),
    ).toThrow(KemerBetReadinessLayer7UnavailableError);
    expect(() =>
      createKemerBetReadinessLayer7Proxy({
        authorizationVerifier: authorizationVerifier(),
        sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
        effectiveGroupId: 0,
        effectiveUserId: 10003,
      }),
    ).toThrow(KemerBetReadinessLayer7UnavailableError);
    expect(() =>
      createKemerBetReadinessLayer7Proxy({
        authorizationVerifier: authorizationVerifier(),
        sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
        effectiveGroupId: 10003,
        effectiveUserId: 10003,
        host: '127.0.0.1',
      }),
    ).toThrow(KemerBetReadinessLayer7UnavailableError);
    expect(() =>
      createKemerBetReadinessLayer7Proxy({
        authorizationVerifier: authorizationVerifier(),
        sameAgentIdentityVerifier: sameAgentIdentityVerifier(),
        effectiveGroupId: 10003,
        effectiveUserId: 10003,
        port: 8443,
      }),
    ).toThrow(KemerBetReadinessLayer7UnavailableError);
  });
});
