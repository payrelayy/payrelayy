import type { Bot, PollingOptions } from 'grammy';

type PollingBot = Pick<Bot, 'init' | 'start' | 'stop'>;
type PollingPhase = 'initializing' | 'starting' | 'polling' | 'shutdown';

function reportFailure(phase: PollingPhase, error: unknown): void {
  const code =
    typeof error === 'object' && error !== null && 'error_code' in error
      ? error.error_code
      : undefined;
  process.exitCode = 1;
  console.error(
    {
      phase,
      reason:
        code === 401
          ? 'telegram_unauthorized'
          : code === 409
            ? 'telegram_conflict'
            : 'unexpected_error',
    },
    'Telegram bot lifecycle failed.',
  );
}

function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    // grammY's abortable initialization/setup retry delay uses this fixed error.
    error.message === 'Aborted delay' ||
    ('error' in error && error.error instanceof Error && error.error.name === 'AbortError')
  );
}

/** Own both long-polling promises: stop() does not wait for start()'s middleware to drain. */
export async function runTelegramPolling(bot: PollingBot, options: PollingOptions): Promise<void> {
  const initialization = new AbortController();
  let phase: PollingPhase = 'initializing';
  let shutdownRequested = false;
  let pollingStarted = false;
  let shutdown: Promise<void> | undefined;

  async function stopPolling(): Promise<void> {
    try {
      await bot.stop();
    } catch (error) {
      reportFailure('shutdown', error);
    }
  }

  function requestShutdown(): void {
    if (shutdownRequested) return;
    shutdownRequested = true;
    console.info('Telegram bot shutdown requested.');
    initialization.abort();
    if (pollingStarted) shutdown = stopPolling();
  }

  process.on('SIGINT', requestShutdown);
  process.on('SIGTERM', requestShutdown);
  try {
    // Explicit initialization makes the first getMe request cancellable as well.
    // grammY's Node declarations use the older AbortSignal polyfill. Its runtime accepts
    // the native signal and forwards cancellation to its internal controller.
    await bot.init(initialization.signal as unknown as Parameters<PollingBot['init']>[0]);
    if (shutdownRequested) return;
    phase = 'starting';
    pollingStarted = true;
    await bot.start({
      ...options,
      onStart: async (botInfo) => {
        if (shutdownRequested) return;
        await options.onStart?.(botInfo);
        phase = 'polling';
      },
    });
  } catch (error) {
    if (!shutdownRequested || !isCancellation(error)) reportFailure(phase, error);
  } finally {
    // Keep both signal handlers installed while either shutdown or middleware is pending.
    await shutdown;
    process.removeListener('SIGINT', requestShutdown);
    process.removeListener('SIGTERM', requestShutdown);
  }
}
