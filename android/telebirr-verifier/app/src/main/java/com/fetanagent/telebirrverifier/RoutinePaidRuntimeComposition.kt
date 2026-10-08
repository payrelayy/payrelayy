package com.fetanagent.telebirrverifier

import android.content.Context
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder

/** Explicit paid-phone evidence mode. It can stage receipts, but cannot credit a Player. */
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
    val phone = RoutinePaidPhonePreparation(
      exchange = FixedRoutinePaidPollHttpsExchange(),
      collector = RoutineTelebirrObservationCollector(SafeOfficialReceiptTransport()),
      workStore = EncryptedRoutinePaidWorkStore.forApplication(context),
    )
    return VerifierRuntimeSession(
      cycle = VerifierRuntimeCycle {
        val receipt = runCatching {
          enrollmentStore.loadEnrolled(receiptSigner, identity, currentUtc())
        }.getOrNull() ?: return@VerifierRuntimeCycle LivePilotRuntimeStatus(
          LivePilotRuntimeState.ENROLLMENT_REQUIRED, "routine_enrollment_unavailable")
        when (val result = phone.run(receipt, receiptSigner, lookup.first, lookup.second,
          identity)) {
          RoutinePaidPhonePreparationResult.NoAssignment ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.READY, "no_assignment")
          RoutinePaidPhonePreparationResult.Retry ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, "paid_observation_retry")
          RoutinePaidPhonePreparationResult.SubmittedForReview ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.READY, "paid_observation_staged")
          is RoutinePaidPhonePreparationResult.Review ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION,
              result.reasonCode.takeIf { Regex("^[a-z][a-z0-9_]{2,63}$").matches(it) }
                ?: "routine_paid_review")
        }
      },
      heartbeat = null,
    )
  }

  private fun unavailable(code: String) = VerifierRuntimeSession(
    cycle = VerifierRuntimeCycle {
      LivePilotRuntimeStatus(LivePilotRuntimeState.ENROLLMENT_REQUIRED, code)
    },
    heartbeat = null,
  )
}
