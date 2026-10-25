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
    en: 'Welcome to FetanAgent.',
  },
  privateChatOnly: {
    en: 'Please message FetanAgent in a private chat.',
  },
  stageZero: {
    en: 'Deposits are not available yet.',
  },
  unrecognizedPrivateMessage: {
    en: 'I didn’t understand that. Open /menu for Deposit or Player ID, or /support for help.',
  },
  inboxUnavailable: {
    en: 'FetanAgent is unavailable right now. Please try again shortly.',
  },
  betaAdmissionWelcome: {
    en: 'Welcome to FetanAgent beta. Deposits are not available yet.',
  },
  betaAdmissionUnavailable: {
    en: 'FetanAgent is unavailable right now. Please try again shortly.',
  },
  playerRegistrationMenu: {
    en: 'Tap Deposit or add a Player ID.',
  },
  addKemerBetPlayerId: {
    en: 'Add Player ID',
  },
  enterKemerBetPlayerId: {
    en: 'Send your KemerBet Player ID.',
  },
  playerIdPending: {
    en: 'Your Player ID is being checked. We’ll update you here.',
  },
  playerIdExists: {
    en: 'That Player ID is already saved.',
  },
  invalidPlayerId: {
    en: 'That Player ID doesn’t look right. Send it again without spaces.',
  },
  playerActionRestart: {
    en: 'That action expired. Open /menu and try again.',
  },
  playerActionMenuRequired: {
    en: 'Open /menu to add a Player ID.',
  },
  playerActionUnavailable: {
    en: 'Player ID setup is unavailable right now. Please try again later.',
  },
  depositInputInvalid: {
    en: 'Open /menu, tap Deposit, then send your payment reference.',
  },
  depositUnavailable: {
    en: 'Deposits are unavailable right now. Please try again later.',
  },
  depositReferenceReceived: {
    en: 'Payment details received. We’ll update you here.',
  },
} as const satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof messages;

export function message(locale: Locale, key: MessageKey): string {
  return messages[key][locale];
}
