/** FetanAgent currently communicates with customers in English only. */
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
    en: 'Welcome to FetanAgent. Secure account setup is being prepared.',
  },
  privateChatOnly: {
    en: 'For your privacy, please use FetanAgent in a private chat with the bot.',
  },
  stageZero: {
    en: 'FetanAgent is being prepared. Financial actions are not available yet.',
  },
  inboxUnavailable: {
    en: 'FetanAgent cannot receive requests right now. Please try again shortly.',
  },
  betaAdmissionWelcome: {
    en: 'Welcome to FetanAgent private beta. Your access is active. Payments are not enabled yet.',
  },
  betaAdmissionUnavailable: {
    en: 'FetanAgent private beta is temporarily unavailable. Please try again shortly.',
  },
  playerRegistrationMenu: {
    en: 'Manage your KemerBet Player ID, or submit a dry-run proof with /deposit PROVIDER PLAYER_ID TRANSACTION_ID.',
  },
  addKemerBetPlayerId: {
    en: 'Add KemerBet Player ID',
  },
  enterKemerBetPlayerId: {
    en: 'Send your KemerBet Player ID now. It will be saved as pending validation.',
  },
  playerIdPending: {
    en: 'Player ID saved — pending validation. It cannot be used for a deposit yet.',
  },
  playerIdExists: {
    en: 'That Player ID is already registered on your FetanAgent account.',
  },
  invalidPlayerId: {
    en: 'That Player ID format is not accepted. Send one value without spaces, up to 64 characters.',
  },
  playerActionRestart: {
    en: 'That action expired or is no longer available. Send /menu to start again.',
  },
  playerActionMenuRequired: {
    en: 'Send /menu, then choose Add KemerBet Player ID.',
  },
  playerActionUnavailable: {
    en: 'Player ID setup is temporarily unavailable. Please try again shortly.',
  },
  depositInputInvalid: {
    en: 'Use /deposit cbe_birr PLAYER_ID TRANSACTION_ID or /deposit telebirr PLAYER_ID TRANSACTION_ID.',
  },
  depositUnavailable: {
    en: 'Deposit intake is temporarily unavailable. No payment action was started.',
  },
  depositReferenceReceived: {
    en: 'Transaction reference received. Check the deposit status for progress.',
  },
} as const satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof messages;

export function message(locale: Locale, key: MessageKey): string {
  return messages[key][locale];
}
