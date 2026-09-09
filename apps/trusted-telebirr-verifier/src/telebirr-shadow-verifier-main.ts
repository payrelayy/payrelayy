import { pathToFileURL } from 'node:url';

import {
  createTelebirrShadowVerifierApplication,
  type TelebirrShadowVerifierApplicationDependencies,
} from './telebirr-shadow-verifier-application.js';
import type { TrustedTelebirrVerifierApplication } from './trusted-telebirr-verifier-application.js';

export interface TelebirrShadowVerifierMainDependencies {
  readonly createApplication?: () => Promise<TrustedTelebirrVerifierApplication>;
  readonly reportFailure?: () => void;
  readonly setExitCode?: (exitCode: number) => void;
}

export async function runTelebirrShadowVerifierMain(
  dependencies: TelebirrShadowVerifierMainDependencies = {},
): Promise<void> {
  try {
    const application = await (
      dependencies.createApplication ?? createTelebirrShadowVerifierApplication
    )();
    await application.run();
  } catch {
    (
      dependencies.reportFailure ??
      (() => console.error('FetanAgent TeleBirr shadow verifier failed closed.'))
    )();
    (dependencies.setExitCode ?? ((exitCode) => (process.exitCode = exitCode)))(1);
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  await runTelebirrShadowVerifierMain();
}

export type { TelebirrShadowVerifierApplicationDependencies };
