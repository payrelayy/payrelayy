import { loadBotConfig, redactedBotConfigForLog } from '@fetanagent/config/bot';
import type { TelegramPrivateActionEnvelope } from '@fetanagent/contracts';
import { message } from '@fetanagent/i18n';
import { Bot, InlineKeyboard } from 'grammy';

import {
  extractTelegramProofMediaText,
  selectTelegramProofMedia,
} from './telegram-deposit-media.js';
import { runTelegramDepositOutcomeNotifier } from './telegram-deposit-outcome-notifier.js';
import { recordTelegramPaymentInstruction } from './telegram-payment-instruction-expiry.js';
import {
  cancelTelegramTemporaryMessage,
  startTelegramTemporaryMessage,
  TELEGRAM_TEMPORARY_MEDIA_TEXT,
  TELEGRAM_TEMPORARY_PAYMENT_TEXT,
  type TelegramTemporaryMessageHandle,
} from './telegram-deposit-temporary-message.js';
import { runTelegramPolling } from './telegram-polling-lifecycle.js';
import { createTelegramPollingReadiness } from './telegram-polling-readiness.js';
import { handleTelegramSupportMessage, TELEGRAM_SUPPORT_HELP_TEXT } from './telegram-support.js';
import {
  isRecognizedTelegramDepositProofStatusCallback,
  isRecognizedTelegramDepositStatusCommand,
  isTelegramGuidedDepositStartCallback,
  isTelegramGuidedDepositStartCommand,
  isTelegramSavedPlayerChangeCallback,
  isCbeBirrReceiptText,
  isTelegramPrivateHelpCommand,
  reduceTelegramGuidedDepositDestinationSubmission,
  reduceTelegramGuidedDepositMediaSubmission,
  reduceTelegramGuidedDepositProofSubmission,
  reduceTelegramSavedTelebirrDestinationAction,
  reduceTelegramSavedCbeSmsMediaSubmission,
  reduceTelegramSavedCbeSmsProofSubmission,
  reduceTelegramSavedTelebirrMediaSubmission,
  reduceTelegramSavedTelebirrProofSubmission,
  reduceTelegramDepositProofSubmission,
  reduceTelegramCbeBirrDryRunCommand,
  reduceTelegramDepositProofStatusCallbackAction,
  reduceTelegramDepositStatusCommand,
  reduceTelegramPlayerIdTextAction,
  reduceTelegramPlayerRegistrationCallbackAction,
  reduceTelegramRootMenuAction,
} from './telegram-private-action.js';
import {
  TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT,
  TELEGRAM_GUIDED_DEPOSIT_PLAYER_INVALID_TEXT,
  TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
  TELEGRAM_GUIDED_DEPOSIT_SELECTION_TEXT,
  TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
  TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA,
  parseTelegramTelebirrPaymentPromptReply,
} from './telegram-guided-deposit.js';
import { deliverTelegramPrivateActionWithRetry } from './telegram-private-action-client.js';
import { renderTelegramQuickMenu, type PrivateTelegramMenuButton } from './private-menu.js';
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
const telegramToken = config.telegram.token;
const pollingReadiness = createTelegramPollingReadiness();
bot.api.config.use(pollingReadiness.transformer);
const playerActions = config.telegramActionChannel;
const apiIngress = config.apiIngress;
const quickMenu = renderTelegramQuickMenu();

function inlineMenu(buttons: readonly PrivateTelegramMenuButton[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const [index, button] of buttons.entries()) {
    if (index > 0) keyboard.row();
    keyboard.text(button.text, button.callbackData);
  }
  return keyboard;
}

const temporaryMessageDependencies = {
  request: (action: TelegramPrivateActionEnvelope) => {
    if (!playerActions.enabled) throw new Error('Telegram player actions are disabled.');
    return deliverTelegramPrivateActionWithRetry(action, playerActions);
  },
  send: (chatId: number, text: string) => bot.api.sendMessage(chatId, text),
  delete: (chatId: number, messageId: number) => bot.api.deleteMessage(chatId, messageId),
};

async function deliverPlayerAction(
  action: TelegramPrivateActionEnvelope,
  reply: (
    text: string,
    keyboard?: InlineKeyboard,
    forceReplyPlaceholder?: string,
  ) => Promise<unknown>,
  temporaryAttempt?: { readonly handle: TelegramTemporaryMessageHandle | undefined },
): Promise<void> {
  if (!playerActions.enabled) return;
  const temporary =
    temporaryAttempt?.handle ??
    (temporaryAttempt === undefined &&
    !config.receiverSmsCandidateEnabled &&
    (action.kind === 'saved_telebirr_proof_command' ||
      (action.kind === 'deposit_proof_command' && action.providerCode === 'telebirr'))
      ? await startTelegramTemporaryMessage(
          temporaryMessageDependencies,
          action.updateId,
          action.privateChatId,
          TELEGRAM_TEMPORARY_PAYMENT_TEXT,
        )
      : undefined);
  try {
    const result = await deliverTelegramPrivateActionWithRetry(action, playerActions);
    const presentation = presentTelegramPlayerIdFlowResult(
      result,
      action.kind === 'telebirr_deposit_destination_command' ||
        action.kind === 'cbe_birr_dry_run_instruction_command'
        ? {
            selectedPlayerId: action.playerId,
            playerValidationEnabled: config.playerValidationIntakeEnabled,
          }
        : { playerValidationEnabled: config.playerValidationIntakeEnabled },
    );
    if (presentation.kind === 'deferred') {
      // SMS review results are delivered through the durable outcome queue.
      // Remove the media-reading notice once that result has been queued.
      if (config.receiverSmsCandidateEnabled) {
        await cancelTelegramTemporaryMessage(temporaryMessageDependencies, temporary);
      }
      return;
    }
    await cancelTelegramTemporaryMessage(temporaryMessageDependencies, temporary);
    if (presentation.kind === 'message') {
      await reply(presentation.text);
      return;
    }
    if (presentation.kind === 'force_reply') {
      const sent = await reply(presentation.text, undefined, presentation.placeholder);
      if (
        result.outcome === 'telebirr_deposit_destination' &&
        (action.kind === 'saved_telebirr_destination_command' ||
          action.kind === 'telebirr_deposit_destination_command')
      ) {
        const messageId =
          typeof sent === 'object' && sent !== null && 'message_id' in sent
            ? sent.message_id
            : undefined;
        const recorded =
          typeof messageId === 'number' &&
          (await recordTelegramPaymentInstruction(
            temporaryMessageDependencies,
            action.updateId,
            action.privateChatId,
            messageId,
          ));
        if (!recorded) {
          console.warn('Telegram payment instruction could not be tracked for expiry.');
          await reply(message('en', 'depositUnavailable'));
        }
      }
      return;
    }
    await reply(presentation.menu.text, inlineMenu(presentation.menu.buttons));
  } catch {
    await cancelTelegramTemporaryMessage(temporaryMessageDependencies, temporary);
    console.warn(
      { playerActionKind: action.kind },
      'Telegram Player-ID action delivery was unavailable.',
    );
    await reply(
      action.kind === 'deposit_proof_status_command' || action.kind === 'deposit_status_command'
        ? TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT
        : action.kind === 'deposit_proof_command' ||
            action.kind === 'saved_telebirr_proof_command' ||
            action.kind === 'saved_receiver_sms_proof_command' ||
            action.kind === 'saved_telebirr_destination_command' ||
            action.kind === 'telebirr_deposit_destination_command' ||
            action.kind === 'cbe_birr_dry_run_instruction_command' ||
            action.kind === 'cbe_birr_bound_dry_run_proof_command'
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
    const replyToMessage =
      'reply_to_message' in context.message ? context.message.reply_to_message : undefined;
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
      const action = reduceTelegramSavedTelebirrDestinationAction(metadata);
      if (action)
        await deliverPlayerAction(action, (replyText, keyboard, placeholder) =>
          context.reply(
            replyText,
            placeholder
              ? {
                  reply_markup: {
                    force_reply: true,
                    selective: true,
                    input_field_placeholder: placeholder,
                  },
                }
              : keyboard
                ? { reply_markup: keyboard }
                : undefined,
          ),
        );
      return;
    }
    const destinationSubmission = reduceTelegramGuidedDepositDestinationSubmission({
      ...metadata,
      text,
      replyToMessage,
      playerValidationEnabled: config.playerValidationIntakeEnabled,
    });
    if (destinationSubmission) {
      if (destinationSubmission.kind === 'action') {
        await deliverPlayerAction(
          destinationSubmission.action,
          (replyText, keyboard, forceReplyPlaceholder) =>
            context.reply(
              replyText,
              forceReplyPlaceholder
                ? {
                    reply_markup: {
                      force_reply: true,
                      selective: true,
                      input_field_placeholder: forceReplyPlaceholder,
                    },
                  }
                : keyboard
                  ? { reply_markup: keyboard }
                  : undefined,
            ),
        );
      } else {
        await context.reply(TELEGRAM_GUIDED_DEPOSIT_PLAYER_INVALID_TEXT);
      }
      return;
    }
    if (
      ('photo' in context.message || 'document' in context.message) &&
      context.chat?.type === 'private' &&
      context.from?.id === context.chat.id &&
      !context.from.is_bot
    ) {
      const selection = selectTelegramProofMedia(context.message);
      if (selection.kind !== 'selected') {
        await context.reply(
          selection.kind === 'too_large'
            ? 'The receipt file is too large (maximum 5 MB). Send a smaller image or PDF, or type the transaction number.'
            : 'Please send a JPG/PNG screenshot or PDF, or type the TeleBirr transaction number.',
        );
        return;
      }
      const temporary = await startTelegramTemporaryMessage(
        temporaryMessageDependencies,
        String(metadata.updateId),
        String(context.chat.id),
        config.receiverSmsCandidateEnabled
          ? '⏳ Payment information received. Reading its reference now.'
          : TELEGRAM_TEMPORARY_MEDIA_TEXT,
      );
      let extracted: Awaited<ReturnType<typeof extractTelegramProofMediaText>>;
      try {
        extracted = await extractTelegramProofMediaText(selection.media, {
          token: telegramToken,
          getFile: (fileId) => bot.api.getFile(fileId),
        });
      } catch {
        await cancelTelegramTemporaryMessage(temporaryMessageDependencies, temporary);
        await context.reply(
          'We could not read your receipt right now. Please try again or type the transaction number. Nothing was submitted.',
        );
        return;
      }
      if (extracted.kind !== 'text') {
        await cancelTelegramTemporaryMessage(temporaryMessageDependencies, temporary);
        await context.reply(
          extracted.kind === 'busy'
            ? 'Receipt reading is busy. Please try again shortly or type the transaction number.'
            : extracted.kind === 'too_large'
              ? 'The receipt file is too large (maximum 5 MB). Send a smaller image or PDF, or type the transaction number.'
              : extracted.kind === 'unreadable'
                ? TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT
                : 'We could not read your receipt right now. Please try again or type the transaction number. Nothing was submitted.',
        );
        return;
      }
      const mediaMetadata = {
        ...metadata,
        caption: 'caption' in context.message ? context.message.caption : undefined,
        extractedText: extracted.text,
        sourceKind: selection.media.kind === 'pdf' ? ('pdf_text' as const) : ('ocr_text' as const),
      };
      if (
        !config.receiverSmsCandidateEnabled &&
        (isCbeBirrReceiptText(extracted.text) || isCbeBirrReceiptText(mediaMetadata.caption))
      ) {
        await cancelTelegramTemporaryMessage(temporaryMessageDependencies, temporary);
        await context.reply('CBE Birr deposits are not available yet. No payment was submitted.');
        return;
      }
      const cbeMedia =
        config.receiverSmsCandidateEnabled &&
        (isCbeBirrReceiptText(extracted.text) || isCbeBirrReceiptText(mediaMetadata.caption));
      const mediaSubmission = cbeMedia
        ? reduceTelegramSavedCbeSmsMediaSubmission(mediaMetadata)
        : parseTelegramTelebirrPaymentPromptReply(replyToMessage)
          ? reduceTelegramGuidedDepositMediaSubmission({ ...mediaMetadata, replyToMessage })
          : reduceTelegramSavedTelebirrMediaSubmission(mediaMetadata);
      if (mediaSubmission?.kind === 'action') {
        await deliverPlayerAction(
          mediaSubmission.action,
          (replyText, keyboard) =>
            context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
          { handle: temporary },
        );
      } else {
        await cancelTelegramTemporaryMessage(temporaryMessageDependencies, temporary);
        await context.reply(
          mediaSubmission?.kind === 'selection_required'
            ? 'I found more than one payment reference. Nothing was submitted. Send one reference only.'
            : 'Deposit not credited. Reason: invalid payment information. Contact support if this is unexpected. Send one clear payment reference.',
        );
      }
      return;
    }
    const cbeSmsSubmission = config.receiverSmsCandidateEnabled
      ? reduceTelegramSavedCbeSmsProofSubmission({ ...metadata, command: text })
      : undefined;
    if (cbeSmsSubmission) {
      if (cbeSmsSubmission.kind === 'action') {
        await deliverPlayerAction(cbeSmsSubmission.action, (replyText, keyboard) =>
          context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
        );
      } else {
        await context.reply(
          cbeSmsSubmission.kind === 'selection_required'
            ? 'I found more than one CBE Birr reference. Nothing was submitted. Send one reference only.'
            : 'Deposit not credited. Reason: invalid payment information. Contact support if this is unexpected. Send one clear CBE Birr reference.',
        );
      }
      return;
    }
    const guidedSubmission = reduceTelegramGuidedDepositProofSubmission({
      ...metadata,
      text,
      replyToMessage,
    });
    if (guidedSubmission) {
      if (guidedSubmission.kind === 'action') {
        await deliverPlayerAction(
          guidedSubmission.action,
          (replyText, keyboard, forceReplyPlaceholder) =>
            context.reply(
              replyText,
              forceReplyPlaceholder
                ? {
                    reply_markup: {
                      force_reply: true,
                      selective: true,
                      input_field_placeholder: forceReplyPlaceholder,
                    },
                  }
                : keyboard
                  ? { reply_markup: keyboard }
                  : undefined,
            ),
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
    const cbeDryRunAction = reduceTelegramCbeBirrDryRunCommand({ ...metadata, command: text });
    if (cbeDryRunAction) {
      await deliverPlayerAction(cbeDryRunAction, (replyText, keyboard) =>
        context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
      );
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
    if (!config.receiverSmsCandidateEnabled && isCbeBirrReceiptText(text)) {
      await context.reply('CBE Birr deposits are not available yet. No payment was submitted.');
      return;
    }
    const savedProof = reduceTelegramSavedTelebirrProofSubmission({ ...metadata, command: text });
    if (savedProof) {
      if (savedProof.kind === 'action') {
        await deliverPlayerAction(savedProof.action, (replyText, keyboard) =>
          context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
        );
      } else {
        await context.reply(
          savedProof.kind === 'selection_required'
            ? TELEGRAM_GUIDED_DEPOSIT_SELECTION_TEXT
            : TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT,
        );
      }
      return;
    }
    if (
      !config.playerValidationIntakeEnabled &&
      !(typeof text === 'string' && text.startsWith('/'))
    ) {
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
    const changePlayer = isTelegramSavedPlayerChangeCallback(callbackMetadata);
    const action =
      reduceTelegramDepositProofStatusCallbackAction(callbackMetadata) ??
      reduceTelegramPlayerRegistrationCallbackAction(callbackMetadata);
    await context.answerCallbackQuery();
    if (guidedDepositStart) {
      const savedAction = reduceTelegramSavedTelebirrDestinationAction(callbackMetadata);
      if (savedAction)
        await deliverPlayerAction(savedAction, (replyText, keyboard, placeholder) =>
          context.reply(
            replyText,
            placeholder
              ? {
                  reply_markup: {
                    force_reply: true,
                    selective: true,
                    input_field_placeholder: placeholder,
                  },
                }
              : keyboard
                ? { reply_markup: keyboard }
                : undefined,
          ),
        );
      return;
    }
    if (changePlayer) {
      await context.reply(TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT, {
        reply_markup: {
          force_reply: true,
          selective: true,
          input_field_placeholder: 'KemerBet Player ID',
        },
      });
      return;
    }
    if (config.playerValidationIntakeEnabled && action?.kind === 'player_registration_callback') {
      await context.reply(TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT, {
        reply_markup: {
          force_reply: true,
          selective: true,
          input_field_placeholder: 'KemerBet Player ID',
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
    await deliverPlayerAction(action, (replyText, keyboard, forceReplyPlaceholder) =>
      context.reply(
        replyText,
        forceReplyPlaceholder
          ? {
              reply_markup: {
                force_reply: true,
                selective: true,
                input_field_placeholder: forceReplyPlaceholder,
              },
            }
          : keyboard
            ? { reply_markup: keyboard }
            : undefined,
      ),
    );
  });
}

bot.catch((error) => {
  console.error(
    {
      updateId: error.ctx.update.update_id,
      playerActionsEnabled: playerActions.enabled,
    },
    'Telegram bot update handling failed; processing or reply delivery may be incomplete.',
  );
});

const outcomeNotifierAbort = new AbortController();
let outcomeNotifier: Promise<void> | undefined;
await runTelegramPolling(
  bot,
  {
    allowed_updates: playerActions.enabled ? ['message', 'callback_query'] : ['message'],
    onStart: (botInfo) => {
      if (playerActions.enabled) {
        outcomeNotifier = runTelegramDepositOutcomeNotifier(
          {
            request: (action) => deliverTelegramPrivateActionWithRetry(action, playerActions),
            send: (chatId, text, showDepositButton) =>
              bot.api.sendMessage(
                chatId,
                text,
                showDepositButton ? { reply_markup: inlineMenu(quickMenu.buttons) } : undefined,
              ),
            delete: (chatId, messageId) => bot.api.deleteMessage(chatId, messageId),
            sendMenu: (chatId) =>
              bot.api.sendMessage(chatId, quickMenu.text, {
                reply_markup: inlineMenu(quickMenu.buttons),
              }),
          },
          outcomeNotifierAbort.signal,
        );
      }
      console.info(
        {
          username: botInfo.username,
          playerActionsEnabled: config.telegramActionChannel.enabled,
        },
        config.telegramBetaAdmission.enabled
          ? 'Telegram bot started with configured private admission and action handlers.'
          : playerActions.enabled
            ? 'Telegram bot started with private action handlers.'
            : 'Telegram bot started in Stage 0 mode.',
      );
    },
  },
  {
    onShutdown: () => {
      outcomeNotifierAbort.abort();
      pollingReadiness.stop();
    },
  },
);
await outcomeNotifier;
