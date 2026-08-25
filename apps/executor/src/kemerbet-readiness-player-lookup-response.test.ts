import { describe, expect, it } from 'vitest';

import {
  KEMERBET_READINESS_PLAYER_LOOKUP_RESPONSE_CONTRACT,
  validateKemerBetReadinessPlayerLookupResponse,
} from './kemerbet-readiness-player-lookup-response.js';

const PLAYER_ID = 'PLAYER-ALPHA';

function body(overrides: Readonly<Record<string, unknown>> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      value: {
        currencyCode: 'ETB',
        email: 'player@example.invalid',
        externalId: PLAYER_ID,
        id: 78123,
        userName: 'player@example.invalid',
        ...overrides,
      },
    }),
    'utf8',
  );
}

describe('KemerBet readiness trusted lookup response parser', () => {
  it('accepts only HTTP 200 exact requested ID, ETB, positive safe id, and bounded identity', () => {
    expect(
      validateKemerBetReadinessPlayerLookupResponse({
        body: body(),
        requestedPlayerId: PLAYER_ID,
        statusCode: 200,
      }),
    ).toBe(true);
    expect(KEMERBET_READINESS_PLAYER_LOOKUP_RESPONSE_CONTRACT).toMatchObject({
      currencyCode: 'ETB',
      maximumJsonBytes: 65_536,
      statusCode: 200,
    });
  });

  it.each([
    ['non-200', 500, body()],
    ['wrong external ID', 200, body({ externalId: 'PLAYER-SWAPPED' })],
    ['wrong currency', 200, body({ currencyCode: 'USD' })],
    ['zero id', 200, body({ id: 0 })],
    ['unsafe id', 200, body({ id: Number.MAX_SAFE_INTEGER + 1 })],
    ['missing identity', 200, body({ email: null, userName: null })],
    ['invalid JSON', 200, Buffer.from('{', 'utf8')],
    ['invalid UTF-8', 200, Buffer.from([0xff, 0xfe])],
  ])('rejects %s without returning response data', (_name, statusCode, responseBody) => {
    expect(
      validateKemerBetReadinessPlayerLookupResponse({
        body: responseBody as Buffer,
        requestedPlayerId: PLAYER_ID,
        statusCode: statusCode as number,
      }),
    ).toBe(false);
  });

  it('rejects over-bounded JSON', () => {
    expect(
      validateKemerBetReadinessPlayerLookupResponse({
        body: Buffer.alloc(65_537, 0x20),
        requestedPlayerId: PLAYER_ID,
        statusCode: 200,
      }),
    ).toBe(false);
  });
});
