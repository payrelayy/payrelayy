# Telegram bot lifecycle

The bot uses grammY's built-in long polling. The lifecycle is composed in
[`apps/bot/src/index.ts`](../apps/bot/src/index.ts) and managed by
[`runTelegramPolling`](../apps/bot/src/telegram-polling-lifecycle.ts). Keep one polling process
running for each bot token. The wrapper does not coordinate multiple processes or restart a failed
poller; competing instances can produce a Telegram conflict.

Initialization calls `bot.init()` with an abort signal before starting polling. This lets a
shutdown request cancel the initial bot-information request. If shutdown arrives during
initialization, polling is not started. The configured startup log is also suppressed if grammY
invokes its startup callback after shutdown was requested.
The diagnostic phase remains `starting` until the configured startup callback succeeds, so a
callback failure is not reported as an active polling failure.

The first `SIGINT` or `SIGTERM` logs `Telegram bot shutdown requested.`, aborts initialization,
and calls `bot.stop()` if startup has begun. Further signals do not start another stop operation.
The handlers remain installed until both the polling promise and any stop promise have settled,
then they are removed.

These are separate waits: grammY's `stop()` cancels the active poll and acknowledges the latest
update offset, while `start()` remains pending until middleware finishes. The final acknowledgement
can fail even when the polling promise has resolved. See the official
[grammY `stop()` reference](https://grammy.dev/ref/core/bot#stop) for this distinction.

Lifecycle failures set `process.exitCode` to `1` and emit the fixed message
`Telegram bot lifecycle failed.` with two allowlisted fields:

| Field    | Values                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------- |
| `phase`  | `initializing`, `starting`, `polling`, or `shutdown`                                           |
| `reason` | `telegram_unauthorized` for error code 401, `telegram_conflict` for 409, or `unexpected_error` |

These diagnostics exclude the raw exception, message, stack, request URL, credentials, and update
payload. An unauthorized result calls for checking the configured bot credential; a conflict calls
for checking whether another poller is running. A recognized abort during requested shutdown is
expected cancellation. Other failures, including a rejected stop acknowledgement, remain errors.

Update-handler failures still use the separate `bot.catch` handler. Its log states that processing
or reply delivery may be incomplete; it does not claim that nothing happened before the failure.
The lifecycle wrapper adds no automatic replay or durable reply outbox, and does not guarantee
exactly-once replies.

There is no fixed shutdown deadline or forced process exit in this wrapper. Completion depends on
initialization cancellation, grammY setup and network behavior, in-flight handlers, and the final
acknowledgement. Repeated shutdown signals retain the graceful wait rather than escalating it.
The staging bot container currently has a 15-second stop grace period. Its supervisor may therefore
terminate a stalled shutdown before these promises settle; the wrapper does not guarantee that
middleware drains during a deployment.

Lifecycle and composition verification uses synthetic bot behavior and no live Telegram token or
network request. Run the focused tests with:

```sh
pnpm --filter @fetanagent/bot exec vitest run src/telegram-polling-lifecycle.test.ts src/index.test.ts
```

The regression cases cover initialization cancellation, startup and polling failures, independent
stop failures, repeated signals, waiting for both promises, listener cleanup, and redacted logs.
These tests verify local lifecycle behavior; they are not a live Telegram availability check.
