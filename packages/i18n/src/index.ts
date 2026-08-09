/** PayReplayy currently communicates with customers in English only. */
export type Locale = 'en';

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Telegram may provide any BCP 47 language code, but the product has one supported locale.
 * Keep this normalization at the transport boundary so unsupported codes can never enter the
 * signed bot-to-API payload as a customer-facing locale.
 */
export function normalizeLocale(_languageCode: string | undefined): Locale {
  return DEFAULT_LOCALE;
}

export const messages = {
  welcome: {
    en: 'Welcome to PayReplayy. Secure account setup is being prepared.',
  },
  privateChatOnly: {
    en: 'For your privacy, please use PayReplayy in a private chat with the bot.',
  },
  stageZero: {
    en: 'PayReplayy is being prepared. Financial actions are not available yet.',
  },
  inboxUnavailable: {
    en: 'PayReplayy cannot receive requests right now. Please try again shortly.',
  },
  playerRegistrationMenu: {
    en: 'Add your KemerBet Player ID to PayReplayy.',
  },
  addKemerBetPlayerId: {
    en: 'Add KemerBet Player ID',
  },
} as const satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof messages;

export function message(locale: Locale, key: MessageKey): string {
  return messages[key][locale];
}
