package com.fetanagent.telebirrverifier

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restarts only a previously operator-enabled verifier after a completed boot or app replacement. */
class VerifierBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action !in SUPPORTED_ACTIONS) return
    val stateStore = VerifierOperationalStateStore(context)
    val snapshot = stateStore.snapshot()
    if (!VerifierPlatformPrerequisites.canStart(context, snapshot)) {
      if (snapshot.operatorEnabled) {
        runCatching {
          stateStore.recordStatus(
            if (!BuildConfig.VERIFIER_ENABLED) {
              LivePilotRuntimeStatus(LivePilotRuntimeState.DISABLED, "build_disabled")
            } else {
              LivePilotRuntimeStatus(
                LivePilotRuntimeState.ATTENTION,
                "notification_permission_required",
              )
            },
          )
          stateStore.setOperatorEnabled(false)
        }
      }
      return
    }
    runCatching { VerifierForegroundService.requestStart(context) }
      .onFailure {
        runCatching {
          stateStore.recordStatus(
            LivePilotRuntimeStatus(
              LivePilotRuntimeState.ATTENTION,
              "foreground_start_unavailable",
            ),
          )
          stateStore.setOperatorEnabled(false)
        }
      }
  }

  companion object {
    private val SUPPORTED_ACTIONS =
      setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)
  }
}
