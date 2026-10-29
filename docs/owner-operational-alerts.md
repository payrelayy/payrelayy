# Owner operational alerts

The Owner Home page checks its read-only system overview every 30 seconds while
the page is visible. The existing authenticated Companion connection check runs
every 20 seconds. Each alert links to the relevant Owner section and disappears
when the next successful check no longer finds the condition. This release sends
no Telegram or other external alert.

## Alert evidence

- An enabled payment method whose existing readiness check reports a provider,
  receiving-account, pairing, new-receiver-SMS, or credit-worker fault needs
  attention. A switch or route deliberately set to a non-live state is displayed
  as a quiet pause.
- Dead deposit jobs and overdue execution leases need an exact payment-outcome
  review before any manual credit. Manual-credit cases remain visible until the
  Owner records the outside result.
- A ready deposit job waiting for two minutes with no leased deposit job is a
  delayed queue, not proof that no Player was credited.
- A Player ID request still pending after five minutes is delayed. Deposits have
  priority over read-only Player ID Find, so this is not proof of a KemerBet
  outage.
- A paired Companion with no authenticated check-in for at least two minutes
  needs attention when deposits are live or Player ID work is pending. The
  missing-check-in alert is suppressed while a deposit job is leased because a
  long browser action can defer the next poll. A check-in alone does not prove
  that the KemerBet page is signed in.

The server returns checked facts, not payment identifiers or a command to
execute work. The Owner page treats an unavailable or malformed check as unknown,
never as healthy. The page does not currently have direct idle heartbeats for the
receiver SMS phone or the bot, so it does not infer their connectivity from the
absence of SMS or customer traffic. A full Owner-site outage cannot be reported
inside the Owner page itself.
