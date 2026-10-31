export interface VerifiedOwnerSubject {
  readonly authUserId: string;
}

/** Read claims only after Supabase Auth has verified this exact bearer token. */
export function ownerSessionIdFromVerifiedToken(token: string, authUserId: string): string {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1] || parts[1].length > 8_192) {
      throw new Error('invalid token');
    }
    const value: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('invalid payload');
    }
    const claims = value as Record<string, unknown>;
    if (
      typeof claims.sub !== 'string' ||
      claims.sub.toLowerCase() !== authUserId ||
      typeof claims.session_id !== 'string' ||
      !UUID_PATTERN.test(claims.session_id)
    ) {
      throw new Error('invalid session');
    }
    return claims.session_id.toLowerCase();
  } catch {
    throw new OwnerAuthenticationRejectedError();
  }
}

export class OwnerAuthenticationRejectedError extends Error {
  constructor() {
    super('Owner authentication was rejected.');
    this.name = 'OwnerAuthenticationRejectedError';
  }
}

export class OwnerAuthenticationUnavailableError extends Error {
  constructor() {
    super('Owner authentication is unavailable.');
    this.name = 'OwnerAuthenticationUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function bearerTokenFromRawHeaders(rawHeaders: readonly string[]): string | undefined {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'authorization') {
      const value = rawHeaders[index + 1];
      if (value !== undefined) values.push(value);
    }
  }
  if (values.length !== 1) return undefined;
  const match = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/u.exec(values[0] ?? '');
  return match?.[1];
}

export async function verifyOwnerBearerToken(
  token: string,
  config: { readonly publishableKey: string; readonly supabaseUrl: string },
  fetchImplementation: typeof fetch = fetch,
): Promise<VerifiedOwnerSubject> {
  let response: Response;
  try {
    response = await fetchImplementation(new URL('/auth/v1/user', config.supabaseUrl), {
      method: 'GET',
      redirect: 'error',
      headers: {
        apikey: config.publishableKey,
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new OwnerAuthenticationUnavailableError();
  }
  if (response.status === 401 || response.status === 403) {
    throw new OwnerAuthenticationRejectedError();
  }
  if (!response.ok) throw new OwnerAuthenticationUnavailableError();

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OwnerAuthenticationUnavailableError();
  }
  const authUserId =
    typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string'
      ? body.id
      : undefined;
  if (!authUserId || !UUID_PATTERN.test(authUserId)) {
    throw new OwnerAuthenticationUnavailableError();
  }
  return { authUserId: authUserId.toLowerCase() };
}
