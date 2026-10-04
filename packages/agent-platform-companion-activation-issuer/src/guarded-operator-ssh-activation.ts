import type { SignedCompanionExecutionActivationHandoff } from '@fetanagent/agent-platform-companion-execution-contracts';

import {
  GuardedOperatorActivationUnavailableError,
  guardedOperatorActivationFailureStage,
  guardedOperatorActivationCleanupStage,
  runGuardedOperatorActivationWithProtectedRemoteSession,
  type GuardedOperatorActivationFailureStage,
  type GuardedOperatorActivationInput,
} from './guarded-operator-activation.js';
import type { GuardedOperatorRemoteSession } from './guarded-operator-query-client.js';
import type { ProtectedOperatorDeviceSigner } from './protected-operator-query-http-client.js';
import {
  ProtectedOperatorSshClientUnavailableError,
  createProtectedOperatorSshEmergencyStop,
  createProtectedOperatorSshHandoffSigner,
  createProtectedOperatorSshRemoteSession,
  type ProtectedOperatorSshConnection,
} from './protected-operator-query-ssh-client.js';

export {
  GuardedOperatorActivationUnavailableError,
  isGuardedOperatorActivationFailureStage,
  type GuardedOperatorActivationFailureStage,
} from './guarded-operator-activation.js';

type ActivationInput = Omit<
  GuardedOperatorActivationInput,
  'administrator' | 'signHandoff' | 'disableDatabase'
>;

interface SshActivationAdapters {
  stop(connection: ProtectedOperatorSshConnection): (requestKey: string) => Promise<void>;
  sign(
    device: ProtectedOperatorDeviceSigner,
    connection: ProtectedOperatorSshConnection,
  ): (requestKey: string) => Promise<SignedCompanionExecutionActivationHandoff>;
  open(
    device: ProtectedOperatorDeviceSigner,
    requestKey: string,
    connection: ProtectedOperatorSshConnection,
  ): Promise<GuardedOperatorRemoteSession>;
  activate: typeof runGuardedOperatorActivationWithProtectedRemoteSession;
}

const productionAdapters: SshActivationAdapters = {
  stop: createProtectedOperatorSshEmergencyStop,
  sign: createProtectedOperatorSshHandoffSigner,
  open: createProtectedOperatorSshRemoteSession,
  activate: runGuardedOperatorActivationWithProtectedRemoteSession,
};

/**
 * The protected host permits exactly one signed handoff before its first query.
 * Cache that response for the coordinator's later publication step; neither a
 * second signature nor an unsigned query can overtake it. The coordinator owns
 * and closes the finite remote session after it opens.
 */
export async function runGuardedOperatorActivationOverSshWithAdapters(
  input: ActivationInput,
  device: ProtectedOperatorDeviceSigner,
  connection: ProtectedOperatorSshConnection,
  adapters: SshActivationAdapters,
): Promise<'confirmed' | 'review_required'> {
  let remote: GuardedOperatorRemoteSession | undefined;
  let stage: GuardedOperatorActivationFailureStage = 'input_validation';
  try {
    if (!input || input.signal?.aborted || !device || !connection) throw new Error();
    stage = 'handoff_signing';
    let signed: SignedCompanionExecutionActivationHandoff | undefined = await adapters.sign(
      device,
      connection,
    )(input.requestKey);
    const stop = adapters.stop(connection);
    stage = 'remote_session_open';
    remote = await adapters.open(device, input.requestKey, connection);
    stage = 'unconfirmed';
    const result = await adapters.activate(
      {
        ...input,
        disableDatabase: () => stop(input.requestKey),
        signHandoff: async (requestKey) => {
          if (requestKey !== input.requestKey || !signed) throw new Error();
          const handoff = signed;
          signed = undefined;
          return handoff;
        },
      },
      remote,
    );
    stage = 'handoff_binding';
    if (signed) throw new Error();
    return result;
  } catch (error) {
    let failureStage = guardedOperatorActivationFailureStage(error, stage);
    let cleanupStage = guardedOperatorActivationCleanupStage(error);
    if (
      stage === 'handoff_signing' &&
      error instanceof ProtectedOperatorSshClientUnavailableError
    ) {
      if (error.handoffStage === 'local_preflight') failureStage = 'handoff_local_preflight';
      else if (error.handoffStage === 'ssh_transport') failureStage = 'handoff_ssh_transport';
      else if (error.handoffStage === 'http_response') failureStage = 'handoff_http_response';
      else if (error.handoffStage === 'handoff_binding') failureStage = 'handoff_binding';
    }
    // The coordinator normally owns close; cover a failure before it takes ownership.
    await remote?.close().catch(() => {
      cleanupStage ??= 'remote_session_close';
    });
    throw new GuardedOperatorActivationUnavailableError(failureStage, cleanupStage);
  }
}

export function runGuardedOperatorActivationOverSsh(
  input: ActivationInput,
  device: ProtectedOperatorDeviceSigner,
  connection: ProtectedOperatorSshConnection,
): Promise<'confirmed' | 'review_required'> {
  if (process.platform !== 'win32') throw new GuardedOperatorActivationUnavailableError();
  return runGuardedOperatorActivationOverSshWithAdapters(
    input,
    device,
    connection,
    productionAdapters,
  );
}
