export interface VerifiedOwnerSubject {
  readonly authUserId: string;
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
