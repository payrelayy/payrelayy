import { describe, expect, it } from 'vitest';

import { loadWindowsCompanionConfig, redactedWindowsCompanionConfig } from './config.js';

describe('Windows companion configuration', () => {
  it('accepts an explicit absolute data directory and redacts it from logs', () => {
    const config = loadWindowsCompanionConfig({
      NODE_ENV: 'test',
      FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
      FETANAGENT_COMPANION_RELEASE_SHA: 'a'.repeat(40),
      FETANAGENT_COMPANION_EXPECTED_AGENT_IDENTITY: 'owner-agent@example.invalid',
    });
    expect(config.profileRoot).toContain('profiles');
    const redacted = JSON.stringify(redactedWindowsCompanionConfig(config));
    expect(redacted).not.toContain('FetanAgent Companion Test');
    expect(redacted).not.toContain('owner-agent@example.invalid');
    expect(redacted).toContain('expectedAgentIdentityProvided');
    expect(redacted).toContain('a'.repeat(40));
    expect(config.takeExpectedAgentIdentity()).toBe('owner-agent@example.invalid');
    expect(config.takeExpectedAgentIdentity()).toBeUndefined();
  });

  it('rejects relative paths, control characters, and unreviewed release identities', () => {
    for (const dataRoot of ['relative', `D:\\bad\u0000path`]) {
      expect(() =>
        loadWindowsCompanionConfig({
          NODE_ENV: 'test',
          FETANAGENT_COMPANION_DATA_ROOT: dataRoot,
        }),
      ).toThrow();
    }
    expect(() =>
      loadWindowsCompanionConfig({
        NODE_ENV: 'test',
        FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
        FETANAGENT_COMPANION_RELEASE_SHA: 'main',
      }),
    ).toThrow();
    for (const identity of ['', ' padded ', `bad\nidentity`, 'x'.repeat(257)]) {
      expect(() =>
        loadWindowsCompanionConfig({
          NODE_ENV: 'test',
          FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
          FETANAGENT_COMPANION_EXPECTED_AGENT_IDENTITY: identity,
        }),
      ).toThrow();
    }
  });
});
