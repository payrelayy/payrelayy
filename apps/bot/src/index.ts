import { loadBotConfig, redactedBotConfigForLog } from '@fetanagent/config/bot';
import type { TelegramPrivateActionEnvelope } from '@fetanagent/contracts';
import { message } from '@fetanagent/i18n';
import { Bot, InlineKeyboard } from 'grammy';

import {
  extractTelegramProofMediaText,
  recognizeTelegramProofMedia,
  selectTelegramProofMedia,
} from './telegram-deposit-media.js';
import {
  DIGITALOCEAN_SCREENSHOT_MODEL,
  readDigitalOceanScreenshotReference,
} from './digitalocean-screenshot-reference.js';
import { recognizeScreenshotReferenceWithFallback } from './telegram-screenshot-reference.js';
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
import {
  createTelegramSupportContactResolver,
  handleTelegramSupportMessage,
} from './telegram-support.js';
import {
  TELEGRAM_INVALID_PAYMENT_REFERENCE_TEXT,
  TELEGRAM_MULTIPLE_PAYMENT_REFERENCES_TEXT,
} from './telegram-customer-copy.js';
import { loadTelegramPaymentMethods } from './telegram-payment-methods.js';
import {
  isRecognizedTelegramDepositProofStatusCallback,
  isRecognizedTelegramDepositStatusCommand,
  isTelegramGuidedDepositStartCallback,
  isTelegramCbeSmsDepositStartCommand,
  isTelegramGuidedDepositStartCommand,
  isTelegramSavedPlayerChangeCallback,
  isTelegramSavedPlayerChangeCommand,
  isCbeBirrReceiptText,
  isTelegramPrivateHelpCommand,
  reduceTelegramAutoReceiverSmsMediaSubmission,
  reduceTelegramAutoReceiverSmsTextSubmission,
  reduceTelegramGuidedDepositDestinationSubmission,
  reduceTelegramGuidedDepositMediaSubmission,
  reduceTelegramGuidedDepositProofSubmission,
  reduceTelegramSavedCbeSmsDestinationAction,
  reduceTelegramSavedCombinedDestinationAction,
  reduceTelegramSavedTelebirrDestinationAction,
  reduceTelegramSavedCbeSmsProofSubmission,
  reduceTelegramSavedTelebirrMediaSubmission,
  reduceTelegramSavedTelebirrProofSubmission,
  reduceTelegramDepositProofSubmission,
  reduceTelegramCbeBirrDryRunCommand,
  reduceTelegramDepositProofStatusCallbackAction,
  reduceTelegramDepositStatusCommand,
  reduceTelegramPlayerIdTextAction,
  reduceTelegramStandalonePlayerIdSubmission,
  reduceTelegramPlayerRegistrationCallbackAction,
  reduceTelegramRootMenuAction,
} from './telegram-private-action.js';
import {
  TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT,
  TELEGRAM_GUIDED_DEPOSIT_PLAYER_INVALID_TEXT,
  TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
  TELEGRAM_GUIDED_DEPOSIT_SELECTION_TEXT,
  TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
  TELEGRAM_GUIDED_CBE_CALLBACK_DATA,
  TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA,
  TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA,
  parseTelegramTelebirrPaymentPromptReply,
  telegramReceiverNumberCodeEntities,
} from './telegram-guided-deposit.js';
import { deliverTelegramPrivateActionWithRetry } from './telegram-private-action-client.js';
import { renderTelegramOutcomeActions, type PrivateTelegramMenuButton } from './private-menu.js';
import {
  TELEGRAM_PRIVATE_HOME_COMMANDS,
  TELEGRAM_PRIVATE_SAVED_PLAYER_COMMANDS,
} from './telegram-command-menu.js';
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
const outcomeActions = renderTelegramOutcomeActions();
let lastSupportFailureLogAt = 0;
let lastSupportFailureReason = '';
const supportContact = createTelegramSupportContactResolver(config.supportContactUrl, {
  reportFailure: (reason, cachedContactUsed) => {
    const now = Date.now();
    if (reason === lastSupportFailureReason && now - lastSupportFailureLogAt < 60_000) return;
    lastSupportFailureReason = reason;
    lastSupportFailureLogAt = now;
    console.warn({ reason, cachedContactUsed }, 'Telegram support contact lookup failed.');
  },
});
let supportRefreshTimer: ReturnType<typeof setInterval> | undefined;

async function supportKeyboard(): Promise<InlineKeyboard | undefined> {
  const contact = await supportContact.resolve();
  return contact ? new InlineKeyboard().url('💬 Support', contact) : undefined;
}

async function depositUnavailableOptions(): Promise<{ reply_markup: InlineKeyboard } | undefined> {
  const keyboard = await supportKeyboard();
  return keyboard ? { reply_markup: keyboard } : undefined;
}
async function syncPrivateCommands(chatId: number, hasSavedPlayer: boolean): Promise<void> {
  try {
    const scope = { type: 'chat' as const, chat_id: chatId };
    if (hasSavedPlayer) {
      await bot.api.setMyCommands([...TELEGRAM_PRIVATE_SAVED_PLAYER_COMMANDS], { scope });
    } else {
      await bot.api.deleteMyCommands({ scope });
    }
  } catch {
    console.warn('Telegram private command menu could not be updated.');
  }
}
async function availableMenuButtons(
  buttons: readonly PrivateTelegramMenuButton[],
): Promise<readonly PrivateTelegramMenuButton[]> {
  const methods = await loadTelegramPaymentMethods(
    config.supportContactUrl,
    config.receiverSmsCandidateEnabled,
  );
  return buttons.filter(
    (button) =>
      (button.callbackData !== TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA ||
        methods.telebirr ||
        methods.cbe_birr) &&
      (button.callbackData !== TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA || methods.telebirr) &&
      (button.callbackData !== TELEGRAM_GUIDED_CBE_CALLBACK_DATA || methods.cbe_birr),
  );
}
function isDepositMenuButton(button: PrivateTelegramMenuButton): boolean {
  return (
    button.callbackData === TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA ||
    button.callbackData === TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA ||
    button.callbackData === TELEGRAM_GUIDED_CBE_CALLBACK_DATA
  );
}
const screenshotModelAccessKey = config.screenshotReferenceReader.enabled
  ? config.screenshotReferenceReader.modelAccessKey
  : undefined;
const screenshotRecognition = screenshotModelAccessKey
  ? (bytes: Buffer, kind: 'photo' | 'image' | 'pdf') =>
      recognizeScreenshotReferenceWithFallback(bytes, kind, {
        local: recognizeTelegramProofMedia,
        vision: async (image, mimeType) => {
          const startedAt = Date.now();
          const result = await readDigitalOceanScreenshotReference(image, mimeType, {
            modelAccessKey: screenshotModelAccessKey,
          });
          console.info(
            {
              model: DIGITALOCEAN_SCREENSHOT_MODEL,
              outcome: result.kind,
              inputTokens: result.kind === 'unavailable' ? null : result.inputTokens,
              outputTokens: result.kind === 'unavailable' ? null : result.outputTokens,
              durationMs: Date.now() - startedAt,
            },
            'Screenshot reference reader completed.',
          );
          return result;
        },
      })
  : undefined;
const unreadableReferenceText =
  'I couldn’t read the reference. Send a clearer receipt or type the reference.';

function inlineMenu(buttons: readonly PrivateTelegramMenuButton[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const [index, button] of buttons.entries()) {
    if (index > 0) keyboard.row();
    keyboard.text(button.text, button.callbackData);
  }
  return keyboard;
}

function replyOptions(keyboard?: InlineKeyboard, text?: string) {
  if (keyboard) return { reply_markup: keyboard };
  const entities = text ? telegramReceiverNumberCodeEntities(text) : [];
  return entities.length > 0 ? { entities } : undefined;
}

async function depositActionOptions(): Promise<{ reply_markup: InlineKeyboard } | undefined> {
  try {
    const buttons = await availableMenuButtons(outcomeActions);
    return buttons.length > 0 ? { reply_markup: inlineMenu(buttons) } : undefined;
  } catch {
    // A payment-method lookup failure must not hide the input guidance itself.
    return undefined;
  }
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
  reply: (text: string, keyboard?: InlineKeyboard) => Promise<unknown>,
  temporaryAttempt?: {
    readonly handle: TelegramTemporaryMessageHandle | undefined;
  },
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
            receiverSmsCandidateEnabled: config.receiverSmsCandidateEnabled,
          }
        : {
            playerValidationEnabled: config.playerValidationIntakeEnabled,
            receiverSmsCandidateEnabled: config.receiverSmsCandidateEnabled,
          },
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
      await reply(
        presentation.text,
        presentation.text === message('en', 'depositUnavailable')
          ? (await depositUnavailableOptions())?.reply_markup
          : undefined,
      );
      return;
    }
    if (presentation.kind === 'prompt') {
      const sent = await reply(presentation.text);
      if (
        (result.outcome === 'telebirr_deposit_destination' &&
          (action.kind === 'saved_telebirr_destination_command' ||
            action.kind === 'telebirr_deposit_destination_command')) ||
        (result.outcome === 'combined_deposit_destination' &&
          action.kind === 'saved_combined_destination_command' &&
          result.receivers.some((receiver) => receiver.providerCode === 'telebirr'))
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
          await reply(
            message('en', 'depositUnavailable'),
            (await depositUnavailableOptions())?.reply_markup,
          );
        }
      }
      return;
    }
    const menuButtons = await availableMenuButtons(presentation.menu.buttons);
    let keyboard = menuButtons.length > 0 ? inlineMenu(menuButtons) : undefined;
    if (
      presentation.menu.buttons.some(isDepositMenuButton) &&
      !menuButtons.some(isDepositMenuButton)
    ) {
      const contact = await supportContact.resolve();
      if (contact) {
        keyboard ??= new InlineKeyboard();
        if (menuButtons.length > 0) keyboard.row();
        keyboard.url('💬 Support', contact);
      }
    }
    await reply(presentation.menu.text, keyboard);
    if (
      'privateChatId' in action &&
      (result.outcome === 'menu' || result.outcome === 'player_selection_saved')
    ) {
      void syncPrivateCommands(
        Number(action.privateChatId),
        result.outcome === 'player_selection_saved' || result.selectedPlayerId !== null,
      );
    }
  } catch {
    await cancelTelegramTemporaryMessage(temporaryMessageDependencies, temporary);
    console.warn(
      { playerActionKind: action.kind },
      'Telegram Player-ID action delivery was unavailable.',
    );
    const unavailableText =
      action.kind === 'deposit_proof_status_command' || action.kind === 'deposit_status_command'
        ? TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT
        : action.kind === 'deposit_proof_command' ||
            action.kind === 'saved_telebirr_proof_command' ||
            action.kind === 'saved_receiver_sms_proof_command' ||
            action.kind === 'saved_telebirr_destination_command' ||
            action.kind === 'saved_cbe_sms_destination_command' ||
            action.kind === 'saved_combined_destination_command' ||
            action.kind === 'telebirr_deposit_destination_command' ||
            action.kind === 'cbe_birr_dry_run_instruction_command' ||
            action.kind === 'cbe_birr_bound_dry_run_proof_command'
          ? message('en', 'depositUnavailable')
          : message('en', 'playerActionUnavailable');
    await reply(
      unavailableText,
      unavailableText === message('en', 'depositUnavailable')
        ? (await depositUnavailableOptions())?.reply_markup
        : undefined,
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
    {
      reply: (text) => context.reply(text),
      resolveContact: supportContact.resolve,
      botUsername: context.me.username,
    },
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
      await context.reply(telegramDepositHelpText(config.receiverSmsCandidateEnabled));
      return;
    }
    if (isTelegramSavedPlayerChangeCommand({ ...metadata, command: text })) {
      await context.reply(TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT);
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
      const methods = await loadTelegramPaymentMethods(
        config.supportContactUrl,
        config.receiverSmsCandidateEnabled,
      );
      const action = config.receiverSmsCandidateEnabled
        ? reduceTelegramSavedCombinedDestinationAction(metadata, methods)
        : methods.telebirr
          ? reduceTelegramSavedTelebirrDestinationAction(metadata)
          : undefined;
      if (action)
        await deliverPlayerAction(action, (replyText, keyboard) =>
          context.reply(replyText, replyOptions(keyboard, replyText)),
        );
      else
        await context.reply(message('en', 'depositUnavailable'), await depositUnavailableOptions());
      return;
    }
    if (
      config.receiverSmsCandidateEnabled &&
      isTelegramCbeSmsDepositStartCommand({ ...metadata, command: text })
    ) {
      const action = reduceTelegramSavedCbeSmsDestinationAction(metadata);
      if (action)
        await deliverPlayerAction(action, (replyText, keyboard) =>
          context.reply(replyText, replyOptions(keyboard, replyText)),
        );
      return;
    }
    const standalonePlayerId = reduceTelegramStandalonePlayerIdSubmission({
      ...metadata,
      text,
      playerValidationEnabled: config.playerValidationIntakeEnabled,
    });
    if (standalonePlayerId) {
      await deliverPlayerAction(standalonePlayerId, (replyText, keyboard) =>
        context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
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
        await deliverPlayerAction(destinationSubmission.action, (replyText, keyboard) =>
          context.reply(replyText, replyOptions(keyboard, replyText)),
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
            ? 'File too large. Send an image or PDF under 5 MB, or type the reference.'
            : config.receiverSmsCandidateEnabled
              ? 'Send a JPG, PNG or PDF, or type the payment reference.'
              : 'Send a JPG, PNG or PDF, or type the TeleBirr reference.',
          await depositActionOptions(),
        );
        return;
      }
      const temporary = await startTelegramTemporaryMessage(
        temporaryMessageDependencies,
        String(metadata.updateId),
        String(context.chat.id),
        TELEGRAM_TEMPORARY_MEDIA_TEXT,
      );
      let extracted: Awaited<ReturnType<typeof extractTelegramProofMediaText>>;
      try {
        extracted = await extractTelegramProofMediaText(selection.media, {
          token: telegramToken,
          getFile: (fileId) => bot.api.getFile(fileId),
          ...(screenshotRecognition ? { recognize: screenshotRecognition } : {}),
        });
      } catch {
        await cancelTelegramTemporaryMessage(temporaryMessageDependencies, temporary);
        await context.reply(
          'I couldn’t read that receipt. Try again or type the reference.',
          await depositActionOptions(),
        );
        return;
      }
      if (extracted.kind !== 'text') {
        await cancelTelegramTemporaryMessage(temporaryMessageDependencies, temporary);
        await context.reply(
          extracted.kind === 'busy'
            ? 'Receipt reading is busy. Try again or type the reference.'
            : extracted.kind === 'too_large'
              ? 'File too large. Send an image or PDF under 5 MB, or type the reference.'
              : extracted.kind === 'unreadable'
                ? unreadableReferenceText
                : 'I couldn’t read that receipt. Try again or type the reference.',
          await depositActionOptions(),
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
        await context.reply(
          'CBE Birr deposits are unavailable. Contact support if you already paid.',
        );
        return;
      }
      const mediaSubmission = config.receiverSmsCandidateEnabled
        ? reduceTelegramAutoReceiverSmsMediaSubmission({ ...mediaMetadata, replyToMessage })
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
            ? TELEGRAM_MULTIPLE_PAYMENT_REFERENCES_TEXT
            : unreadableReferenceText,
          await depositActionOptions(),
        );
      }
      return;
    }
    const autoSmsSubmission = config.receiverSmsCandidateEnabled
      ? reduceTelegramAutoReceiverSmsTextSubmission({ ...metadata, command: text, replyToMessage })
      : undefined;
    if (autoSmsSubmission) {
      if (autoSmsSubmission.kind === 'action') {
        await deliverPlayerAction(autoSmsSubmission.action, (replyText, keyboard) =>
          context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
        );
      } else {
        await context.reply(
          autoSmsSubmission.kind === 'selection_required'
            ? TELEGRAM_MULTIPLE_PAYMENT_REFERENCES_TEXT
            : TELEGRAM_INVALID_PAYMENT_REFERENCE_TEXT,
          await depositActionOptions(),
        );
      }
      return;
    }
    const cbeSmsSubmission = config.receiverSmsCandidateEnabled
      ? reduceTelegramSavedCbeSmsProofSubmission(
          { ...metadata, command: text },
          config.receiverSmsCandidateEnabled,
        )
      : undefined;
    if (cbeSmsSubmission) {
      if (cbeSmsSubmission.kind === 'action') {
        await deliverPlayerAction(cbeSmsSubmission.action, (replyText, keyboard) =>
          context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
        );
      } else {
        await context.reply(
          cbeSmsSubmission.kind === 'selection_required'
            ? TELEGRAM_MULTIPLE_PAYMENT_REFERENCES_TEXT
            : TELEGRAM_INVALID_PAYMENT_REFERENCE_TEXT,
          await depositActionOptions(),
        );
      }
      return;
    }
    const guidedSubmission = config.receiverSmsCandidateEnabled
      ? undefined
      : reduceTelegramGuidedDepositProofSubmission({ ...metadata, text, replyToMessage });
    if (guidedSubmission) {
      if (guidedSubmission.kind === 'action') {
        await deliverPlayerAction(guidedSubmission.action, (replyText, keyboard) =>
          context.reply(replyText, replyOptions(keyboard, replyText)),
        );
      } else {
        await context.reply(
          guidedSubmission.kind === 'selection_required'
            ? TELEGRAM_GUIDED_DEPOSIT_SELECTION_TEXT
            : TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT,
          await depositActionOptions(),
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
    const proofSubmission = reduceTelegramDepositProofSubmission(
      { ...metadata, command: text },
      config.receiverSmsCandidateEnabled,
    );
    if (proofSubmission) {
      if (proofSubmission.kind === 'action') {
        await deliverPlayerAction(proofSubmission.action, (replyText, keyboard) =>
          context.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined),
        );
      } else {
        await context.reply(
          proofSubmission.kind === 'selection_required'
            ? telegramDepositReferenceSelectionText(config.receiverSmsCandidateEnabled)
            : telegramDepositHelpText(config.receiverSmsCandidateEnabled),
          await depositActionOptions(),
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
      await context.reply(TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT, await depositActionOptions());
      return;
    }
    if (!config.receiverSmsCandidateEnabled && isCbeBirrReceiptText(text)) {
      await context.reply(
        'CBE Birr deposits are unavailable. Contact support if you already paid.',
      );
      return;
    }
    const savedProof = config.receiverSmsCandidateEnabled
      ? undefined
      : reduceTelegramSavedTelebirrProofSubmission({ ...metadata, command: text });
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
          await depositActionOptions(),
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

  if (!apiIngress.enabled) {
    if (
      playerActions.enabled &&
      context.chat?.type === 'private' &&
      context.from?.id === context.chat.id &&
      context.from.is_bot === false
    ) {
      await context.reply(message('en', 'unrecognizedPrivateMessage'));
    }
    return;
  }

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

  await context.reply(
    message(
      inbound.preferredLocale,
      playerActions.enabled ? 'unrecognizedPrivateMessage' : 'stageZero',
    ),
  );
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
      const methods = await loadTelegramPaymentMethods(
        config.supportContactUrl,
        config.receiverSmsCandidateEnabled,
      );
      const savedAction = config.receiverSmsCandidateEnabled
        ? reduceTelegramSavedCombinedDestinationAction(callbackMetadata, methods)
        : methods.telebirr
          ? reduceTelegramSavedTelebirrDestinationAction(callbackMetadata)
          : undefined;
      if (savedAction)
        await deliverPlayerAction(savedAction, (replyText, keyboard) =>
          context.reply(replyText, replyOptions(keyboard, replyText)),
        );
      else
        await context.reply(message('en', 'depositUnavailable'), await depositUnavailableOptions());
      return;
    }
    if (changePlayer) {
      await context.reply(TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT);
      return;
    }
    if (config.playerValidationIntakeEnabled && action?.kind === 'player_registration_callback') {
      await context.reply(TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT);
      return;
    }
    if (!action) {
      if (isRecognizedTelegramDepositProofStatusCallback(callbackMetadata)) {
        await context.reply(TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT, await depositActionOptions());
      }
      return;
    }
    await deliverPlayerAction(action, (replyText, keyboard) =>
      context.reply(replyText, replyOptions(keyboard, replyText)),
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
      // Warm the fallback while Owner is healthy, before a later deposit outage.
      if (config.nodeEnv === 'production') {
        void supportContact.resolve();
        supportRefreshTimer = setInterval(() => void supportContact.resolve(), 60_000);
        supportRefreshTimer.unref();
      }
      if (playerActions.enabled) {
        outcomeNotifier = runTelegramDepositOutcomeNotifier(
          {
            request: (action) => deliverTelegramPrivateActionWithRetry(action, playerActions),
            send: async (chatId, text, showDepositButton) => {
              const sent = await bot.api.sendMessage(
                chatId,
                text,
                showDepositButton
                  ? { reply_markup: inlineMenu(await availableMenuButtons(outcomeActions)) }
                  : undefined,
              );
              if (showDepositButton) void syncPrivateCommands(chatId, true);
              return sent;
            },
            delete: (chatId, messageId) => bot.api.deleteMessage(chatId, messageId),
          },
          outcomeNotifierAbort.signal,
        );
        void bot.api
          .setMyCommands([...TELEGRAM_PRIVATE_HOME_COMMANDS], {
            scope: { type: 'all_private_chats' },
          })
          .catch(() => console.warn('Telegram private command menu could not be published.'));
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
      if (supportRefreshTimer) clearInterval(supportRefreshTimer);
      outcomeNotifierAbort.abort();
      pollingReadiness.stop();
    },
  },
);
await outcomeNotifier;
