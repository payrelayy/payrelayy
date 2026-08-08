export type Locale = 'en' | 'am';

export const messages = {
  welcome: {
    en: 'Welcome to PayReplayy. Choose Deposit or Withdrawal to continue.',
    am: 'እንኳን ወደ PayReplayy በደህና መጡ። ለመቀጠል ገቢ ወይም ወጪ ይምረጡ።',
  },
  privateChatOnly: {
    en: 'For your privacy, please use PayReplayy in a private chat with the bot.',
    am: 'ለግላዊነትዎ PayReplayyን በቦቱ የግል ውይይት ውስጥ ብቻ ይጠቀሙ።',
  },
  stageZero: {
    en: 'PayReplayy is being prepared. Financial actions are not available yet.',
    am: 'PayReplayy በዝግጅት ላይ ነው። የገንዘብ እንቅስቃሴዎች እስካሁን አይገኙም።',
  },
  inboxUnavailable: {
    en: 'PayReplayy cannot receive requests right now. Please try again shortly.',
    am: 'PayReplayy በአሁኑ ጊዜ ጥያቄዎን መቀበል አልቻለም። እባክዎ ትንሽ ቆይተው እንደገና ይሞክሩ።',
  },
} as const satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof messages;

export function message(locale: Locale, key: MessageKey): string {
  return messages[key][locale];
}
