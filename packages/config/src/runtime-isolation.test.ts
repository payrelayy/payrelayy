import { describe, expect, it } from 'vitest';

import { loadApiConfig } from './api.js';
import { loadBotConfig, redactedBotConfigForLog } from './bot.js';
import { loadExecutorConfig } from './executor.js';
import { loadWorkerConfig } from './worker.js';

function environmentThatRejectsTelegramReads(): NodeJS.ProcessEnv {
  return new Proxy(
    {
      FINANCIAL_ACTIONS_MODE: 'dry_run',
      NODE_ENV: 'test',
    },
    {
      get(target, property, receiver) {
        if (property === 'TELEGRAM_BOT_ENABLED' || property === 'TELEGRAM_BOT_TOKEN') {
          throw new Error(`unexpected Telegram environment read: ${String(property)}`);
        }
        return Reflect.get(target, property, receiver);
      },
    },
  );
}

describe('runtime configuration isolation', () => {
  it('defaults API financial actions to dry-run mode', () => {
    expect(loadApiConfig({ NODE_ENV: 'test' }).financialActionsMode).toBe('dry_run');
  });

  it('refuses API live mode outside production', () => {
    expect(() => loadApiConfig({ NODE_ENV: 'test', FINANCIAL_ACTIONS_MODE: 'live' })).toThrow(
      'only when NODE_ENV=production',
    );
  });

  it('keeps Telegram configuration out of the API process', () => {
    const config = loadApiConfig(environmentThatRejectsTelegramReads());

    expect(config).not.toHaveProperty('telegram');
    expect(Object.keys(config)).not.toContain('telegram');
  });

  it('keeps Telegram configuration out of worker and executor processes', () => {
    const worker = loadWorkerConfig(environmentThatRejectsTelegramReads());
    const executor = loadExecutorConfig(environmentThatRejectsTelegramReads());

    expect(worker).not.toHaveProperty('telegram');
    expect(executor).not.toHaveProperty('telegram');
  });

  it('loads a Telegram token only for an enabled bot and never logs it', () => {
    const token = '123456:example-token-for-test-only';
    const config = loadBotConfig({
      NODE_ENV: 'test',
      TELEGRAM_BOT_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: token,
    });

    expect(config.telegram).toEqual({ enabled: true, token });
    expect(redactedBotConfigForLog(config)).toEqual({
      nodeEnv: 'test',
      logLevel: 'info',
      telegram: { enabled: true, tokenConfigured: true },
    });
    expect(JSON.stringify(redactedBotConfigForLog(config))).not.toContain(token);
  });

  it('does not read a Telegram token when bot polling is disabled', () => {
    const environment = new Proxy(
      { NODE_ENV: 'test', TELEGRAM_BOT_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (property === 'TELEGRAM_BOT_TOKEN') {
            throw new Error('disabled bot must not read TELEGRAM_BOT_TOKEN');
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadBotConfig(environment).telegram).toEqual({ enabled: false, token: undefined });
  });

  it('requires a token before an enabled bot can start', () => {
    expect(() => loadBotConfig({ NODE_ENV: 'test', TELEGRAM_BOT_ENABLED: 'true' })).toThrow(
      'TELEGRAM_BOT_TOKEN is required',
    );
  });
});
