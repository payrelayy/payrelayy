package com.fetanagent.telebirrverifier

import android.content.Context
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import java.util.concurrent.atomic.AtomicReference

/** Receiver SMS is a separate operational mode; it never starts receipt lookup lanes. */
internal object ReceiverSmsRuntimeComposition {
  fun enabled(): Boolean = BuildConfig.VERIFIER_ENABLED && BuildConfig.RECEIVER_SMS_ENABLED &&
    BuildConfig.VERIFIER_RUNTIME_MODE == "evidence_only" &&
    BuildConfig.VERIFIER_DEPLOYMENT_TARGET == "production"

  private fun nowUtc(): String =
    DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.now())

  fun isEnrolled(context: Context): Boolean = runCatching {
    if (!enabled()) return false
    val signer = RoutineNoMoneyRuntimeComposition.receiptSigner() ?: return false
    val identity = RoutineNoMoneyRuntimeComposition.identity()
    EncryptedRoutineEnrollmentStore.forApplication(context)
      .loadEnrolled(signer, identity, nowUtc()) != null
  }.getOrDefault(false)

  fun create(context: Context): VerifierRuntimeSession {
    if (!enabled()) return unavailable("sms_mode_unavailable")
    val signer = RoutineNoMoneyRuntimeComposition.receiptSigner()
      ?: return unavailable("sms_trust_unavailable")
    val identity = runCatching { RoutineNoMoneyRuntimeComposition.identity() }.getOrNull()
      ?: return unavailable("sms_device_key_unavailable")
    val enrollmentStore = EncryptedRoutineEnrollmentStore.forApplication(context)
    val outboxResult = runCatching { ReceiverSmsEncryptedOutbox.forApplication(context) }
    val outbox = outboxResult.getOrNull()
      ?: return unavailable(queueInitializationCode(outboxResult.exceptionOrNull()))
    val upload = ReceiverSmsPhoneUpload(outbox, FixedReceiverSmsHttpsExchange())
    val captureCode = AtomicReference<String?>(null)
    val capture = ReceiverSmsCapture(context, outbox) { code -> captureCode.set(code) }
    if (runCatching { capture.start() }.isFailure)
      return unavailable("sms_capture_unavailable")
    return VerifierRuntimeSession(
      cycle = VerifierRuntimeCycle {
        val receipt = runCatching {
          enrollmentStore.loadEnrolled(signer, identity, nowUtc())
        }.getOrNull() ?: return@VerifierRuntimeCycle LivePilotRuntimeStatus(
          LivePilotRuntimeState.ENROLLMENT_REQUIRED, "routine_enrollment_unavailable")
        val result = upload.run(receipt.body.deviceId, identity)
        val captureFailure = captureCode.getAndSet(null)
        when {
          captureFailure != null && captureFailure != "sms_queued" ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, captureFailure)
          result == ReceiverSmsUploadResult.Empty ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.READY, "sms_inbox_idle")
          result == ReceiverSmsUploadResult.Recorded ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.READY, "sms_event_recorded")
          result == ReceiverSmsUploadResult.Retry ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, "sms_upload_retry")
          result is ReceiverSmsUploadResult.Review ->
            LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, result.reasonCode)
          else -> LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, "sms_upload_review")
        }
      },
      heartbeat = null,
      close = capture::close,
    )
  }

  private fun unavailable(code: String) = VerifierRuntimeSession(
    cycle = VerifierRuntimeCycle {
      LivePilotRuntimeStatus(LivePilotRuntimeState.ENROLLMENT_REQUIRED, code)
    }, heartbeat = null,
  )

  internal fun queueInitializationCode(failure: Throwable?): String = when (failure) {
    is ReceiverSmsEncryptedOutbox.InitializationFailure -> failure.code
    is java.io.IOException -> "sms_queue_io_failed"
    is IllegalArgumentException -> "sms_queue_existing_file_invalid"
    is IllegalStateException -> "sms_queue_existing_file_invalid"
    else -> "sms_queue_unavailable"
  }
}
