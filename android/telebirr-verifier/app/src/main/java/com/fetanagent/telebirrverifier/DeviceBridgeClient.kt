package com.fetanagent.telebirrverifier

import java.security.SecureRandom
import java.util.UUID

class DeviceBridgeRetryableException : RuntimeException("Device bridge is temporarily unavailable")

class DeviceBridgeRejectedException(val reason: DeviceBridgeReasonCode) :
  RuntimeException("Device bridge rejected the request: ${reason.wireName}")

sealed interface DeviceBridgeHeartbeatResult {
  data object Acknowledged : DeviceBridgeHeartbeatResult
  data object Retryable : DeviceBridgeHeartbeatResult
  data class Rejected(val reason: DeviceBridgeReasonCode) : DeviceBridgeHeartbeatResult
}

interface DeviceBridgeRequestMaterialSource {
  fun nextRequestId(): String
  fun nextNonceDigest(): String
}

class SecureDeviceBridgeRequestMaterialSource(
  private val random: SecureRandom = SecureRandom(),
) : DeviceBridgeRequestMaterialSource {
  override fun nextRequestId(): String = "request_${UUID.randomUUID().toString().replace("-", "")}"

  override fun nextNonceDigest(): String =
    ByteArray(32).also(random::nextBytes).let(DeviceBridgeCanonical::sha256)
}

/**
 * One-use enrollment exchange. The immutable HTTPS origin, TLS policy, and redirect rejection are
 * supplied by [DeviceBridgeExchange]; no endpoint or credential is compiled into the app.
 */
class DeviceBridgeEnrollmentClient(
  private val exchange: DeviceBridgeExchange,
  trustedServerSpkiDer: ByteArray,
  private val clock: MillisClock = MillisClock(System::currentTimeMillis),
) {
  private val trustedServerSpkiDer = trustedServerSpkiDer.copyOf()

  fun enroll(pairing: SignedDeviceBridgePairingRequest): SignedDeviceBridgeEnrollmentCertificate {
    require(DeviceBridgeVerifier.verifyPairing(pairing))
    val now = now()
    require(now >= pairing.body.issuedAt && now < pairing.body.expiresAt)
    val response =
      exchange.post(
        DeviceBridgeProtocol.PAIRING_PATH,
        DeviceBridgeProtocol.CONTENT_TYPE,
        DeviceBridgeJsonCodec.encodePairingRequest(pairing),
      )
    require(response.statusCode == 201)
    require(response.contentType == DeviceBridgeProtocol.CONTENT_TYPE)
    val certificate =
      requireNotNull(DeviceBridgeJsonCodec.decodePairingResponse(response.body)) {
        "Invalid enrollment response"
      }
    require(DeviceBridgeVerifier.verifyCertificate(certificate, trustedServerSpkiDer))
    require(DeviceBridgeVerifier.certificateMatchesPairing(certificate, pairing))
    require(certificate.body.state == "active")
    require(now >= certificate.body.validFrom && now < certificate.body.validUntil)
    return certificate
  }

  private fun now(): String = SafeOfficialReceiptTransport.canonicalTimestamp(clock.nowMillis())

  override fun toString(): String = "DeviceBridgeEnrollmentClient(<redacted>)"
}

/**
 * Authenticated no-money command channel used by the live runtime's assignment and upload seams.
 * Every exchange gets a new signed request; an uncertain response is retried by the runtime with
 * the same staged assignment/observation signatures, while the server replay cache returns the
 * original acknowledgement for an exact request retry.
 */
class AuthenticatedDeviceBridgeClient(
  private val certificate: SignedDeviceBridgeEnrollmentCertificate,
  trustedServerSpkiDer: ByteArray,
  private val identity: P256Identity,
  private val exchange: DeviceBridgeExchange,
  private val requestMaterial: DeviceBridgeRequestMaterialSource =
    SecureDeviceBridgeRequestMaterialSource(),
  private val appVersion: String,
  private val clock: MillisClock = MillisClock(System::currentTimeMillis),
) : LivePilotAssignmentSource, LivePilotObservationUploader {
  private val trustedServerSpkiDer = trustedServerSpkiDer.copyOf()

  init {
    require(DeviceBridgeVerifier.verifyCertificate(certificate, this.trustedServerSpkiDer))
    require(certificate.body.state == "active")
    val public = identity.publicMaterial()
    require(identity.keyId == certificate.body.keyId)
    require(public.keyId == certificate.body.keyId)
    require(public.publicKeySpkiBase64Url == certificate.body.devicePublicKeySpki)
    require(public.publicKeySpkiSha256 == certificate.body.devicePublicKeySpkiSha256)
    DeviceBridgeProtocol.requireVersion(appVersion, "appVersion")
    require(versionAtLeast(appVersion, certificate.body.minimumAppVersion))
  }

  override fun nextAssignment(): LivePilotSignedAssignment? {
    val payload = DeviceBridgeAssignmentPollPayload(requestedLeaseSeconds = 120)
    val request = signedRequest(
      DeviceBridgeCommand.ASSIGNMENT_POLL,
      DeviceBridgeCanonical.assignmentPollPayloadDigest(payload),
    )
    val response =
      exchangeAndAuthenticate(
        request,
        DeviceBridgeJsonCodec.encodeAssignmentPollFrame(request, payload),
      )
    return when (response.acknowledgement.body.outcome) {
      DeviceBridgeAcknowledgementOutcome.ASSIGNMENT ->
        requireNotNull(response.assignment).also(::requireAssignmentCertificateBinding)
      DeviceBridgeAcknowledgementOutcome.NO_ASSIGNMENT -> null
      DeviceBridgeAcknowledgementOutcome.RETRY -> throw DeviceBridgeRetryableException()
      DeviceBridgeAcknowledgementOutcome.REJECTED ->
        throw DeviceBridgeRejectedException(
          requireNotNull(response.acknowledgement.body.reasonCode),
        )
      DeviceBridgeAcknowledgementOutcome.ACKNOWLEDGED ->
        throw IllegalArgumentException("Invalid poll acknowledgement")
    }
  }

  fun heartbeat(status: LivePilotRuntimeStatus): DeviceBridgeHeartbeatResult {
    val runtimeState =
      when (status.state) {
        LivePilotRuntimeState.DISABLED,
        LivePilotRuntimeState.ENROLLMENT_REQUIRED,
        -> DeviceBridgeRuntimeState.ENROLLMENT_REQUIRED
        LivePilotRuntimeState.READY -> DeviceBridgeRuntimeState.READY
        LivePilotRuntimeState.BUSY -> DeviceBridgeRuntimeState.BUSY
        LivePilotRuntimeState.UPLOAD_PENDING -> DeviceBridgeRuntimeState.UPLOAD_PENDING
        LivePilotRuntimeState.ATTENTION -> DeviceBridgeRuntimeState.ATTENTION
      }
    val payload =
      DeviceBridgeHeartbeatPayload(
        runtimeState = runtimeState,
        statusCode = status.code,
        appVersion = appVersion,
      )
    val request = signedRequest(
      DeviceBridgeCommand.HEARTBEAT,
      DeviceBridgeCanonical.heartbeatPayloadDigest(payload),
    )
    val response =
      runCatching {
          exchangeAndAuthenticate(
            request,
            DeviceBridgeJsonCodec.encodeHeartbeatFrame(request, payload),
          )
        }
        .getOrElse { return DeviceBridgeHeartbeatResult.Retryable }
    return when (response.acknowledgement.body.outcome) {
      DeviceBridgeAcknowledgementOutcome.ACKNOWLEDGED ->
        DeviceBridgeHeartbeatResult.Acknowledged
      DeviceBridgeAcknowledgementOutcome.RETRY -> DeviceBridgeHeartbeatResult.Retryable
      DeviceBridgeAcknowledgementOutcome.REJECTED ->
        DeviceBridgeHeartbeatResult.Rejected(
          requireNotNull(response.acknowledgement.body.reasonCode),
        )
      else -> DeviceBridgeHeartbeatResult.Retryable
    }
  }

  override fun upload(
    assignment: LivePilotSignedAssignment,
    observation: LivePilotSignedObservation,
  ): LivePilotUploadResult {
    val payload = DeviceBridgeObservationUploadPayload(assignment, observation)
    val request = signedRequest(
      DeviceBridgeCommand.OBSERVATION_UPLOAD,
      DeviceBridgeCanonical.observationUploadPayloadDigest(payload),
    )
    val response =
      runCatching {
          exchangeAndAuthenticate(
            request,
            DeviceBridgeJsonCodec.encodeObservationUploadFrame(request, payload),
          )
        }
        .getOrElse { return LivePilotUploadResult.Retryable }
    val acknowledgement = response.acknowledgement.body
    return when (acknowledgement.outcome) {
      DeviceBridgeAcknowledgementOutcome.ACKNOWLEDGED -> {
        if (
          acknowledgement.assignmentBodyDigest != assignment.bodyDigest ||
            acknowledgement.observationBodyDigest != observation.bodyDigest
        ) {
          LivePilotUploadResult.Retryable
        } else {
          LivePilotUploadResult.Acknowledged(observation.bodyDigest)
        }
      }
      DeviceBridgeAcknowledgementOutcome.RETRY -> LivePilotUploadResult.Retryable
      DeviceBridgeAcknowledgementOutcome.REJECTED ->
        LivePilotUploadResult.Rejected(
          uploadRejection(requireNotNull(acknowledgement.reasonCode)),
        )
      else -> LivePilotUploadResult.Retryable
    }
  }

  private fun signedRequest(
    command: DeviceBridgeCommand,
    payloadDigest: String,
  ): SignedDeviceBridgeRequest {
    val issuedAtMillis = clock.nowMillis()
    val issuedAt = SafeOfficialReceiptTransport.canonicalTimestamp(issuedAtMillis)
    requireEnrollmentActiveAt(issuedAt)
    val body =
      DeviceBridgeRequestBody(
        requestId = requestMaterial.nextRequestId(),
        enrollmentId = certificate.body.enrollmentId,
        deviceId = certificate.body.deviceId,
        keyId = certificate.body.keyId,
        command = command,
        payloadDigest = payloadDigest,
        nonceDigest = requestMaterial.nextNonceDigest(),
        issuedAt = issuedAt,
        expiresAt = SafeOfficialReceiptTransport.canonicalTimestamp(issuedAtMillis + 60_000),
      )
    return DeviceBridgeSignedFactory.request(body, identity)
  }

  private fun exchangeAndAuthenticate(
    request: SignedDeviceBridgeRequest,
    frame: ByteArray,
  ): DeviceBridgeCommandResponse {
    val response =
      exchange.post(request.body.canonicalPath, DeviceBridgeProtocol.CONTENT_TYPE, frame)
    require(response.statusCode == 200)
    require(response.contentType == DeviceBridgeProtocol.CONTENT_TYPE)
    val decoded =
      requireNotNull(DeviceBridgeJsonCodec.decodeCommandResponse(response.body)) {
        "Invalid device bridge response"
      }
    val assessedAt = SafeOfficialReceiptTransport.canonicalTimestamp(clock.nowMillis())
    require(
      DeviceBridgeVerifier.verifyAcknowledgement(
        decoded.acknowledgement,
        request,
        trustedServerSpkiDer,
        assessedAt,
      ),
    )
    return decoded
  }

  private fun requireAssignmentCertificateBinding(assignment: LivePilotSignedAssignment) {
    val body = assignment.body
    require(assignment.signerKeyId == certificate.body.assignmentSignerKeyId)
    require(body.deviceId == certificate.body.deviceId)
    require(body.keyId == certificate.body.keyId)
    require(body.pilotRevisionId == certificate.body.pilotRevisionId)
    require(body.receiverRevisionId == certificate.body.receiverRevisionId)
    require(body.receiverProfileId == certificate.body.receiverProfileId)
    require(body.receiverProfileDigest == certificate.body.receiverProfileDigest)
    require(body.receiverConfigurationDigest == certificate.body.receiverConfigurationDigest)
  }

  private fun requireEnrollmentActiveAt(assessedAt: String) {
    require(certificate.body.state == "active")
    require(assessedAt >= certificate.body.validFrom && assessedAt < certificate.body.validUntil)
  }

  private fun uploadRejection(reason: DeviceBridgeReasonCode): LivePilotUploadRejection =
    when (reason) {
      DeviceBridgeReasonCode.BINDING_MISMATCH -> LivePilotUploadRejection.BINDING_MISMATCH
      DeviceBridgeReasonCode.DEVICE_REVOKED -> LivePilotUploadRejection.DEVICE_REVOKED
      DeviceBridgeReasonCode.OBSERVATION_REJECTED,
      DeviceBridgeReasonCode.PAYLOAD_INVALID,
      -> LivePilotUploadRejection.EVIDENCE_INVALID
      DeviceBridgeReasonCode.PILOT_STOPPED -> LivePilotUploadRejection.PILOT_STOPPED
      DeviceBridgeReasonCode.REQUEST_EXPIRED -> LivePilotUploadRejection.ASSIGNMENT_EXPIRED
      DeviceBridgeReasonCode.ASSIGNMENT_UNAVAILABLE,
      DeviceBridgeReasonCode.REQUEST_REPLAYED,
      DeviceBridgeReasonCode.TEMPORARY_UNAVAILABLE,
      -> LivePilotUploadRejection.ASSIGNMENT_REJECTED
    }

  private fun versionAtLeast(actual: String, minimum: String): Boolean {
    fun numeric(value: String): List<Int>? {
      val match = Regex("^(\\d+)\\.(\\d+)\\.(\\d+)(?:[-.].*)?$").matchEntire(value)
        ?: return null
      return match.groupValues.drop(1).map { it.toIntOrNull() ?: return null }
    }
    val actualParts = numeric(actual)
    val minimumParts = numeric(minimum)
    if (actualParts == null || minimumParts == null) return actual == minimum
    for (index in actualParts.indices) {
      if (actualParts[index] != minimumParts[index]) {
        return actualParts[index] > minimumParts[index]
      }
    }
    return actual == minimum
  }

  override fun toString(): String = "AuthenticatedDeviceBridgeClient(<redacted>)"
}
