import {
  KEMERBET_AGENT_API_ORIGIN,
  KEMERBET_AGENT_PLAYER_LOOKUP_PATH,
  KEMERBET_AGENT_WEB_ORIGIN,
} from '@fetanagent/agent-platform-kemerbet';

const KEMERBET_LOGIN_PATH = '/Account/Login';
const KEMERBET_REFRESH_PATH = '/Account/RefreshToken';
const KEMERBET_DEPOSIT_PATH = '/Wallet/PlayerEPOSDeposit';
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REVIEWED_API_READ_PATHS = new Set([
  '/Account/Info',
  '/Account/Currencies',
  '/SystemLanguage/SystemAvailablePublished',
  '/SystemLanguage/AvailablePublished',
]);
const OVERRIDE_QUERY_NAMES = new Set([
  '_method',
  'method',
  'action',
  'operation',
  'command',
  'amount',
  'amountminor',
  'deposit',
  'withdraw',
  'transfer',
  'credit',
  'commission',
]);

/** Classify by host first so alternate transports cannot escape into outside_provider. */
export function isLocalKemerBetProviderUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.+$/u, '');
  return host === 'agentsystem.admindigi.com' || host === 'admin-api.agt-digi.com';
}

export type LocalKemerBetGuardPhase = 'manual_login' | 'signed_in_read_only';
export type LocalKemerBetRequestDecision =
  | {
      readonly action: 'allow';
      readonly reason:
        | 'outside_provider'
        | 'provider_read'
        | 'exact_login'
        | 'exact_refresh'
        | 'exact_lookup'
        | 'exact_lookup_preflight';
    }
  | {
      readonly action: 'abort';
      readonly reason:
        | 'invalid_url'
        | 'credentialed_url'
        | 'provider_mutation'
        | 'provider_unknown_method'
        | 'invalid_transport'
        | 'unsafe_path'
        | 'unsafe_query'
        | 'unreviewed_read'
        | 'transfer_endpoint';
    };

/**
 * Fail-closed request policy for the local enrollment browser. It deliberately knows only the
 * exact login POST and read methods. No Amount, Transfer, deposit, withdrawal, or generic provider
 * mutation can pass this boundary.
 */
export function decideLocalKemerBetRequest(
  methodCandidate: string,
  rawUrl: string,
  phase: LocalKemerBetGuardPhase,
  approvedLookupPlayerId?: string,
): LocalKemerBetRequestDecision {
  const method = methodCandidate.toUpperCase();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { action: 'abort', reason: 'invalid_url' };
  }
  if (url.username !== '' || url.password !== '') {
    return { action: 'abort', reason: 'credentialed_url' };
  }
  if (!isLocalKemerBetProviderUrl(url)) {
    return { action: 'allow', reason: 'outside_provider' };
  }
  if (url.origin !== KEMERBET_AGENT_WEB_ORIGIN && url.origin !== KEMERBET_AGENT_API_ORIGIN) {
    return { action: 'abort', reason: 'invalid_transport' };
  }
  if (url.hash !== '' || /[%\\;]|\/\//u.test(url.pathname)) {
    return { action: 'abort', reason: 'unsafe_path' };
  }
  if (
    [...url.searchParams.keys()].some(
      (key) => key.includes('%') || OVERRIDE_QUERY_NAMES.has(key.toLowerCase()),
    )
  ) {
    return { action: 'abort', reason: 'unsafe_query' };
  }
  if (
    url.pathname.toLowerCase() === KEMERBET_DEPOSIT_PATH.toLowerCase() ||
    /\/(?:wallet|deposit|withdraw|transfer|credit|commission)(?:\/|$)/iu.test(url.pathname)
  ) {
    return { action: 'abort', reason: 'transfer_endpoint' };
  }
  const exactSessionMutation =
    (url.pathname === KEMERBET_LOGIN_PATH || url.pathname === KEMERBET_REFRESH_PATH) &&
    url.search === '';
  if (READ_METHODS.has(method)) {
    if (url.origin === KEMERBET_AGENT_WEB_ORIGIN) {
      return { action: 'allow', reason: 'provider_read' };
    }
    const query = [...url.searchParams.entries()];
    const infoQuery =
      url.pathname === '/Account/Info' &&
      query.length === 1 &&
      query[0]?.[0] === 'languageCode' &&
      /^[A-Za-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/u.test(query[0]?.[1] ?? '');
    const exactLookup =
      (method === 'GET' || method === 'OPTIONS') &&
      phase === 'signed_in_read_only' &&
      typeof approvedLookupPlayerId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(approvedLookupPlayerId) &&
      url.pathname === KEMERBET_AGENT_PLAYER_LOOKUP_PATH &&
      query.length === 1 &&
      query[0]?.[0] === 'externalId' &&
      query[0]?.[1] === approvedLookupPlayerId;
    if (url.origin === KEMERBET_AGENT_API_ORIGIN && exactLookup) {
      return {
        action: 'allow',
        reason: method === 'GET' ? 'exact_lookup' : 'exact_lookup_preflight',
      };
    }
    const reviewedRead =
      REVIEWED_API_READ_PATHS.has(url.pathname) && (url.search === '' || infoQuery);
    if (reviewedRead || (method === 'OPTIONS' && exactSessionMutation)) {
      return { action: 'allow', reason: 'provider_read' };
    }
    return { action: 'abort', reason: 'unreviewed_read' };
  }
  if (
    url.origin === KEMERBET_AGENT_API_ORIGIN &&
    url.pathname === KEMERBET_REFRESH_PATH &&
    url.search === '' &&
    url.hash === '' &&
    method === 'POST'
  ) {
    // KemerBet uses this non-financial request to keep an authenticated browser session alive.
    // The payload stays on the owner's device and is never inspected or logged by this policy.
    return { action: 'allow', reason: 'exact_refresh' };
  }
  if (
    phase === 'manual_login' &&
    url.origin === KEMERBET_AGENT_API_ORIGIN &&
    url.pathname === KEMERBET_LOGIN_PATH &&
    url.search === '' &&
    url.hash === '' &&
    method === 'POST'
  ) {
    return { action: 'allow', reason: 'exact_login' };
  }
  if (MUTATION_METHODS.has(method)) return { action: 'abort', reason: 'provider_mutation' };
  return { action: 'abort', reason: 'provider_unknown_method' };
}
