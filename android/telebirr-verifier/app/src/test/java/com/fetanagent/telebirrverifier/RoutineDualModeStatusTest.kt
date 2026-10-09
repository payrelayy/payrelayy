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
}
