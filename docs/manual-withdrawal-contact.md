# Manual withdrawal contact

The Telegram bot's private menu shows **Withdraw** below **Deposit** only after a Player ID is
saved. The button opens the current withdrawal handler's Telegram chat. It does not create a
withdrawal request, verify a balance, or move money. The `withdrawal_collection` and
`withdrawal_validation` switches remain disabled.

The launch contact is `@balem18`. In Owner, open **System → Manual withdrawal contact** to
review or change it. Enter a Telegram username, check the preview, confirm, and save. The
contact is separate from **Customer support**. FetanAgent validates the username's format but
cannot verify who owns the Telegram account. Saving a blank username disables the link;
clearing the draft alone does not save. A stale edit requires refreshing the saved contact.

The bot button uses `https://owner.fetanagent.com/v1/public/withdrawal-chat`, a stable link that
looks up the current Owner setting on every click. Previously sent bot menus therefore use the
new contact after an Owner change. The redirect accepts no user-supplied destination and sends
`Cache-Control: no-store`. If the contact is disabled or the lookup fails, the page says manual
withdrawals are unavailable and does not redirect.

For rollout, deploy the compatible Owner and bot runtime before applying
`20261101013001_manual_withdrawal_contact.sql` immediately afterward. The link may return an
unavailable page during that short interval. The database migration seeds the launch contact
and adds three narrowly granted functions. The Owner server's startup preflight accepts their
absence during rollout and checks their grants once present. Verify the Owner saved contact and
redirect before announcing the button.
