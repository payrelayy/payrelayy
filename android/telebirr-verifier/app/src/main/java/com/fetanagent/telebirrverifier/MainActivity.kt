package com.fetanagent.telebirrverifier

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class MainActivity : Activity() {
  private lateinit var stateStore: VerifierOperationalStateStore

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    stateStore = VerifierOperationalStateStore(applicationContext)
    render()
  }

  override fun onResume() {
    super.onResume()
    render()
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode != NOTIFICATION_PERMISSION_REQUEST) return
    if (grantResults.singleOrNull() == PackageManager.PERMISSION_GRANTED) {
      startVerifier()
    } else {
      runCatching { stateStore.setOperatorEnabled(false) }
      runCatching {
        stateStore.recordStatus(
          LivePilotRuntimeStatus(
            LivePilotRuntimeState.ATTENTION,
            "notification_permission_required",
          ),
        )
      }
      render()
    }
  }

  private fun render() {
    val snapshot = stateStore.snapshot()
    val displayedStatus =
      if (BuildConfig.VERIFIER_ENABLED) snapshot.status
      else LivePilotRuntimeStatus(LivePilotRuntimeState.DISABLED, "build_disabled")
    val root = statusView(VerifierLifecycle.from(displayedStatus), snapshot)
    setContentView(ScrollView(this).apply { addView(root) })
  }

  private fun statusView(
    lifecycle: VerifierLifecycle,
    snapshot: VerifierOperationalSnapshot,
  ): LinearLayout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(48, 96, 48, 48)
      addView(
        TextView(context).apply {
          setText(R.string.app_name)
          textSize = 24f
          setTypeface(typeface, Typeface.BOLD)
        },
      )
      addView(
        TextView(context).apply {
          text = lifecycle.label
          textSize = 20f
          setPadding(0, 48, 0, 24)
        },
      )
      addView(versionView("Relay", RelayProtocol.TRANSCRIPT_VERSION))
      addView(versionView("Pilot", LivePrivatePilotProtocol.OBSERVATION_TRANSCRIPT_VERSION))
      addView(versionView("Bridge", DeviceBridgeProtocol.REQUEST_TRANSCRIPT_VERSION))
      addView(versionView("Provider", LivePrivatePilotProtocol.SOURCE_PROFILE))
      addView(versionView("Parser", RelayProtocol.PARSER_VERSION))
      addView(versionView("Normalizer", RelayProtocol.NORMALIZER_VERSION))
      addView(
        TextView(context).apply {
          text =
            if (!BuildConfig.VERIFIER_ENABLED) {
              getString(R.string.inert_artifact_notice)
            } else if (snapshot.operatorEnabled) {
              getString(R.string.automatic_operation_enabled)
            } else {
              getString(R.string.automatic_operation_stopped)
            }
          textSize = 14f
          setPadding(0, 36, 0, 0)
          gravity = Gravity.CENTER
        },
      )
      addView(
        TextView(context).apply {
          setText(R.string.no_calendar_shutdown)
          textSize = 14f
          setPadding(0, 20, 0, 0)
          gravity = Gravity.CENTER
        },
      )
      addView(
        TextView(context).apply {
          setText(R.string.signed_route_only)
          textSize = 14f
          setPadding(0, 36, 0, 0)
          gravity = Gravity.CENTER
        },
      )
      addView(
        TextView(context).apply {
          setText(R.string.no_financial_authority)
          textSize = 14f
          setPadding(0, 24, 0, 0)
          gravity = Gravity.CENTER
        },
      )
      if (BuildConfig.VERIFIER_ENABLED) addOperationalControls(snapshot.operatorEnabled)
    }

  private fun LinearLayout.addOperationalControls(operatorEnabled: Boolean) {
    addView(
      Button(context).apply {
        setText(R.string.start_automatic_verification)
        isEnabled = !operatorEnabled
        setPadding(24, 20, 24, 20)
        setOnClickListener { requestStart() }
      },
      LinearLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        .apply { topMargin = 48 },
    )
    addView(
      Button(context).apply {
        setText(R.string.stop)
        isEnabled = operatorEnabled
        setOnClickListener { stopVerifier() }
      },
      LinearLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        .apply { topMargin = 16 },
    )
  }

  private fun requestStart() {
    if (!BuildConfig.VERIFIER_ENABLED) return
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
          PackageManager.PERMISSION_GRANTED
    ) {
      requestPermissions(
        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
        NOTIFICATION_PERMISSION_REQUEST,
      )
      return
    }
    startVerifier()
  }

  private fun startVerifier() {
    val started =
      runCatching {
          stateStore.setOperatorEnabled(true)
          VerifierForegroundService.requestStart(this)
        }
        .isSuccess
    if (!started) {
      runCatching { stateStore.setOperatorEnabled(false) }
      runCatching {
        stateStore.recordStatus(
          LivePilotRuntimeStatus(
            LivePilotRuntimeState.ATTENTION,
            "foreground_start_unavailable",
          ),
        )
      }
    }
    render()
  }

  private fun stopVerifier() {
    runCatching { stateStore.setOperatorEnabled(false) }
    runCatching {
      stateStore.recordStatus(
        LivePilotRuntimeStatus(LivePilotRuntimeState.DISABLED, "operator_stopped"),
      )
    }
    runCatching { VerifierForegroundService.requestStop(this) }
    render()
  }

  private fun versionView(label: String, version: String): TextView =
    TextView(this).apply {
      text = getString(R.string.version_value, label, version)
      textSize = 13f
      layoutParams =
        ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
      gravity = Gravity.CENTER
    }

  companion object {
    private const val NOTIFICATION_PERMISSION_REQUEST = 7_001
  }
}

class VerifierLifecycle private constructor(val state: State, val label: String) {
  enum class State {
    DISABLED,
    ENROLLMENT_REQUIRED,
    READY,
    BUSY,
    UPLOAD_PENDING,
    ATTENTION,
  }

  companion object {
    fun disabled(): VerifierLifecycle = VerifierLifecycle(State.DISABLED, "Disabled")

    fun enrollmentRequired(): VerifierLifecycle =
      VerifierLifecycle(State.ENROLLMENT_REQUIRED, "Enrollment required")

    fun ready(): VerifierLifecycle = VerifierLifecycle(State.READY, "Ready")

    fun from(status: LivePilotRuntimeStatus): VerifierLifecycle =
      when (status.state) {
        LivePilotRuntimeState.DISABLED -> disabled()
        LivePilotRuntimeState.ENROLLMENT_REQUIRED -> enrollmentRequired()
        LivePilotRuntimeState.READY -> ready()
        LivePilotRuntimeState.BUSY -> VerifierLifecycle(State.BUSY, "Observing")
        LivePilotRuntimeState.UPLOAD_PENDING ->
          VerifierLifecycle(State.UPLOAD_PENDING, "Upload pending")
        LivePilotRuntimeState.ATTENTION -> VerifierLifecycle(State.ATTENTION, "Attention required")
      }
  }
}
