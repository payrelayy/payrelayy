import { loadConfig, redactedConfigForLog } from '@payreplayy/config';
import { message, type Locale } from '@payreplayy/i18n';
import { Bot } from 'grammy';

const config = loadConfig();

if (!config.telegram.enabled) {
  console.info(
    { config: redactedConfigForLog(config) },
    'Telegram bot is disabled; no polling will start in Stage 0.',
  );
  process.exit(0);
}

if (!config.telegram.token) {
  throw new Error('TELEGRAM_BOT_TOKEN is required when TELEGRAM_BOT_ENABLED=true.');
}

const bot = new Bot(config.telegram.token);

function preferredLocale(languageCode: string | undefined): Locale {
  return languageCode?.toLowerCase().startsWith('am') ? 'am' : 'en';
}

bot.on('message', async (context) => {
  const locale = preferredLocale(context.from?.language_code);

  if (context.chat.type !== 'private') {
    await context.reply(message(locale, 'privateChatOnly'));
    return;
  }

  await context.reply(message(locale, 'stageZero'));
});

await bot.start({
  onStart: (botInfo) => {
    console.info({ username: botInfo.username }, 'Telegram bot started in Stage 0 mode.');
  },
});
