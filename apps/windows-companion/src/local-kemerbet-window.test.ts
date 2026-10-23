import type { Page } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import {
  ensureKemerBetAgentWindow,
  LocalKemerBetWindowUnavailableError,
} from './local-kemerbet-window.js';

type WindowState = 'normal' | 'minimized' | 'maximized' | 'fullscreen';

function fakeWindow(initial: WindowState, maximizedSize = { width: 1508, height: 908 }) {
  let windowState = initial;
  const changes: WindowState[] = [];
  const detach = vi.fn(async () => undefined);
  const send = vi.fn(
    async (method: string, parameters?: { bounds?: { windowState: WindowState } }) => {
      if (method === 'Browser.getWindowForTarget') return { windowId: 1 };
      if (method === 'Browser.getWindowBounds') {
        return {
          bounds: {
            windowState,
            ...(windowState === 'maximized' ? maximizedSize : { width: 676, height: 460 }),
          },
        };
      }
      if (method === 'Browser.setWindowBounds' && parameters?.bounds) {
        if (windowState === 'minimized' && parameters.bounds.windowState === 'maximized') {
          throw new Error('Chrome requires a normal transition.');
        }
        windowState = parameters.bounds.windowState;
        changes.push(windowState);
        return {};
      }
      throw new Error('Unexpected CDP method.');
    },
  );
  const bringToFront = vi.fn(async () => undefined);
  const page = {
    bringToFront,
    context: () => ({ newCDPSession: async () => ({ send, detach }) }),
  } as unknown as Page;
  return { bringToFront, changes, detach, page, send };
}

describe('KemerBet Player lookup window recovery', () => {
  it('restores a minimized window before maximizing it and beginning the lookup', async () => {
    const window = fakeWindow('minimized');

    await ensureKemerBetAgentWindow(window.page);

    expect(window.changes).toEqual(['normal', 'maximized']);
    expect(window.bringToFront).toHaveBeenCalledOnce();
    expect(window.detach).toHaveBeenCalledOnce();
  });

  it('maximizes a small restored window before beginning the lookup', async () => {
    const window = fakeWindow('normal');

    await ensureKemerBetAgentWindow(window.page);

    expect(window.changes).toEqual(['maximized']);
    expect(window.bringToFront).toHaveBeenCalledOnce();
  });

  it('does not begin a lookup if the host display remains too small', async () => {
    const window = fakeWindow('minimized', { width: 800, height: 600 });

    await expect(ensureKemerBetAgentWindow(window.page)).rejects.toBeInstanceOf(
      LocalKemerBetWindowUnavailableError,
    );

    expect(window.changes).toEqual(['normal', 'maximized']);
    expect(window.bringToFront).not.toHaveBeenCalled();
    expect(window.detach).toHaveBeenCalledOnce();
  });

  it('does not begin a lookup if Chrome cannot report its window state', async () => {
    const window = fakeWindow('normal');
    window.send.mockRejectedValueOnce(new Error('CDP unavailable'));

    await expect(ensureKemerBetAgentWindow(window.page)).rejects.toBeInstanceOf(
      LocalKemerBetWindowUnavailableError,
    );

    expect(window.bringToFront).not.toHaveBeenCalled();
    expect(window.detach).toHaveBeenCalledOnce();
  });
});
