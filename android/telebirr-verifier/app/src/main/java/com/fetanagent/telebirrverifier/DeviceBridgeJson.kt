package com.fetanagent.telebirrverifier

import com.google.gson.Strictness
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import com.google.gson.stream.JsonWriter
import java.io.StringReader
import java.io.StringWriter
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

data class DeviceBridgeCommandResponse(
  val acknowledgement: SignedDeviceBridgeAcknowledgement,
  val assignment: LivePilotSignedAssignment?,
) {
  init {
    if (acknowledgement.body.outcome == DeviceBridgeAcknowledgementOutcome.ASSIGNMENT) {
      require(assignment?.bodyDigest == acknowledgement.body.assignmentBodyDigest)
    } else {
      require(assignment == null)
    }
  }

  override fun toString(): String =
    "DeviceBridgeCommandResponse(outcome=${acknowledgement.body.outcome.wireName},assignment=<redacted>)"
}

/** Strict duplicate-rejecting JSON wire codec for the public Android bridge surface. */
object DeviceBridgeJsonCodec {
  private const val MAX_WIRE_BYTES = 256 * 1_024

  fun encodePairingRequest(request: SignedDeviceBridgePairingRequest): ByteArray =
    encode(pairingEnvelope(request))

  fun decodePairingResponse(bytes: ByteArray): SignedDeviceBridgeEnrollmentCertificate? =
    decode(bytes) { root ->
      root.requireObject(setOf("certificate")).value("certificate").certificateEnvelope()
    }

  fun encodeAssignmentPollFrame(
    request: SignedDeviceBridgeRequest,
    payload: DeviceBridgeAssignmentPollPayload,
  ): ByteArray {
    require(request.body.command == DeviceBridgeCommand.ASSIGNMENT_POLL)
    require(request.body.payloadDigest == DeviceBridgeCanonical.assignmentPollPayloadDigest(payload))
    return encode(
      obj(
        "request" to requestEnvelope(request),
        "payload" to obj("requestedLeaseSeconds" to number(payload.requestedLeaseSeconds.toLong())),
      ),
    )
  }

  fun encodeHeartbeatFrame(
    request: SignedDeviceBridgeRequest,
    payload: DeviceBridgeHeartbeatPayload,
  ): ByteArray {
    require(request.body.command == DeviceBridgeCommand.HEARTBEAT)
    require(request.body.payloadDigest == DeviceBridgeCanonical.heartbeatPayloadDigest(payload))
    return encode(
      obj(
        "request" to requestEnvelope(request),
        "payload" to
          obj(
            "runtimeState" to text(payload.runtimeState.wireName),
            "statusCode" to text(payload.statusCode),
            "appVersion" to text(payload.appVersion),
          ),
      ),
    )
  }

  fun encodeObservationUploadFrame(
    request: SignedDeviceBridgeRequest,
    payload: DeviceBridgeObservationUploadPayload,
  ): ByteArray {
    require(request.body.command == DeviceBridgeCommand.OBSERVATION_UPLOAD)
    require(
      request.body.payloadDigest == DeviceBridgeCanonical.observationUploadPayloadDigest(payload),
    )
    return encode(
      obj(
        "request" to requestEnvelope(request),
        "payload" to
          obj(
            "signedAssignment" to assignmentEnvelope(payload.signedAssignment),
            "signedObservation" to observationEnvelope(payload.signedObservation),
          ),
      ),
    )
  }

  fun decodeCommandResponse(bytes: ByteArray): DeviceBridgeCommandResponse? =
    decode(bytes) { root ->
      val response = root.requireObject(setOf("acknowledgement", "assignment"))
      val acknowledgement = response.value("acknowledgement").acknowledgementEnvelope()
      val assignmentValue = response.value("assignment")
      val assignment = if (assignmentValue === JsonValue.Null) null else assignmentValue.assignmentEnvelope()
      DeviceBridgeCommandResponse(acknowledgement, assignment)
    }

  internal fun encodePairingResponseForTest(
    certificate: SignedDeviceBridgeEnrollmentCertificate,
  ): ByteArray = encode(obj("certificate" to certificateEnvelope(certificate)))

  internal fun encodeCommandResponseForTest(response: DeviceBridgeCommandResponse): ByteArray =
    encode(
      obj(
        "acknowledgement" to acknowledgementEnvelope(response.acknowledgement),
        "assignment" to (response.assignment?.let(::assignmentEnvelope) ?: JsonValue.Null),
      ),
    )

  private fun pairingEnvelope(value: SignedDeviceBridgePairingRequest): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "transcriptVersion" to text(value.transcriptVersion),
      "bodyDigestAlgorithm" to text(value.bodyDigestAlgorithm),
      "bodyDigest" to text(value.bodyDigest),
      "signatureAlgorithm" to text(value.signatureAlgorithm),
      "signatureEncoding" to text(value.signatureEncoding),
      "keyId" to text(value.keyId),
      "body" to pairingBody(value.body),
      "signature" to text(value.signature),
    )

  private fun pairingBody(value: DeviceBridgePairingBody): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "pairingId" to text(value.pairingId),
      "pairingNonceDigest" to text(value.pairingNonceDigest),
      "deviceId" to text(value.deviceId),
      "keyId" to text(value.keyId),
      "devicePublicKeySpki" to text(value.devicePublicKeySpki),
      "devicePublicKeySpkiSha256" to text(value.devicePublicKeySpkiSha256),
      "signatureAlgorithm" to text(value.signatureAlgorithm),
      "devicePlatform" to text(value.devicePlatform),
      "appVersion" to text(value.appVersion),
      "issuedAt" to text(value.issuedAt),
      "expiresAt" to text(value.expiresAt),
      "oneUse" to bool(value.oneUse),
      *safetyPairs(value.safety),
    )

  private fun requestEnvelope(value: SignedDeviceBridgeRequest): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "transcriptVersion" to text(value.transcriptVersion),
      "bodyDigestAlgorithm" to text(value.bodyDigestAlgorithm),
      "bodyDigest" to text(value.bodyDigest),
      "signatureAlgorithm" to text(value.signatureAlgorithm),
      "signatureEncoding" to text(value.signatureEncoding),
      "keyId" to text(value.keyId),
      "body" to requestBody(value.body),
      "signature" to text(value.signature),
    )

  private fun certificateEnvelope(
    value: SignedDeviceBridgeEnrollmentCertificate,
  ): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "transcriptVersion" to text(value.transcriptVersion),
      "bodyDigestAlgorithm" to text(value.bodyDigestAlgorithm),
      "bodyDigest" to text(value.bodyDigest),
      "signatureAlgorithm" to text(value.signatureAlgorithm),
      "signatureEncoding" to text(value.signatureEncoding),
      "signerKeyId" to text(value.signerKeyId),
      "body" to certificateBody(value.body),
      "signature" to text(value.signature),
    )

  private fun certificateBody(value: DeviceBridgeEnrollmentCertificateBody): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "enrollmentId" to text(value.enrollmentId),
      "pairingId" to text(value.pairingId),
      "pairingRequestBodyDigest" to text(value.pairingRequestBodyDigest),
      "pairingNonceDigest" to text(value.pairingNonceDigest),
      "pairingConsumed" to bool(value.pairingConsumed),
      "deviceId" to text(value.deviceId),
      "keyId" to text(value.keyId),
      "devicePublicKeySpki" to text(value.devicePublicKeySpki),
      "devicePublicKeySpkiSha256" to text(value.devicePublicKeySpkiSha256),
      "signatureAlgorithm" to text(value.signatureAlgorithm),
      "devicePlatform" to text(value.devicePlatform),
      "minimumAppVersion" to text(value.minimumAppVersion),
      "pilotRevisionId" to text(value.pilotRevisionId),
      "receiverRevisionId" to text(value.receiverRevisionId),
      "receiverProfileId" to text(value.receiverProfileId),
      "receiverProfileDigest" to text(value.receiverProfileDigest),
      "receiverConfigurationDigest" to text(value.receiverConfigurationDigest),
      "assignmentSignerKeyId" to text(value.assignmentSignerKeyId),
      "assignmentSignerPublicKeySpkiSha256" to
        text(value.assignmentSignerPublicKeySpkiSha256),
      "state" to text(value.state),
      "issuedAt" to text(value.issuedAt),
      "validFrom" to text(value.validFrom),
      "validUntil" to text(value.validUntil),
      *safetyPairs(value.safety),
    )

  private fun acknowledgementEnvelope(
    value: SignedDeviceBridgeAcknowledgement,
  ): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "transcriptVersion" to text(value.transcriptVersion),
      "bodyDigestAlgorithm" to text(value.bodyDigestAlgorithm),
      "bodyDigest" to text(value.bodyDigest),
      "signatureAlgorithm" to text(value.signatureAlgorithm),
      "signatureEncoding" to text(value.signatureEncoding),
      "signerKeyId" to text(value.signerKeyId),
      "body" to acknowledgementBody(value.body),
      "signature" to text(value.signature),
    )

  private fun acknowledgementBody(value: DeviceBridgeAcknowledgementBody): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "acknowledgementId" to text(value.acknowledgementId),
      "requestId" to text(value.requestId),
      "enrollmentId" to text(value.enrollmentId),
      "deviceId" to text(value.deviceId),
      "keyId" to text(value.keyId),
      "command" to text(value.command.wireName),
      "requestBodyDigest" to text(value.requestBodyDigest),
      "requestPayloadDigest" to text(value.requestPayloadDigest),
      "outcome" to text(value.outcome.wireName),
      "assignmentBodyDigest" to nullableText(value.assignmentBodyDigest),
      "observationBodyDigest" to nullableText(value.observationBodyDigest),
      "reasonCode" to nullableText(value.reasonCode?.wireName),
      "issuedAt" to text(value.issuedAt),
      "expiresAt" to text(value.expiresAt),
      *safetyPairs(value.safety),
    )

  private fun requestBody(value: DeviceBridgeRequestBody): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "requestId" to text(value.requestId),
      "enrollmentId" to text(value.enrollmentId),
      "deviceId" to text(value.deviceId),
      "keyId" to text(value.keyId),
      "command" to text(value.command.wireName),
      "method" to text(value.method),
      "canonicalPath" to text(value.canonicalPath),
      "payloadDigest" to text(value.payloadDigest),
      "nonceDigest" to text(value.nonceDigest),
      "issuedAt" to text(value.issuedAt),
      "expiresAt" to text(value.expiresAt),
      *safetyPairs(value.safety),
    )

  private fun assignmentEnvelope(value: LivePilotSignedAssignment): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "transcriptVersion" to text(value.transcriptVersion),
      "bodyDigestAlgorithm" to text(value.bodyDigestAlgorithm),
      "bodyDigest" to text(value.bodyDigest),
      "signatureAlgorithm" to text(value.signatureAlgorithm),
      "signatureEncoding" to text(value.signatureEncoding),
      "signerKeyId" to text(value.signerKeyId),
      "body" to assignmentBody(value.body),
      "signature" to text(value.signature),
    )

  private fun assignmentBody(value: LivePilotAssignmentBody): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "assignmentId" to text(value.assignmentId),
      "requestId" to text(value.requestId),
      "jobId" to text(value.jobId),
      "attemptNumber" to number(value.attemptNumber.toLong()),
      "pilotRevisionId" to text(value.pilotRevisionId),
      "deviceId" to text(value.deviceId),
      "keyId" to text(value.keyId),
      "leaseNonceDigest" to text(value.leaseNonceDigest),
      "challengeId" to text(value.challengeId),
      "challengeDigest" to text(value.challengeDigest),
      "rawReference" to text(value.rawReference),
      "referenceFingerprint" to text(value.referenceFingerprint),
      "referenceBindingProfile" to text(value.referenceBindingProfile),
      "referenceBindingDigest" to text(value.referenceBindingDigest),
      "sourceProfile" to text(value.sourceProfile),
      "receiverRevisionId" to text(value.receiverRevisionId),
      "receiverProfileId" to text(value.receiverProfileId),
      "receiverProfileDigest" to text(value.receiverProfileDigest),
      "receiverConfigurationDigest" to text(value.receiverConfigurationDigest),
      "receiverNameNormalizerVersion" to text(value.receiverNameNormalizerVersion),
      "expectedReceiverNameNormalized" to text(value.expectedReceiverNameNormalized),
      "expectedReceiverNameDigest" to text(value.expectedReceiverNameDigest),
      "adapterVersion" to text(value.adapterVersion),
      "parserVersion" to text(value.parserVersion),
      "factsNormalizerVersion" to text(value.factsNormalizerVersion),
      "issuedAt" to text(value.issuedAt),
      "expiresAt" to text(value.expiresAt),
    )

  private fun observationEnvelope(value: LivePilotSignedObservation): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "transcriptVersion" to text(value.transcriptVersion),
      "bodyDigestAlgorithm" to text(value.bodyDigestAlgorithm),
      "bodyDigest" to text(value.bodyDigest),
      "signatureAlgorithm" to text(value.signatureAlgorithm),
      "signatureEncoding" to text(value.signatureEncoding),
      "body" to observationBody(value.body),
      "signature" to text(value.signature),
    )

  private fun observationBody(value: LivePilotObservationBody): JsonValue.Object =
    obj(
      "contractVersion" to number(value.contractVersion.toLong()),
      "providerCode" to text(value.providerCode),
      "protocolMode" to text(value.protocolMode),
      "assignmentId" to text(value.assignmentId),
      "requestId" to text(value.requestId),
      "jobId" to text(value.jobId),
      "attemptNumber" to number(value.attemptNumber.toLong()),
      "pilotRevisionId" to text(value.pilotRevisionId),
      "deviceId" to text(value.deviceId),
      "keyId" to text(value.keyId),
      "leaseNonceDigest" to text(value.leaseNonceDigest),
      "challengeId" to text(value.challengeId),
      "challengeDigest" to text(value.challengeDigest),
      "assignmentBodyDigest" to text(value.assignmentBodyDigest),
      "referenceFingerprint" to text(value.referenceFingerprint),
      "referenceBindingDigest" to text(value.referenceBindingDigest),
      "sourceProfile" to text(value.sourceProfile),
      "receiverRevisionId" to text(value.receiverRevisionId),
      "receiverProfileId" to text(value.receiverProfileId),
      "receiverProfileDigest" to text(value.receiverProfileDigest),
      "receiverConfigurationDigest" to text(value.receiverConfigurationDigest),
      "receiverNameNormalizerVersion" to text(value.receiverNameNormalizerVersion),
      "expectedReceiverNameDigest" to text(value.expectedReceiverNameDigest),
      "adapterVersion" to text(value.adapterVersion),
      "parserVersion" to text(value.parserVersion),
      "factsNormalizerVersion" to text(value.factsNormalizerVersion),
      "sourceDocumentDigest" to text(value.sourceDocumentDigest),
      "normalizedFactsDigest" to text(value.normalizedFactsDigest),
      "observedAt" to text(value.observedAt),
      "facts" to facts(value.facts),
    )

  private fun facts(value: LivePilotReceiptFacts): JsonValue.Object =
    when (value) {
      is LivePilotReviewRequiredFacts ->
        obj(
          "lookupOutcome" to text(value.lookupOutcome),
          "reviewReason" to text(value.reviewReason),
          "retrievedAt" to nullableText(value.retrievedAt),
        )
      is LivePilotFoundFacts ->
        obj(
          "lookupOutcome" to text(value.lookupOutcome),
          "evidenceSource" to text(value.evidenceSource),
          "layoutAttestation" to text(value.layoutAttestation),
          "providerFinalStatus" to text(value.providerFinalStatus),
          "canonicalReferencePresent" to bool(value.canonicalReferencePresent),
          "referenceMatch" to text(value.referenceMatch),
          "amountMinor" to nullableNumber(value.amountMinor),
          "currencyCode" to text(value.currencyCode),
          "receiverMatch" to text(value.receiverMatch),
          "creditedPartyNameDigest" to nullableText(value.creditedPartyNameDigest),
          "paymentMode" to text(value.paymentMode),
          "paymentReason" to text(value.paymentReason),
          "paymentChannel" to text(value.paymentChannel),
          "occurredAt" to nullableText(value.occurredAt),
          "retrievedAt" to text(value.retrievedAt),
        )
    }

  private fun JsonValue.certificateEnvelope(): SignedDeviceBridgeEnrollmentCertificate {
    val value =
      requireObject(
        setOf(
          "contractVersion",
          "providerCode",
          "protocolMode",
          "transcriptVersion",
          "bodyDigestAlgorithm",
          "bodyDigest",
          "signatureAlgorithm",
          "signatureEncoding",
          "signerKeyId",
          "body",
          "signature",
        ),
      )
    return SignedDeviceBridgeEnrollmentCertificate(
      contractVersion = value.int("contractVersion"),
      providerCode = value.string("providerCode"),
      protocolMode = value.string("protocolMode"),
      transcriptVersion = value.string("transcriptVersion"),
      bodyDigestAlgorithm = value.string("bodyDigestAlgorithm"),
      bodyDigest = value.string("bodyDigest"),
      signatureAlgorithm = value.string("signatureAlgorithm"),
      signatureEncoding = value.string("signatureEncoding"),
      signerKeyId = value.string("signerKeyId"),
      body = value.value("body").certificateBody(),
      signature = value.string("signature"),
    )
  }

  private fun JsonValue.certificateBody(): DeviceBridgeEnrollmentCertificateBody {
    val value = requireObject(certificateBodyKeys)
    return DeviceBridgeEnrollmentCertificateBody(
      contractVersion = value.int("contractVersion"),
      providerCode = value.string("providerCode"),
      protocolMode = value.string("protocolMode"),
      enrollmentId = value.string("enrollmentId"),
      pairingId = value.string("pairingId"),
      pairingRequestBodyDigest = value.string("pairingRequestBodyDigest"),
      pairingNonceDigest = value.string("pairingNonceDigest"),
      pairingConsumed = value.boolean("pairingConsumed"),
      deviceId = value.string("deviceId"),
      keyId = value.string("keyId"),
      devicePublicKeySpki = value.string("devicePublicKeySpki"),
      devicePublicKeySpkiSha256 = value.string("devicePublicKeySpkiSha256"),
      signatureAlgorithm = value.string("signatureAlgorithm"),
      devicePlatform = value.string("devicePlatform"),
      minimumAppVersion = value.string("minimumAppVersion"),
      pilotRevisionId = value.string("pilotRevisionId"),
      receiverRevisionId = value.string("receiverRevisionId"),
      receiverProfileId = value.string("receiverProfileId"),
      receiverProfileDigest = value.string("receiverProfileDigest"),
      receiverConfigurationDigest = value.string("receiverConfigurationDigest"),
      assignmentSignerKeyId = value.string("assignmentSignerKeyId"),
      assignmentSignerPublicKeySpkiSha256 =
        value.string("assignmentSignerPublicKeySpkiSha256"),
      state = value.string("state"),
      issuedAt = value.string("issuedAt"),
      validFrom = value.string("validFrom"),
      validUntil = value.string("validUntil"),
      safety = value.safety(),
    )
  }

  private fun JsonValue.acknowledgementEnvelope(): SignedDeviceBridgeAcknowledgement {
    val value = requireObject(serverEnvelopeKeys)
    return SignedDeviceBridgeAcknowledgement(
      contractVersion = value.int("contractVersion"),
      providerCode = value.string("providerCode"),
      protocolMode = value.string("protocolMode"),
      transcriptVersion = value.string("transcriptVersion"),
      bodyDigestAlgorithm = value.string("bodyDigestAlgorithm"),
      bodyDigest = value.string("bodyDigest"),
      signatureAlgorithm = value.string("signatureAlgorithm"),
      signatureEncoding = value.string("signatureEncoding"),
      signerKeyId = value.string("signerKeyId"),
      body = value.value("body").acknowledgementBody(),
      signature = value.string("signature"),
    )
  }

  private fun JsonValue.acknowledgementBody(): DeviceBridgeAcknowledgementBody {
    val value = requireObject(acknowledgementBodyKeys)
    return DeviceBridgeAcknowledgementBody(
      contractVersion = value.int("contractVersion"),
      providerCode = value.string("providerCode"),
      protocolMode = value.string("protocolMode"),
      acknowledgementId = value.string("acknowledgementId"),
      requestId = value.string("requestId"),
      enrollmentId = value.string("enrollmentId"),
      deviceId = value.string("deviceId"),
      keyId = value.string("keyId"),
      command =
        requireNotNull(DeviceBridgeCommand.fromWire(value.string("command"))) {
          "Unknown command"
        },
      requestBodyDigest = value.string("requestBodyDigest"),
      requestPayloadDigest = value.string("requestPayloadDigest"),
      outcome =
        requireNotNull(
          DeviceBridgeAcknowledgementOutcome.fromWire(value.string("outcome")),
        ) {
          "Unknown acknowledgement outcome"
        },
      assignmentBodyDigest = value.nullableString("assignmentBodyDigest"),
      observationBodyDigest = value.nullableString("observationBodyDigest"),
      reasonCode =
        value.nullableString("reasonCode")?.let {
          requireNotNull(DeviceBridgeReasonCode.fromWire(it)) { "Unknown reason code" }
        },
      issuedAt = value.string("issuedAt"),
      expiresAt = value.string("expiresAt"),
      safety = value.safety(),
    )
  }

  private fun JsonValue.assignmentEnvelope(): LivePilotSignedAssignment {
    val value = requireObject(assignmentEnvelopeKeys)
    return LivePilotSignedAssignment(
      contractVersion = value.int("contractVersion"),
      providerCode = value.string("providerCode"),
      protocolMode = value.string("protocolMode"),
      transcriptVersion = value.string("transcriptVersion"),
      bodyDigestAlgorithm = value.string("bodyDigestAlgorithm"),
      bodyDigest = value.string("bodyDigest"),
      signatureAlgorithm = value.string("signatureAlgorithm"),
      signatureEncoding = value.string("signatureEncoding"),
      signerKeyId = value.string("signerKeyId"),
      body = value.value("body").assignmentBodyValue(),
      signature = value.string("signature"),
    ).also {
      require(it.bodyDigest == LivePilotCanonicalTranscripts.assignmentBodyDigest(it.body))
    }
  }

  private fun JsonValue.assignmentBodyValue(): LivePilotAssignmentBody {
    val value = requireObject(assignmentBodyKeys)
    return LivePilotAssignmentBody(
      contractVersion = value.int("contractVersion"),
      providerCode = value.string("providerCode"),
      protocolMode = value.string("protocolMode"),
      assignmentId = value.string("assignmentId"),
      requestId = value.string("requestId"),
      jobId = value.string("jobId"),
      attemptNumber = value.int("attemptNumber"),
      pilotRevisionId = value.string("pilotRevisionId"),
      deviceId = value.string("deviceId"),
      keyId = value.string("keyId"),
      leaseNonceDigest = value.string("leaseNonceDigest"),
      challengeId = value.string("challengeId"),
      challengeDigest = value.string("challengeDigest"),
      rawReference = value.string("rawReference"),
      referenceFingerprint = value.string("referenceFingerprint"),
      referenceBindingProfile = value.string("referenceBindingProfile"),
      referenceBindingDigest = value.string("referenceBindingDigest"),
      sourceProfile = value.string("sourceProfile"),
      receiverRevisionId = value.string("receiverRevisionId"),
      receiverProfileId = value.string("receiverProfileId"),
      receiverProfileDigest = value.string("receiverProfileDigest"),
      receiverConfigurationDigest = value.string("receiverConfigurationDigest"),
      receiverNameNormalizerVersion = value.string("receiverNameNormalizerVersion"),
      expectedReceiverNameNormalized = value.string("expectedReceiverNameNormalized"),
      expectedReceiverNameDigest = value.string("expectedReceiverNameDigest"),
      adapterVersion = value.string("adapterVersion"),
      parserVersion = value.string("parserVersion"),
      factsNormalizerVersion = value.string("factsNormalizerVersion"),
      issuedAt = value.string("issuedAt"),
      expiresAt = value.string("expiresAt"),
    )
  }

  private fun JsonValue.Object.safety(): DeviceBridgeSafety =
    DeviceBridgeSafety(
      evidenceOnly = boolean("evidenceOnly"),
      databaseAccessAllowed = boolean("databaseAccessAllowed"),
      claimAllowed = boolean("claimAllowed"),
      settlementAllowed = boolean("settlementAllowed"),
      enqueueAllowed = boolean("enqueueAllowed"),
      executionAllowed = boolean("executionAllowed"),
      financialActionAllowed = boolean("financialActionAllowed"),
      moneyMovementAllowed = boolean("moneyMovementAllowed"),
      rawReceiptUploadAllowed = boolean("rawReceiptUploadAllowed"),
      sensitiveLoggingAllowed = boolean("sensitiveLoggingAllowed"),
    )

  private inline fun <T> decode(bytes: ByteArray, transform: (JsonValue) -> T): T? =
    runCatching {
        require(bytes.size in 1..MAX_WIRE_BYTES)
        transform(StrictJson.parse(bytes))
      }
      .getOrNull()

  private fun encode(value: JsonValue): ByteArray {
    val encoded = StrictJson.encode(value).toByteArray(StandardCharsets.UTF_8)
    require(encoded.size <= MAX_WIRE_BYTES)
    return encoded
  }

  private fun safetyPairs(value: DeviceBridgeSafety): Array<Pair<String, JsonValue>> =
    arrayOf(
      "evidenceOnly" to bool(value.evidenceOnly),
      "databaseAccessAllowed" to bool(value.databaseAccessAllowed),
      "claimAllowed" to bool(value.claimAllowed),
      "settlementAllowed" to bool(value.settlementAllowed),
      "enqueueAllowed" to bool(value.enqueueAllowed),
      "executionAllowed" to bool(value.executionAllowed),
      "financialActionAllowed" to bool(value.financialActionAllowed),
      "moneyMovementAllowed" to bool(value.moneyMovementAllowed),
      "rawReceiptUploadAllowed" to bool(value.rawReceiptUploadAllowed),
      "sensitiveLoggingAllowed" to bool(value.sensitiveLoggingAllowed),
    )

  private val safetyKeys =
    setOf(
      "evidenceOnly",
      "databaseAccessAllowed",
      "claimAllowed",
      "settlementAllowed",
      "enqueueAllowed",
      "executionAllowed",
      "financialActionAllowed",
      "moneyMovementAllowed",
      "rawReceiptUploadAllowed",
      "sensitiveLoggingAllowed",
    )

  private val certificateBodyKeys =
    setOf(
      "contractVersion",
      "providerCode",
      "protocolMode",
      "enrollmentId",
      "pairingId",
      "pairingRequestBodyDigest",
      "pairingNonceDigest",
      "pairingConsumed",
      "deviceId",
      "keyId",
      "devicePublicKeySpki",
      "devicePublicKeySpkiSha256",
      "signatureAlgorithm",
      "devicePlatform",
      "minimumAppVersion",
      "pilotRevisionId",
      "receiverRevisionId",
      "receiverProfileId",
      "receiverProfileDigest",
      "receiverConfigurationDigest",
      "assignmentSignerKeyId",
      "assignmentSignerPublicKeySpkiSha256",
      "state",
      "issuedAt",
      "validFrom",
      "validUntil",
    ) + safetyKeys

  private val acknowledgementBodyKeys =
    setOf(
      "contractVersion",
      "providerCode",
      "protocolMode",
      "acknowledgementId",
      "requestId",
      "enrollmentId",
      "deviceId",
      "keyId",
      "command",
      "requestBodyDigest",
      "requestPayloadDigest",
      "outcome",
      "assignmentBodyDigest",
      "observationBodyDigest",
      "reasonCode",
      "issuedAt",
      "expiresAt",
    ) + safetyKeys

  private val serverEnvelopeKeys =
    setOf(
      "contractVersion",
      "providerCode",
      "protocolMode",
      "transcriptVersion",
      "bodyDigestAlgorithm",
      "bodyDigest",
      "signatureAlgorithm",
      "signatureEncoding",
      "signerKeyId",
      "body",
      "signature",
    )

  private val assignmentEnvelopeKeys =
    setOf(
      "contractVersion",
      "providerCode",
      "protocolMode",
      "transcriptVersion",
      "bodyDigestAlgorithm",
      "bodyDigest",
      "signatureAlgorithm",
      "signatureEncoding",
      "signerKeyId",
      "body",
      "signature",
    )

  private val assignmentBodyKeys =
    setOf(
      "contractVersion",
      "providerCode",
      "protocolMode",
      "assignmentId",
      "requestId",
      "jobId",
      "attemptNumber",
      "pilotRevisionId",
      "deviceId",
      "keyId",
      "leaseNonceDigest",
      "challengeId",
      "challengeDigest",
      "rawReference",
      "referenceFingerprint",
      "referenceBindingProfile",
      "referenceBindingDigest",
      "sourceProfile",
      "receiverRevisionId",
      "receiverProfileId",
      "receiverProfileDigest",
      "receiverConfigurationDigest",
      "receiverNameNormalizerVersion",
      "expectedReceiverNameNormalized",
      "expectedReceiverNameDigest",
      "adapterVersion",
      "parserVersion",
      "factsNormalizerVersion",
      "issuedAt",
      "expiresAt",
    )
}

private sealed interface JsonValue {
  data class Object(val fields: LinkedHashMap<String, JsonValue>) : JsonValue {
    fun value(name: String): JsonValue = requireNotNull(fields[name]) { "Missing $name" }

    fun string(name: String): String = (value(name) as? Text)?.value ?: error("$name is not text")

    fun nullableString(name: String): String? =
      when (val candidate = value(name)) {
        Null -> null
        is Text -> candidate.value
        else -> error("$name is not nullable text")
      }

    fun boolean(name: String): Boolean =
      (value(name) as? BooleanValue)?.value ?: error("$name is not boolean")

    fun int(name: String): Int {
      val raw = (value(name) as? NumberValue)?.raw ?: error("$name is not a number")
      require(INTEGER_PATTERN.matches(raw))
      return raw.toInt()
    }
  }

  data class Text(val value: String) : JsonValue
  data class NumberValue(val raw: String) : JsonValue
  data class BooleanValue(val value: Boolean) : JsonValue
  data object Null : JsonValue
}

private val INTEGER_PATTERN = Regex("-?(?:0|[1-9][0-9]*)")

private fun JsonValue.requireObject(expectedKeys: Set<String>): JsonValue.Object {
  val value = this as? JsonValue.Object ?: error("Expected object")
  require(value.fields.keys == expectedKeys) { "Unexpected object keys" }
  return value
}

private fun obj(vararg fields: Pair<String, JsonValue>): JsonValue.Object =
  JsonValue.Object(
    linkedMapOf<String, JsonValue>().apply {
      for ((name, value) in fields) require(put(name, value) == null) { "Duplicate $name" }
    },
  )

private fun text(value: String): JsonValue.Text = JsonValue.Text(value)

private fun nullableText(value: String?): JsonValue = value?.let(::text) ?: JsonValue.Null

private fun number(value: Long): JsonValue.NumberValue = JsonValue.NumberValue(value.toString())

private fun nullableNumber(value: Long?): JsonValue = value?.let(::number) ?: JsonValue.Null

private fun bool(value: Boolean): JsonValue.BooleanValue = JsonValue.BooleanValue(value)

private object StrictJson {
  private const val MAX_DEPTH = 16
  private const val MAX_FIELDS_PER_OBJECT = 128
  private const val MAX_STRING_CODE_UNITS = 32 * 1_024
  private const val MAX_TOKENS = 4_096

  fun parse(bytes: ByteArray): JsonValue {
    val decoder =
      StandardCharsets.UTF_8
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
    val text = decoder.decode(ByteBuffer.wrap(bytes)).toString()
    require(text.isNotEmpty() && text.first() != '\uFEFF')
    var tokens = 0
    JsonReader(StringReader(text)).use { reader ->
      reader.strictness = Strictness.STRICT
      fun read(depth: Int): JsonValue {
        require(depth <= MAX_DEPTH && ++tokens <= MAX_TOKENS)
        return when (reader.peek()) {
          JsonToken.BEGIN_OBJECT -> {
            reader.beginObject()
            val fields = linkedMapOf<String, JsonValue>()
            while (reader.hasNext()) {
              require(fields.size < MAX_FIELDS_PER_OBJECT)
              val name = reader.nextName()
              require(name.length <= MAX_STRING_CODE_UNITS && !fields.containsKey(name))
              fields[name] = read(depth + 1)
            }
            reader.endObject()
            JsonValue.Object(fields)
          }
          JsonToken.STRING -> {
            val value = reader.nextString()
            require(value.length <= MAX_STRING_CODE_UNITS)
            JsonValue.Text(value)
          }
          JsonToken.NUMBER -> {
            val value = reader.nextString()
            require(INTEGER_PATTERN.matches(value))
            JsonValue.NumberValue(value)
          }
          JsonToken.BOOLEAN -> JsonValue.BooleanValue(reader.nextBoolean())
          JsonToken.NULL -> {
            reader.nextNull()
            JsonValue.Null
          }
          else -> error("Unsupported JSON token")
        }
      }
      val value = read(0)
      require(reader.peek() == JsonToken.END_DOCUMENT)
      return value
    }
  }

  fun encode(value: JsonValue): String {
    val output = StringWriter()
    JsonWriter(output).use { writer ->
      writer.strictness = Strictness.STRICT
      fun write(candidate: JsonValue) {
        when (candidate) {
          is JsonValue.Object -> {
            writer.beginObject()
            for ((name, child) in candidate.fields) {
              writer.name(name)
              write(child)
            }
            writer.endObject()
          }
          is JsonValue.Text -> writer.value(candidate.value)
          is JsonValue.NumberValue -> writer.jsonValue(candidate.raw)
          is JsonValue.BooleanValue -> writer.value(candidate.value)
          JsonValue.Null -> writer.nullValue()
        }
      }
      write(value)
    }
    return output.toString()
  }
}
