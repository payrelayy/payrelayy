import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WindowsCurrentUserDataProtector } from './windows-data-protection.js';
import {
  LocalKemerBetIdentityVerificationError,
  verifyLocalKemerBetIdentity,
  type LocalIdentityLocator,
  type LocalIdentityPage,
} from './local-kemerbet-identity.js';

const AGENTS_URL = 'https://agentsystem.admindigi.com/agents';
const IDENTITY_ROOT = '.rt--header-actions-content:has(.rt--header-actions-name)';
const IDENTITY_VALUE = '.rt--header-actions-name';
const CAPTCHA = 'iframe[src*="recaptcha"][src*="/bframe"]';
const SIGN_IN_FORM = 'form.ant-form:has(input#userName):has(input#password[type="password"])';
const RAW_IDENTITY = 'owner-agent@example.invalid';

interface FakeNode {
  readonly children?: Readonly<Record<string, readonly FakeNode[]>>;
  readonly text?: string;
  readonly visible: boolean;
}

class FakeLocator implements LocalIdentityLocator {
  constructor(private readonly nodes: readonly FakeNode[]) {}

  async count(): Promise<number> {
    return this.nodes.length;
  }

  async innerText(): Promise<string> {
    return this.nodes[0]?.text ?? '';
  }

  async isVisible(): Promise<boolean> {
    return this.nodes[0]?.visible ?? false;
  }

  locator(selector: string): LocalIdentityLocator {
    return new FakeLocator(this.nodes.flatMap((node) => node.children?.[selector] ?? []));
  }

  nth(index: number): LocalIdentityLocator {
    const node = this.nodes[index];
    return new FakeLocator(node === undefined ? [] : [node]);
  }
}

class FakePage implements LocalIdentityPage {
  constructor(
    private readonly currentUrl: string,
    private readonly locators: Readonly<Record<string, readonly FakeNode[]>>,
  ) {}

  locator(selector: string): LocalIdentityLocator {
    return new FakeLocator(this.locators[selector] ?? []);
  }

  url(): string {
    return this.currentUrl;
  }
}

const protector: WindowsCurrentUserDataProtector = {
  protect: async (cleartext) => Buffer.concat([Buffer.from([0xa5]), cleartext]),
  unprotect: async (ciphertext) => {
    if (ciphertext[0] !== 0xa5) throw new Error('invalid protected value');
    return Buffer.from(ciphertext.subarray(1));
  },
};

function page(
  identity = RAW_IDENTITY,
  overrides: {
    readonly captchaVisible?: boolean;
    readonly duplicateIdentityRoot?: boolean;
    readonly signInVisible?: boolean;
    readonly url?: string;
  } = {},
): LocalIdentityPage {
  const value: FakeNode = { text: identity, visible: true };
  const root: FakeNode = { children: { [IDENTITY_VALUE]: [value] }, visible: true };
  return new FakePage(overrides.url ?? AGENTS_URL, {
    [CAPTCHA]: overrides.captchaVisible ? [{ visible: true }] : [],
    [IDENTITY_ROOT]: overrides.duplicateIdentityRoot ? [root, root] : [root],
    [SIGN_IN_FORM]: overrides.signInVisible ? [{ visible: true }] : [],
  });
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fetanagent-companion-identity-'));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe('local KemerBet identity verification', () => {
  it('creates one redacted current-user-protected binding, then verifies it without raw identity input', async () => {
    const first = await verifyLocalKemerBetIdentity({
      dataRoot: root,
      expectedAgentIdentity: RAW_IDENTITY,
      now: () => new Date('2026-09-04T13:00:00.000Z'),
      page: page(),
      protector,
      releaseSha: 'a'.repeat(40),
    });
    expect(first).toEqual({
      bindingCreated: true,
      identityVerified: true,
      identifiersRedacted: true,
      transferDisabled: true,
    });

    const binding = await readFile(join(root, 'identity', 'kemerbet-primary.binding.json'), 'utf8');
    expect(binding).not.toContain(RAW_IDENTITY);
    expect(binding).not.toContain('password');
    expect(binding).toContain('windows-dpapi-current-user');
    expect(binding).toMatch(/"identityFingerprint":"hmac-sha256:[0-9a-f]{64}"/u);

    await expect(
      verifyLocalKemerBetIdentity({
        dataRoot: root,
        page: page(),
        protector,
        releaseSha: 'b'.repeat(40),
      }),
    ).resolves.toEqual({
      bindingCreated: false,
      identityVerified: true,
      identifiersRedacted: true,
      transferDisabled: true,
    });
  });

  it('requires explicit first-use identity confirmation and fails closed on later identity drift', async () => {
    await expect(
      verifyLocalKemerBetIdentity({
        dataRoot: root,
        page: page(),
        protector,
        releaseSha: 'a'.repeat(40),
      }),
    ).rejects.toMatchObject({ code: 'FETANAGENT_IDENTITY_CONFIRMATION_REQUIRED' });

    await verifyLocalKemerBetIdentity({
      dataRoot: root,
      expectedAgentIdentity: RAW_IDENTITY,
      page: page(),
      protector,
      releaseSha: 'a'.repeat(40),
    });
    await expect(
      verifyLocalKemerBetIdentity({
        dataRoot: root,
        page: page('another-agent@example.invalid'),
        protector,
        releaseSha: 'b'.repeat(40),
      }),
    ).rejects.toMatchObject({ code: 'FETANAGENT_IDENTITY_MISMATCH' });
  });

  it.each([
    ['typed identity mismatch', page(), 'wrong-agent@example.invalid'],
    [
      'duplicate visible identity roots',
      page(RAW_IDENTITY, { duplicateIdentityRoot: true }),
      RAW_IDENTITY,
    ],
    ['visible sign-in form', page(RAW_IDENTITY, { signInVisible: true }), RAW_IDENTITY],
    ['visible CAPTCHA', page(RAW_IDENTITY, { captchaVisible: true }), RAW_IDENTITY],
    [
      'unexpected route',
      page(RAW_IDENTITY, { url: 'https://agentsystem.admindigi.com/login' }),
      RAW_IDENTITY,
    ],
  ])('rejects %s without creating a binding', async (_label, candidatePage, expectedIdentity) => {
    await expect(
      verifyLocalKemerBetIdentity({
        dataRoot: root,
        expectedAgentIdentity: expectedIdentity,
        page: candidatePage,
        protector,
        releaseSha: 'a'.repeat(40),
      }),
    ).rejects.toBeInstanceOf(LocalKemerBetIdentityVerificationError);
    await expect(
      readFile(join(root, 'identity', 'kemerbet-primary.binding.json')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
