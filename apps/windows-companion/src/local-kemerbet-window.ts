import type { CDPSession, Page } from 'playwright-core';

// A restored Chrome profile can reopen in a small or minimized Windows window. KemerBet's
// financial-actions controls are not dependable there, even though the session is signed in.
const MIN_LOOKUP_WINDOW_WIDTH = 900;
const MIN_LOOKUP_WINDOW_HEIGHT = 650;

export class LocalKemerBetWindowUnavailableError extends Error {
  constructor() {
    super('The KemerBet Player lookup window is unavailable.');
    this.name = 'LocalKemerBetWindowUnavailableError';
  }
}

function unavailable(): never {
  throw new LocalKemerBetWindowUnavailableError();
}

/** Restore the guarded Chrome window before any read-only Player lookup touches the page. */
export async function ensureKemerBetPlayerLookupWindow(page: Page): Promise<void> {
  let cdp: CDPSession | undefined;
  try {
    cdp = await page.context().newCDPSession(page);
    const target = await cdp.send('Browser.getWindowForTarget');
    if (!Number.isSafeInteger(target.windowId) || target.windowId < 1) unavailable();
    const windowId: number = target.windowId;
    const current = await cdp.send('Browser.getWindowBounds', { windowId });
    const state = current.bounds?.windowState;
    if (state === 'minimized' || state === 'fullscreen') {
      // Chrome refuses a direct minimized/fullscreen -> maximized transition.
      await cdp.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'normal' },
      });
    } else if (state !== 'normal' && state !== 'maximized') {
      unavailable();
    }
    if (state !== 'maximized') {
      await cdp.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'maximized' },
      });
    }
    const ready = await cdp.send('Browser.getWindowBounds', { windowId });
    if (
      ready.bounds?.windowState !== 'maximized' ||
      typeof ready.bounds.width !== 'number' ||
      ready.bounds.width < MIN_LOOKUP_WINDOW_WIDTH ||
      typeof ready.bounds.height !== 'number' ||
      ready.bounds.height < MIN_LOOKUP_WINDOW_HEIGHT
    ) {
      unavailable();
    }
    await page.bringToFront();
  } catch {
    unavailable();
  } finally {
    await cdp?.detach().catch(() => undefined);
  }
}
