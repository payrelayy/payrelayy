import { pathToFileURL } from 'node:url';

import {
  createTrustedTelebirrVerifierApplication,
  type TrustedTelebirrVerifierApplication,
} from './trusted-telebirr-verifier-application.js';

export interface TrustedTelebirrVerifierMainDependencies {
  readonly createApplication?: () => Promise<TrustedTelebirrVerifierApplication>;
  readonly reportFailure?: () => void;
  readonly setExitCode?: (exitCode: number) => void;
}

export async function runTrustedTelebirrVerifierMain(
  dependencies: TrustedTelebirrVerifierMainDependencies = {},
): Promise<void> {
  try {
    const application = await (
      dependencies.createApplication ?? createTrustedTelebirrVerifierApplication
    )();
    await application.run();
  } catch {
    (
      dependencies.reportFailure ??
      (() => console.error('FetanAgent trusted TeleBirr verifier failed closed.'))
    )();
    (dependencies.setExitCode ?? ((exitCode) => (process.exitCode = exitCode)))(1);
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  await runTrustedTelebirrVerifierMain();
}
