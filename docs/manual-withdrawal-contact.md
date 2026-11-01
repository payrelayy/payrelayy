# Manual withdrawal contact

The Telegram bot shows **Withdraw** to the right of **Deposit** on saved-Player menus and on
eligible payment result messages, including credited and rejected results. Interim checking
notices keep their existing button behavior. Before sending a button, the bot reads the Owner
setting and puts a direct `t.me` chat link on it. The button does not create a withdrawal request,
verify a balance, or move money. The `withdrawal_collection` and `withdrawal_validation` switches
remain disabled.

The launch contact is `@balem18`. In Owner, open **System → Manual withdrawal contact** to
review or change it. Enter a Telegram username, check the preview, confirm, and save. The
contact is separate from **Customer support**. FetanAgent validates the username's format but
cannot verify who owns the Telegram account. Saving a blank username disables the link;
clearing the draft alone does not save. A stale edit requires refreshing the saved contact.

The bot looks up the current setting through
`https://owner.fetanagent.com/v1/public/withdrawal-chat` behind the scenes. That Owner URL never
appears on new Telegram buttons. If the contact is disabled or the lookup fails, new menus omit
Withdraw. After an Owner change, newly sent menus use the new contact; previously sent menus
retain their original button URL. A customer can send `/start` for a fresh menu. The public
redirect remains for older bot messages and accepts no user-supplied destination.

The contact schema and Owner setting are already deployed. Verify the direct Telegram button on
a fresh saved-Player menu and a final payment notice. Older menus keep working through the
compatibility redirect.
