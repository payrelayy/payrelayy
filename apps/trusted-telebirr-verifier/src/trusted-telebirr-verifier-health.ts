export const TRUSTED_TELEBIRR_VERIFIER_HEALTH_HOST = '127.0.0.1' as const;
export const TRUSTED_TELEBIRR_VERIFIER_HEALTH_PORT = 8091 as const;

export type TrustedTelebirrVerifierReadiness =
  | {
      readonly ready: true;
      readonly status: 'ready';
      readonly service: 'fetanagent-trusted-telebirr-verifier';
    }
  | {
      readonly ready: false;
      readonly status: 'unavailable';
      readonly service: 'fetanagent-trusted-telebirr-verifier';
      readonly reason: 'database_unavailable' | 'stopping';
    };

export interface TrustedTelebirrVerifierHealth {
  healthz(): {
    readonly status: 'ok';
    readonly service: 'fetanagent-trusted-telebirr-verifier';
  };
  readyz(): Promise<TrustedTelebirrVerifierReadiness>;
  markStopping(): void;
}

function unavailable(
  reason: Extract<TrustedTelebirrVerifierReadiness, { readonly ready: false }>['reason'],
): TrustedTelebirrVerifierReadiness {
  return Object.freeze({
    ready: false as const,
    status: 'unavailable' as const,
    service: 'fetanagent-trusted-telebirr-verifier' as const,
    reason,
  });
}

/**
 * Redacted process health. Readiness proves the lifetime singleton and exact database catalog
 * preflight again; it never returns a key, identifier, digest, reference, or database detail.
 */
export function createTrustedTelebirrVerifierHealth(
  probeDatabase: () => Promise<boolean>,
): TrustedTelebirrVerifierHealth {
  let stopping = false;
  let readinessInFlight: Promise<TrustedTelebirrVerifierReadiness> | null = null;

  async function probe(): Promise<TrustedTelebirrVerifierReadiness> {
    if (stopping) return unavailable('stopping');
    let ready = false;
    try {
      ready = (await probeDatabase()) === true;
    } catch {
      ready = false;
    }
    if (!ready) return unavailable('database_unavailable');
    if (stopping) return unavailable('stopping');
    return Object.freeze({
      ready: true as const,
      status: 'ready' as const,
      service: 'fetanagent-trusted-telebirr-verifier' as const,
    });
  }

  return Object.freeze({
    healthz: () =>
      Object.freeze({
        status: 'ok' as const,
        service: 'fetanagent-trusted-telebirr-verifier' as const,
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
