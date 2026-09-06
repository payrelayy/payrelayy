package com.fetanagent.telebirrverifier

import java.util.concurrent.ThreadLocalRandom

data class VerifierLoopDecision(
  val continueRunning: Boolean,
  val delayMillis: Long?,
  val heartbeatDue: Boolean,
) {
  init {
    require((delayMillis != null) == continueRunning)
    require(delayMillis == null || delayMillis >= 0L)
  }
}

/**
 * State-based foreground-loop policy. It deliberately has no wall-clock date, product-expiry date,
 * or fixed pilot shutdown: explicit operator state, enrollment validity, revocation, and short-lived
 * signed work remain the stopping boundaries.
 */
class VerifierRunLoopPolicy(
  private val jitterFraction: () -> Double = { ThreadLocalRandom.current().nextDouble() },
) {
  private var previousStatus: StatusProjection? = null
  private var equivalentStatusCount = 0
  private var lastHeartbeatStatus: StatusProjection? = null
  private var lastHeartbeatAtMillis: Long? = null

  fun decide(status: LivePilotRuntimeStatus, monotonicNowMillis: Long): VerifierLoopDecision {
    require(monotonicNowMillis >= 0L)
    val projection = StatusProjection(status.state, status.code)
    if (projection == previousStatus) {
      equivalentStatusCount += 1
    } else {
      previousStatus = projection
      equivalentStatusCount = 0
    }

    val heartbeatDue =
      lastHeartbeatStatus != projection ||
        lastHeartbeatAtMillis == null ||
        monotonicNowMillis < requireNotNull(lastHeartbeatAtMillis) ||
        monotonicNowMillis - requireNotNull(lastHeartbeatAtMillis) >= HEARTBEAT_INTERVAL_MILLIS

    val baseDelay = baseDelayMillis(status, equivalentStatusCount)
    return if (baseDelay == null) {
      VerifierLoopDecision(
        continueRunning = false,
        delayMillis = null,
        heartbeatDue = heartbeatDue,
      )
    } else {
      VerifierLoopDecision(
        continueRunning = true,
        delayMillis = jittered(baseDelay),
        heartbeatDue = heartbeatDue,
      )
    }
  }

  fun recordHeartbeatAttempt(status: LivePilotRuntimeStatus, monotonicNowMillis: Long) {
    require(monotonicNowMillis >= 0L)
    lastHeartbeatStatus = StatusProjection(status.state, status.code)
    lastHeartbeatAtMillis = monotonicNowMillis
  }

  private fun baseDelayMillis(status: LivePilotRuntimeStatus, repeat: Int): Long? =
    when (status.state) {
      LivePilotRuntimeState.DISABLED,
      LivePilotRuntimeState.ENROLLMENT_REQUIRED,
      -> null
      LivePilotRuntimeState.READY ->
        if (status.code in READY_IDLE_CODES) delay(READY_IDLE_DELAYS_MILLIS, repeat) else 1_000L
      LivePilotRuntimeState.BUSY -> 1_000L
      LivePilotRuntimeState.UPLOAD_PENDING -> delay(UPLOAD_DELAYS_MILLIS, repeat)
      LivePilotRuntimeState.ATTENTION ->
        if (status.code in TERMINAL_ATTENTION_CODES) null else delay(ATTENTION_DELAYS_MILLIS, repeat)
    }

  private fun delay(sequence: LongArray, repeat: Int): Long =
    sequence[repeat.coerceIn(0, sequence.lastIndex)]

  private fun jittered(baseDelayMillis: Long): Long {
    val fraction = jitterFraction()
    require(fraction in 0.0..1.0) { "Jitter fraction must be between zero and one" }
    return baseDelayMillis + (baseDelayMillis * MAXIMUM_JITTER_FRACTION * fraction).toLong()
  }

  private data class StatusProjection(
    val state: LivePilotRuntimeState,
    val code: String,
  )

  companion object {
    const val HEARTBEAT_INTERVAL_MILLIS = 5 * 60 * 1_000L
    private const val MAXIMUM_JITTER_FRACTION = 0.20
    private val READY_IDLE_DELAYS_MILLIS = longArrayOf(10_000L, 20_000L, 30_000L, 60_000L)
    private val READY_IDLE_CODES = setOf("no_assignment", "transport_enrolled")
    private val UPLOAD_DELAYS_MILLIS =
      longArrayOf(5_000L, 10_000L, 20_000L, 40_000L, 60_000L, 120_000L, 300_000L)
    private val ATTENTION_DELAYS_MILLIS =
      longArrayOf(30_000L, 60_000L, 120_000L, 300_000L, 600_000L, 900_000L)
    private val TERMINAL_ATTENTION_CODES =
      setOf(
        "assignment_body_digest_mismatch",
        "assignment_signature_invalid",
        "assignment_signer_expired",
        "assignment_signer_key_invalid",
        "assignment_signer_key_mismatch",
        "assignment_signer_revoked",
        "assignment_payload_invalid",
        "assignment_response_invalid",
        "binding_mismatch",
        "device_enrollment_expired",
        "device_key_mismatch",
        "device_revoked",
        "heartbeat_binding_mismatch",
        "heartbeat_device_revoked",
        "heartbeat_payload_invalid",
        "heartbeat_pilot_stopped",
        "invalid_request",
        "upload_ack_mismatch",
        "upload_assignment_expired",
        "upload_assignment_rejected",
        "upload_binding_mismatch",
        "upload_device_revoked",
        "upload_evidence_invalid",
        "upload_pilot_stopped",
      )
  }
}
