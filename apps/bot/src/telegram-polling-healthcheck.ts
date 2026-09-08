import { isTelegramPollingReady } from './telegram-polling-readiness.js';

// Deliberately no output, credentials, network requests, or command-line path overrides.
process.exitCode = isTelegramPollingReady() ? 0 : 1;
