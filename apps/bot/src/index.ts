import { loadBotConfig, redactedBotConfigForLog } from '@fetanagent/config/bot';
import type { TelegramPrivateActionEnvelope } from '@fetanagent/contracts';
import { message } from '@fetanagent/i18n';
import { Bot, InlineKeyboard } from 'grammy';

import { handleTelegramBetaInviteMessage } from './telegram-beta-invite-admission.js';
import {
  isRecognizedTelegramDepositCommand,
  reduceTelegramDepositProofCommand,
  reduceTelegramDepositStatusCommand,
  reduceTelegramPlayerIdTextAction,
  reduceTelegramPlayerRegistrationCallbackAction,
  reduceTelegramRootMenuAction,
} from './telegram-private-action.js';
import { deliverTelegramPrivateActionWithRetry } from './telegram-private-action-client.js';
import { presentTelegramPlayerIdFlowResult } from './telegram-player-id-flow.js';
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
const betaAdmission = config.telegramBetaAdmission;
const playerActions = config.telegramActionChannel;
const apiIngress = config.apiIngress;

async function deliverPlayerAction(
  action: TelegramPrivateActionEnvelope,
  reply: (text: string, keyboard?: InlineKeyboard) => Promise<unknown>,
): Promise<void> {
  if (!playerActions.enabled) return;
  try {
    const presentation = presentTelegramPlayerIdFlowResult(
      await deliverTelegramPrivateActionWithRetry(action, playerActions),
    );
    if (presentation.kind === 'message') {
      await reply(presentation.text);
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const button of presentation.menu.buttons) {
      keyboard.text(button.text, button.callbackData);
    }
    await reply(presentation.menu.text, keyboard);
  } catch {
    console.warn(
      { playerActionKind: action.kind },
      'Telegram Player-ID action delivery was unavailable.',
    );
    await reply(message('en', 'playerActionUnavailable'));
  }
}

bot.on('message', async (context) => {
  if (betaAdmission.enabled) {
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
    if (outcome !== 'ignored') return;
  }

  if (playerActions.enabled) {
    const metadata = {
      updateId: context.update.update_id,
      chat: context.chat ? { id: context.chat.id, type: context.chat.type } : undefined,
      from: context.from
        ? {
            id: context.from.id,
            isBot: context.from.is_bot,
            languageCode: context.from.language_code,
          }
        : undefined,
    };
    const text = 'text' in context.message ? context.message.text : undefined;
    const rootAction = reduceTelegramRootMenuAction({ ...metadata, command: text });
    if (rootAction) {
      await deliverPlayerAction(rootAction, (replyText, keyboard) =>
        context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
      );
      return;
    }
    const depositAction =
      reduceTelegramDepositProofCommand({ ...metadata, command: text }) ??
      reduceTelegramDepositStatusCommand({ ...metadata, command: text });
    if (depositAction) {
      await deliverPlayerAction(depositAction, (replyText, keyboard) =>
        context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
      );
      return;
    }
    if (isRecognizedTelegramDepositCommand({ ...metadata, command: text })) {
      await context.reply(message('en', 'depositInputInvalid'));
      return;
    }
    if (!(typeof text === 'string' && text.startsWith('/'))) {
      const playerIdAction = reduceTelegramPlayerIdTextAction({ ...metadata, text });
      if (playerIdAction) {
        await deliverPlayerAction(playerIdAction, (replyText, keyboard) =>
          context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
        );
        return;
      }
    }
  }

  if (!apiIngress.enabled) return;

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

if (playerActions.enabled) {
  bot.on('callback_query:data', async (context) => {
    const action = reduceTelegramPlayerRegistrationCallbackAction({
      updateId: context.update.update_id,
      chat: context.chat ? { id: context.chat.id, type: context.chat.type } : undefined,
      from: context.from
        ? {
            id: context.from.id,
            isBot: context.from.is_bot,
            languageCode: context.from.language_code,
          }
        : undefined,
      callbackData: context.callbackQuery.data,
    });
    await context.answerCallbackQuery();
    if (!action) return;
    await deliverPlayerAction(action, (replyText, keyboard) =>
      context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
    );
  });
}

bot.catch((error) => {
  console.error(
    {
      updateId: error.ctx.update.update_id,
      betaAdmissionEnabled: betaAdmission.enabled,
      playerActionsEnabled: playerActions.enabled,
    },
    'Telegram bot update failed without starting a customer action.',
  );
});

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

await bot.start({
  allowed_updates: playerActions.enabled ? ['message', 'callback_query'] : ['message'],
  onStart: (botInfo) => {
    console.info(
      {
        username: botInfo.username,
        betaAdmissionEnabled: config.telegramBetaAdmission.enabled,
        playerActionsEnabled: config.telegramActionChannel.enabled,
      },
      betaAdmission.enabled || playerActions.enabled
        ? 'Telegram bot started with configured private admission and action handlers.'
        : 'Telegram bot started in Stage 0 mode.',
    );
  },
});
