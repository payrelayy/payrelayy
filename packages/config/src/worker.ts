import { loadRuntimeConfig, type RuntimeConfig } from './shared.js';

export type WorkerConfig = RuntimeConfig;

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return loadRuntimeConfig(environment);
}

export function redactedWorkerConfigForLog(config: WorkerConfig): WorkerConfig {
  return config;
}
