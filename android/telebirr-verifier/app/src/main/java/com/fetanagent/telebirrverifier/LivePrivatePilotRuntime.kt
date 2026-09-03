package com.fetanagent.telebirrverifier

/**
 * Three independent gates must be open before the evidence-only runtime may contact the official
 * provider. There is intentionally no calendar stop date here: short-lived signed assignments,
 * device enrollment validity, server revocation, and the explicit operator gate are the safety
 * boundaries.
 */
data class LivePilotRuntimeGate(
  val buildEnabled: Boolean,
  val providerObservationEnabled: Boolean,
  val operatorEnabled: Boolean,
) {
  companion object {
    fun disabled(): LivePilotRuntimeGate =
      LivePilotRuntimeGate(
        buildEnabled = false,
        providerObservationEnabled = false,
        operatorEnabled = false,
      )
  }
}

enum class LivePilotRuntimeState {
  DISABLED,
  ENROLLMENT_REQUIRED,
  READY,
  BUSY,
  UPLOAD_PENDING,
  ATTENTION,
}

/** A deliberately small, non-sensitive projection suitable for UI and operational health. */
data class LivePilotRuntimeStatus(
  val state: LivePilotRuntimeState,
  val code: String,
  val lookupOutcome: String? = null,
  val advisoryEvidenceOnly: Boolean = true,
  val databaseWriteAllowed: Boolean = false,
  val settlementAllowed: Boolean = false,
  val financialActionAllowed: Boolean = false,
) {
  init {
    require(Regex("^[a-z][a-z0-9_]{2,63}$").matches(code))
    require(lookupOutcome == null || lookupOutcome in setOf("found", "review_required"))
    require(advisoryEvidenceOnly)
    require(!databaseWriteAllowed && !settlementAllowed && !financialActionAllowed)
  }

  override fun toString(): String =
    "LivePilotRuntimeStatus(state=$state,code=$code,lookupOutcome=$lookupOutcome,advisoryEvidenceOnly=true)"
}

fun interface LivePilotAssignmentSource {
  /** Returns at most one typed assignment. JSON decoding and authenticated transport live outside. */
  fun nextAssignment(): LivePilotSignedAssignment?
}

enum class LivePilotUploadRejection(val code: String) {
  ASSIGNMENT_REJECTED("assignment_rejected"),
  ASSIGNMENT_EXPIRED("assignment_expired"),
  BINDING_MISMATCH("binding_mismatch"),
  DEVICE_REVOKED("device_revoked"),
  EVIDENCE_INVALID("evidence_invalid"),
  PILOT_STOPPED("pilot_stopped"),
}

sealed interface LivePilotUploadResult {
  data class Acknowledged(val observationBodyDigest: String) : LivePilotUploadResult {
    init {
      LivePrivatePilotProtocol.requireSha256(observationBodyDigest, "observationBodyDigest")
    }

    override fun toString(): String = "LivePilotUploadResult.Acknowledged(<redacted>)"
  }

  data object Retryable : LivePilotUploadResult

  data class Rejected(val reason: LivePilotUploadRejection) : LivePilotUploadResult
}

fun interface LivePilotObservationUploader {
  /**
   * Uploads evidence only. The implementation must authenticate the server, bind both signed
   * payloads, and treat [LivePilotSignedObservation.bodyDigest] as its idempotency identity.
   */
  fun upload(
    assignment: LivePilotSignedAssignment,
    observation: LivePilotSignedObservation,
  ): LivePilotUploadResult
}

/** Sensitive queued material. Its text projection never exposes either signed payload. */
data class LivePilotPendingUpload(
  val assignment: LivePilotSignedAssignment,
  val observation: LivePilotSignedObservation,
) {
  init {
    require(assignment.bodyDigest == observation.body.assignmentBodyDigest)
    require(
      assignment.bodyDigest ==
        LivePilotCanonicalTranscripts.assignmentBodyDigest(assignment.body),
    )
    require(
      observation.bodyDigest ==
        LivePilotCanonicalTranscripts.observationBodyDigest(observation.body),
    )
  }

  override fun toString(): String = "LivePilotPendingUpload(<redacted>)"
}

sealed interface LivePilotWorkClaim {
  data object Acquired : LivePilotWorkClaim
  data object Busy : LivePilotWorkClaim
  data object Acknowledged : LivePilotWorkClaim

  data class Pending(val upload: LivePilotPendingUpload) : LivePilotWorkClaim {
    override fun toString(): String = "LivePilotWorkClaim.Pending(<redacted>)"
  }

  data class Rejected(val reason: LivePilotUploadRejection) : LivePilotWorkClaim
}

/**
 * Atomic replay/queue boundary. Operational wiring must provide a durable encrypted
 * implementation. An observation is staged before upload so a lost acknowledgement resends the
 * exact same signature instead of fetching or signing a second observation.
 */
interface LivePilotWorkStore {
  /** Returns the oldest staged upload so recovery drains evidence before leasing more work. */
  fun nextPending(): LivePilotPendingUpload?

  fun claim(assignmentBodyDigest: String): LivePilotWorkClaim

  fun stage(
    assignmentBodyDigest: String,
    assignment: LivePilotSignedAssignment,
    observation: LivePilotSignedObservation,
  )

  fun acknowledge(
    assignmentBodyDigest: String,
    observationBodyDigest: String,
  )

  fun reject(
    assignmentBodyDigest: String,
    reason: LivePilotUploadRejection,
  )

  fun release(assignmentBodyDigest: String)
}

/** Test/development implementation only; it is deliberately not wired into the Android app. */
class InMemoryLivePilotWorkStore : LivePilotWorkStore {
  private sealed interface Record {
    data object InFlight : Record
    data object Acknowledged : Record
    data class Pending(val upload: LivePilotPendingUpload) : Record
    data class Rejected(val reason: LivePilotUploadRejection) : Record
  }

  private val records = linkedMapOf<String, Record>()

  @Synchronized
  override fun nextPending(): LivePilotPendingUpload? =
    records.values.filterIsInstance<Record.Pending>().firstOrNull()?.upload

  @Synchronized
  override fun claim(assignmentBodyDigest: String): LivePilotWorkClaim {
    LivePrivatePilotProtocol.requireSha256(assignmentBodyDigest, "assignmentBodyDigest")
    return when (val existing = records[assignmentBodyDigest]) {
      null -> {
        records[assignmentBodyDigest] = Record.InFlight
        LivePilotWorkClaim.Acquired
      }
      Record.InFlight -> LivePilotWorkClaim.Busy
      Record.Acknowledged -> LivePilotWorkClaim.Acknowledged
      is Record.Pending -> LivePilotWorkClaim.Pending(existing.upload)
      is Record.Rejected -> LivePilotWorkClaim.Rejected(existing.reason)
    }
  }

  @Synchronized
  override fun stage(
    assignmentBodyDigest: String,
    assignment: LivePilotSignedAssignment,
    observation: LivePilotSignedObservation,
  ) {
    LivePrivatePilotProtocol.requireSha256(assignmentBodyDigest, "assignmentBodyDigest")
    require(records[assignmentBodyDigest] == Record.InFlight)
    require(assignment.bodyDigest == assignmentBodyDigest)
    require(observation.body.assignmentBodyDigest == assignmentBodyDigest)
    records[assignmentBodyDigest] =
      Record.Pending(LivePilotPendingUpload(assignment, observation))
  }

  @Synchronized
  override fun acknowledge(
    assignmentBodyDigest: String,
    observationBodyDigest: String,
  ) {
    LivePrivatePilotProtocol.requireSha256(assignmentBodyDigest, "assignmentBodyDigest")
    LivePrivatePilotProtocol.requireSha256(observationBodyDigest, "observationBodyDigest")
    val pending = records[assignmentBodyDigest] as? Record.Pending
      ?: throw IllegalStateException("No staged observation")
    require(pending.upload.observation.bodyDigest == observationBodyDigest)
    records[assignmentBodyDigest] = Record.Acknowledged
  }

  @Synchronized
  override fun reject(
    assignmentBodyDigest: String,
    reason: LivePilotUploadRejection,
  ) {
    LivePrivatePilotProtocol.requireSha256(assignmentBodyDigest, "assignmentBodyDigest")
    require(records[assignmentBodyDigest] is Record.Pending)
    records[assignmentBodyDigest] = Record.Rejected(reason)
  }

  @Synchronized
  override fun release(assignmentBodyDigest: String) {
    LivePrivatePilotProtocol.requireSha256(assignmentBodyDigest, "assignmentBodyDigest")
    if (records[assignmentBodyDigest] == Record.InFlight) records.remove(assignmentBodyDigest)
  }

  override fun toString(): String = "InMemoryLivePilotWorkStore(<redacted>)"
}

/**
 * Runs one signed assignment at a time. It has no polling timer, endpoint, credential, database
 * client, financial authority, or mutable receipt URL. Those boundaries are injected and remain
 * disabled in the shipped app.
 */
class LivePrivatePilotRuntimeCoordinator(
  private val gate: LivePilotRuntimeGate,
  private val trustedSigner: LivePilotTrustedAssignmentSigner,
  private val enrollment: LivePilotDeviceEnrollment,
  signerPublicSpkiDer: ByteArray,
  private val identity: P256Identity,
  private val assignmentSource: LivePilotAssignmentSource,
  private val transport: ProviderTransport,
  private val parser: LivePrivatePilotReceiptParser,
  private val uploader: LivePilotObservationUploader,
  private val workStore: LivePilotWorkStore,
  private val clock: MillisClock = MillisClock(System::currentTimeMillis),
) {
  private val signerPublicSpkiDer = signerPublicSpkiDer.copyOf()

  @Synchronized
  fun runOnce(): LivePilotRuntimeStatus {
    gateStatus()?.let { return it }
    val pending =
      runCatching { workStore.nextPending() }
        .getOrElse { return attention("work_store_unavailable") }
    if (pending != null) {
      return upload(
        pending.assignment,
        pending.assignment.bodyDigest,
        pending.observation,
      )
    }
    val assessedAt = now() ?: return attention("device_clock_unavailable")
    val devicePublicMaterial =
      runCatching { identity.publicMaterial() }
        .getOrElse { return enrollmentRequired("device_identity_unavailable") }
    val signedAssignment =
      runCatching { assignmentSource.nextAssignment() }
        .getOrElse { return attention("assignment_channel_unavailable") }
        ?: return ready("no_assignment")
    val assessment =
      LivePilotAssignmentVerifier.verify(
        signer = trustedSigner,
        enrollment = enrollment,
        signedAssignment = signedAssignment,
        signerPublicSpkiDer = signerPublicSpkiDer.copyOf(),
        devicePublicMaterial = devicePublicMaterial,
        assessedAt = assessedAt,
      )
    val assignment = assessment.authenticatedAssignment
      ?: return attention(assessment.reasonCode)
    val assignmentBodyDigest = signedAssignment.bodyDigest
    val claim =
      runCatching { workStore.claim(assignmentBodyDigest) }
        .getOrElse { return attention("work_store_unavailable") }
    return when (claim) {
      LivePilotWorkClaim.Acknowledged -> ready("assignment_already_acknowledged")
      LivePilotWorkClaim.Busy -> busy("assignment_in_progress")
      is LivePilotWorkClaim.Rejected -> attention("upload_${claim.reason.code}")
      is LivePilotWorkClaim.Pending ->
        upload(claim.upload.assignment, assignmentBodyDigest, claim.upload.observation)
      LivePilotWorkClaim.Acquired ->
        observeStageAndUpload(signedAssignment, assignment, assignmentBodyDigest)
    }
  }

  private fun gateStatus(): LivePilotRuntimeStatus? =
    when {
      !gate.buildEnabled -> disabled("build_disabled")
      !gate.providerObservationEnabled -> disabled("provider_observation_disabled")
      !gate.operatorEnabled -> disabled("operator_stopped")
      else -> null
    }

  private fun observeStageAndUpload(
    signedAssignment: LivePilotSignedAssignment,
    assignment: AuthenticatedLivePilotAssignment,
    assignmentBodyDigest: String,
  ): LivePilotRuntimeStatus {
    val document =
      runCatching {
          val reference = CanonicalReference.fromCanonical(assignment.body.rawReference)
          transport.retrieve(OfficialReceiptRoute.forReference(reference))
        }
        .getOrElse {
          ProviderDocument.Unavailable(
            uncertainty = "device",
            sourceDocumentDigest =
              LivePilotCanonicalTranscripts.sha256(
                "fetanagent-telebirr-live-pilot-device-error-v1".toByteArray(),
              ),
          )
        }
    val parsed =
      runCatching { parser.parse(document, assignment) }
        .getOrElse {
          LivePilotParsedProviderObservation(
            facts = LivePilotReviewRequiredFacts(reviewReason = "device_error", retrievedAt = null),
            sourceDocumentDigest =
              LivePilotCanonicalTranscripts.sha256(
                "fetanagent-telebirr-live-pilot-parser-error-v1".toByteArray(),
              ),
          )
        }
    val observedAt = now()
    if (observedAt == null) {
      release(assignmentBodyDigest)
      return attention("device_clock_unavailable")
    }
    if (observedAt < assignment.body.issuedAt || observedAt >= assignment.body.expiresAt) {
      release(assignmentBodyDigest)
      return attention("assignment_expired_during_observation")
    }
    val observation =
      runCatching {
          LivePilotSignedObservationFactory.create(
            assignment = assignment,
            facts = parsed.facts,
            sourceDocumentDigest = parsed.sourceDocumentDigest,
            observedAt = observedAt,
            identity = identity,
          )
        }
        .getOrElse {
          release(assignmentBodyDigest)
          return attention("observation_signing_unavailable")
        }
    val staged =
      runCatching {
          workStore.stage(assignmentBodyDigest, signedAssignment, observation)
        }
        .isSuccess
    if (!staged) {
      release(assignmentBodyDigest)
      return attention("work_store_unavailable")
    }
    return upload(signedAssignment, assignmentBodyDigest, observation)
  }

  private fun upload(
    signedAssignment: LivePilotSignedAssignment,
    assignmentBodyDigest: String,
    observation: LivePilotSignedObservation,
  ): LivePilotRuntimeStatus {
    val lookupOutcome = observation.body.facts.lookupOutcome
    val result =
      runCatching { uploader.upload(signedAssignment, observation) }
        .getOrElse { LivePilotUploadResult.Retryable }
    return when (result) {
      LivePilotUploadResult.Retryable ->
        uploadPending("upload_retry_scheduled", lookupOutcome)
      is LivePilotUploadResult.Acknowledged -> {
        if (result.observationBodyDigest != observation.bodyDigest) {
          attention("upload_ack_mismatch", lookupOutcome)
        } else {
          val recorded =
            runCatching {
                workStore.acknowledge(assignmentBodyDigest, observation.bodyDigest)
              }
              .isSuccess
          if (recorded) {
            ready("observation_acknowledged", lookupOutcome)
          } else {
            uploadPending("acknowledgement_store_unavailable", lookupOutcome)
          }
        }
      }
      is LivePilotUploadResult.Rejected -> {
        val recorded =
          runCatching { workStore.reject(assignmentBodyDigest, result.reason) }.isSuccess
        if (recorded) {
          attention("upload_${result.reason.code}", lookupOutcome)
        } else {
          uploadPending("rejection_store_unavailable", lookupOutcome)
        }
      }
    }
  }

  private fun release(assignmentBodyDigest: String) {
    runCatching { workStore.release(assignmentBodyDigest) }
  }

  private fun now(): String? =
    runCatching { SafeOfficialReceiptTransport.canonicalTimestamp(clock.nowMillis()) }.getOrNull()

  private fun disabled(code: String): LivePilotRuntimeStatus =
    LivePilotRuntimeStatus(LivePilotRuntimeState.DISABLED, code)

  private fun enrollmentRequired(code: String): LivePilotRuntimeStatus =
    LivePilotRuntimeStatus(LivePilotRuntimeState.ENROLLMENT_REQUIRED, code)

  private fun ready(code: String, lookupOutcome: String? = null): LivePilotRuntimeStatus =
    LivePilotRuntimeStatus(LivePilotRuntimeState.READY, code, lookupOutcome)

  private fun busy(code: String): LivePilotRuntimeStatus =
    LivePilotRuntimeStatus(LivePilotRuntimeState.BUSY, code)

  private fun uploadPending(code: String, lookupOutcome: String): LivePilotRuntimeStatus =
    LivePilotRuntimeStatus(LivePilotRuntimeState.UPLOAD_PENDING, code, lookupOutcome)

  private fun attention(code: String, lookupOutcome: String? = null): LivePilotRuntimeStatus =
    LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, code, lookupOutcome)
}
