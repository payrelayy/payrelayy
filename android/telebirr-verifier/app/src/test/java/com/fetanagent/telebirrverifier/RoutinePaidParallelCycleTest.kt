package com.fetanagent.telebirrverifier

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutinePaidParallelCycleTest {
  @Test
  fun `four paid receipts can be inspected concurrently without a fifth lane`() {
    val arrived = CountDownLatch(4)
    RoutinePaidParallelCycle(4).use { cycle ->
      val results = cycle.runOnce(4) { lane ->
        arrived.countDown()
        assertTrue(arrived.await(2, TimeUnit.SECONDS))
        if (lane == 2) RoutinePaidPhonePreparationResult.Retry
        else RoutinePaidPhonePreparationResult.SubmittedForReview
      }
      assertEquals(4, results.size)
      assertEquals(RoutinePaidPhonePreparationResult.Retry, results[2])
    }
  }

  @Test
  fun `one failed receipt lane does not discard another signed upload`() {
    val completed = AtomicInteger()
    RoutinePaidParallelCycle(4).use { cycle ->
      val results = cycle.runOnce(4) { lane ->
        if (lane == 1) error("fixture failure")
        completed.incrementAndGet()
        RoutinePaidPhonePreparationResult.SubmittedForReview
      }
      assertEquals(3, completed.get())
      assertEquals(RoutinePaidPhonePreparationResult.Review("paid_slot_unavailable"), results[1])
    }
  }

  @Test
  fun `idle operation uses one lane and invalid fanout is rejected`() {
    RoutinePaidParallelCycle(4).use { cycle ->
      val visited = mutableListOf<Int>()
      assertEquals(
        listOf(RoutinePaidPhonePreparationResult.NoAssignment),
        cycle.runOnce(1) { lane ->
          visited.add(lane)
          RoutinePaidPhonePreparationResult.NoAssignment
        },
      )
      assertEquals(listOf(0), visited)
      assertThrows(IllegalArgumentException::class.java) {
        cycle.runOnce(5) { RoutinePaidPhonePreparationResult.NoAssignment }
      }
    }
  }
}
