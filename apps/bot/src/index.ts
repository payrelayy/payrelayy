import { loadBotConfig, redactedBotConfigForLog } from '@fetanagent/config/bot';
import type { TelegramPrivateActionEnvelope } from '@fetanagent/contracts';
import { message } from '@fetanagent/i18n';
import { Bot, InlineKeyboard } from 'grammy';

import { handleTelegramBetaInviteMessage } from './telegram-beta-invite-admission.js';
import { runTelegramPolling } from './telegram-polling-lifecycle.js';
import { createTelegramPollingReadiness } from './telegram-polling-readiness.js';
import { handleTelegramSupportMessage, TELEGRAM_SUPPORT_HELP_TEXT } from './telegram-support.js';
import {
  isRecognizedTelegramDepositProofStatusCallback,
  isRecognizedTelegramDepositStatusCommand,
  isTelegramGuidedDepositStartCallback,
  isTelegramGuidedDepositStartCommand,
  isTelegramPrivateHelpCommand,
  reduceTelegramGuidedDepositProofSubmission,
  reduceTelegramDepositProofSubmission,
  reduceTelegramDepositProofStatusCallbackAction,
  reduceTelegramDepositStatusCommand,
  reduceTelegramPlayerIdTextAction,
  reduceTelegramPlayerRegistrationCallbackAction,
  reduceTelegramRootMenuAction,
} from './telegram-private-action.js';
import {
  TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT,
  TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
  TELEGRAM_GUIDED_DEPOSIT_SELECTION_TEXT,
} from './telegram-guided-deposit.js';
import { deliverTelegramPrivateActionWithRetry } from './telegram-private-action-client.js';
import {
  TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT,
  presentTelegramPlayerIdFlowResult,
  telegramDepositHelpText,
  telegramDepositReferenceSelectionText,
} from './telegram-player-id-flow.js';
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
const pollingReadiness = createTelegramPollingReadiness();
bot.api.config.use(pollingReadiness.transformer);
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
    await reply(
      action.kind === 'deposit_proof_status_command' || action.kind === 'deposit_status_command'
        ? TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT
        : action.kind === 'deposit_proof_command'
          ? message('en', 'depositUnavailable')
          : message('en', 'playerActionUnavailable'),
    );
  }
}

bot.on('message', async (context) => {
  const supportOutcome = await handleTelegramSupportMessage(
    {
      text: 'text' in context.message ? context.message.text : undefined,
      chat: context.chat ? { id: context.chat.id, type: context.chat.type } : undefined,
      from: context.from ? { id: context.from.id, isBot: context.from.is_bot } : undefined,
    },
    config.supportContactUrl,
    { reply: (text) => context.reply(text), botUsername: context.me.username },
  );
  if (supportOutcome === 'handled') return;

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
    if (isTelegramPrivateHelpCommand({ ...metadata, command: text })) {
      await context.reply(`${telegramDepositHelpText()}\n${TELEGRAM_SUPPORT_HELP_TEXT}`);
      return;
    }
    const rootAction = reduceTelegramRootMenuAction({ ...metadata, command: text });
    if (rootAction) {
      await deliverPlayerAction(rootAction, (replyText, keyboard) =>
        context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
      );
      return;
    }
    if (isTelegramGuidedDepositStartCommand({ ...metadata, command: text })) {
      await context.reply(TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT, {
        reply_markup: {
          force_reply: true,
          selective: true,
          input_field_placeholder: 'Player ID, then transaction number',
        },
      });
      return;
    }
    const guidedSubmission = reduceTelegramGuidedDepositProofSubmission({
      ...metadata,
      text,
      replyToMessage:
        'reply_to_message' in context.message ? context.message.reply_to_message : undefined,
    });
    if (guidedSubmission) {
      if (guidedSubmission.kind === 'action') {
        await deliverPlayerAction(guidedSubmission.action, (replyText, keyboard) =>
          context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
        );
      } else {
        await context.reply(
          guidedSubmission.kind === 'selection_required'
            ? TELEGRAM_GUIDED_DEPOSIT_SELECTION_TEXT
            : TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT,
        );
      }
      return;
    }
    const proofSubmission = reduceTelegramDepositProofSubmission({ ...metadata, command: text });
    if (proofSubmission) {
      if (proofSubmission.kind === 'action') {
        await deliverPlayerAction(proofSubmission.action, (replyText, keyboard) =>
          context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
        );
      } else {
        await context.reply(
          proofSubmission.kind === 'selection_required'
            ? telegramDepositReferenceSelectionText()
            : telegramDepositHelpText(),
        );
      }
      return;
    }
    const depositAction = reduceTelegramDepositStatusCommand({ ...metadata, command: text });
    if (depositAction) {
      await deliverPlayerAction(depositAction, (replyText, keyboard) =>
        context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
      );
      return;
    }
    if (isRecognizedTelegramDepositStatusCommand({ ...metadata, command: text })) {
      await context.reply(TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT);
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
    const callbackMetadata = {
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
    };
    const guidedDepositStart = isTelegramGuidedDepositStartCallback(callbackMetadata);
    const action =
      reduceTelegramDepositProofStatusCallbackAction(callbackMetadata) ??
      reduceTelegramPlayerRegistrationCallbackAction(callbackMetadata);
    await context.answerCallbackQuery();
    if (guidedDepositStart) {
      await context.reply(TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT, {
        reply_markup: {
          force_reply: true,
          selective: true,
          input_field_placeholder: 'Player ID, then transaction number',
        },
      });
      return;
    }
    if (!action) {
      if (isRecognizedTelegramDepositProofStatusCallback(callbackMetadata)) {
        await context.reply(TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT);
      }
      return;
    }
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
    'Telegram bot update handling failed; processing or reply delivery may be incomplete.',
  );
});

await runTelegramPolling(
  bot,
  {
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
  },
  { onShutdown: pollingReadiness.stop },
);
