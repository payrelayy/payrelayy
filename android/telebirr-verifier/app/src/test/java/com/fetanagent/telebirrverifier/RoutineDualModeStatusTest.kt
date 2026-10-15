package com.fetanagent.telebirrverifier

import org.junit.Assert.assertEquals
import org.junit.Test

class RoutineDualModeStatusTest {
  private fun ready(code: String) = LivePilotRuntimeStatus(LivePilotRuntimeState.READY, code)
  private fun attention(code: String) = LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, code)

  @Test fun `no-money result is visible while the paid server gate is closed`() {
    val noMoney = ready("no_assignment")
    assertEquals(noMoney, RoutineDualModeStatus.select(noMoney, attention("server_rejected")))
  }

  @Test fun `paid result is visible while the no-money server gate is closed`() {
    val paid = ready("no_paid_assignment")
    assertEquals(paid, RoutineDualModeStatus.select(attention("server_rejected"), paid))
  }

  @Test fun `paid staging and non-gate failures are not hidden`() {
    val staged = ready("paid_observation_staged")
    assertEquals(staged, RoutineDualModeStatus.select(attention("server_review"), staged))
    val failed = attention("paid_observation_retry")
    assertEquals(ready("routine_no_money_idle_paid_retry"),
      RoutineDualModeStatus.select(ready("no_assignment"), failed))
    val noMoneyFailed = attention("routine_retry")
    assertEquals(noMoneyFailed,
      RoutineDualModeStatus.select(noMoneyFailed, ready("no_paid_assignment")))
    assertEquals(noMoneyFailed,
      RoutineDualModeStatus.select(noMoneyFailed, attention("paid_observation_retry")))
    assertEquals(failed,
      RoutineDualModeStatus.select(attention("server_rejected"), failed))
  }

  @Test fun `paid retries keep their own bounded clock while no-money polling continues`() {
    var now = 1_000L
    val pacer = RoutinePaidRetryPacer { now }
    assertEquals(true, pacer.shouldAttempt())
    val delays = listOf(5_000L, 10_000L, 20_000L, 30_000L, 60_000L, 60_000L)
    for (delay in delays) {
      pacer.record(listOf(RoutinePaidPhonePreparationResult.Retry))
      assertEquals(true, pacer.waitingForRetry)
      now += delay - 1L
      assertEquals(false, pacer.shouldAttempt())
      now += 1L
      assertEquals(true, pacer.shouldAttempt())
    }
    pacer.record(listOf(RoutinePaidPhonePreparationResult.NoAssignment))
    assertEquals(false, pacer.waitingForRetry)
    assertEquals(true, pacer.shouldAttempt())
  }

  @Test fun `paid receipt network and review retries keep distinct fast statuses`() {
    val network = RoutinePaidCycleStatus.fromResults(
      listOf(RoutinePaidPhonePreparationResult.Review("network_unavailable")), false)
    assertEquals(attention("paid_receipt_network_retry"), network)
    assertEquals(network, RoutineDualModeStatus.select(ready("no_assignment"), network))
    assertEquals(attention("paid_receipt_review_retry"), RoutinePaidCycleStatus.fromResults(
      listOf(RoutinePaidPhonePreparationResult.Review("receipt_review")), false))
    assertEquals(attention("paid_observation_retry"),
      RoutinePaidCycleStatus.fromResults(emptyList(), true))
  }

  @Test fun `a stale rejected upload cannot hide a newer signed receipt result`() {
    val results = listOf(
      RoutinePaidPhonePreparationResult.Review("server_rejected"),
      RoutinePaidPhonePreparationResult.NoAssignment,
      RoutinePaidPhonePreparationResult.SubmittedForReview,
    )
    assertEquals(ready("paid_observation_staged"), RoutinePaidCycleStatus.fromResults(results, false))
  }

  @Test fun `a rejected lane cools down independently without blocking healthy lanes`() {
    var now = 1_000L
    val pacer = RoutinePaidRejectedLanePacer(4) { now }
    assertEquals(true, pacer.shouldAttempt(0))
    pacer.record(0, RoutinePaidPhonePreparationResult.Review("server_rejected"))
    assertEquals(false, pacer.shouldAttempt(0))
    assertEquals(true, pacer.shouldAttempt(1))
    assertEquals(true, pacer.hasCoolingLanes())
    now += 59_999L
    assertEquals(false, pacer.shouldAttempt(0))
    now += 1L
    assertEquals(true, pacer.shouldAttempt(0))
    pacer.record(0, RoutinePaidPhonePreparationResult.NoAssignment)
    assertEquals(false, pacer.hasCoolingLanes())
  }

  @Test fun `other lanes keep polling while a sealed lane is rejected`() {
    val status = RoutinePaidCycleStatus.fromResults(listOf(
      RoutinePaidPhonePreparationResult.Review("server_rejected"),
      RoutinePaidPhonePreparationResult.NoAssignment,
    ), false)
    assertEquals(ready("paid_partial_lane_recovery"), status)
    assertEquals(status, RoutineDualModeStatus.select(ready("no_assignment"), status))
    assertEquals(attention("server_rejected"), RoutinePaidCycleStatus.fromResults(listOf(
      RoutinePaidPhonePreparationResult.Review("server_rejected")), false))
  }

  @Test fun `an unattested transient page stays review only and retries promptly`() {
    val status = RoutinePaidCycleStatus.fromResults(listOf(
      RoutinePaidPhonePreparationResult.Review("server_rejected"),
      RoutinePaidPhonePreparationResult.Review("invalid_page_unattested")), false)
    assertEquals(attention("paid_receipt_review_retry"), status)
    assertEquals(status, RoutineDualModeStatus.select(ready("no_assignment"), status))
    assertEquals(attention("paid_receipt_review_retry"), RoutinePaidCycleStatus.fromResults(listOf(
      RoutinePaidPhonePreparationResult.Review("unknown_layout_invoice_number")), false))
  }
}
