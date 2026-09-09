export const TRUSTED_TELEBIRR_VERIFIER_HEALTH_HOST = '127.0.0.1' as const;
export const TRUSTED_TELEBIRR_VERIFIER_HEALTH_PORT = 8091 as const;
export const TELEBIRR_SHADOW_VERIFIER_HEALTH_PORT = 8092 as const;

export type TelebirrVerifierService =
  'fetanagent-trusted-telebirr-verifier' | 'fetanagent-telebirr-shadow-verifier';

export type TrustedTelebirrVerifierReadiness =
  | {
      readonly ready: true;
      readonly status: 'ready';
      readonly service: TelebirrVerifierService;
    }
  | {
      readonly ready: false;
      readonly status: 'unavailable';
      readonly service: TelebirrVerifierService;
      readonly reason: 'database_unavailable' | 'stopping';
    };

export interface TrustedTelebirrVerifierHealth {
  healthz(): {
    readonly status: 'ok';
    readonly service: TelebirrVerifierService;
  };
  readyz(): Promise<TrustedTelebirrVerifierReadiness>;
  markStopping(): void;
}

function unavailable(
  reason: Extract<TrustedTelebirrVerifierReadiness, { readonly ready: false }>['reason'],
  service: TelebirrVerifierService,
): TrustedTelebirrVerifierReadiness {
  return Object.freeze({
    ready: false as const,
    status: 'unavailable' as const,
    service,
    reason,
  });
}

/**
 * Redacted process health. Readiness proves the lifetime singleton and exact database catalog
 * preflight again; it never returns a key, identifier, digest, reference, or database detail.
 */
function createTelebirrVerifierHealth(
  probeDatabase: () => Promise<boolean>,
  service: TelebirrVerifierService,
): TrustedTelebirrVerifierHealth {
  let stopping = false;
  let readinessInFlight: Promise<TrustedTelebirrVerifierReadiness> | null = null;

  async function probe(): Promise<TrustedTelebirrVerifierReadiness> {
    if (stopping) return unavailable('stopping', service);
    let ready = false;
    try {
      ready = (await probeDatabase()) === true;
    } catch {
      ready = false;
    }
    if (!ready) return unavailable('database_unavailable', service);
    if (stopping) return unavailable('stopping', service);
    return Object.freeze({
      ready: true as const,
      status: 'ready' as const,
      service,
    });
  }

  return Object.freeze({
    healthz: () =>
      Object.freeze({
        status: 'ok' as const,
        service,
      }),

    readyz() {
      if (readinessInFlight !== null) return readinessInFlight;
      const pending = probe().finally(() => {
        if (readinessInFlight === pending) readinessInFlight = null;
      });
      readinessInFlight = pending;
      return pending;
    },

    markStopping() {
      stopping = true;
    },
  });
}

export function createTrustedTelebirrVerifierHealth(
  probeDatabase: () => Promise<boolean>,
): TrustedTelebirrVerifierHealth {
  return createTelebirrVerifierHealth(probeDatabase, 'fetanagent-trusted-telebirr-verifier');
}

export function createTelebirrShadowVerifierHealth(
  probeDatabase: () => Promise<boolean>,
): TrustedTelebirrVerifierHealth {
  return createTelebirrVerifierHealth(probeDatabase, 'fetanagent-telebirr-shadow-verifier');
}
