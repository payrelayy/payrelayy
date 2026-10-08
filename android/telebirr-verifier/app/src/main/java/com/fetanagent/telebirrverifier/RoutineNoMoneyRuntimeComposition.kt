package com.fetanagent.telebirrverifier

import android.content.Context
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder

/** The signed production rehearsal is an alternative to, never an extension of, pilot execution. */
internal object RoutineNoMoneyRuntimeComposition {
  fun enabled(): Boolean = BuildConfig.VERIFIER_ENABLED && BuildConfig.ROUTINE_NO_MONEY_ENABLED &&
    !BuildConfig.ROUTINE_PAID_ENABLED &&
    BuildConfig.VERIFIER_RUNTIME_MODE == "evidence_only" &&
    BuildConfig.VERIFIER_DEPLOYMENT_TARGET == "production"

  fun identity(): P256Identity {
    val alias = "fetanagent_telebirr_routine_pairing_p256_v1"
    val bootstrap = AndroidKeystoreP256Identity("routine_key_bootstrap_v1", alias)
    val fingerprint = bootstrap.publicMaterial().publicKeySpkiSha256.removePrefix("sha256:")
    return AndroidKeystoreP256Identity("routine_key_$fingerprint", alias)
  }

  fun receiptSigner(): RoutineEnrollmentTrustedSigner? = runCatching {
    if (!BuildConfig.VERIFIER_ENABLED || !BuildConfig.ROUTINE_NO_MONEY_ENABLED ||
      BuildConfig.VERIFIER_RUNTIME_MODE != "evidence_only" ||
      BuildConfig.VERIFIER_DEPLOYMENT_TARGET != "production" ||
      BuildConfig.ROUTINE_RECEIPT_SIGNER_KEY_ID !=
      "telebirr-routine-enrollment-production-v1") return null
    val spki = DeviceBridgeCrypto.parseP256SpkiBase64Url(
      BuildConfig.ROUTINE_RECEIPT_SIGNER_PUBLIC_KEY_SPKI)
    require(DeviceBridgeCanonical.sha256(spki) ==
      BuildConfig.ROUTINE_RECEIPT_SIGNER_PUBLIC_KEY_SPKI_SHA256)
    RoutineEnrollmentTrustedSigner(
      BuildConfig.ROUTINE_RECEIPT_SIGNER_KEY_ID,
      BuildConfig.ROUTINE_RECEIPT_SIGNER_PUBLIC_KEY_SPKI,
      BuildConfig.ROUTINE_RECEIPT_SIGNER_PUBLIC_KEY_SPKI_SHA256,
      BuildConfig.ROUTINE_RECEIPT_SIGNER_VALID_FROM,
      BuildConfig.ROUTINE_RECEIPT_SIGNER_VALID_UNTIL,
      "active",
    )
  }.getOrNull()

  fun lookupSigner(): Pair<RoutineLookupTrustedSigner, ByteArray>? = runCatching {
    if (!BuildConfig.VERIFIER_ENABLED || !BuildConfig.ROUTINE_NO_MONEY_ENABLED ||
      BuildConfig.VERIFIER_RUNTIME_MODE != "evidence_only" ||
      BuildConfig.VERIFIER_DEPLOYMENT_TARGET != "production" ||
      BuildConfig.ROUTINE_LOOKUP_SIGNER_KEY_ID !=
      "telebirr-routine-lookup-production-v1") return null
    val spki = DeviceBridgeCrypto.parseP256SpkiBase64Url(
      BuildConfig.ROUTINE_LOOKUP_SIGNER_PUBLIC_KEY_SPKI)
    require(DeviceBridgeCanonical.sha256(spki) ==
      BuildConfig.ROUTINE_LOOKUP_SIGNER_PUBLIC_KEY_SPKI_SHA256)
    require(BuildConfig.ROUTINE_LOOKUP_SIGNER_PUBLIC_KEY_SPKI_SHA256 !=
      BuildConfig.ROUTINE_RECEIPT_SIGNER_PUBLIC_KEY_SPKI_SHA256)
    RoutineLookupTrustedSigner(
      signerKeyId = BuildConfig.ROUTINE_LOOKUP_SIGNER_KEY_ID,
      publicKeySpkiSha256 = BuildConfig.ROUTINE_LOOKUP_SIGNER_PUBLIC_KEY_SPKI_SHA256,
      state = "active",
      validFrom = BuildConfig.ROUTINE_LOOKUP_SIGNER_VALID_FROM,
      validUntil = BuildConfig.ROUTINE_LOOKUP_SIGNER_VALID_UNTIL,
    ) to spki
  }.getOrNull()

  private fun currentUtc(): String =
    DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.now())

  fun isEnrolled(context: Context): Boolean = runCatching {
    val signer = receiptSigner() ?: return false
    lookupSigner() ?: return false
    EncryptedRoutineEnrollmentStore.forApplication(context)
      .loadEnrolled(signer, identity(), currentUtc()) != null
  }.getOrDefault(false)

  fun create(context: Context): VerifierRuntimeSession {
    val receiptSigner = receiptSigner()
    val lookup = lookupSigner()
    if (receiptSigner == null || lookup == null) return unavailable("routine_trust_unavailable")
    val deviceIdentity = runCatching { identity() }.getOrNull()
      ?: return unavailable("routine_device_key_unavailable")
    val rehearsal = RoutineNoMoneyPhoneRehearsal(
      exchange = FixedRoutineNoMoneyHttpsExchange(),
      collector = RoutineTelebirrObservationCollector(SafeOfficialReceiptTransport()),
      workStore = EncryptedRoutineNoMoneyWorkStore.forApplication(context),
    )
    val enrollmentStore = EncryptedRoutineEnrollmentStore.forApplication(context)
    return VerifierRuntimeSession(
      cycle = VerifierRuntimeCycle {
        val receipt = runCatching {
          enrollmentStore.loadEnrolled(receiptSigner, deviceIdentity, currentUtc())
        }.getOrNull() ?: return@VerifierRuntimeCycle LivePilotRuntimeStatus(
          LivePilotRuntimeState.ENROLLMENT_REQUIRED, "routine_enrollment_unavailable")
        when (val result = rehearsal.run(
          receipt, receiptSigner, lookup.first, lookup.second, deviceIdentity)) {
          RoutineNoMoneyPhoneResult.NoAssignment ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.READY, "no_assignment")
          RoutineNoMoneyPhoneResult.Retry ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, "routine_retry")
          RoutineNoMoneyPhoneResult.SubmittedForReview ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.READY, "no_assignment")
          RoutineNoMoneyPhoneResult.RecordedPolicyReview ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, "server_review")
          is RoutineNoMoneyPhoneResult.Review ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION,
              result.reasonCode.takeIf { Regex("^[a-z][a-z0-9_]{2,63}$").matches(it) }
                ?: "routine_review")
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
