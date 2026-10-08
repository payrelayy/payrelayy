/** Private, Unix-socket-only transport between the public phone bridge and the protected broker. */
export const ROUTINE_NO_MONEY_LOCAL_PATH = '/v1/telebirr/routine/broker:execute' as const;
export const ROUTINE_NO_MONEY_LOCAL_CONTENT_TYPE =
  'application/vnd.fetanagent.telebirr-routine-broker.v1+json' as const;
export const ROUTINE_NO_MONEY_LOCAL_MAX_BYTES = 32_768 as const;

/** Distinct paid-work transport; never accepted by the no-money local handler. */
export const ROUTINE_PAID_POLL_LOCAL_PATH = '/v1/telebirr/routine/paid/broker:execute' as const;
export const ROUTINE_PAID_POLL_LOCAL_CONTENT_TYPE =
  'application/vnd.fetanagent.telebirr-routine-paid-broker.v1+json' as const;
export const ROUTINE_PAID_POLL_LOCAL_MAX_BYTES = 32_768 as const;
