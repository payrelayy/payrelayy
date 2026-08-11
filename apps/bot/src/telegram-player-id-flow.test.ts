import { formatTelegramPlayerRegistrationCapabilityCallback } from '@payreplayy/contracts';
import { describe, expect, it } from 'vitest';

import { presentTelegramPlayerIdFlowResult } from './telegram-player-id-flow.js';

describe('Telegram Player-ID flow presentation', () => {
  it('renders only the opaque API capability in the one-button menu', () => {
    const callbackData = formatTelegramPlayerRegistrationCapabilityCallback({
      compactCapabilityId: 'AAAAAAAAAAAAAAAAAAAAAA',
      token: '_____________________w',
    });
    expect(
      presentTelegramPlayerIdFlowResult({ version: 1, outcome: 'menu', callbackData }),
    ).toEqual({
      kind: 'menu',
      menu: {
        text: 'Add your KemerBet Player ID to PayReplayy.',
        buttons: [{ text: 'Add KemerBet Player ID', callbackData }],
      },
    });
  });

  it.each([
    ['awaiting_player_id', 'Send your KemerBet Player ID now.'],
    ['player_id_pending', 'Player ID saved — pending validation.'],
    ['invalid_player_id', 'That Player ID format is not accepted.'],
    ['restart_required', 'That action expired or is no longer available.'],
    ['menu_required', 'Send /menu, then choose Add KemerBet Player ID.'],
  ] as const)('maps %s to safe customer copy', (outcome, expected) => {
    const presentation = presentTelegramPlayerIdFlowResult({ version: 1, outcome });
    expect(presentation.kind).toBe('message');
    if (presentation.kind === 'message') expect(presentation.text).toContain(expected);
  });
});
