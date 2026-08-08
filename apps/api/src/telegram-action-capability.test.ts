import { describe, expect, it } from 'vitest';

import {
  createTelegramActionSemanticHmac,
  decodePlayerRegistrationCapabilityCallback,
  decodeTelegramCapabilityId,
  derivePlayerRegistrationCapabilityPresentation,
  deriveTelegramPlayerRegistrationCapabilityId,
  encodeTelegramCapabilityId,
} from './telegram-action-capability.js';

const originInboundEventId = '64b27169-c249-4d2e-b312-d2ed9d6661ea';
const keys = {
  capabilityHmacSecret: 'a'.repeat(64),
  semanticHmacSecret: 'b'.repeat(64),
} as const;
const actionContext = {
  actionId: '0a5fa0f3-c7b9-405c-a49c-84c5d8d4be18',
  capabilityId: '9de75e42-a628-4f8f-9f9f-9f321dbf21b0',
  expectedConversationVersion: '2',
} as const;

describe('Telegram Player ID capability protection', () => {
  it('derives one canonical opaque capability ID per recorded inbound event', () => {
    const first = deriveTelegramPlayerRegistrationCapabilityId(
      originInboundEventId,
      keys.capabilityHmacSecret,
    );
    const retry = deriveTelegramPlayerRegistrationCapabilityId(
      originInboundEventId,
      keys.capabilityHmacSecret,
    );
    const different = deriveTelegramPlayerRegistrationCapabilityId(
      '58eeef22-21eb-4fe6-9f64-8637daed6874',
      keys.capabilityHmacSecret,
    );

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(retry).toBe(first);
    expect(different).not.toBe(first);
  });

  it('round-trips the compact canonical capability identifier', () => {
    const capabilityId = deriveTelegramPlayerRegistrationCapabilityId(
      originInboundEventId,
      keys.capabilityHmacSecret,
    );
    const compact = encodeTelegramCapabilityId(capabilityId);

    expect(compact).toHaveLength(22);
    expect(decodeTelegramCapabilityId(compact)).toBe(capabilityId);
    expect(decodeTelegramCapabilityId(`${compact}=`)).toBeUndefined();
    expect(decodeTelegramCapabilityId('not-a-compact-capability')).toBeUndefined();
  });

  it('derives a deterministic opaque callback and independently blinded values', () => {
    const first = derivePlayerRegistrationCapabilityPresentation({
      originInboundEventId,
      keys,
    });
    const retry = derivePlayerRegistrationCapabilityPresentation({
      originInboundEventId,
      keys,
    });
    const differentCapability = derivePlayerRegistrationCapabilityPresentation({
      originInboundEventId: '58eeef22-21eb-4fe6-9f64-8637daed6874',
      keys,
    });

    expect(retry).toEqual(first);
    expect(first.callbackData).toHaveLength(50);
    expect(first.tokenFingerprint).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/);
    expect(first.issueSemanticInputHmac).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/);
    expect(first.callbackData).not.toContain(keys.capabilityHmacSecret);
    expect(first.callbackData).not.toContain(keys.semanticHmacSecret);
    expect(differentCapability.callbackData).not.toBe(first.callbackData);
    expect(differentCapability.tokenFingerprint).not.toBe(first.tokenFingerprint);
  });

  it('converts a customer callback to only a capability UUID and blinded token fingerprint', () => {
    const presentation = derivePlayerRegistrationCapabilityPresentation({
      originInboundEventId,
      keys,
    });

    expect(
      decodePlayerRegistrationCapabilityCallback(
        presentation.callbackData,
        keys.capabilityHmacSecret,
      ),
    ).toEqual({
      capabilityId: presentation.capabilityId,
      tokenFingerprint: presentation.tokenFingerprint,
    });
    const tamperedCallback = `${presentation.callbackData.slice(0, -1)}${
      presentation.callbackData.endsWith('A') ? 'B' : 'A'
    }`;
    expect(
      decodePlayerRegistrationCapabilityCallback(tamperedCallback, keys.capabilityHmacSecret),
    ).not.toEqual({
      capabilityId: presentation.capabilityId,
      tokenFingerprint: presentation.tokenFingerprint,
    });
  });

  it('domain-separates start semantics from capability issuance', () => {
    const presentation = derivePlayerRegistrationCapabilityPresentation({
      originInboundEventId,
      keys,
    });
    const startSemanticHmac = createTelegramActionSemanticHmac({
      consumer: 'start_player_registration',
      originInboundEventId,
      capabilityId: presentation.capabilityId,
      tokenFingerprint: presentation.tokenFingerprint,
      semanticHmacSecret: keys.semanticHmacSecret,
    });

    expect(startSemanticHmac).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/);
    expect(startSemanticHmac).not.toBe(presentation.issueSemanticInputHmac);
  });

  it('binds server-derived action context and HMAC-only Player ID normalization', () => {
    const first = createTelegramActionSemanticHmac({
      consumer: 'submit_player_registration_input',
      originInboundEventId,
      playerId: '  28379330  ',
      semanticHmacSecret: keys.semanticHmacSecret,
      ...actionContext,
    });
    const retry = createTelegramActionSemanticHmac({
      consumer: 'submit_player_registration_input',
      originInboundEventId,
      playerId: '28379330',
      semanticHmacSecret: keys.semanticHmacSecret,
      ...actionContext,
    });
    const expiry = createTelegramActionSemanticHmac({
      consumer: 'expire_player_registration_action',
      originInboundEventId,
      semanticHmacSecret: keys.semanticHmacSecret,
      ...actionContext,
    });

    expect(first).toBe(retry);
    expect(expiry).not.toBe(first);
    expect(first).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/);
    expect(
      createTelegramActionSemanticHmac({
        consumer: 'submit_player_registration_input',
        originInboundEventId,
        playerId: 'player id',
        semanticHmacSecret: keys.semanticHmacSecret,
        ...actionContext,
      }),
    ).not.toBe(first);

    const differentContext = createTelegramActionSemanticHmac({
      consumer: 'submit_player_registration_input',
      originInboundEventId,
      playerId: '28379330',
      semanticHmacSecret: keys.semanticHmacSecret,
      ...actionContext,
      expectedConversationVersion: 3n,
    });
    const nonAsciiWhitespace = createTelegramActionSemanticHmac({
      consumer: 'submit_player_registration_input',
      originInboundEventId,
      playerId: '\u00a028379330\u00a0',
      semanticHmacSecret: keys.semanticHmacSecret,
      ...actionContext,
    });
    const differentAction = createTelegramActionSemanticHmac({
      consumer: 'submit_player_registration_input',
      originInboundEventId,
      playerId: '28379330',
      semanticHmacSecret: keys.semanticHmacSecret,
      ...actionContext,
      actionId: '2474da35-7a28-4b38-8fd7-e7bf4c7243d8',
    });

    expect(differentContext).not.toBe(first);
    expect(nonAsciiWhitespace).not.toBe(first);
    expect(differentAction).not.toBe(first);
    expect(() =>
      createTelegramActionSemanticHmac({
        consumer: 'expire_player_registration_action',
        originInboundEventId,
        semanticHmacSecret: keys.semanticHmacSecret,
        ...actionContext,
        expectedConversationVersion: '02',
      }),
    ).toThrow('canonical nonnegative integer');
    expect(() =>
      createTelegramActionSemanticHmac({
        consumer: 'expire_player_registration_action',
        originInboundEventId,
        semanticHmacSecret: keys.semanticHmacSecret,
        ...actionContext,
        actionId: actionContext.actionId.toUpperCase(),
      }),
    ).toThrow('canonical lowercase UUID');
    expect(() =>
      createTelegramActionSemanticHmac({
        consumer: 'unknown_consumer',
        originInboundEventId,
        semanticHmacSecret: keys.semanticHmacSecret,
      } as unknown as Parameters<typeof createTelegramActionSemanticHmac>[0]),
    ).toThrow('semantic consumer is invalid');
  });

  it('fails closed on malformed internal identifiers or secrets', () => {
    expect(() =>
      derivePlayerRegistrationCapabilityPresentation({
        originInboundEventId: originInboundEventId.toUpperCase(),
        keys,
      }),
    ).toThrow('canonical lowercase UUID');
    expect(() =>
      derivePlayerRegistrationCapabilityPresentation({
        originInboundEventId,
        keys: { ...keys, capabilityHmacSecret: 'not-a-secret' },
      }),
    ).toThrow('capability HMAC secret');
  });
});
