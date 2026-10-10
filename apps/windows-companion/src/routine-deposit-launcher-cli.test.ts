import { describe, expect, it } from 'vitest';

import { parseRoutineDepositLauncherInput } from './routine-deposit-launcher-cli.js';

const BASE = Object.freeze({
  FETANAGENT_COMPANION_ROUTINE_PLATFORM_AGENT_ACCOUNT_ID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  FETANAGENT_COMPANION_DATA_ROOT: 'D:\\FetanAgent Companion Test',
  FETANAGENT_COMPANION_RELEASE_SHA: 'a'.repeat(40),
});

describe('protected routine launcher no-money rehearsal', () => {
  it('keeps the normal launch unchanged when no rehearsal is requested', () => {
    expect(parseRoutineDepositLauncherInput(BASE).noMoneyPreflight).toBeUndefined();
  });

  it('accepts a complete, bounded rehearsal target', () => {
    expect(
      parseRoutineDepositLauncherInput({
        ...BASE,
        FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER',
        FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '2500',
      }).noMoneyPreflight,
    ).toEqual({ playerId: 'SAMPLE-PLAYER', amountMinor: 2500 });
  });

  it.each([
    { FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER' },
    { FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '2500' },
    {
      FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'BAD PLAYER',
      FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '2500',
    },
    {
      FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER',
      FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '2499',
    },
    {
      FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER',
      FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '2500001',
    },
    {
      FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER',
      FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '02500',
    },
    { INTERNAL_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER' },
  ])('rejects incomplete, invalid, or ambient protected inputs', (override) => {
    expect(() => parseRoutineDepositLauncherInput({ ...BASE, ...override })).toThrow(
      'protected routine-deposit launcher is unavailable',
    );
  });
});
