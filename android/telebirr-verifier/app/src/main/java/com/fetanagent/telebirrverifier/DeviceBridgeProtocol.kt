package com.fetanagent.telebirrverifier

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.Base64

/** Authenticated, evidence-only Android bridge. No type here can represent a financial command. */
object DeviceBridgeProtocol {
  const val CONTRACT_VERSION = 1
  const val PROVIDER_CODE = "telebirr"
  const val PROTOCOL_MODE = "device_bridge_no_money_v1"
  const val DEVICE_PLATFORM = "android"
  const val DIGEST_ALGORITHM = "sha256"
  const val SIGNATURE_ALGORITHM = "ecdsa-p256-sha256"
  const val SIGNATURE_ENCODING = "ieee-p1363-base64url"
  const val PAIRING_TRANSCRIPT_VERSION = "telebirr-device-bridge-pairing-transcript-v1"
  const val CERTIFICATE_TRANSCRIPT_VERSION =
    "telebirr-device-bridge-certificate-transcript-v1"
  const val REQUEST_TRANSCRIPT_VERSION = "telebirr-device-bridge-request-transcript-v1"
  const val ACKNOWLEDGEMENT_TRANSCRIPT_VERSION =
    "telebirr-device-bridge-acknowledgement-transcript-v1"
  const val CONTENT_TYPE = "application/vnd.fetanagent.telebirr-device-bridge+json"
  const val PAIRING_PATH = "/v1/telebirr/device/enrollments:pair"
  const val ASSIGNMENT_POLL_PATH = "/v1/telebirr/device/assignments:poll"
  const val HEARTBEAT_PATH = "/v1/telebirr/device/heartbeat"
  const val OBSERVATION_UPLOAD_PATH = "/v1/telebirr/device/observations:upload"

  private val opaqueIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")
  private val versionPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
  private val sha256Pattern = Regex("^sha256:[a-f0-9]{64}$")
  private val signaturePattern = Regex("^[A-Za-z0-9_-]{86}$")
  private val statusCodePattern = Regex("^[a-z][a-z0-9_]{2,63}$")

  fun requireHeader(contractVersion: Int, providerCode: String, protocolMode: String) {
    require(contractVersion == CONTRACT_VERSION)
    require(providerCode == PROVIDER_CODE)
    require(protocolMode == PROTOCOL_MODE)
  }

  fun requireOpaqueId(value: String, field: String) {
    require(opaqueIdPattern.matches(value)) { "$field is not a bounded opaque identifier" }
  }

  fun requireVersion(value: String, field: String) {
    require(versionPattern.matches(value)) { "$field is not a bounded version" }
  }

  fun requireSha256(value: String, field: String) {
    require(sha256Pattern.matches(value)) { "$field is not a canonical SHA-256 digest" }
  }

  fun requireSignature(value: String) {
    require(signaturePattern.matches(value)) { "signature is not P-256 P1363 base64url" }
  }

  fun requireStatusCode(value: String) {
    require(statusCodePattern.matches(value)) { "statusCode is not redacted" }
  }

  fun requireTimestamp(value: String, field: String): Instant {
    require(Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$").matches(value)) {
      "$field is not a canonical timestamp"
    }
    val parsed = runCatching { Instant.parse(value) }.getOrElse {
      throw IllegalArgumentException("$field is not a valid timestamp", it)
    }
    return parsed
  }

  fun pathFor(command: DeviceBridgeCommand): String =
    when (command) {
      DeviceBridgeCommand.ASSIGNMENT_POLL -> ASSIGNMENT_POLL_PATH
      DeviceBridgeCommand.HEARTBEAT -> HEARTBEAT_PATH
      DeviceBridgeCommand.OBSERVATION_UPLOAD -> OBSERVATION_UPLOAD_PATH
    }
}

data class DeviceBridgeSafety(
  val evidenceOnly: Boolean = true,
  val databaseAccessAllowed: Boolean = false,
  val claimAllowed: Boolean = false,
  val settlementAllowed: Boolean = false,
  val enqueueAllowed: Boolean = false,
  val executionAllowed: Boolean = false,
  val financialActionAllowed: Boolean = false,
  val moneyMovementAllowed: Boolean = false,
  val rawReceiptUploadAllowed: Boolean = false,
  val sensitiveLoggingAllowed: Boolean = false,
) {
  init {
    require(evidenceOnly)
    require(
      !databaseAccessAllowed &&
        !claimAllowed &&
        !settlementAllowed &&
        !enqueueAllowed &&
        !executionAllowed &&
        !financialActionAllowed &&
        !moneyMovementAllowed &&
        !rawReceiptUploadAllowed &&
        !sensitiveLoggingAllowed,
    )
  }
}

enum class DeviceBridgeCommand(val wireName: String) {
  ASSIGNMENT_POLL("assignment_poll"),
  HEARTBEAT("heartbeat"),
  OBSERVATION_UPLOAD("observation_upload");

  companion object {
    fun fromWire(value: String): DeviceBridgeCommand? = entries.find { it.wireName == value }
  }
}

enum class DeviceBridgeRuntimeState(val wireName: String) {
  ENROLLMENT_REQUIRED("enrollment_required"),
  READY("ready"),
  BUSY("busy"),
  UPLOAD_PENDING("upload_pending"),
  ATTENTION("attention");

  companion object {
    fun fromWire(value: String): DeviceBridgeRuntimeState? = entries.find { it.wireName == value }
  }
}

enum class DeviceBridgeAcknowledgementOutcome(val wireName: String) {
  ASSIGNMENT("assignment"),
  NO_ASSIGNMENT("no_assignment"),
  ACKNOWLEDGED("acknowledged"),
  RETRY("retry"),
  REJECTED("rejected");

  companion object {
    fun fromWire(value: String): DeviceBridgeAcknowledgementOutcome? =
      entries.find { it.wireName == value }
  }
}

enum class DeviceBridgeReasonCode(val wireName: String) {
  ASSIGNMENT_UNAVAILABLE("assignment_unavailable"),
  BINDING_MISMATCH("binding_mismatch"),
  DEVICE_REVOKED("device_revoked"),
  OBSERVATION_REJECTED("observation_rejected"),
  PAYLOAD_INVALID("payload_invalid"),
  PILOT_STOPPED("pilot_stopped"),
  REQUEST_EXPIRED("request_expired"),
  REQUEST_REPLAYED("request_replayed"),
  TEMPORARY_UNAVAILABLE("temporary_unavailable");

  companion object {
    fun fromWire(value: String): DeviceBridgeReasonCode? = entries.find { it.wireName == value }
  }
}

data class DeviceBridgePairingBody(
  val contractVersion: Int = DeviceBridgeProtocol.CONTRACT_VERSION,
  val providerCode: String = DeviceBridgeProtocol.PROVIDER_CODE,
  val protocolMode: String = DeviceBridgeProtocol.PROTOCOL_MODE,
  val pairingId: String,
  val pairingNonceDigest: String,
  val deviceId: String,
  val keyId: String,
  val devicePublicKeySpki: String,
  val devicePublicKeySpkiSha256: String,
  val signatureAlgorithm: String = DeviceBridgeProtocol.SIGNATURE_ALGORITHM,
  val devicePlatform: String = DeviceBridgeProtocol.DEVICE_PLATFORM,
  val appVersion: String,
  val issuedAt: String,
  val expiresAt: String,
  val oneUse: Boolean = true,
  val safety: DeviceBridgeSafety = DeviceBridgeSafety(),
) {
  init {
    DeviceBridgeProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    DeviceBridgeProtocol.requireOpaqueId(pairingId, "pairingId")
    DeviceBridgeProtocol.requireSha256(pairingNonceDigest, "pairingNonceDigest")
    DeviceBridgeProtocol.requireOpaqueId(deviceId, "deviceId")
    DeviceBridgeProtocol.requireOpaqueId(keyId, "keyId")
    val spki = DeviceBridgeCrypto.parseP256SpkiBase64Url(devicePublicKeySpki)
    DeviceBridgeProtocol.requireSha256(devicePublicKeySpkiSha256, "devicePublicKeySpkiSha256")
    require(DeviceBridgeCanonical.sha256(spki) == devicePublicKeySpkiSha256)
    require(signatureAlgorithm == DeviceBridgeProtocol.SIGNATURE_ALGORITHM)
    require(devicePlatform == DeviceBridgeProtocol.DEVICE_PLATFORM)
    DeviceBridgeProtocol.requireVersion(appVersion, "appVersion")
    val start = DeviceBridgeProtocol.requireTimestamp(issuedAt, "issuedAt")
    val end = DeviceBridgeProtocol.requireTimestamp(expiresAt, "expiresAt")
    require(end > start && end.toEpochMilli() - start.toEpochMilli() <= 10 * 60 * 1_000)
    require(oneUse)
  }

  override fun toString(): String = "DeviceBridgePairingBody(<redacted>)"
}

data class SignedDeviceBridgePairingRequest(
  val contractVersion: Int = DeviceBridgeProtocol.CONTRACT_VERSION,
  val providerCode: String = DeviceBridgeProtocol.PROVIDER_CODE,
  val protocolMode: String = DeviceBridgeProtocol.PROTOCOL_MODE,
  val transcriptVersion: String = DeviceBridgeProtocol.PAIRING_TRANSCRIPT_VERSION,
  val bodyDigestAlgorithm: String = DeviceBridgeProtocol.DIGEST_ALGORITHM,
  val bodyDigest: String,
  val signatureAlgorithm: String = DeviceBridgeProtocol.SIGNATURE_ALGORITHM,
  val signatureEncoding: String = DeviceBridgeProtocol.SIGNATURE_ENCODING,
  val keyId: String,
  val body: DeviceBridgePairingBody,
  val signature: String,
) {
  init {
    DeviceBridgeProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    require(transcriptVersion == DeviceBridgeProtocol.PAIRING_TRANSCRIPT_VERSION)
    require(bodyDigestAlgorithm == DeviceBridgeProtocol.DIGEST_ALGORITHM)
    DeviceBridgeProtocol.requireSha256(bodyDigest, "bodyDigest")
    require(signatureAlgorithm == DeviceBridgeProtocol.SIGNATURE_ALGORITHM)
    require(signatureEncoding == DeviceBridgeProtocol.SIGNATURE_ENCODING)
    DeviceBridgeProtocol.requireOpaqueId(keyId, "keyId")
    require(keyId == body.keyId)
    DeviceBridgeProtocol.requireSignature(signature)
  }

  override fun toString(): String = "SignedDeviceBridgePairingRequest(<redacted>)"
}

data class DeviceBridgeEnrollmentCertificateBody(
  val contractVersion: Int = DeviceBridgeProtocol.CONTRACT_VERSION,
  val providerCode: String = DeviceBridgeProtocol.PROVIDER_CODE,
  val protocolMode: String = DeviceBridgeProtocol.PROTOCOL_MODE,
  val enrollmentId: String,
  val pairingId: String,
  val pairingRequestBodyDigest: String,
  val pairingNonceDigest: String,
  val pairingConsumed: Boolean = true,
  val deviceId: String,
  val keyId: String,
  val devicePublicKeySpki: String,
  val devicePublicKeySpkiSha256: String,
  val signatureAlgorithm: String = DeviceBridgeProtocol.SIGNATURE_ALGORITHM,
  val devicePlatform: String = DeviceBridgeProtocol.DEVICE_PLATFORM,
  val minimumAppVersion: String,
  val pilotRevisionId: String,
  val receiverRevisionId: String,
  val receiverProfileId: String,
  val receiverProfileDigest: String,
  val receiverConfigurationDigest: String,
  val assignmentSignerKeyId: String,
  val assignmentSignerPublicKeySpkiSha256: String,
  val state: String,
  val issuedAt: String,
  val validFrom: String,
  val validUntil: String,
  val safety: DeviceBridgeSafety = DeviceBridgeSafety(),
) {
  init {
    DeviceBridgeProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    listOf(
        "enrollmentId" to enrollmentId,
        "pairingId" to pairingId,
        "deviceId" to deviceId,
        "keyId" to keyId,
        "pilotRevisionId" to pilotRevisionId,
        "receiverRevisionId" to receiverRevisionId,
        "receiverProfileId" to receiverProfileId,
        "assignmentSignerKeyId" to assignmentSignerKeyId,
      )
      .forEach { (field, value) -> DeviceBridgeProtocol.requireOpaqueId(value, field) }
    listOf(
        "pairingRequestBodyDigest" to pairingRequestBodyDigest,
        "pairingNonceDigest" to pairingNonceDigest,
        "devicePublicKeySpkiSha256" to devicePublicKeySpkiSha256,
        "receiverProfileDigest" to receiverProfileDigest,
        "receiverConfigurationDigest" to receiverConfigurationDigest,
        "assignmentSignerPublicKeySpkiSha256" to assignmentSignerPublicKeySpkiSha256,
      )
      .forEach { (field, value) -> DeviceBridgeProtocol.requireSha256(value, field) }
    val spki = DeviceBridgeCrypto.parseP256SpkiBase64Url(devicePublicKeySpki)
    require(DeviceBridgeCanonical.sha256(spki) == devicePublicKeySpkiSha256)
    require(pairingConsumed)
    require(signatureAlgorithm == DeviceBridgeProtocol.SIGNATURE_ALGORITHM)
    require(devicePlatform == DeviceBridgeProtocol.DEVICE_PLATFORM)
    DeviceBridgeProtocol.requireVersion(minimumAppVersion, "minimumAppVersion")
    require(state == "active" || state == "revoked")
    val issued = DeviceBridgeProtocol.requireTimestamp(issuedAt, "issuedAt")
    val from = DeviceBridgeProtocol.requireTimestamp(validFrom, "validFrom")
    val until = DeviceBridgeProtocol.requireTimestamp(validUntil, "validUntil")
    require(issued <= from && from < until)
  }

  fun livePilotEnrollment(): LivePilotDeviceEnrollment =
    LivePilotDeviceEnrollment(
      contractVersion = 1,
      providerCode = "telebirr",
      protocolMode = "live_private_pilot_v1",
      enrollmentId = enrollmentId,
      deviceId = deviceId,
      keyId = keyId,
      publicKeySpkiSha256 = devicePublicKeySpkiSha256,
      signatureAlgorithm = signatureAlgorithm,
      state = state,
      validFrom = validFrom,
      validUntil = validUntil,
      pilotRevisionId = pilotRevisionId,
      receiverRevisionId = receiverRevisionId,
      receiverProfileId = receiverProfileId,
      receiverProfileDigest = receiverProfileDigest,
      receiverConfigurationDigest = receiverConfigurationDigest,
    )

  override fun toString(): String = "DeviceBridgeEnrollmentCertificateBody(<redacted>)"
}

data class SignedDeviceBridgeEnrollmentCertificate(
  val contractVersion: Int = DeviceBridgeProtocol.CONTRACT_VERSION,
  val providerCode: String = DeviceBridgeProtocol.PROVIDER_CODE,
  val protocolMode: String = DeviceBridgeProtocol.PROTOCOL_MODE,
  val transcriptVersion: String = DeviceBridgeProtocol.CERTIFICATE_TRANSCRIPT_VERSION,
  val bodyDigestAlgorithm: String = DeviceBridgeProtocol.DIGEST_ALGORITHM,
  val bodyDigest: String,
  val signatureAlgorithm: String = DeviceBridgeProtocol.SIGNATURE_ALGORITHM,
  val signatureEncoding: String = DeviceBridgeProtocol.SIGNATURE_ENCODING,
  val signerKeyId: String,
  val body: DeviceBridgeEnrollmentCertificateBody,
  val signature: String,
) {
  init {
    DeviceBridgeProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    require(transcriptVersion == DeviceBridgeProtocol.CERTIFICATE_TRANSCRIPT_VERSION)
    require(bodyDigestAlgorithm == DeviceBridgeProtocol.DIGEST_ALGORITHM)
    DeviceBridgeProtocol.requireSha256(bodyDigest, "bodyDigest")
    require(signatureAlgorithm == DeviceBridgeProtocol.SIGNATURE_ALGORITHM)
    require(signatureEncoding == DeviceBridgeProtocol.SIGNATURE_ENCODING)
    DeviceBridgeProtocol.requireOpaqueId(signerKeyId, "signerKeyId")
    DeviceBridgeProtocol.requireSignature(signature)
  }

  override fun toString(): String = "SignedDeviceBridgeEnrollmentCertificate(<redacted>)"
}

data class DeviceBridgeRequestBody(
  val contractVersion: Int = DeviceBridgeProtocol.CONTRACT_VERSION,
  val providerCode: String = DeviceBridgeProtocol.PROVIDER_CODE,
  val protocolMode: String = DeviceBridgeProtocol.PROTOCOL_MODE,
  val requestId: String,
  val enrollmentId: String,
  val deviceId: String,
  val keyId: String,
  val command: DeviceBridgeCommand,
  val method: String = "POST",
  val canonicalPath: String = DeviceBridgeProtocol.pathFor(command),
  val payloadDigest: String,
  val nonceDigest: String,
  val issuedAt: String,
  val expiresAt: String,
  val safety: DeviceBridgeSafety = DeviceBridgeSafety(),
) {
  init {
    DeviceBridgeProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    listOf(
        "requestId" to requestId,
        "enrollmentId" to enrollmentId,
        "deviceId" to deviceId,
        "keyId" to keyId,
      )
      .forEach { (field, value) -> DeviceBridgeProtocol.requireOpaqueId(value, field) }
    require(method == "POST")
    require(canonicalPath == DeviceBridgeProtocol.pathFor(command))
    DeviceBridgeProtocol.requireSha256(payloadDigest, "payloadDigest")
    DeviceBridgeProtocol.requireSha256(nonceDigest, "nonceDigest")
    val start = DeviceBridgeProtocol.requireTimestamp(issuedAt, "issuedAt")
    val end = DeviceBridgeProtocol.requireTimestamp(expiresAt, "expiresAt")
    require(end > start && end.toEpochMilli() - start.toEpochMilli() <= 2 * 60 * 1_000)
  }

  override fun toString(): String = "DeviceBridgeRequestBody(command=${command.wireName})"
}

data class SignedDeviceBridgeRequest(
  val contractVersion: Int = DeviceBridgeProtocol.CONTRACT_VERSION,
  val providerCode: String = DeviceBridgeProtocol.PROVIDER_CODE,
  val protocolMode: String = DeviceBridgeProtocol.PROTOCOL_MODE,
  val transcriptVersion: String = DeviceBridgeProtocol.REQUEST_TRANSCRIPT_VERSION,
  val bodyDigestAlgorithm: String = DeviceBridgeProtocol.DIGEST_ALGORITHM,
  val bodyDigest: String,
  val signatureAlgorithm: String = DeviceBridgeProtocol.SIGNATURE_ALGORITHM,
  val signatureEncoding: String = DeviceBridgeProtocol.SIGNATURE_ENCODING,
  val keyId: String,
  val body: DeviceBridgeRequestBody,
  val signature: String,
) {
  init {
    DeviceBridgeProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    require(transcriptVersion == DeviceBridgeProtocol.REQUEST_TRANSCRIPT_VERSION)
    require(bodyDigestAlgorithm == DeviceBridgeProtocol.DIGEST_ALGORITHM)
    DeviceBridgeProtocol.requireSha256(bodyDigest, "bodyDigest")
    require(signatureAlgorithm == DeviceBridgeProtocol.SIGNATURE_ALGORITHM)
    require(signatureEncoding == DeviceBridgeProtocol.SIGNATURE_ENCODING)
    DeviceBridgeProtocol.requireOpaqueId(keyId, "keyId")
    require(keyId == body.keyId)
    DeviceBridgeProtocol.requireSignature(signature)
  }

  override fun toString(): String = "SignedDeviceBridgeRequest(command=${body.command.wireName})"
}

data class DeviceBridgeAssignmentPollPayload(val requestedLeaseSeconds: Int) {
  init {
    require(requestedLeaseSeconds in 30..300)
  }
}

data class DeviceBridgeHeartbeatPayload(
  val runtimeState: DeviceBridgeRuntimeState,
  val statusCode: String,
  val appVersion: String,
) {
  init {
    DeviceBridgeProtocol.requireStatusCode(statusCode)
    DeviceBridgeProtocol.requireVersion(appVersion, "appVersion")
  }
}

data class DeviceBridgeObservationUploadPayload(
  val signedAssignment: LivePilotSignedAssignment,
  val signedObservation: LivePilotSignedObservation,
) {
  init {
    require(signedAssignment.bodyDigest == signedObservation.body.assignmentBodyDigest)
    require(signedAssignment.body.assignmentId == signedObservation.body.assignmentId)
    require(signedAssignment.body.deviceId == signedObservation.body.deviceId)
    require(signedAssignment.body.keyId == signedObservation.body.keyId)
    require(
      signedAssignment.bodyDigest ==
        LivePilotCanonicalTranscripts.assignmentBodyDigest(signedAssignment.body),
    )
    require(
      signedObservation.bodyDigest ==
        LivePilotCanonicalTranscripts.observationBodyDigest(signedObservation.body),
    )
  }

  override fun toString(): String = "DeviceBridgeObservationUploadPayload(<redacted>)"
}

data class DeviceBridgeAcknowledgementBody(
  val contractVersion: Int = DeviceBridgeProtocol.CONTRACT_VERSION,
  val providerCode: String = DeviceBridgeProtocol.PROVIDER_CODE,
  val protocolMode: String = DeviceBridgeProtocol.PROTOCOL_MODE,
  val acknowledgementId: String,
  val requestId: String,
  val enrollmentId: String,
  val deviceId: String,
  val keyId: String,
  val command: DeviceBridgeCommand,
  val requestBodyDigest: String,
  val requestPayloadDigest: String,
  val outcome: DeviceBridgeAcknowledgementOutcome,
  val assignmentBodyDigest: String?,
  val observationBodyDigest: String?,
  val reasonCode: DeviceBridgeReasonCode?,
  val issuedAt: String,
  val expiresAt: String,
  val safety: DeviceBridgeSafety = DeviceBridgeSafety(),
) {
  init {
    DeviceBridgeProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    listOf(
        "acknowledgementId" to acknowledgementId,
        "requestId" to requestId,
        "enrollmentId" to enrollmentId,
        "deviceId" to deviceId,
        "keyId" to keyId,
      )
      .forEach { (field, value) -> DeviceBridgeProtocol.requireOpaqueId(value, field) }
    DeviceBridgeProtocol.requireSha256(requestBodyDigest, "requestBodyDigest")
    DeviceBridgeProtocol.requireSha256(requestPayloadDigest, "requestPayloadDigest")
    assignmentBodyDigest?.let {
      DeviceBridgeProtocol.requireSha256(it, "assignmentBodyDigest")
    }
    observationBodyDigest?.let {
      DeviceBridgeProtocol.requireSha256(it, "observationBodyDigest")
    }
    require(validSemantics())
    val start = DeviceBridgeProtocol.requireTimestamp(issuedAt, "issuedAt")
    val end = DeviceBridgeProtocol.requireTimestamp(expiresAt, "expiresAt")
    require(end > start && end.toEpochMilli() - start.toEpochMilli() <= 2 * 60 * 1_000)
  }

  private fun validSemantics(): Boolean =
    when (outcome) {
      DeviceBridgeAcknowledgementOutcome.ASSIGNMENT ->
        command == DeviceBridgeCommand.ASSIGNMENT_POLL &&
          assignmentBodyDigest != null &&
          observationBodyDigest == null &&
          reasonCode == null
      DeviceBridgeAcknowledgementOutcome.NO_ASSIGNMENT ->
        command == DeviceBridgeCommand.ASSIGNMENT_POLL &&
          assignmentBodyDigest == null &&
          observationBodyDigest == null &&
          reasonCode == null
      DeviceBridgeAcknowledgementOutcome.ACKNOWLEDGED ->
        if (command == DeviceBridgeCommand.HEARTBEAT) {
          assignmentBodyDigest == null && observationBodyDigest == null && reasonCode == null
        } else {
          command == DeviceBridgeCommand.OBSERVATION_UPLOAD &&
            assignmentBodyDigest != null &&
            observationBodyDigest != null &&
            reasonCode == null
        }
      DeviceBridgeAcknowledgementOutcome.RETRY ->
        assignmentBodyDigest == null &&
          observationBodyDigest == null &&
          reasonCode == DeviceBridgeReasonCode.TEMPORARY_UNAVAILABLE
      DeviceBridgeAcknowledgementOutcome.REJECTED ->
        assignmentBodyDigest == null &&
          observationBodyDigest == null &&
          reasonCode != null &&
          reasonCode != DeviceBridgeReasonCode.TEMPORARY_UNAVAILABLE
    }

  override fun toString(): String =
    "DeviceBridgeAcknowledgementBody(command=${command.wireName},outcome=${outcome.wireName})"
}

data class SignedDeviceBridgeAcknowledgement(
  val contractVersion: Int = DeviceBridgeProtocol.CONTRACT_VERSION,
  val providerCode: String = DeviceBridgeProtocol.PROVIDER_CODE,
  val protocolMode: String = DeviceBridgeProtocol.PROTOCOL_MODE,
  val transcriptVersion: String = DeviceBridgeProtocol.ACKNOWLEDGEMENT_TRANSCRIPT_VERSION,
  val bodyDigestAlgorithm: String = DeviceBridgeProtocol.DIGEST_ALGORITHM,
  val bodyDigest: String,
  val signatureAlgorithm: String = DeviceBridgeProtocol.SIGNATURE_ALGORITHM,
  val signatureEncoding: String = DeviceBridgeProtocol.SIGNATURE_ENCODING,
  val signerKeyId: String,
  val body: DeviceBridgeAcknowledgementBody,
  val signature: String,
) {
  init {
    DeviceBridgeProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    require(transcriptVersion == DeviceBridgeProtocol.ACKNOWLEDGEMENT_TRANSCRIPT_VERSION)
    require(bodyDigestAlgorithm == DeviceBridgeProtocol.DIGEST_ALGORITHM)
    DeviceBridgeProtocol.requireSha256(bodyDigest, "bodyDigest")
    require(signatureAlgorithm == DeviceBridgeProtocol.SIGNATURE_ALGORITHM)
    require(signatureEncoding == DeviceBridgeProtocol.SIGNATURE_ENCODING)
    DeviceBridgeProtocol.requireOpaqueId(signerKeyId, "signerKeyId")
    DeviceBridgeProtocol.requireSignature(signature)
  }

  override fun toString(): String = "SignedDeviceBridgeAcknowledgement(<redacted>)"
}

object DeviceBridgeCanonical {
  private sealed interface Scalar {
    data class Text(val value: String) : Scalar
    data class Number(val value: Long) : Scalar
    data class BooleanValue(val value: Boolean) : Scalar
    data object NullValue : Scalar
  }

  private data class Field(val name: String, val value: Scalar)

  fun pairingBodyBytes(body: DeviceBridgePairingBody): ByteArray =
    encode(
      "fetanagent:telebirr:device-bridge:pairing-body:v1",
      listOf(
        field("contractVersion", body.contractVersion.toLong()),
        field("providerCode", body.providerCode),
        field("protocolMode", body.protocolMode),
        field("pairingId", body.pairingId),
        field("pairingNonceDigest", body.pairingNonceDigest),
        field("deviceId", body.deviceId),
        field("keyId", body.keyId),
        field("devicePublicKeySpki", body.devicePublicKeySpki),
        field("devicePublicKeySpkiSha256", body.devicePublicKeySpkiSha256),
        field("signatureAlgorithm", body.signatureAlgorithm),
        field("devicePlatform", body.devicePlatform),
        field("appVersion", body.appVersion),
        field("issuedAt", body.issuedAt),
        field("expiresAt", body.expiresAt),
        field("oneUse", body.oneUse),
      ) + safetyFields(body.safety),
    )

  fun pairingBodyDigest(body: DeviceBridgePairingBody): String = sha256(pairingBodyBytes(body))

  fun pairingSignatureBytes(body: DeviceBridgePairingBody): ByteArray =
    signatureBytes(
      "fetanagent:telebirr:device-bridge:pairing-signature:v1",
      DeviceBridgeProtocol.PAIRING_TRANSCRIPT_VERSION,
      pairingBodyDigest(body),
      "keyId",
      body.keyId,
    )

  fun enrollmentCertificateBodyBytes(body: DeviceBridgeEnrollmentCertificateBody): ByteArray =
    encode(
      "fetanagent:telebirr:device-bridge:enrollment-certificate-body:v1",
      listOf(
        field("contractVersion", body.contractVersion.toLong()),
        field("providerCode", body.providerCode),
        field("protocolMode", body.protocolMode),
        field("enrollmentId", body.enrollmentId),
        field("pairingId", body.pairingId),
        field("pairingRequestBodyDigest", body.pairingRequestBodyDigest),
        field("pairingNonceDigest", body.pairingNonceDigest),
        field("pairingConsumed", body.pairingConsumed),
        field("deviceId", body.deviceId),
        field("keyId", body.keyId),
        field("devicePublicKeySpki", body.devicePublicKeySpki),
        field("devicePublicKeySpkiSha256", body.devicePublicKeySpkiSha256),
        field("signatureAlgorithm", body.signatureAlgorithm),
        field("devicePlatform", body.devicePlatform),
        field("minimumAppVersion", body.minimumAppVersion),
        field("pilotRevisionId", body.pilotRevisionId),
        field("receiverRevisionId", body.receiverRevisionId),
        field("receiverProfileId", body.receiverProfileId),
        field("receiverProfileDigest", body.receiverProfileDigest),
        field("receiverConfigurationDigest", body.receiverConfigurationDigest),
        field("assignmentSignerKeyId", body.assignmentSignerKeyId),
        field("assignmentSignerPublicKeySpkiSha256", body.assignmentSignerPublicKeySpkiSha256),
        field("state", body.state),
        field("issuedAt", body.issuedAt),
        field("validFrom", body.validFrom),
        field("validUntil", body.validUntil),
      ) + safetyFields(body.safety),
    )

  fun enrollmentCertificateBodyDigest(body: DeviceBridgeEnrollmentCertificateBody): String =
    sha256(enrollmentCertificateBodyBytes(body))

  fun enrollmentCertificateSignatureBytes(
    body: DeviceBridgeEnrollmentCertificateBody,
    signerKeyId: String,
  ): ByteArray =
    signatureBytes(
      "fetanagent:telebirr:device-bridge:enrollment-certificate-signature:v1",
      DeviceBridgeProtocol.CERTIFICATE_TRANSCRIPT_VERSION,
      enrollmentCertificateBodyDigest(body),
      "signerKeyId",
      signerKeyId,
    )

  fun requestBodyBytes(body: DeviceBridgeRequestBody): ByteArray =
    encode(
      "fetanagent:telebirr:device-bridge:request-body:v1",
      listOf(
        field("contractVersion", body.contractVersion.toLong()),
        field("providerCode", body.providerCode),
        field("protocolMode", body.protocolMode),
        field("requestId", body.requestId),
        field("enrollmentId", body.enrollmentId),
        field("deviceId", body.deviceId),
        field("keyId", body.keyId),
        field("command", body.command.wireName),
        field("method", body.method),
        field("canonicalPath", body.canonicalPath),
        field("payloadDigest", body.payloadDigest),
        field("nonceDigest", body.nonceDigest),
        field("issuedAt", body.issuedAt),
        field("expiresAt", body.expiresAt),
      ) + safetyFields(body.safety),
    )

  fun requestBodyDigest(body: DeviceBridgeRequestBody): String = sha256(requestBodyBytes(body))

  fun requestSignatureBytes(body: DeviceBridgeRequestBody): ByteArray =
    signatureBytes(
      "fetanagent:telebirr:device-bridge:request-signature:v1",
      DeviceBridgeProtocol.REQUEST_TRANSCRIPT_VERSION,
      requestBodyDigest(body),
      "keyId",
      body.keyId,
    )

  fun assignmentPollPayloadDigest(payload: DeviceBridgeAssignmentPollPayload): String =
    sha256(
      encode(
        "fetanagent:telebirr:device-bridge:assignment-poll-payload:v1",
        listOf(field("requestedLeaseSeconds", payload.requestedLeaseSeconds.toLong())),
      ),
    )

  fun heartbeatPayloadDigest(payload: DeviceBridgeHeartbeatPayload): String =
    sha256(
      encode(
        "fetanagent:telebirr:device-bridge:heartbeat-payload:v1",
        listOf(
          field("runtimeState", payload.runtimeState.wireName),
          field("statusCode", payload.statusCode),
          field("appVersion", payload.appVersion),
        ),
      ),
    )

  fun observationUploadPayloadDigest(payload: DeviceBridgeObservationUploadPayload): String =
    sha256(
      encode(
        "fetanagent:telebirr:device-bridge:observation-upload-payload:v1",
        listOf(
          field("assignmentBodyDigest", payload.signedAssignment.bodyDigest),
          field("assignmentSignatureDigest", signatureDigest(payload.signedAssignment.signature)),
          field("observationBodyDigest", payload.signedObservation.bodyDigest),
          field("observationSignatureDigest", signatureDigest(payload.signedObservation.signature)),
        ),
      ),
    )

  fun acknowledgementBodyBytes(body: DeviceBridgeAcknowledgementBody): ByteArray =
    encode(
      "fetanagent:telebirr:device-bridge:acknowledgement-body:v1",
      listOf(
        field("contractVersion", body.contractVersion.toLong()),
        field("providerCode", body.providerCode),
        field("protocolMode", body.protocolMode),
        field("acknowledgementId", body.acknowledgementId),
        field("requestId", body.requestId),
        field("enrollmentId", body.enrollmentId),
        field("deviceId", body.deviceId),
        field("keyId", body.keyId),
        field("command", body.command.wireName),
        field("requestBodyDigest", body.requestBodyDigest),
        field("requestPayloadDigest", body.requestPayloadDigest),
        field("outcome", body.outcome.wireName),
        field("assignmentBodyDigest", body.assignmentBodyDigest),
        field("observationBodyDigest", body.observationBodyDigest),
        field("reasonCode", body.reasonCode?.wireName),
        field("issuedAt", body.issuedAt),
        field("expiresAt", body.expiresAt),
      ) + safetyFields(body.safety),
    )

  fun acknowledgementBodyDigest(body: DeviceBridgeAcknowledgementBody): String =
    sha256(acknowledgementBodyBytes(body))

  fun acknowledgementSignatureBytes(
    body: DeviceBridgeAcknowledgementBody,
    signerKeyId: String,
  ): ByteArray =
    signatureBytes(
      "fetanagent:telebirr:device-bridge:acknowledgement-signature:v1",
      DeviceBridgeProtocol.ACKNOWLEDGEMENT_TRANSCRIPT_VERSION,
      acknowledgementBodyDigest(body),
      "signerKeyId",
      signerKeyId,
    )

  fun sha256(bytes: ByteArray): String =
    "sha256:" + MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

  private fun signatureDigest(encoded: String): String {
    DeviceBridgeProtocol.requireSignature(encoded)
    return sha256(Base64.getUrlDecoder().decode(encoded))
  }

  private fun signatureBytes(
    domain: String,
    transcriptVersion: String,
    bodyDigest: String,
    keyField: String,
    keyId: String,
  ): ByteArray =
    encode(
      domain,
      listOf(
        field("contractVersion", DeviceBridgeProtocol.CONTRACT_VERSION.toLong()),
        field("providerCode", DeviceBridgeProtocol.PROVIDER_CODE),
        field("protocolMode", DeviceBridgeProtocol.PROTOCOL_MODE),
        field("transcriptVersion", transcriptVersion),
        field("bodyDigestAlgorithm", DeviceBridgeProtocol.DIGEST_ALGORITHM),
        field("bodyDigest", bodyDigest),
        field("signatureAlgorithm", DeviceBridgeProtocol.SIGNATURE_ALGORITHM),
        field("signatureEncoding", DeviceBridgeProtocol.SIGNATURE_ENCODING),
        field(keyField, keyId),
      ),
    )

  private fun safetyFields(safety: DeviceBridgeSafety): List<Field> =
    listOf(
      field("evidenceOnly", safety.evidenceOnly),
      field("databaseAccessAllowed", safety.databaseAccessAllowed),
      field("claimAllowed", safety.claimAllowed),
      field("settlementAllowed", safety.settlementAllowed),
      field("enqueueAllowed", safety.enqueueAllowed),
      field("executionAllowed", safety.executionAllowed),
      field("financialActionAllowed", safety.financialActionAllowed),
      field("moneyMovementAllowed", safety.moneyMovementAllowed),
      field("rawReceiptUploadAllowed", safety.rawReceiptUploadAllowed),
      field("sensitiveLoggingAllowed", safety.sensitiveLoggingAllowed),
    )

  private fun encode(domain: String, fields: List<Field>): ByteArray {
    val values = mutableListOf(domain, fields.size.toString())
    for (field in fields) {
      values += field.name
      values += scalarText(field.value)
    }
    return ByteArrayOutputStream().use { bytes ->
      DataOutputStream(bytes).use { output ->
        for (value in values) {
          val encoded = value.toByteArray(StandardCharsets.UTF_8)
          output.writeInt(encoded.size)
          output.write(encoded)
        }
      }
      bytes.toByteArray()
    }
  }

  private fun scalarText(value: Scalar): String =
    when (value) {
      is Scalar.Text -> "string:${value.value}"
      is Scalar.Number -> "number:${value.value}"
      is Scalar.BooleanValue -> "boolean:${if (value.value) "true" else "false"}"
      Scalar.NullValue -> "null:"
    }

  private fun field(name: String, value: String?): Field =
    Field(name, value?.let(Scalar::Text) ?: Scalar.NullValue)

  private fun field(name: String, value: Long): Field = Field(name, Scalar.Number(value))

  private fun field(name: String, value: Boolean): Field = Field(name, Scalar.BooleanValue(value))

  private fun ByteArray.toHex(): String = joinToString(separator = "") { "%02x".format(it) }
}

object DeviceBridgeSignedFactory {
  fun pairing(body: DeviceBridgePairingBody, identity: P256Identity): SignedDeviceBridgePairingRequest {
    val material = identity.publicMaterial()
    require(identity.keyId == body.keyId && material.keyId == body.keyId)
    require(material.publicKeySpkiBase64Url == body.devicePublicKeySpki)
    require(material.publicKeySpkiSha256 == body.devicePublicKeySpkiSha256)
    val digest = DeviceBridgeCanonical.pairingBodyDigest(body)
    val signature = identity.signP1363(DeviceBridgeCanonical.pairingSignatureBytes(body))
    require(signature.size == 64)
    return SignedDeviceBridgePairingRequest(
      bodyDigest = digest,
      keyId = body.keyId,
      body = body,
      signature = Base64.getUrlEncoder().withoutPadding().encodeToString(signature),
    )
  }

  fun request(body: DeviceBridgeRequestBody, identity: P256Identity): SignedDeviceBridgeRequest {
    require(identity.keyId == body.keyId)
    val digest = DeviceBridgeCanonical.requestBodyDigest(body)
    val signature = identity.signP1363(DeviceBridgeCanonical.requestSignatureBytes(body))
    require(signature.size == 64)
    return SignedDeviceBridgeRequest(
      bodyDigest = digest,
      keyId = body.keyId,
      body = body,
      signature = Base64.getUrlEncoder().withoutPadding().encodeToString(signature),
    )
  }
}

object DeviceBridgeVerifier {
  fun verifyCertificate(
    certificate: SignedDeviceBridgeEnrollmentCertificate,
    trustedServerSpkiDer: ByteArray,
  ): Boolean =
    certificate.bodyDigest ==
      DeviceBridgeCanonical.enrollmentCertificateBodyDigest(certificate.body) &&
      DeviceBridgeCrypto.verifyP1363(
        trustedServerSpkiDer,
        DeviceBridgeCanonical.enrollmentCertificateSignatureBytes(
          certificate.body,
          certificate.signerKeyId,
        ),
        certificate.signature,
      )

  fun certificateMatchesPairing(
    certificate: SignedDeviceBridgeEnrollmentCertificate,
    pairing: SignedDeviceBridgePairingRequest,
  ): Boolean {
    val body = certificate.body
    return verifyPairing(pairing) &&
      body.pairingId == pairing.body.pairingId &&
      body.pairingRequestBodyDigest == pairing.bodyDigest &&
      body.pairingNonceDigest == pairing.body.pairingNonceDigest &&
      body.deviceId == pairing.body.deviceId &&
      body.keyId == pairing.body.keyId &&
      body.devicePublicKeySpki == pairing.body.devicePublicKeySpki &&
      body.devicePublicKeySpkiSha256 == pairing.body.devicePublicKeySpkiSha256 &&
      body.issuedAt >= pairing.body.issuedAt &&
      body.issuedAt < pairing.body.expiresAt
  }

  fun verifyPairing(pairing: SignedDeviceBridgePairingRequest): Boolean =
    pairing.bodyDigest == DeviceBridgeCanonical.pairingBodyDigest(pairing.body) &&
      DeviceBridgeCrypto.verifyP1363(
        DeviceBridgeCrypto.parseP256SpkiBase64Url(pairing.body.devicePublicKeySpki),
        DeviceBridgeCanonical.pairingSignatureBytes(pairing.body),
        pairing.signature,
      )

  fun verifyAcknowledgement(
    acknowledgement: SignedDeviceBridgeAcknowledgement,
    request: SignedDeviceBridgeRequest,
    trustedServerSpkiDer: ByteArray,
    assessedAt: String,
  ): Boolean {
    val assessed = runCatching {
      DeviceBridgeProtocol.requireTimestamp(assessedAt, "assessedAt")
    }.getOrNull() ?: return false
    val body = acknowledgement.body
    return body.requestId == request.body.requestId &&
      body.enrollmentId == request.body.enrollmentId &&
      body.deviceId == request.body.deviceId &&
      body.keyId == request.body.keyId &&
      body.command == request.body.command &&
      body.requestBodyDigest == request.bodyDigest &&
      body.requestPayloadDigest == request.body.payloadDigest &&
      assessed >= Instant.parse(body.issuedAt) &&
      assessed < Instant.parse(body.expiresAt) &&
      acknowledgement.bodyDigest == DeviceBridgeCanonical.acknowledgementBodyDigest(body) &&
      DeviceBridgeCrypto.verifyP1363(
        trustedServerSpkiDer,
        DeviceBridgeCanonical.acknowledgementSignatureBytes(body, acknowledgement.signerKeyId),
        acknowledgement.signature,
      )
  }
}

internal object DeviceBridgeCrypto {
  fun parseP256SpkiBase64Url(encoded: String): ByteArray {
    require(Regex("^[A-Za-z0-9_-]+$").matches(encoded))
    val bytes = runCatching { Base64.getUrlDecoder().decode(encoded) }.getOrElse {
      throw IllegalArgumentException("Invalid public key", it)
    }
    require(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == encoded)
    parseP256Spki(bytes)
    return bytes
  }

  fun verifyP1363(spkiDer: ByteArray, message: ByteArray, encodedSignature: String): Boolean =
    runCatching {
        DeviceBridgeProtocol.requireSignature(encodedSignature)
        val key = parseP256Spki(spkiDer)
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initVerify(key)
        signature.update(message)
        signature.verify(EcdsaP1363.p1363ToDer(Base64.getUrlDecoder().decode(encodedSignature)))
      }
      .getOrDefault(false)

  private fun parseP256Spki(spkiDer: ByteArray): ECPublicKey {
    require(spkiDer.size in 1..512)
    val key =
      KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spkiDer)) as? ECPublicKey
        ?: throw IllegalArgumentException("Public key is not EC")
    require(key.params.curve.field.fieldSize == 256)
    require(key.encoded.contentEquals(spkiDer))
    return key
  }
}

data class DeviceBridgeRawResponse(
  val statusCode: Int,
  val contentType: String,
  val body: ByteArray,
) {
  init {
    require(statusCode in 100..599)
    require(body.size <= 256 * 1_024)
  }

  override fun toString(): String =
    "DeviceBridgeRawResponse(statusCode=$statusCode,contentType=$contentType,body=<redacted>)"
}

fun interface DeviceBridgeExchange {
  /** Implementations must use an immutable HTTPS origin and must not follow redirects. */
  fun post(path: String, contentType: String, body: ByteArray): DeviceBridgeRawResponse
}
