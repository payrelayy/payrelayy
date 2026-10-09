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
    assertEquals(failed, RoutineDualModeStatus.select(ready("no_assignment"), failed))
    val noMoneyFailed = attention("routine_retry")
    assertEquals(noMoneyFailed,
      RoutineDualModeStatus.select(noMoneyFailed, ready("no_paid_assignment")))
  }
}
