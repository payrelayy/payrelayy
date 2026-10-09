import { lstatSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { ROUTINE_PAID_SETTLEMENT_HEARTBEAT_FILE } from './routine-paid-settlement-main.js';

export function settlementHeartbeatFresh(value: string, now: number): boolean {
  if (!/^\d{13}\n$/u.test(value)) return false;
  const elapsed = now - Number(value.trim());
  return elapsed >= 0 && elapsed <= 20_000;
}

export function routinePaidSettlementHealthy(): boolean {
  try {
    const stat = lstatSync(ROUTINE_PAID_SETTLEMENT_HEARTBEAT_FILE);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== 10001 ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > 32
    )
      return false;
    return settlementHeartbeatFresh(
      readFileSync(ROUTINE_PAID_SETTLEMENT_HEARTBEAT_FILE, 'utf8'),
      Date.now(),
    );
  } catch {
    return false;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = routinePaidSettlementHealthy() ? 0 : 1;
}
