import { readFileSync } from 'node:fs';

import {
  booleanFromEnv,
  loadRuntimeConfig,
  requiredHexHmacSecret,
  type NodeEnvironment,
  type RuntimeConfig,
} from './shared.js';

export type TelegramConfig =
  | {
      readonly enabled: false;
      readonly token: undefined;
    }
  | {
      readonly enabled: true;
      readonly token: string;
    };

export type BotApiIngressConfig =
  | {
      readonly enabled: false;
      readonly baseUrl: undefined;
      readonly transportHmacSecret: undefined;
    }
  | {
      readonly enabled: true;
      readonly baseUrl: string;
      readonly transportHmacSecret: string;
    };

export type BotTelegramBetaAdmissionConfig =
  | {
      readonly enabled: false;
      readonly baseUrl: undefined;
      readonly transportHmacSecret: undefined;
    }
  | {
      readonly enabled: true;
      readonly baseUrl: string;
      readonly transportHmacSecret: string;
    };

/**
 * An independently authenticated private action-channel transport. The bot consumes it separately
 * from beta admission, so either feature can be enabled without implicitly enabling the other.
 */
export type BotTelegramActionChannelConfig =
  | {
      readonly enabled: false;
      readonly baseUrl: undefined;
      readonly transportHmacSecret: undefined;
    }
  | {
      readonly enabled: true;
      readonly baseUrl: string;
      readonly transportHmacSecret: string;
    };

export type BotScreenshotReferenceReaderConfig =
  | { readonly enabled: false; readonly modelAccessKey: undefined }
  | { readonly enabled: true; readonly modelAccessKey: string };

export interface BotConfig extends RuntimeConfig {
  readonly telegram: TelegramConfig;
  readonly apiIngress: BotApiIngressConfig;
  readonly telegramBetaAdmission: BotTelegramBetaAdmissionConfig;
  readonly telegramActionChannel: BotTelegramActionChannelConfig;
  readonly playerValidationIntakeEnabled: boolean;
  readonly receiverSmsCandidateEnabled: boolean;
  readonly screenshotReferenceReader: BotScreenshotReferenceReaderConfig;
  readonly supportContactUrl: string | undefined;
}

export const BOT_PUBLIC_SUPPORT_CONTACT_URL =
  'https://owner.fetanagent.com/v1/public/support-contact';

function optionalSupportContactUrl(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (value !== BOT_PUBLIC_SUPPORT_CONTACT_URL) {
    throw new Error('BOT_SUPPORT_CONTACT_URL must be the approved public support-contact URL.');
  }
  return value;
}

function secretFromEnvironmentOrFile(
  value: string | undefined,
  filePath: string | undefined,
  valueVariableName: string,
  fileVariableName: string,
  nodeEnv: NodeEnvironment,
  productionFilePath: string,
): string | undefined {
  const hasValue = value !== undefined && value !== '';
  const hasFile = filePath !== undefined && filePath !== '';
  if (hasValue && hasFile) {
    throw new Error(`${valueVariableName} and ${fileVariableName} are mutually exclusive.`);
  }
  if (hasValue) return value;
  if (!hasFile) return undefined;

  if (nodeEnv === 'production' && filePath !== productionFilePath) {
    throw new Error(`${fileVariableName} must use the approved private runtime secret path.`);
  }

  let secret: string;
  try {
    secret = readFileSync(filePath, 'utf8').replace(/\r?\n$/u, '');
  } catch {
    throw new Error(`${fileVariableName} could not be read.`);
  }
  if (!secret || /[\r\n]/u.test(secret)) {
    throw new Error(`${fileVariableName} must contain exactly one non-empty secret value.`);
  }
  return secret;
}

function requiredTelegramToken(
  value: string | undefined,
  filePath: string | undefined,
  nodeEnv: NodeEnvironment,
): string {
  const token = secretFromEnvironmentOrFile(
    value,
    filePath,
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_TOKEN_FILE',
    nodeEnv,
    '/run/secrets/telegram_bot_token',
  );
  if (!token) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN is required when TELEGRAM_BOT_ENABLED=true; TELEGRAM_BOT_TOKEN_FILE may be used instead.',
    );
  }
  return token;
}

function requiredInternalApiBaseUrl(value: string | undefined, nodeEnv: NodeEnvironment): string {
  if (!value) {
    throw new Error('BOT_TO_API_INGRESS_BASE_URL is required when TELEGRAM_BOT_ENABLED=true.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('BOT_TO_API_INGRESS_BASE_URL must be a valid internal HTTP(S) base URL.');
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('BOT_TO_API_INGRESS_BASE_URL must be an HTTP(S) origin without credentials.');
  }

  if (
    nodeEnv === 'production' &&
    (parsed.protocol !== 'http:' || parsed.hostname !== 'api' || parsed.port !== '3000')
  ) {
    throw new Error(
      'Production BOT_TO_API_INGRESS_BASE_URL must be the private Docker API origin http://api:3000/.',
    );
  }

  return parsed.toString();
}

function requiredActionApiBaseUrl(value: string | undefined, nodeEnv: NodeEnvironment): string {
  if (!value) {
    throw new Error(
      'BOT_TO_API_ACTION_BASE_URL is required when INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED=true.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('BOT_TO_API_ACTION_BASE_URL must be a valid internal HTTP(S) base URL.');
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('BOT_TO_API_ACTION_BASE_URL must be an HTTP(S) origin without credentials.');
  }

  if (
    nodeEnv === 'production' &&
    (parsed.protocol !== 'http:' || parsed.hostname !== 'api' || parsed.port !== '3000')
  ) {
    throw new Error(
      'Production BOT_TO_API_ACTION_BASE_URL must be the private Docker API origin http://api:3000/.',
    );
  }

  return parsed.toString();
}

function requiredBetaAdmissionBaseUrl(value: string | undefined, nodeEnv: NodeEnvironment): string {
  if (!value) {
    throw new Error(
      'BOT_TO_BETA_ADMISSION_BASE_URL is required when TELEGRAM_BETA_ADMISSION_ENABLED=true.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('BOT_TO_BETA_ADMISSION_BASE_URL must be a valid internal HTTP(S) base URL.');
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'BOT_TO_BETA_ADMISSION_BASE_URL must be an HTTP(S) origin without credentials.',
    );
  }

  if (
    nodeEnv === 'production' &&
    (parsed.protocol !== 'http:' || parsed.hostname !== 'beta-admission' || parsed.port !== '3001')
  ) {
    throw new Error(
      'Production BOT_TO_BETA_ADMISSION_BASE_URL must be the private Docker beta-admission origin http://beta-admission:3001/.',
    );
  }

  return parsed.toString();
}

function loadBotTelegramBetaAdmissionConfig(
  environment: NodeJS.ProcessEnv,
  nodeEnv: NodeEnvironment,
  telegramEnabled: boolean,
): BotTelegramBetaAdmissionConfig {
  const enabled = booleanFromEnv(
    environment.TELEGRAM_BETA_ADMISSION_ENABLED,
    false,
    'TELEGRAM_BETA_ADMISSION_ENABLED',
  );

  if (!enabled) {
    return {
      enabled: false,
      baseUrl: undefined,
      transportHmacSecret: undefined,
    };
  }

  if (!telegramEnabled) {
    throw new Error('TELEGRAM_BETA_ADMISSION_ENABLED requires TELEGRAM_BOT_ENABLED=true.');
  }
  return {
    enabled: true,
    baseUrl: requiredBetaAdmissionBaseUrl(environment.BOT_TO_BETA_ADMISSION_BASE_URL, nodeEnv),
    transportHmacSecret: requiredHexHmacSecret(
      secretFromEnvironmentOrFile(
        environment.BOT_TO_BETA_ADMISSION_HMAC_SECRET,
        environment.BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE,
        'BOT_TO_BETA_ADMISSION_HMAC_SECRET',
        'BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE',
        nodeEnv,
        '/run/secrets/bot_beta_admission_transport_hmac',
      ),
      'BOT_TO_BETA_ADMISSION_HMAC_SECRET',
    ),
  };
}

function loadBotTelegramActionChannelConfig(
  environment: NodeJS.ProcessEnv,
  nodeEnv: NodeEnvironment,
  telegramEnabled: boolean,
  enabled: boolean,
): BotTelegramActionChannelConfig {
  if (!enabled) {
    return {
      enabled: false,
      baseUrl: undefined,
      transportHmacSecret: undefined,
    };
  }

  if (!telegramEnabled) {
    throw new Error('INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED requires TELEGRAM_BOT_ENABLED=true.');
  }

  return {
    enabled: true,
    baseUrl: requiredActionApiBaseUrl(environment.BOT_TO_API_ACTION_BASE_URL, nodeEnv),
    transportHmacSecret: requiredHexHmacSecret(
      secretFromEnvironmentOrFile(
        environment.BOT_TO_API_ACTION_HMAC_SECRET,
        environment.BOT_TO_API_ACTION_HMAC_SECRET_FILE,
        'BOT_TO_API_ACTION_HMAC_SECRET',
        'BOT_TO_API_ACTION_HMAC_SECRET_FILE',
        nodeEnv,
        '/run/secrets/bot_player_action_transport_hmac',
      ),
      'BOT_TO_API_ACTION_HMAC_SECRET',
    ),
  };
}

function assertDistinctBotTelegramTransportHmacSecrets(
  apiIngress: BotApiIngressConfig,
  telegramActionChannel: BotTelegramActionChannelConfig,
): void {
  if (!apiIngress.enabled || !telegramActionChannel.enabled) return;

  if (apiIngress.transportHmacSecret === telegramActionChannel.transportHmacSecret) {
    throw new Error(
      'BOT_TO_API_ACTION_HMAC_SECRET must be distinct from BOT_TO_API_INGRESS_HMAC_SECRET.',
    );
  }
}

export function loadBotConfig(environment: NodeJS.ProcessEnv = process.env): BotConfig {
  const runtime = loadRuntimeConfig(environment);
  const supportContactUrl = optionalSupportContactUrl(environment.BOT_SUPPORT_CONTACT_URL);
  const enabled = booleanFromEnv(environment.TELEGRAM_BOT_ENABLED, false, 'TELEGRAM_BOT_ENABLED');
  const actionChannelEnabled = booleanFromEnv(
    environment.INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED,
    false,
    'INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED',
  );
  const telegramBetaAdmission = loadBotTelegramBetaAdmissionConfig(
    environment,
    runtime.nodeEnv,
    enabled,
  );
  const telegramActionChannel = loadBotTelegramActionChannelConfig(
    environment,
    runtime.nodeEnv,
    enabled,
    actionChannelEnabled,
  );
  const playerValidationIntakeEnabled = booleanFromEnv(
    environment.INTERNAL_TELEGRAM_PLAYER_VALIDATION_INTAKE_ENABLED,
    false,
    'INTERNAL_TELEGRAM_PLAYER_VALIDATION_INTAKE_ENABLED',
  );
  const receiverSmsCandidateEnabled = booleanFromEnv(
    environment.BOT_RECEIVER_SMS_CANDIDATE_ENABLED,
    false,
    'BOT_RECEIVER_SMS_CANDIDATE_ENABLED',
  );
  const screenshotReferenceReaderEnabled = booleanFromEnv(
    environment.BOT_SCREENSHOT_REFERENCE_READER_ENABLED,
    false,
    'BOT_SCREENSHOT_REFERENCE_READER_ENABLED',
  );
  if (screenshotReferenceReaderEnabled && (!enabled || !receiverSmsCandidateEnabled)) {
    throw new Error('Screenshot reference reading requires the live receiver SMS candidate route.');
  }
  const screenshotReferenceReader: BotScreenshotReferenceReaderConfig =
    screenshotReferenceReaderEnabled
      ? {
          enabled: true,
          modelAccessKey:
            secretFromEnvironmentOrFile(
              environment.BOT_SCREENSHOT_REFERENCE_MODEL_ACCESS_KEY,
              environment.BOT_SCREENSHOT_REFERENCE_MODEL_ACCESS_KEY_FILE,
              'BOT_SCREENSHOT_REFERENCE_MODEL_ACCESS_KEY',
              'BOT_SCREENSHOT_REFERENCE_MODEL_ACCESS_KEY_FILE',
              runtime.nodeEnv,
              '/run/secrets/bot_screenshot_reference_model_access_key',
            ) ?? '',
        }
      : { enabled: false, modelAccessKey: undefined };
  if (screenshotReferenceReader.enabled && !screenshotReferenceReader.modelAccessKey) {
    throw new Error('Screenshot reference reader requires its model access key.');
  }
  if (receiverSmsCandidateEnabled && (!enabled || !telegramActionChannel.enabled)) {
    throw new Error(
      'The receiver SMS candidate route requires the private Telegram action channel.',
    );
  }
  if (playerValidationIntakeEnabled && (!enabled || !telegramActionChannel.enabled)) {
    throw new Error('Player validation intake requires the private Telegram action channel.');
  }

  if (!enabled) {
    return {
      ...runtime,
      telegram: {
        enabled: false,
        token: undefined,
      },
      apiIngress: {
        enabled: false,
        baseUrl: undefined,
        transportHmacSecret: undefined,
      },
      telegramBetaAdmission,
      telegramActionChannel,
      playerValidationIntakeEnabled,
      receiverSmsCandidateEnabled,
      screenshotReferenceReader,
      supportContactUrl,
    };
  }

  const telegram: TelegramConfig = {
    enabled: true,
    token: requiredTelegramToken(
      environment.TELEGRAM_BOT_TOKEN,
      environment.TELEGRAM_BOT_TOKEN_FILE,
      runtime.nodeEnv,
    ),
  };
  const legacyApiIngressEnabled = booleanFromEnv(
    environment.BOT_TO_API_INGRESS_ENABLED,
    true,
    'BOT_TO_API_INGRESS_ENABLED',
  );
  const apiIngress: BotApiIngressConfig =
    telegramBetaAdmission.enabled || !legacyApiIngressEnabled
      ? {
          enabled: false,
          baseUrl: undefined,
          transportHmacSecret: undefined,
        }
      : {
          enabled: true,
          baseUrl: requiredInternalApiBaseUrl(
            environment.BOT_TO_API_INGRESS_BASE_URL,
            runtime.nodeEnv,
          ),
          transportHmacSecret: requiredHexHmacSecret(
            environment.BOT_TO_API_INGRESS_HMAC_SECRET,
            'BOT_TO_API_INGRESS_HMAC_SECRET',
          ),
        };
  assertDistinctBotTelegramTransportHmacSecrets(apiIngress, telegramActionChannel);

  return {
    ...runtime,
    telegram,
    apiIngress,
    telegramBetaAdmission,
    telegramActionChannel,
    playerValidationIntakeEnabled,
    receiverSmsCandidateEnabled,
    screenshotReferenceReader,
    supportContactUrl,
  };
}

export function redactedBotConfigForLog(config: BotConfig): Omit<
  BotConfig,
  | 'telegram'
  | 'apiIngress'
  | 'telegramBetaAdmission'
  | 'telegramActionChannel'
  | 'screenshotReferenceReader'
  | 'supportContactUrl'
> & {
  readonly supportContactConfigured: boolean;
  readonly telegram: { readonly enabled: boolean; readonly tokenConfigured: boolean };
  readonly apiIngress: { readonly enabled: boolean; readonly secretsConfigured: boolean };
  readonly telegramBetaAdmission: {
    readonly enabled: boolean;
    readonly secretsConfigured: boolean;
  };
  readonly telegramActionChannel: {
    readonly enabled: boolean;
    readonly secretsConfigured: boolean;
  };
  readonly playerValidationIntakeEnabled: boolean;
  readonly receiverSmsCandidateEnabled: boolean;
  readonly screenshotReferenceReader: {
    readonly enabled: boolean;
    readonly keyConfigured: boolean;
  };
} {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    supportContactConfigured: config.supportContactUrl !== undefined,
    telegram: {
      enabled: config.telegram.enabled,
      tokenConfigured: config.telegram.enabled,
    },
    apiIngress: {
      enabled: config.apiIngress.enabled,
      secretsConfigured: config.apiIngress.enabled,
    },
    telegramBetaAdmission: {
      enabled: config.telegramBetaAdmission.enabled,
      secretsConfigured: config.telegramBetaAdmission.enabled,
    },
    telegramActionChannel: {
      enabled: config.telegramActionChannel.enabled,
      secretsConfigured: config.telegramActionChannel.enabled,
    },
    playerValidationIntakeEnabled: config.playerValidationIntakeEnabled,
    receiverSmsCandidateEnabled: config.receiverSmsCandidateEnabled,
    screenshotReferenceReader: {
      enabled: config.screenshotReferenceReader.enabled,
      keyConfigured: config.screenshotReferenceReader.enabled,
    },
  };
}
