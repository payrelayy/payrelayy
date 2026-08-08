import { loadBotConfig, redactedBotConfigForLog } from '@payreplayy/config/bot';
import { message, type Locale } from '@payreplayy/i18n';
import { Bot } from 'grammy';

const config = loadBotConfig();

if (!config.telegram.enabled) {
  console.info(
    { config: redactedBotConfigForLog(config) },
    'Telegram bot is disabled; no polling will start in Stage 0.',
  );
  process.exit(0);
}

const bot = new Bot(config.telegram.token);

function preferredLocale(languageCode: string | undefined): Locale {
  return languageCode?.toLowerCase().startsWith('am') ? 'am' : 'en';
}

bot.on('message', async (context) => {
  if (context.chat.type !== 'private') {
    return;
  }

  const locale = preferredLocale(context.from?.language_code);
  await context.reply(message(locale, 'stageZero'));
});

await bot.start({
  onStart: (botInfo) => {
    console.info({ username: botInfo.username }, 'Telegram bot started in Stage 0 mode.');
  },
});
