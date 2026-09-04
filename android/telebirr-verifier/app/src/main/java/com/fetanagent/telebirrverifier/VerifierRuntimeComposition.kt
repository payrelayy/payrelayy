package com.fetanagent.telebirrverifier

import android.content.Context

fun interface VerifierRuntimeCycle {
  fun runOnce(): LivePilotRuntimeStatus
}

fun interface VerifierRuntimeHeartbeat {
  fun heartbeat(status: LivePilotRuntimeStatus): DeviceBridgeHeartbeatResult
}

class VerifierRuntimeSession(
  val cycle: VerifierRuntimeCycle,
  val heartbeat: VerifierRuntimeHeartbeat?,
) {
  override fun toString(): String = "VerifierRuntimeSession(<redacted>)"
}

/**
 * Fail-closed application composition seam. Production enrollment material is intentionally absent
 * from this inert artifact. The foreground lifecycle can therefore be exercised and reviewed
 * without silently inventing a trusted signer, enrollment, pairing grant, or live pilot.
 */
object VerifierRuntimeComposition {
  @Suppress("UNUSED_PARAMETER")
  fun create(context: Context): VerifierRuntimeSession {
    return VerifierRuntimeSession(
      cycle =
        VerifierRuntimeCycle {
          LivePilotRuntimeStatus(
            state = LivePilotRuntimeState.ENROLLMENT_REQUIRED,
            code = "provisioning_required",
          )
        },
      heartbeat = null,
    )
  }
}
