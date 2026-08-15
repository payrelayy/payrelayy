import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type {
  CustomerWebAuthPort,
  CustomerWebAuthRequestContext,
  CustomerWebAuthResponseHeaderName,
  CustomerWebCookiePort,
  CustomerWebRequestCookie,
  CustomerWebResponseCookie,
} from '@fetanagent/customer-web-auth-runtime';
import type {
  CustomerWorkspaceDisplayStatus,
  CustomerWorkspaceRegistration,
  CustomerWorkspaceRuntime,
} from '@fetanagent/customer-web-workspace-runtime';
import Fastify, { LogController, type FastifyReply, type FastifyRequest } from 'fastify';

import {
  createAccountPage,
  forgotPasswordPage,
  genericErrorPage,
  homePage,
  offlinePage,
  signInPage,
  updatePasswordPage,
  workspacePage,
} from './pages.js';

const DEFAULT_PUBLIC_ORIGIN = 'https://fetanagent.com';
const CSRF_COOKIE_NAME = '__Host-fetanagent-csrf';
const RECOVERY_COOKIE_NAME = '__Host-fetanagent-recovery';
const CSRF_MAX_AGE_SECONDS = 30 * 60;
const RECOVERY_MAX_AGE_SECONDS = 10 * 60;
const DEFAULT_BODY_LIMIT = 8 * 1024;
const DEFAULT_RATE_LIMIT_MAX = 8;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_BUCKETS = 5_000;

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const NO_STORE = 'private, no-store, max-age=0, must-revalidate';
const PUBLIC_CONTENT_POLICY =
  "default-src 'none'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; manifest-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'; upgrade-insecure-requests";

const SECURITY_HEADERS = {
  'content-security-policy': PUBLIC_CONTENT_POLICY,
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'origin-agent-cluster': '?1',
  'permissions-policy':
    'accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;

const NO_STORE_PATHS = new Set([
  '/',
  '/create-account',
  '/sign-in',
  '/sign-out',
  '/forgot-password',
  '/auth/recovery',
  '/update-password',
  '/workspace',
  '/player-ids',
]);

const MUTATION_PATHS = new Set([
  '/create-account',
  '/sign-in',
  '/sign-out',
  '/forgot-password',
  '/update-password',
  '/player-ids',
]);

const RATE_LIMITED_ROUTES = new Set([
  ...[...MUTATION_PATHS].map((path) => `POST ${path}`),
  'GET /auth/recovery',
]);

const publicDirectory = new URL('../public/', import.meta.url);
const publicAssets = {
  css: readFileSync(new URL('app.v1.css', publicDirectory), 'utf8'),
  manifest: readFileSync(new URL('manifest.webmanifest', publicDirectory), 'utf8'),
  mark: readFileSync(new URL('mark.v1.svg', publicDirectory), 'utf8'),
  mark192: readFileSync(new URL('mark-192.v1.png', publicDirectory)),
  mark512: readFileSync(new URL('mark-512.v1.png', publicDirectory)),
  markMaskable192: readFileSync(new URL('mark-maskable-192.v1.png', publicDirectory)),
  markMaskable512: readFileSync(new URL('mark-maskable-512.v1.png', publicDirectory)),
  registerServiceWorker: readFileSync(new URL('register-sw.v1.js', publicDirectory), 'utf8'),
  serviceWorker: readFileSync(new URL('service-worker.v1.js', publicDirectory), 'utf8'),
} as const;

export interface CustomerWebRateLimitOptions {
  readonly maxRequests: number;
  readonly windowMs: number;
}

export interface CustomerWebAppOptions {
  readonly auth: CustomerWebAuthPort;
  readonly csrfTokenFactory?: () => string;
  readonly now?: () => number;
  readonly publicOrigin?: string;
  readonly rateLimit?: CustomerWebRateLimitOptions;
  readonly requestKeyFactory?: () => string;
  readonly workspace: CustomerWorkspaceRuntime;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

type FormBody = Readonly<Record<string, string>>;

function exactOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (
    parsed.protocol !== 'https:' ||
    parsed.origin !== origin ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new Error('Customer web public origin must be one exact HTTPS origin.');
  }
  return origin;
}

function responsePath(request: FastifyRequest): string {
  return request.url.split('?', 1)[0] ?? '/';
}

function appendHeader(reply: FastifyReply, name: string, value: string): void {
  const existing = reply.getHeader(name);
  if (existing === undefined) {
    reply.header(name, value);
    return;
  }
  const values = Array.isArray(existing) ? existing.map(String) : [String(existing)];
  reply.removeHeader(name);
  reply.header(name, [...values, value]);
}

function appendSetCookie(reply: FastifyReply, value: string): void {
  reply.header('set-cookie', value);
}

function appendVaryCookie(reply: FastifyReply): void {
  const existing = reply.getHeader('vary');
  const values = (Array.isArray(existing) ? existing : existing === undefined ? [] : [existing])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === 'cookie')) values.push('Cookie');
  reply.header('vary', values.join(', '));
}

function parseRequestCookies(rawHeader: string | undefined): readonly CustomerWebRequestCookie[] {
  if (rawHeader === undefined || rawHeader === '') return [];
  if (rawHeader.length > 8 * 1024) return [{ name: '', value: '' }];

  return rawHeader.split(';').map((rawPart) => {
    const part = rawPart.trimStart();
    const separator = part.indexOf('=');
    if (separator <= 0) return { name: '', value: '' };
    return {
      name: part.slice(0, separator).trimEnd(),
      value: part.slice(separator + 1),
    };
  });
}

function serializedResponseCookie(cookie: CustomerWebResponseCookie): string {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(cookie.name)) throw new Error();
  if (/[\u0000-\u001f\u007f;,]/u.test(cookie.value)) throw new Error();
  if (cookie.maxAge !== undefined && (!Number.isSafeInteger(cookie.maxAge) || cookie.maxAge < 0)) {
    throw new Error();
  }
  if (cookie.expires !== undefined && Number.isNaN(cookie.expires.getTime())) throw new Error();

  const attributes = [
    `${cookie.name}=${cookie.value}`,
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (cookie.maxAge !== undefined) attributes.push(`Max-Age=${cookie.maxAge}`);
  if (cookie.expires !== undefined) attributes.push(`Expires=${cookie.expires.toUTCString()}`);
  return attributes.join('; ');
}

function authContext(request: FastifyRequest, reply: FastifyReply): CustomerWebAuthRequestContext {
  const requestCookies = parseRequestCookies(request.headers.cookie);
  const cookies: CustomerWebCookiePort = {
    readAll(): readonly CustomerWebRequestCookie[] {
      return requestCookies;
    },
    appendSetCookie(cookie: CustomerWebResponseCookie): void {
      appendSetCookie(reply, serializedResponseCookie(cookie));
    },
    appendResponseHeader(name: CustomerWebAuthResponseHeaderName, value: string): void {
      if (/\r|\n/u.test(value)) throw new Error();
      appendHeader(reply, name, value);
    },
  };
  return { cookies };
}

function newCsrfToken(factory: (() => string) | undefined): string {
  const token = factory?.() ?? randomBytes(32).toString('base64url');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new Error('Invalid CSRF token factory output.');
  return token;
}

function issueCsrfCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  factory: (() => string) | undefined,
): string {
  const existing = csrfTokenFromCookies(request);
  if (existing !== undefined) return existing;

  const token = newCsrfToken(factory);
  appendSetCookie(
    reply,
    `${CSRF_COOKIE_NAME}=${token}; Path=/; Max-Age=${CSRF_MAX_AGE_SECONDS}; Secure; HttpOnly; SameSite=Strict`,
  );
  return token;
}

function csrfTokenFromCookies(request: FastifyRequest): string | undefined {
  const matches = parseRequestCookies(request.headers.cookie).filter(
    (cookie) => cookie.name === CSRF_COOKIE_NAME,
  );
  const token = matches.length === 1 ? matches[0]?.value : undefined;
  return token !== undefined && /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : undefined;
}

function recoveryCodeFromCookies(request: FastifyRequest): string | undefined {
  const matches = parseRequestCookies(request.headers.cookie).filter(
    (cookie) => cookie.name === RECOVERY_COOKIE_NAME,
  );
  const code = matches.length === 1 ? matches[0]?.value : undefined;
  return validRecoveryCode(code) ? code : undefined;
}

function issueRecoveryCookie(reply: FastifyReply, code: string): void {
  appendSetCookie(
    reply,
    `${RECOVERY_COOKIE_NAME}=${code}; Path=/; Max-Age=${RECOVERY_MAX_AGE_SECONDS}; Secure; HttpOnly; SameSite=Lax`,
  );
}

function clearRecoveryCookie(reply: FastifyReply): void {
  appendSetCookie(
    reply,
    `${RECOVERY_COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax`,
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isFormContentType(request: FastifyRequest): boolean {
  const contentType = request.headers['content-type'];
  return (
    typeof contentType === 'string' &&
    contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/x-www-form-urlencoded'
  );
}

function isExactFormBody(value: unknown): value is FormBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((field) => typeof field === 'string');
}

function exactForm(value: unknown, keys: readonly string[]): FormBody | undefined {
  if (!isExactFormBody(value)) return undefined;
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
    ? value
    : undefined;
}

function validMutationRequest(request: FastifyRequest, publicOrigin: string): boolean {
  if (request.headers.origin !== publicOrigin) return false;
  if (request.headers['sec-fetch-site'] !== 'same-origin') return false;
  if (!isFormContentType(request)) return false;
  if (!isExactFormBody(request.body)) return false;

  const submittedToken = request.body._csrf;
  const cookieToken = csrfTokenFromCookies(request);
  return (
    typeof submittedToken === 'string' &&
    typeof cookieToken === 'string' &&
    /^[A-Za-z0-9_-]{43}$/u.test(submittedToken) &&
    /^[A-Za-z0-9_-]{43}$/u.test(cookieToken) &&
    constantTimeEqual(submittedToken, cookieToken)
  );
}

function normalizedEmail(value: string | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email !== undefined &&
    email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) &&
    !/[\u0000-\u001f\u007f]/u.test(email)
    ? email
    : undefined;
}

function validPassword(value: string | undefined): value is string {
  return value !== undefined && value.length >= 12 && value.length <= 128 && !value.includes('\0');
}

function validRecoveryCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= 2048 &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

function validRequestKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  );
}

function newRequestKey(factory: (() => string) | undefined): string {
  const requestKey = factory?.() ?? randomUUID();
  if (!validRequestKey(requestKey)) throw new Error('Invalid request-key factory output.');
  return requestKey;
}

function validPlayerId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= 64 &&
    /^[^\s\u0000-\u001f\u007f]+$/u.test(value)
  );
}

function validDisplayStatus(value: unknown): value is CustomerWorkspaceDisplayStatus {
  return value === 'checking' || value === 'ready' || value === 'needs_attention';
}

function safeRegistrations(value: unknown): readonly CustomerWorkspaceRegistration[] | undefined {
  if (!Array.isArray(value) || value.length > 20) return undefined;
  try {
    return Object.freeze(
      value.map((registration) => {
        if (
          typeof registration !== 'object' ||
          registration === null ||
          Array.isArray(registration)
        ) {
          throw new Error();
        }
        const record = registration as Record<string, unknown>;
        if (
          Object.keys(record).sort().join(',') !== 'playerId,status' ||
          !validPlayerId(record.playerId) ||
          !validDisplayStatus(record.status)
        ) {
          throw new Error();
        }
        return Object.freeze({ playerId: record.playerId, status: record.status });
      }),
    );
  } catch {
    return undefined;
  }
}

function html(reply: FastifyReply, statusCode: number, body: string): FastifyReply {
  return reply.code(statusCode).type(HTML_CONTENT_TYPE).send(body);
}

function redirect(reply: FastifyReply, location: string): FastifyReply {
  return reply.code(303).header('location', location).send();
}

function validRateLimitOptions(options: CustomerWebRateLimitOptions): CustomerWebRateLimitOptions {
  if (
    !Number.isSafeInteger(options.maxRequests) ||
    options.maxRequests < 1 ||
    options.maxRequests > 1_000 ||
    !Number.isSafeInteger(options.windowMs) ||
    options.windowMs < 1_000 ||
    options.windowMs > 60 * 60 * 1_000
  ) {
    throw new Error('Customer web rate-limit options are invalid.');
  }
  return options;
}

export function buildCustomerWebApp(options: CustomerWebAppOptions) {
  const publicOrigin = exactOrigin(options.publicOrigin ?? DEFAULT_PUBLIC_ORIGIN);
  const now = options.now ?? Date.now;
  const rateLimit = validRateLimitOptions(
    options.rateLimit ?? {
      maxRequests: DEFAULT_RATE_LIMIT_MAX,
      windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
    },
  );
  const rateLimitBuckets = new Map<string, RateLimitBucket>();

  const app = Fastify({
    bodyLimit: DEFAULT_BODY_LIMIT,
    logController: new LogController({ disableRequestLogging: true }),
    logger: false,
    trustProxy: false,
  });

  app.addHook('onClose', async () => {
    await options.workspace.close();
  });

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, rawBody, done) => {
      try {
        const form = Object.create(null) as Record<string, string>;
        const parameters = new URLSearchParams(
          typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'),
        );
        for (const [key, value] of parameters) {
          if (key === '' || Object.hasOwn(form, key)) throw new Error();
          form[key] = value;
        }
        done(null, form);
      } catch {
        done(Object.assign(new Error('Invalid form request.'), { statusCode: 400 }), undefined);
      }
    },
  );

  app.addHook('onSend', async (request, reply, payload) => {
    reply.headers(SECURITY_HEADERS);
    const path = responsePath(request);
    if (request.method !== 'GET' || NO_STORE_PATHS.has(path)) {
      reply.header('cache-control', NO_STORE).header('pragma', 'no-cache').header('expires', '0');
      appendVaryCookie(reply);
    } else if (!reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-cache, max-age=0');
    }
    return payload;
  });

  app.addHook('preHandler', async (request, reply) => {
    const routeUrl = request.routeOptions.url ?? '';
    if (request.method === 'POST' && MUTATION_PATHS.has(routeUrl)) {
      if (!validMutationRequest(request, publicOrigin)) {
        return html(reply, 400, genericErrorPage(400));
      }
    }

    const routeKey = `${request.method} ${routeUrl}`;
    if (RATE_LIMITED_ROUTES.has(routeKey)) {
      const key = `${request.ip}\u0000${routeKey}`;
      const timestamp = now();
      let bucket = rateLimitBuckets.get(key);
      if (!bucket || timestamp >= bucket.resetAt) {
        if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) {
          const oldest = rateLimitBuckets.keys().next().value as string | undefined;
          if (oldest !== undefined) rateLimitBuckets.delete(oldest);
        }
        bucket = { count: 0, resetAt: timestamp + rateLimit.windowMs };
        rateLimitBuckets.set(key, bucket);
      }
      if (bucket.count >= rateLimit.maxRequests) {
        const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1_000));
        return html(reply.header('retry-after', String(retryAfter)), 429, genericErrorPage(429));
      }
      bucket.count += 1;
    }
  });

  app.get('/healthz', async (_request, reply) => reply.send({ status: 'ok' }));
  app.get('/readyz', async (_request, reply) => {
    try {
      return (await options.workspace.ready())
        ? reply.send({ status: 'ready' })
        : reply.code(503).send({ status: 'unavailable' });
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.get('/', async (request, reply) => {
    try {
      const customer = await options.auth.getCurrentCustomer(authContext(request, reply));
      if (!customer.ok) return html(reply, 503, genericErrorPage(503));
      return customer.status === 'authenticated'
        ? redirect(reply, '/workspace')
        : html(reply, 200, homePage());
    } catch {
      return html(reply, 503, genericErrorPage(503));
    }
  });
  app.get('/offline', async (_request, reply) => html(reply, 200, offlinePage()));

  app.get('/assets/app.v1.css', async (_request, reply) =>
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .type('text/css; charset=utf-8')
      .send(publicAssets.css),
  );
  app.get('/assets/mark.v1.svg', async (_request, reply) =>
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .type('image/svg+xml; charset=utf-8')
      .send(publicAssets.mark),
  );
  app.get('/assets/mark-192.v1.png', async (_request, reply) =>
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .type('image/png')
      .send(publicAssets.mark192),
  );
  app.get('/assets/mark-512.v1.png', async (_request, reply) =>
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .type('image/png')
      .send(publicAssets.mark512),
  );
  app.get('/assets/mark-maskable-192.v1.png', async (_request, reply) =>
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .type('image/png')
      .send(publicAssets.markMaskable192),
  );
  app.get('/assets/mark-maskable-512.v1.png', async (_request, reply) =>
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .type('image/png')
      .send(publicAssets.markMaskable512),
  );
  app.get('/assets/register-sw.v1.js', async (_request, reply) =>
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .type('text/javascript; charset=utf-8')
      .send(publicAssets.registerServiceWorker),
  );
  app.get('/manifest.webmanifest', async (_request, reply) =>
    reply
      .header('cache-control', 'public, max-age=3600')
      .type('application/manifest+json; charset=utf-8')
      .send(publicAssets.manifest),
  );
  app.get('/service-worker.v1.js', async (_request, reply) =>
    reply
      .header('cache-control', 'no-cache, max-age=0')
      .header('service-worker-allowed', '/')
      .type('text/javascript; charset=utf-8')
      .send(publicAssets.serviceWorker),
  );

  app.get('/create-account', async (request, reply) => {
    try {
      const customer = await options.auth.getCurrentCustomer(authContext(request, reply));
      if (!customer.ok) return html(reply, 503, genericErrorPage(503));
      return customer.status === 'authenticated'
        ? redirect(reply, '/workspace')
        : html(
            reply,
            200,
            createAccountPage(issueCsrfCookie(request, reply, options.csrfTokenFactory)),
          );
    } catch {
      return html(reply, 503, genericErrorPage(503));
    }
  });
  app.post('/create-account', async (request, reply) => {
    const form = exactForm(request.body, ['_csrf', 'email', 'password']);
    const email = normalizedEmail(form?.email);
    const password = form?.password;
    if (!form || !email || !validPassword(password)) {
      return html(
        reply,
        400,
        createAccountPage(issueCsrfCookie(request, reply, options.csrfTokenFactory), {
          kind: 'error',
          message: 'We could not complete that request. Check the details and try again.',
        }),
      );
    }

    try {
      const result = await options.auth.signUpWithEmailPassword(authContext(request, reply), {
        email,
        password,
      });
      return result.ok ? redirect(reply, '/workspace') : html(reply, 400, genericErrorPage(400));
    } catch {
      return html(reply, 503, genericErrorPage(503));
    }
  });

  app.get('/sign-in', async (request, reply) => {
    try {
      const customer = await options.auth.getCurrentCustomer(authContext(request, reply));
      if (!customer.ok) return html(reply, 503, genericErrorPage(503));
      if (customer.status === 'authenticated') return redirect(reply, '/workspace');
      const query = request.query as Record<string, unknown>;
      const signedOut = Object.keys(query).length === 1 && query['signed-out'] === '1';
      return html(
        reply,
        200,
        signInPage(
          issueCsrfCookie(request, reply, options.csrfTokenFactory),
          signedOut ? { kind: 'info', message: 'You are signed out.' } : undefined,
        ),
      );
    } catch {
      return html(reply, 503, genericErrorPage(503));
    }
  });
  app.post('/sign-in', async (request, reply) => {
    const form = exactForm(request.body, ['_csrf', 'email', 'password']);
    const email = normalizedEmail(form?.email);
    const password = form?.password;
    if (!form || !email || !validPassword(password)) {
      return html(reply, 400, genericErrorPage(400));
    }

    try {
      const result = await options.auth.signInWithEmailPassword(authContext(request, reply), {
        email,
        password,
      });
      return result.ok ? redirect(reply, '/workspace') : html(reply, 400, genericErrorPage(400));
    } catch {
      return html(reply, 503, genericErrorPage(503));
    }
  });

  app.get('/forgot-password', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const sent = Object.keys(query).length === 1 && query.sent === '1';
    return html(
      reply,
      200,
      forgotPasswordPage(
        issueCsrfCookie(request, reply, options.csrfTokenFactory),
        sent
          ? {
              kind: 'info',
              message: 'If the account can use that address, recovery instructions are on the way.',
            }
          : undefined,
      ),
    );
  });
  app.post('/forgot-password', async (request, reply) => {
    const form = exactForm(request.body, ['_csrf', 'email']);
    const email = normalizedEmail(form?.email);
    if (!form || !email) return html(reply, 400, genericErrorPage(400));

    try {
      await options.auth.requestPasswordRecovery(authContext(request, reply), { email });
      return redirect(reply, '/forgot-password?sent=1');
    } catch {
      return redirect(reply, '/forgot-password?sent=1');
    }
  });

  app.get('/auth/recovery', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const code = query.code;
    if (Object.keys(query).length !== 1 || !validRecoveryCode(code)) {
      return redirect(reply, '/forgot-password');
    }
    issueRecoveryCookie(reply, code);
    return redirect(reply, '/update-password');
  });

  app.get('/update-password', async (request, reply) => {
    if (!recoveryCodeFromCookies(request)) return redirect(reply, '/forgot-password');
    return html(
      reply,
      200,
      updatePasswordPage(issueCsrfCookie(request, reply, options.csrfTokenFactory)),
    );
  });
  app.post('/update-password', async (request, reply) => {
    const form = exactForm(request.body, ['_csrf', 'password']);
    const password = form?.password;
    const code = recoveryCodeFromCookies(request);
    if (!form || !validPassword(password) || !code) {
      clearRecoveryCookie(reply);
      return html(reply, 400, genericErrorPage(400));
    }

    try {
      const result = await options.auth.completePasswordRecovery(authContext(request, reply), {
        code,
        password,
      });
      clearRecoveryCookie(reply);
      return result.ok ? redirect(reply, '/workspace') : html(reply, 400, genericErrorPage(400));
    } catch {
      clearRecoveryCookie(reply);
      return html(reply, 503, genericErrorPage(503));
    }
  });

  app.get('/workspace', async (request, reply) => {
    try {
      const customer = await options.auth.getCurrentCustomer(authContext(request, reply));
      if (!customer.ok) return html(reply, 503, genericErrorPage(503));
      if (customer.status === 'anonymous') return redirect(reply, '/sign-in');
      const ensured = await options.workspace.ensureAccount({
        authUserId: customer.account.authUserId,
      });
      if (!ensured.ok || ensured.status !== 'active') {
        return html(reply, 503, genericErrorPage(503));
      }
      const listed = await options.workspace.listPlayerRegistrations({
        authUserId: customer.account.authUserId,
        limit: 20,
      });
      if (!listed.ok) return html(reply, 503, genericErrorPage(503));
      const registrations = safeRegistrations(listed.registrations);
      if (!registrations) return html(reply, 503, genericErrorPage(503));
      const query = request.query as Record<string, unknown>;
      const submitted = Object.keys(query).length === 1 && query.submitted === '1';
      return html(
        reply,
        200,
        workspacePage(
          customer.account.email,
          issueCsrfCookie(request, reply, options.csrfTokenFactory),
          newRequestKey(options.requestKeyFactory),
          registrations,
          submitted ? { kind: 'info', message: 'Your Player ID request was received.' } : undefined,
        ),
      );
    } catch {
      return html(reply, 503, genericErrorPage(503));
    }
  });

  app.post('/player-ids', async (request, reply) => {
    const form = exactForm(request.body, ['_csrf', 'playerId', 'requestKey']);
    const playerId = form?.playerId;
    const requestKey = form?.requestKey;
    if (!form || !validPlayerId(playerId) || !validRequestKey(requestKey)) {
      return html(reply, 400, genericErrorPage(400));
    }

    try {
      const customer = await options.auth.getCurrentCustomer(authContext(request, reply));
      if (!customer.ok) return html(reply, 503, genericErrorPage(503));
      if (customer.status === 'anonymous') return redirect(reply, '/sign-in');
      const ensured = await options.workspace.ensureAccount({
        authUserId: customer.account.authUserId,
      });
      if (!ensured.ok || ensured.status !== 'active') {
        return html(reply, 503, genericErrorPage(503));
      }
      const submitted = await options.workspace.submitPlayerRegistration({
        authUserId: customer.account.authUserId,
        playerId,
        requestKey,
      });
      if (
        !submitted.ok ||
        submitted.registration.playerId !== playerId ||
        !validDisplayStatus(submitted.registration.status)
      ) {
        return html(reply, 503, genericErrorPage(503));
      }
      return redirect(reply, '/workspace?submitted=1');
    } catch {
      return html(reply, 503, genericErrorPage(503));
    }
  });

  app.post('/sign-out', async (request, reply) => {
    try {
      const result = await options.auth.signOut(authContext(request, reply));
      return result.ok
        ? redirect(reply, '/sign-in?signed-out=1')
        : html(reply, 400, genericErrorPage(400));
    } catch {
      return html(reply, 503, genericErrorPage(503));
    }
  });

  app.setNotFoundHandler(async (_request, reply) => html(reply, 404, genericErrorPage(404)));
  app.setErrorHandler((error, _request, reply) => {
    const candidateStatusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined;
    const statusCode =
      candidateStatusCode === 413
        ? 413
        : candidateStatusCode !== undefined &&
            candidateStatusCode >= 400 &&
            candidateStatusCode < 500
          ? 400
          : 503;
    return html(reply, statusCode, genericErrorPage(statusCode));
  });

  return app;
}
