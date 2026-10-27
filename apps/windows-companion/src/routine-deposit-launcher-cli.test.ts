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
    expect(parseRoutineDepositLauncherInput(BASE).routinePlayerValidationEnabled).toBe(false);
  });

  it('allows one explicit read-only Find opt-in without changing the routine launch', () => {
    const input = parseRoutineDepositLauncherInput({
      ...BASE,
      FETANAGENT_COMPANION_ROUTINE_PLAYER_FIND_ENABLED: 'true',
    });
    expect(input.routinePlayerValidationEnabled).toBe(true);
    expect(input.noMoneyPreflight).toBeUndefined();
  });

  it('accepts a complete, bounded rehearsal target', () => {
    expect(
      parseRoutineDepositLauncherInput({
        ...BASE,
        FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER',
        FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '10000',
      }).noMoneyPreflight,
    ).toEqual({ playerId: 'SAMPLE-PLAYER', amountMinor: 10000 });
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
      FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '9999',
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
    { INTERNAL_COMPANION_ROUTINE_PLAYER_VALIDATION_ENABLED: 'true' },
    { FETANAGENT_COMPANION_ROUTINE_PLAYER_FIND_ENABLED: 'false' },
    { FETANAGENT_COMPANION_ROUTINE_PLAYER_FIND_ENABLED: 'TRUE' },
    {
      FETANAGENT_COMPANION_ROUTINE_PLAYER_FIND_ENABLED: 'true',
      FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID: 'SAMPLE-PLAYER',
      FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR: '2500',
    },
  ])('rejects incomplete, invalid, or ambient protected inputs', (override) => {
    expect(() => parseRoutineDepositLauncherInput({ ...BASE, ...override })).toThrow(
      'protected routine-deposit launcher is unavailable',
    );
  });
});
