import { loadBotConfig, redactedBotConfigForLog } from '@payreplayy/config/bot';
import { message } from '@payreplayy/i18n';
import { Bot } from 'grammy';

import { handleTelegramBetaInviteMessage } from './telegram-beta-invite-admission.js';
import {
  deliverTelegramPrivateInboundWithRetry,
  toTelegramPrivateInboundEvent,
} from './telegram-ingress.js';

const config = loadBotConfig();

if (!config.telegram.enabled) {
  console.info(
    { config: redactedBotConfigForLog(config) },
    'Telegram bot is disabled; no polling will start in Stage 0.',
  );
  process.exit(0);
}

const bot = new Bot(config.telegram.token);

if (config.telegramBetaAdmission.enabled) {
  const betaAdmission = config.telegramBetaAdmission;
  bot.on('message', async (context) => {
    const outcome = await handleTelegramBetaInviteMessage(
      {
        updateId: context.update.update_id,
        chat: context.chat
          ? {
              id: context.chat.id,
              type: context.chat.type,
            }
          : undefined,
        from: context.from
          ? {
              id: context.from.id,
              isBot: context.from.is_bot,
            }
          : undefined,
        text: 'text' in context.message ? context.message.text : undefined,
      },
      betaAdmission,
      {
        reply: (text) => context.reply(text),
      },
    );

    if (outcome === 'unavailable') {
      console.warn(
        { invitePresented: true },
        'Telegram beta admission was unavailable; no customer action was started.',
      );
    }
  });
} else {
  if (!config.apiIngress.enabled) {
    throw new Error('An enabled Telegram bot requires its private API ingress configuration.');
  }
  const apiIngress = config.apiIngress;

  bot.on('message', async (context) => {
    const inbound = toTelegramPrivateInboundEvent({
      updateId: context.update.update_id,
      chat: context.chat
        ? {
            id: context.chat.id,
            type: context.chat.type,
          }
        : undefined,
      from: context.from
        ? {
            id: context.from.id,
            isBot: context.from.is_bot,
            firstName: context.from.first_name,
            lastName: context.from.last_name,
            username: context.from.username,
            languageCode: context.from.language_code,
          }
        : undefined,
    });
    if (!inbound) return;

    try {
      await deliverTelegramPrivateInboundWithRetry(inbound, apiIngress);
    } catch {
      console.warn(
        { updateId: inbound.updateId },
        'Private Telegram inbound delivery was unavailable; no customer action was started.',
      );
      await context.reply(message(inbound.preferredLocale, 'inboxUnavailable'));
      return;
    }

    await context.reply(message(inbound.preferredLocale, 'stageZero'));
  });
}

bot.catch((error) => {
  console.error(
    config.telegramBetaAdmission.enabled
      ? { betaAdmissionEnabled: true }
      : { updateId: error.ctx.update.update_id },
    'Telegram bot update failed without starting a customer action.',
  );
});

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

await bot.start({
  allowed_updates: ['message'],
  onStart: (botInfo) => {
    console.info(
      {
        username: botInfo.username,
        betaAdmissionEnabled: config.telegramBetaAdmission.enabled,
      },
      config.telegramBetaAdmission.enabled
        ? 'Telegram bot started in private beta admission mode.'
        : 'Telegram bot started in Stage 0 mode.',
    );
  },
});
