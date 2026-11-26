# FetanAgent Telegram profile

FetanAgent is the product name. “Fetan” (ፈጣን) means “fast.” The public profile stays neutral about the Player platform so it can serve additional platforms when they become available.

## Bot profile

- Name: `FetanAgent`
- Username: `@FetanAgentBot`
- Avatar: [FetanAgent F monogram](fetanagent-telegram-avatar.png)
- Bio: `Save your Player ID, tap Deposit, and send your receipt or transaction reference here. We’ll update you in this chat.`
- BotFather introduction:

  > Welcome to FetanAgent. Save your Player ID, tap Deposit, and pay using the details shown. Send your receipt or transaction reference here; we’ll update you in this chat. Need help? Send /support.

Keep deposit actions in the private bot chat. The Telegram command menu is published by the bot at startup and must be changed in code, not only in BotFather. The private menu lists Home, Deposit, Support, and Updates channel; a saved Player ID also adds Change Player ID. The `/channel` command opens the channel through a Telegram URL button. `/help` still works when typed but is not listed in the menu. The Home message is unchanged.

## Announcement channel

- Name: `FetanAgent Updates`
- Public link: `https://t.me/FetanAgentUpdates`
- About: `Service news and deposit tips from FetanAgent. Open @FetanAgentBot to make a deposit or get support.`
- Pinned introduction:

  > Welcome to FetanAgent Updates.
  >
  > This channel shares service news and simple deposit tips.
  >
  > To deposit, open @FetanAgentBot and use its private chat. Send your receipt or transaction reference there. Need help? Send /support to the bot.

The channel is for announcements. It does not process payments.
