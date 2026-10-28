/** Only current customer actions appear in Telegram's blue command menu. */
export const TELEGRAM_PRIVATE_HOME_COMMANDS = [
  { command: 'start', description: 'Home' },
  { command: 'deposit', description: 'Deposit' },
  { command: 'support', description: 'Support' },
  { command: 'help', description: 'Help' },
] as const;

export const TELEGRAM_PRIVATE_SAVED_PLAYER_COMMANDS = [
  TELEGRAM_PRIVATE_HOME_COMMANDS[0],
  TELEGRAM_PRIVATE_HOME_COMMANDS[1],
  { command: 'change_player_id', description: 'Change Player ID' },
  TELEGRAM_PRIVATE_HOME_COMMANDS[2],
  TELEGRAM_PRIVATE_HOME_COMMANDS[3],
] as const;
