package com.fetanagent.telebirrverifier

import android.content.Context
import android.util.Log
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder

/** Signed evidence mode. Each server route independently enforces its mutually exclusive gate. */
internal object RoutinePaidRuntimeComposition {
  fun enabled(): Boolean = BuildConfig.VERIFIER_ENABLED && BuildConfig.ROUTINE_PAID_ENABLED &&
    BuildConfig.ROUTINE_NO_MONEY_ENABLED &&
    BuildConfig.VERIFIER_RUNTIME_MODE == "evidence_only" &&
    BuildConfig.VERIFIER_DEPLOYMENT_TARGET == "production"

  private fun currentUtc(): String =
    DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.now())

  fun isEnrolled(context: Context): Boolean = runCatching {
    if (!enabled()) return false
    val signer = RoutineNoMoneyRuntimeComposition.receiptSigner() ?: return false
    RoutineNoMoneyRuntimeComposition.lookupSigner() ?: return false
    val identity = RoutineNoMoneyRuntimeComposition.identity()
    EncryptedRoutineEnrollmentStore.forApplication(context)
      .loadEnrolled(signer, identity, currentUtc()) != null
  }.getOrDefault(false)

  fun create(context: Context): VerifierRuntimeSession {
    val receiptSigner = RoutineNoMoneyRuntimeComposition.receiptSigner()
    val lookup = RoutineNoMoneyRuntimeComposition.lookupSigner()
    if (!enabled() || receiptSigner == null || lookup == null)
      return unavailable("routine_paid_trust_unavailable")
    val identity = runCatching { RoutineNoMoneyRuntimeComposition.identity() }.getOrNull()
      ?: return unavailable("routine_device_key_unavailable")
    val enrollmentStore = EncryptedRoutineEnrollmentStore.forApplication(context)
    // Keep the existing no-money encrypted outbox and route available in this newer APK.
    // The no-money SQL boundary requires all financial switches off; the paid SQL boundary
    // requires current live authority. Neither phone route can credit a Player.
    val noMoneySession = RoutineNoMoneyRuntimeComposition.create(context)
    val phones = (0 until RoutinePaidParallelCycle.MAX_LANES).map { lane ->
      RoutinePaidPhonePreparation(
        exchange = FixedRoutinePaidPollHttpsExchange(),
        collector = RoutineTelebirrObservationCollector(SafeOfficialReceiptTransport()),
        workStore = EncryptedRoutinePaidWorkStore.forApplication(context, lane),
      )
    }
    val parallelCycle = RoutinePaidParallelCycle(phones.size)
    // Inspect every outbox on restart; after an empty pass, use one idle poll until work arrives.
    var burst = true
    return VerifierRuntimeSession(
      cycle = VerifierRuntimeCycle {
        val receipt = runCatching {
          enrollmentStore.loadEnrolled(receiptSigner, identity, currentUtc())
        }.getOrNull() ?: return@VerifierRuntimeCycle LivePilotRuntimeStatus(
          LivePilotRuntimeState.ENROLLMENT_REQUIRED, "routine_enrollment_unavailable")
        val results = parallelCycle.runOnce(if (burst) phones.size else 1) { lane ->
          phones[lane].run(receipt, receiptSigner, lookup.first, lookup.second, identity)
        }
        burst = results.any { it != RoutinePaidPhonePreparationResult.NoAssignment }
        val review = results.filterIsInstance<RoutinePaidPhonePreparationResult.Review>().firstOrNull()
        val paidStatus = when {
          review != null -> LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION,
            review.reasonCode.takeIf { Regex("^[a-z][a-z0-9_]{2,63}$").matches(it) }
              ?: "routine_paid_review")
          results.any { it == RoutinePaidPhonePreparationResult.SubmittedForReview } ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.READY, "paid_observation_staged")
          results.any { it == RoutinePaidPhonePreparationResult.Retry } ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, "paid_observation_retry")
          else -> LivePilotRuntimeStatus(LivePilotRuntimeState.READY, "no_paid_assignment")
        }
        val noMoneyStatus = noMoneySession.cycle.runOnce()
        // Both codes are locally validated, fixed operational categories. Never log an
        // assignment, reference, receipt, address, signature, or response body.
        Log.i("FetanAgentRoutineCycle", "noMoney=${noMoneyStatus.code} paid=${paidStatus.code}")
        RoutineDualModeStatus.select(noMoneyStatus, paidStatus)
      },
      heartbeat = null,
      close = {
        parallelCycle.close()
        noMoneySession.close()
      },
    )
  }

  private fun unavailable(code: String) = VerifierRuntimeSession(
    cycle = VerifierRuntimeCycle {
      LivePilotRuntimeStatus(LivePilotRuntimeState.ENROLLMENT_REQUIRED, code)
    },
    heartbeat = null,
  )
}

/** Status presentation only; the server gates, not this choice, authorize an assignment. */
internal object RoutineDualModeStatus {
  fun select(noMoney: LivePilotRuntimeStatus, paid: LivePilotRuntimeStatus): LivePilotRuntimeStatus {
    if (paid.code == "paid_observation_staged") return paid
    if (noMoney.code == "server_rejected") return paid
    if (paid.code == "server_rejected") return noMoney
    if (noMoney.state == LivePilotRuntimeState.ATTENTION) return noMoney
    if (paid.state == LivePilotRuntimeState.ATTENTION) return paid
    if (paid.state == LivePilotRuntimeState.ENROLLMENT_REQUIRED) return paid
    if (noMoney.state == LivePilotRuntimeState.ENROLLMENT_REQUIRED) return noMoney
    if (paid.code == "no_paid_assignment" && noMoney.code != "no_assignment") return noMoney
    return paid
  }
}
