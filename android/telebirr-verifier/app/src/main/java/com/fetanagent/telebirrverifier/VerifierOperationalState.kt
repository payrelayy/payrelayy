package com.fetanagent.telebirrverifier

import android.Manifest
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build

data class VerifierOperationalSnapshot(
  val operatorEnabled: Boolean,
  val status: LivePilotRuntimeStatus,
  val updatedAtMillis: Long,
)

/** Stores only non-sensitive lifecycle state. Keys, references, receipts, and signed payloads never
 * enter preferences. */
class VerifierOperationalStateStore internal constructor(
  private val preferences: SharedPreferences,
) {
  constructor(context: Context) : this(
    context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE),
  )

  /** Keeps a visible screen in sync with writes made by the separate service store instance. */
  fun observeChanges(onChange: () -> Unit): () -> Unit {
    var observing = true
    val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
      if (observing && key in OPERATIONAL_KEYS) onChange()
    }
    preferences.registerOnSharedPreferenceChangeListener(listener)
    // Retaining this closure also retains the listener, which SharedPreferences holds weakly.
    return {
      if (observing) {
        observing = false
        preferences.unregisterOnSharedPreferenceChangeListener(listener)
      }
    }
  }

  fun snapshot(): VerifierOperationalSnapshot {
    val state =
      runCatching {
          LivePilotRuntimeState.valueOf(
            preferences.getString(STATUS_STATE, null) ?: LivePilotRuntimeState.DISABLED.name,
          )
        }
        .getOrDefault(LivePilotRuntimeState.DISABLED)
    val storedCode = runCatching { preferences.getString(STATUS_CODE, null) }.getOrNull()
    val code =
      storedCode?.takeIf { Regex("^[a-z][a-z0-9_]{2,63}$").matches(it) }
        ?: "build_disabled"
    val status =
      runCatching { LivePilotRuntimeStatus(state, code) }
        .getOrElse { LivePilotRuntimeStatus(LivePilotRuntimeState.DISABLED, "build_disabled") }
    return VerifierOperationalSnapshot(
      operatorEnabled =
        runCatching { preferences.getBoolean(OPERATOR_ENABLED, false) }.getOrDefault(false),
      status = status,
      updatedAtMillis =
        runCatching { preferences.getLong(UPDATED_AT_MILLIS, 0L) }
          .getOrDefault(0L)
          .coerceAtLeast(0L),
    )
  }

  fun setOperatorEnabled(enabled: Boolean) {
    check(preferences.edit().putBoolean(OPERATOR_ENABLED, enabled).commit()) {
      "Unable to persist operator state"
    }
  }

  fun recordStatus(status: LivePilotRuntimeStatus, updatedAtMillis: Long = System.currentTimeMillis()) {
    check(updatedAtMillis >= 0L)
    check(
      preferences
        .edit()
        .putString(STATUS_STATE, status.state.name)
        .putString(STATUS_CODE, status.code)
        .putLong(UPDATED_AT_MILLIS, updatedAtMillis)
        .commit(),
    ) {
      "Unable to persist verifier status"
    }
  }

  companion object {
    private const val PREFERENCES_NAME = "fetanagent_telebirr_operational_state_v1"
    private const val OPERATOR_ENABLED = "operator_enabled"
    private const val STATUS_STATE = "status_state"
    private const val STATUS_CODE = "status_code"
    private const val UPDATED_AT_MILLIS = "updated_at_millis"
    private val OPERATIONAL_KEYS =
      setOf(OPERATOR_ENABLED, STATUS_STATE, STATUS_CODE, UPDATED_AT_MILLIS)
  }
}

object VerifierPlatformPrerequisites {
  fun notificationsAllowed(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED

  fun canStart(context: Context, snapshot: VerifierOperationalSnapshot): Boolean =
    BuildConfig.VERIFIER_ENABLED && snapshot.operatorEnabled && notificationsAllowed(context)
}
