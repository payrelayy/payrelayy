package com.fetanagent.telebirrverifier

import android.app.Activity
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(statusView(VerifierLifecycle.disabled()))
  }

  private fun statusView(lifecycle: VerifierLifecycle): LinearLayout =
    LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(48, 96, 48, 48)
      addView(
        TextView(context).apply {
          text = "FetanAgent TeleBirr Verifier"
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
      addView(versionView("Provider", LivePrivatePilotProtocol.SOURCE_PROFILE))
      addView(versionView("Parser", RelayProtocol.PARSER_VERSION))
      addView(versionView("Normalizer", RelayProtocol.NORMALIZER_VERSION))
      addView(
        TextView(context).apply {
          text = "Signed assignments and the fixed official TeleBirr route only. No editable URL or API key."
          textSize = 14f
          setPadding(0, 36, 0, 0)
          gravity = Gravity.CENTER
        },
      )
      addView(
        TextView(context).apply {
          text = "No database, KemerBet, settlement, or financial-action authority."
          textSize = 14f
          setPadding(0, 24, 0, 0)
          gravity = Gravity.CENTER
        },
      )
    }

  private fun versionView(label: String, version: String): TextView =
    TextView(this).apply {
      text = "$label: $version"
      textSize = 13f
      layoutParams =
        ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
      gravity = Gravity.CENTER
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
