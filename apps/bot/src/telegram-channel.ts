export const FETANAGENT_UPDATES_CHANNEL_URL = 'https://t.me/FetanAgentUpdates';

interface ChannelMessage {
  readonly text?: string | undefined;
  readonly chat?: { readonly id: number; readonly type: string } | undefined;
  readonly from?: { readonly id: number; readonly isBot: boolean } | undefined;
}

/** Keep the public channel command out of payment and Player-ID input pipelines. */
export function isTelegramPrivateChannelCommand(
  metadata: ChannelMessage,
  botUsername: string | undefined,
): boolean {
  const { text, chat, from } = metadata;
  if (typeof text !== 'string') return false;
  const addressed = /^\/channel(?:@([A-Za-z0-9_]{5,32}))?$/u.exec(text);
  if (!addressed) return false;
  if (
    addressed[1] &&
    (typeof botUsername !== 'string' || addressed[1].toLowerCase() !== botUsername.toLowerCase())
  ) {
    return false;
  }
  return (
    chat?.type === 'private' &&
    from?.isBot === false &&
    Number.isSafeInteger(chat.id) &&
    chat.id > 0 &&
    from.id === chat.id
  );
}
