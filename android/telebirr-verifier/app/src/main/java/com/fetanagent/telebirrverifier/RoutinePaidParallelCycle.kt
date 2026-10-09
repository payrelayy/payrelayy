package com.fetanagent.telebirrverifier

import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** Bounded, independent receipt lookups. Each lane owns a separate sealed outbox. */
internal class RoutinePaidParallelCycle(
  private val lanes: Int,
  private val executor: ExecutorService = Executors.newFixedThreadPool(lanes) { task ->
    Thread(task, "fetanagent-paid-receipt").apply { isDaemon = true }
  },
) : AutoCloseable {
  init { require(lanes in 1..MAX_LANES) }

  fun runOnce(
    activeLanes: Int,
    work: (Int) -> RoutinePaidPhonePreparationResult,
  ): List<RoutinePaidPhonePreparationResult> {
    require(activeLanes in 1..lanes)
    // Submit every lane before waiting. A slow official receipt cannot block another lookup.
    val futures = (0 until activeLanes).map { lane ->
      executor.submit(Callable {
        try { work(lane) } catch (_: Exception) {
          RoutinePaidPhonePreparationResult.Review("paid_slot_unavailable")
        }
      })
    }
    return futures.map { it.get() }
  }

  override fun close() { executor.shutdownNow() }

  companion object { const val MAX_LANES = 4 }
}
