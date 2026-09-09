import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BOT_PUBLIC_SUPPORT_CONTACT_URL, loadBotConfig, redactedBotConfigForLog } from './bot.js';

const temporaryDirectories: string[] = [];

describe('public bot support-contact configuration', () => {
  it.each([undefined, ''])('is optional without supplying a fake contact URL: %s', (value) => {
    const config = loadBotConfig({ NODE_ENV: 'test', BOT_SUPPORT_CONTACT_URL: value });
    expect(config.supportContactUrl).toBeUndefined();
    expect(redactedBotConfigForLog(config).supportContactConfigured).toBe(false);
  });

  it.each(['test', 'production'])('accepts only the public production URL in %s', (nodeEnv) => {
    const config = loadBotConfig({
      NODE_ENV: nodeEnv,
      BOT_SUPPORT_CONTACT_URL: BOT_PUBLIC_SUPPORT_CONTACT_URL,
    });
    expect(config.supportContactUrl).toBe(BOT_PUBLIC_SUPPORT_CONTACT_URL);
    expect(redactedBotConfigForLog(config).supportContactConfigured).toBe(true);
    expect(JSON.stringify(redactedBotConfigForLog(config))).not.toContain(
      BOT_PUBLIC_SUPPORT_CONTACT_URL,
    );
  });

  it.each([
    'http://owner.fetanagent.com/v1/public/support-contact',
    'https://owner.fetanagent.com.evil.example/v1/public/support-contact',
    'https://secret@owner.fetanagent.com/v1/public/support-contact',
    'https://owner.fetanagent.com:443/v1/public/support-contact',
    `${BOT_PUBLIC_SUPPORT_CONTACT_URL}/`,
    `${BOT_PUBLIC_SUPPORT_CONTACT_URL}?secret=private`,
    `${BOT_PUBLIC_SUPPORT_CONTACT_URL}#fragment`,
    ` ${BOT_PUBLIC_SUPPORT_CONTACT_URL}`,
    'http://127.0.0.1/',
  ])('rejects unapproved URLs without reflecting their values: %#', (value) => {
    expect(() => loadBotConfig({ NODE_ENV: 'test', BOT_SUPPORT_CONTACT_URL: value })).toThrow(
      'BOT_SUPPORT_CONTACT_URL must be the approved public support-contact URL.',
    );
  });
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function writeSecretFile(name: string, value: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'fetanagent-bot-config-'));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  writeFileSync(path, `${value}\n`, { encoding: 'utf8', mode: 0o400 });
  return path;
}

describe('Telegram beta admission bot configuration', () => {
  it('defaults the beta mode to disabled without reading its URL or secret', () => {
    const environment = new Proxy(
      { NODE_ENV: 'test', TELEGRAM_BOT_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (
            property === 'BOT_TO_BETA_ADMISSION_BASE_URL' ||
            property === 'BOT_TO_BETA_ADMISSION_HMAC_SECRET' ||
            property === 'BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE'
          ) {
            throw new Error(`disabled beta mode must not read ${String(property)}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadBotConfig(environment).telegramBetaAdmission).toEqual({
      enabled: false,
      baseUrl: undefined,
      transportHmacSecret: undefined,
    });
  });

  it('loads only the isolated beta transport and never reads historical ingress credentials', () => {
    const transportHmacSecret = 'b'.repeat(64);
    const environment = new Proxy(
      {
        NODE_ENV: 'test',
        TELEGRAM_BOT_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '123456:test-token',
        TELEGRAM_BETA_ADMISSION_ENABLED: 'true',
        BOT_TO_BETA_ADMISSION_BASE_URL: 'http://beta-admission:3001/',
        BOT_TO_BETA_ADMISSION_HMAC_SECRET: transportHmacSecret,
        INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'false',
      },
      {
        get(target, property, receiver) {
          if (
            property === 'BOT_TO_API_INGRESS_BASE_URL' ||
            property === 'BOT_TO_API_INGRESS_HMAC_SECRET' ||
            property === 'BOT_TO_API_ACTION_BASE_URL' ||
            property === 'BOT_TO_API_ACTION_HMAC_SECRET'
          ) {
            throw new Error(`beta mode must not read ${String(property)}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    const config = loadBotConfig(environment);
    expect(config.telegramBetaAdmission).toEqual({
      enabled: true,
      baseUrl: 'http://beta-admission:3001/',
      transportHmacSecret,
    });
    expect(config.apiIngress).toEqual({
      enabled: false,
      baseUrl: undefined,
      transportHmacSecret: undefined,
    });
    expect(config.telegramActionChannel).toEqual({
      enabled: false,
      baseUrl: undefined,
      transportHmacSecret: undefined,
    });

    const redacted = redactedBotConfigForLog(config);
    expect(redacted.telegramBetaAdmission).toEqual({
      enabled: true,
      secretsConfigured: true,
    });
    expect(JSON.stringify(redacted)).not.toContain(transportHmacSecret);
    expect(JSON.stringify(redacted)).not.toContain('123456:test-token');
  });

  it('requires polling and permits only the separate action channel alongside beta admission', () => {
    expect(() =>
      loadBotConfig({
        NODE_ENV: 'test',
        TELEGRAM_BOT_ENABLED: 'false',
        TELEGRAM_BETA_ADMISSION_ENABLED: 'true',
      }),
    ).toThrow('requires TELEGRAM_BOT_ENABLED=true');

    const config = loadBotConfig({
      NODE_ENV: 'test',
      TELEGRAM_BOT_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '123456:test-token',
      TELEGRAM_BETA_ADMISSION_ENABLED: 'true',
      BOT_TO_BETA_ADMISSION_BASE_URL: 'http://beta-admission:3001/',
      BOT_TO_BETA_ADMISSION_HMAC_SECRET: 'a'.repeat(64),
      INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true',
      BOT_TO_API_ACTION_BASE_URL: 'http://api:3000/',
      BOT_TO_API_ACTION_HMAC_SECRET: 'b'.repeat(64),
    });
    expect(config.apiIngress.enabled).toBe(false);
    expect(config.telegramBetaAdmission.enabled).toBe(true);
    expect(config.telegramActionChannel).toMatchObject({
      enabled: true,
      baseUrl: 'http://api:3000/',
    });
  });

  it('pins the production admission service to its private container origin', () => {
    const common = {
      NODE_ENV: 'production',
      TELEGRAM_BOT_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '123456:test-token',
      TELEGRAM_BETA_ADMISSION_ENABLED: 'true',
      BOT_TO_BETA_ADMISSION_HMAC_SECRET: 'b'.repeat(64),
    } as const;

    expect(() =>
      loadBotConfig({
        ...common,
        BOT_TO_BETA_ADMISSION_BASE_URL: 'https://beta-admission.example.test/',
      }),
    ).toThrow('private Docker beta-admission origin');
    expect(
      loadBotConfig({
        ...common,
        BOT_TO_BETA_ADMISSION_BASE_URL: 'http://beta-admission:3001/',
      }).telegramBetaAdmission,
    ).toMatchObject({ enabled: true, baseUrl: 'http://beta-admission:3001/' });
  });

  it('loads token and beta HMAC from separate private files without retaining file paths', () => {
    const token = '123456:file-token';
    const transportHmacSecret = 'c'.repeat(64);
    const tokenFile = writeSecretFile('telegram-token', token);
    const hmacFile = writeSecretFile('beta-hmac', transportHmacSecret);
    const config = loadBotConfig({
      NODE_ENV: 'test',
      TELEGRAM_BOT_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN_FILE: tokenFile,
      TELEGRAM_BETA_ADMISSION_ENABLED: 'true',
      BOT_TO_BETA_ADMISSION_BASE_URL: 'http://beta-admission:3001/',
      BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE: hmacFile,
    });

    expect(config.telegram).toEqual({ enabled: true, token });
    expect(config.telegramBetaAdmission).toMatchObject({
      enabled: true,
      transportHmacSecret,
    });
    expect(JSON.stringify(config)).not.toContain(tokenFile);
    expect(JSON.stringify(config)).not.toContain(hmacFile);
  });

  it('rejects direct-plus-file duplicates and unsafe production secret paths', () => {
    const tokenFile = writeSecretFile('telegram-token', '123456:file-token');
    const hmacFile = writeSecretFile('beta-hmac', 'c'.repeat(64));

    expect(() =>
      loadBotConfig({
        NODE_ENV: 'test',
        TELEGRAM_BOT_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '123456:direct-token',
        TELEGRAM_BOT_TOKEN_FILE: tokenFile,
      }),
    ).toThrow('TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_TOKEN_FILE are mutually exclusive');

    expect(() =>
      loadBotConfig({
        NODE_ENV: 'test',
        TELEGRAM_BOT_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '123456:direct-token',
        TELEGRAM_BETA_ADMISSION_ENABLED: 'true',
        BOT_TO_BETA_ADMISSION_BASE_URL: 'http://beta-admission:3001/',
        BOT_TO_BETA_ADMISSION_HMAC_SECRET: 'b'.repeat(64),
        BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE: hmacFile,
      }),
    ).toThrow(
      'BOT_TO_BETA_ADMISSION_HMAC_SECRET and BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE are mutually exclusive',
    );

    expect(() =>
      loadBotConfig({
        NODE_ENV: 'production',
        TELEGRAM_BOT_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN_FILE: tokenFile,
      }),
    ).toThrow('TELEGRAM_BOT_TOKEN_FILE must use the approved private runtime secret path');
  });

  it('rejects empty, embedded-newline, and extra-newline secret files', () => {
    for (const value of ['', 'first\nsecond', '123456:test-token\n']) {
      const tokenFile = writeSecretFile('malformed-token', value);
      expect(() =>
        loadBotConfig({
          NODE_ENV: 'test',
          TELEGRAM_BOT_ENABLED: 'true',
          TELEGRAM_BOT_TOKEN_FILE: tokenFile,
        }),
      ).toThrow('TELEGRAM_BOT_TOKEN_FILE must contain exactly one non-empty secret value');
    }
  });
});

describe('Telegram admission and action transport composition', () => {
  it.each([
    { betaAdmissionEnabled: false, actionChannelEnabled: false },
    { betaAdmissionEnabled: true, actionChannelEnabled: false },
    { betaAdmissionEnabled: false, actionChannelEnabled: true },
    { betaAdmissionEnabled: true, actionChannelEnabled: true },
  ])(
    'loads beta=$betaAdmissionEnabled and action=$actionChannelEnabled independently',
    ({ betaAdmissionEnabled, actionChannelEnabled }) => {
      const environment: NodeJS.ProcessEnv = {
        NODE_ENV: 'test',
        TELEGRAM_BOT_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '123456:test-token',
        TELEGRAM_BETA_ADMISSION_ENABLED: String(betaAdmissionEnabled),
        INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: String(actionChannelEnabled),
      };

      if (betaAdmissionEnabled) {
        environment.BOT_TO_BETA_ADMISSION_BASE_URL = 'http://beta-admission:3001/';
        environment.BOT_TO_BETA_ADMISSION_HMAC_SECRET = 'b'.repeat(64);
      } else {
        environment.BOT_TO_API_INGRESS_BASE_URL = 'http://api:3000/';
        environment.BOT_TO_API_INGRESS_HMAC_SECRET = 'a'.repeat(64);
      }
      if (actionChannelEnabled) {
        environment.BOT_TO_API_ACTION_BASE_URL = 'http://api:3000/';
        environment.BOT_TO_API_ACTION_HMAC_SECRET = 'c'.repeat(64);
      }

      const config = loadBotConfig(environment);
      expect(config.telegramBetaAdmission.enabled).toBe(betaAdmissionEnabled);
      expect(config.telegramActionChannel.enabled).toBe(actionChannelEnabled);
      expect(config.apiIngress.enabled).toBe(!betaAdmissionEnabled);
    },
  );
});
