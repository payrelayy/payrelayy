import { describe, expect, it } from 'vitest';

import {
  KEMERBET_READINESS_BROWSER_FIREWALL_RELEASE_FILE,
  KEMERBET_READINESS_CONTROLLER_FIREWALL_RELEASE_FILE,
  KEMERBET_READINESS_FIREWALL_RELEASE_CONTENT,
  KemerBetReadinessFirewallReleaseUnavailableError,
  waitForKemerBetReadinessFirewallRelease,
} from './kemerbet-readiness-firewall-release.js';

function missing(): Error & { code: string } {
  return Object.assign(new Error('missing'), { code: 'ENOENT' });
}

function fixture(initialContent = '') {
  let descriptorContent = initialContent;
  let pathContent = initialContent;
  let descriptorInode = 2;
  let pathInode = 2;
  const stat = (inode: number, content: string) => ({
    dev: 1,
    gid: 0,
    ino: inode,
    mode: 0o100444,
    nlink: 1,
    size: Buffer.byteLength(content),
    uid: 0,
    isFile: () => true,
    isSymbolicLink: () => false,
  });
  const fileSystem = {
    lstat: async (path: string) => {
      if (path === KEMERBET_READINESS_BROWSER_FIREWALL_RELEASE_FILE) throw missing();
      return stat(pathInode, pathContent);
    },
    open: async (path: string) => {
      if (path !== KEMERBET_READINESS_CONTROLLER_FIREWALL_RELEASE_FILE) throw missing();
      return {
        close: async () => undefined,
        read: async (buffer: Buffer, offset: number, length: number) => {
          const source = Buffer.from(descriptorContent);
          const bytesRead = source.copy(buffer, offset, 0, length);
          source.fill(0);
          return { buffer, bytesRead };
        },
        stat: async () => stat(descriptorInode, descriptorContent),
      } as never;
    },
    realpath: async (path: string) => path,
  };
  return {
    fileSystem,
    publish(content = KEMERBET_READINESS_FIREWALL_RELEASE_CONTENT) {
      descriptorContent = content;
      pathContent = content;
    },
    replace(content = KEMERBET_READINESS_FIREWALL_RELEASE_CONTENT) {
      pathInode = 3;
      pathContent = content;
    },
    replaceDescriptor() {
      descriptorInode = 4;
    },
  };
}

describe('KemerBet readiness firewall release', () => {
  it('waits on the same root-owned inode until the host publishes the exact release', async () => {
    const test = fixture();
    let pauses = 0;
    await expect(
      waitForKemerBetReadinessFirewallRelease({
        fileSystem: test.fileSystem,
        now: () => pauses * 50,
        pause: async () => {
          pauses += 1;
          test.publish();
        },
        role: 'controller',
      }),
    ).resolves.toBeUndefined();
    expect(pauses).toBe(1);
  });

  it('rejects malformed released content', async () => {
    const malformed = 'x'.repeat(Buffer.byteLength(KEMERBET_READINESS_FIREWALL_RELEASE_CONTENT));
    await expect(
      waitForKemerBetReadinessFirewallRelease({
        fileSystem: fixture(malformed).fileSystem,
        role: 'controller',
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessFirewallReleaseUnavailableError);
  });

  it('rejects replacement of the mounted release inode', async () => {
    const test = fixture();
    await expect(
      waitForKemerBetReadinessFirewallRelease({
        fileSystem: test.fileSystem,
        now: () => 0,
        pause: async () => test.replace(),
        role: 'controller',
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessFirewallReleaseUnavailableError);
  });

  it('rejects a missing release file', async () => {
    const test = fixture();
    await expect(
      waitForKemerBetReadinessFirewallRelease({
        fileSystem: {
          ...test.fileSystem,
          open: async () => {
            throw missing();
          },
        },
        role: 'controller',
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessFirewallReleaseUnavailableError);
  });

  it('fails closed at the bounded timeout when no release is published', async () => {
    const test = fixture();
    let current = 0;
    await expect(
      waitForKemerBetReadinessFirewallRelease({
        fileSystem: test.fileSystem,
        now: () => {
          current += 500;
          return current;
        },
        pause: async () => undefined,
        pollIntervalMs: 10,
        role: 'controller',
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessFirewallReleaseUnavailableError);
  });

  it('rejects exposure of the other role release file', async () => {
    const test = fixture(KEMERBET_READINESS_FIREWALL_RELEASE_CONTENT);
    await expect(
      waitForKemerBetReadinessFirewallRelease({
        fileSystem: {
          ...test.fileSystem,
          lstat: async (path: string) => {
            if (path === KEMERBET_READINESS_BROWSER_FIREWALL_RELEASE_FILE) {
              return {
                dev: 1,
                gid: 0,
                ino: 9,
                mode: 0o100444,
                nlink: 1,
                size: 0,
                uid: 0,
                isFile: () => true,
                isSymbolicLink: () => false,
              };
            }
            return test.fileSystem.lstat(path);
          },
        },
        role: 'controller',
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessFirewallReleaseUnavailableError);
  });
});
