package com.fetanagent.telebirrverifier

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VerifierRunLoopPolicyTest {
  @Test
  fun `idle polling increases to one minute and remains bounded`() {
    val policy = VerifierRunLoopPolicy { 0.0 }
    val status = status(LivePilotRuntimeState.READY, "no_assignment")
    val delays = (0..6).map { policy.decide(status, it.toLong()).delayMillis }
    assertEquals(
      listOf(10_000L, 20_000L, 30_000L, 60_000L, 60_000L, 60_000L, 60_000L),
      delays,
    )
  }

  @Test
  fun `pairing-only heartbeat mode uses the same bounded idle cadence`() {
    val policy = VerifierRunLoopPolicy { 0.0 }
    val status = status(LivePilotRuntimeState.READY, "transport_enrolled")
    val delays = (0..4).map { policy.decide(status, it.toLong()).delayMillis }
    assertEquals(listOf(10_000L, 20_000L, 30_000L, 60_000L, 60_000L), delays)
  }

  @Test
  fun `pending uploads retry quickly then cap at five minutes`() {
    val policy = VerifierRunLoopPolicy { 0.0 }
    val status = status(LivePilotRuntimeState.UPLOAD_PENDING, "upload_retry_scheduled")
    val delays = (0..8).map { policy.decide(status, it.toLong()).delayMillis }
    assertEquals(
      listOf(5_000L, 10_000L, 20_000L, 40_000L, 60_000L, 120_000L, 300_000L, 300_000L, 300_000L),
      delays,
    )
  }

  @Test
  fun `transient attention backs off to fifteen minutes`() {
    val policy = VerifierRunLoopPolicy { 0.0 }
    val status = status(LivePilotRuntimeState.ATTENTION, "assignment_channel_retryable")
    val delays = (0..7).map { policy.decide(status, it.toLong()).delayMillis }
    assertEquals(
      listOf(30_000L, 60_000L, 120_000L, 300_000L, 600_000L, 900_000L, 900_000L, 900_000L),
      delays,
    )
  }

  @Test
  fun `disabled enrollment and terminal trust failures stop`() {
    val statuses =
      listOf(
        status(LivePilotRuntimeState.DISABLED, "operator_stopped"),
        status(LivePilotRuntimeState.ENROLLMENT_REQUIRED, "provisioning_required"),
        status(LivePilotRuntimeState.ATTENTION, "device_revoked"),
        status(LivePilotRuntimeState.ATTENTION, "binding_mismatch"),
        status(LivePilotRuntimeState.ATTENTION, "assignment_payload_invalid"),
        status(LivePilotRuntimeState.ATTENTION, "assignment_response_invalid"),
        status(LivePilotRuntimeState.ATTENTION, "upload_pilot_stopped"),
      )
    statuses.forEach { status ->
      val decision = VerifierRunLoopPolicy { 0.0 }.decide(status, 0L)
      assertFalse(decision.continueRunning)
      assertNull(decision.delayMillis)
    }
  }

  @Test
  fun `recent acknowledgement and busy work continue after one second`() {
    val policy = VerifierRunLoopPolicy { 0.0 }
    assertEquals(
      1_000L,
      policy
        .decide(status(LivePilotRuntimeState.READY, "observation_acknowledged"), 0L)
        .delayMillis,
    )
    assertEquals(
      1_000L,
      policy.decide(status(LivePilotRuntimeState.BUSY, "assignment_in_progress"), 1L).delayMillis,
    )
  }

  @Test
  fun `heartbeat is immediate on change and at least every five minutes`() {
    val policy = VerifierRunLoopPolicy { 0.0 }
    val ready = status(LivePilotRuntimeState.READY, "no_assignment")
    assertTrue(policy.decide(ready, 100L).heartbeatDue)
    policy.recordHeartbeatAttempt(ready, 100L)
    assertFalse(policy.decide(ready, 101L).heartbeatDue)
    assertFalse(
      policy
        .decide(ready, 100L + VerifierRunLoopPolicy.HEARTBEAT_INTERVAL_MILLIS - 1L)
        .heartbeatDue,
    )
    assertTrue(
      policy
        .decide(ready, 100L + VerifierRunLoopPolicy.HEARTBEAT_INTERVAL_MILLIS)
        .heartbeatDue,
    )
    assertTrue(
      policy
        .decide(status(LivePilotRuntimeState.ATTENTION, "network_unavailable"), 102L)
        .heartbeatDue,
    )
  }

  @Test
  fun `jitter is bounded to twenty percent`() {
    val minimum = VerifierRunLoopPolicy { 0.0 }.decide(
      status(LivePilotRuntimeState.READY, "no_assignment"),
      0L,
    )
    val maximum = VerifierRunLoopPolicy { 1.0 }.decide(
      status(LivePilotRuntimeState.READY, "no_assignment"),
      0L,
    )
    assertEquals(10_000L, minimum.delayMillis)
    assertEquals(12_000L, maximum.delayMillis)
  }

  @Test
  fun `absolute date never changes the operational decision`() {
    val status = status(LivePilotRuntimeState.READY, "no_assignment")
    val nearBoot = VerifierRunLoopPolicy { 0.0 }.decide(status, 1L)
    val yearsLater = VerifierRunLoopPolicy { 0.0 }.decide(status, 1_893_456_000_000L)
    assertTrue(nearBoot.continueRunning)
    assertEquals(nearBoot.delayMillis, yearsLater.delayMillis)
  }

  private fun status(state: LivePilotRuntimeState, code: String): LivePilotRuntimeStatus =
    LivePilotRuntimeStatus(state, code)
}
