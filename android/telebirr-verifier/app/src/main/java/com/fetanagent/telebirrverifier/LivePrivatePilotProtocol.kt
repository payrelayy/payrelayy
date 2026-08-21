package com.fetanagent.telebirrverifier

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.X509EncodedKeySpec
import java.text.Normalizer
import java.time.Instant
import java.util.Base64

/**
 * Production-shaped, evidence-only private-pilot contract. It is deliberately not wired into the
 * Android lifecycle, transport, enrollment, or any server endpoint.
 */
object LivePrivatePilotProtocol {
  const val CONTRACT_VERSION = 1
  const val PROVIDER_CODE = "telebirr"
  const val PROTOCOL_MODE = "live_private_pilot_v1"
  const val ASSIGNMENT_TRANSCRIPT_VERSION =
    "telebirr-live-private-pilot-assignment-transcript-v1"
  const val OBSERVATION_TRANSCRIPT_VERSION =
    "telebirr-live-private-pilot-observation-transcript-v1"
  const val DIGEST_ALGORITHM = "sha256"
  const val SIGNATURE_ALGORITHM = "ecdsa-p256-sha256"
  const val SIGNATURE_ENCODING = "ieee-p1363-base64url"
  const val REFERENCE_BINDING_PROFILE = "telebirr-provider-reference-binding-v1"
  const val RECEIVER_NAME_NORMALIZER_VERSION = "telebirr-credited-party-name-normalizer-v1"
  const val ADAPTER_VERSION = "telebirr-live-private-pilot-adapter-v1"
  const val PARSER_VERSION = "telebirr-official-receipt-live-pilot-parser-v1"
  const val FACTS_NORMALIZER_VERSION = "telebirr-live-private-pilot-facts-normalizer-v1"
  const val SOURCE_PROFILE = "telebirr_official_receipt_v1"

  val CAPABILITIES = LivePilotDisabledCapabilities()

  private val opaqueIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")
  private val sha256Pattern = Regex("^sha256:[a-f0-9]{64}$")
  private val referenceFingerprintPattern = Regex("^hmac-sha256:[a-f0-9]{64}$")
  private val rawReferencePattern = Regex("^[A-Z0-9]{8,64}$")
  private val timestampPattern = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")
  private val signaturePattern = Regex("^[A-Za-z0-9_-]{86}$")

  fun requireHeader(contractVersion: Int, providerCode: String, protocolMode: String) {
    require(contractVersion == CONTRACT_VERSION)
    require(providerCode == PROVIDER_CODE)
    require(protocolMode == PROTOCOL_MODE)
  }

  fun requireOpaqueId(value: String, field: String) {
    require(opaqueIdPattern.matches(value)) { "$field is not a bounded opaque identifier" }
  }

  fun requireSha256(value: String, field: String) {
    require(sha256Pattern.matches(value)) { "$field is not a canonical SHA-256 digest" }
  }

  fun requireReferenceFingerprint(value: String) {
    require(referenceFingerprintPattern.matches(value))
  }

  fun requireRawReference(value: String) {
    require(rawReferencePattern.matches(value))
  }

  fun requireTimestamp(value: String, field: String) {
    require(timestampPattern.matches(value)) { "$field is not a canonical timestamp" }
    runCatching { Instant.parse(value) }.getOrElse {
      throw IllegalArgumentException("$field is not a valid timestamp", it)
    }
  }

  fun requireSignature(value: String) {
    require(signaturePattern.matches(value))
  }
}

/** Every authority flag remains false, including transport and provider interaction. */
data class LivePilotDisabledCapabilities(
  val transportAllowed: Boolean = false,
  val networkAllowed: Boolean = false,
  val providerInteractionAllowed: Boolean = false,
  val databaseReadAllowed: Boolean = false,
  val databaseWriteAllowed: Boolean = false,
  val persistenceAllowed: Boolean = false,
  val claimAllowed: Boolean = false,
  val settlementAllowed: Boolean = false,
  val enqueueAllowed: Boolean = false,
  val executionAllowed: Boolean = false,
  val financialActionAllowed: Boolean = false,
)

data class LivePilotTrustedAssignmentSigner(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val signerKeyId: String,
  val publicKeySpkiSha256: String,
  val signatureAlgorithm: String,
  val state: String,
  val validFrom: String,
  val validUntil: String,
) {
  init {
    LivePrivatePilotProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    LivePrivatePilotProtocol.requireOpaqueId(signerKeyId, "signerKeyId")
    LivePrivatePilotProtocol.requireSha256(publicKeySpkiSha256, "publicKeySpkiSha256")
    require(signatureAlgorithm == LivePrivatePilotProtocol.SIGNATURE_ALGORITHM)
    require(state == "active" || state == "revoked")
    LivePrivatePilotProtocol.requireTimestamp(validFrom, "validFrom")
    LivePrivatePilotProtocol.requireTimestamp(validUntil, "validUntil")
    require(validFrom < validUntil)
  }
}

data class LivePilotDeviceEnrollment(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val enrollmentId: String,
  val deviceId: String,
  val keyId: String,
  val publicKeySpkiSha256: String,
  val signatureAlgorithm: String,
  val state: String,
  val validFrom: String,
  val validUntil: String,
  val pilotRevisionId: String,
  val receiverRevisionId: String,
  val receiverProfileId: String,
  val receiverProfileDigest: String,
  val receiverConfigurationDigest: String,
) {
  init {
    LivePrivatePilotProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    LivePrivatePilotProtocol.requireOpaqueId(enrollmentId, "enrollmentId")
    LivePrivatePilotProtocol.requireOpaqueId(deviceId, "deviceId")
    LivePrivatePilotProtocol.requireOpaqueId(keyId, "keyId")
    LivePrivatePilotProtocol.requireSha256(publicKeySpkiSha256, "publicKeySpkiSha256")
    require(signatureAlgorithm == LivePrivatePilotProtocol.SIGNATURE_ALGORITHM)
    require(state == "active" || state == "revoked")
    LivePrivatePilotProtocol.requireTimestamp(validFrom, "validFrom")
    LivePrivatePilotProtocol.requireTimestamp(validUntil, "validUntil")
    require(validFrom < validUntil)
    LivePrivatePilotProtocol.requireOpaqueId(pilotRevisionId, "pilotRevisionId")
    LivePrivatePilotProtocol.requireOpaqueId(receiverRevisionId, "receiverRevisionId")
    LivePrivatePilotProtocol.requireOpaqueId(receiverProfileId, "receiverProfileId")
    LivePrivatePilotProtocol.requireSha256(receiverProfileDigest, "receiverProfileDigest")
    LivePrivatePilotProtocol.requireSha256(receiverConfigurationDigest, "receiverConfigurationDigest")
  }
}

data class LivePilotAssignmentBody(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val assignmentId: String,
  val requestId: String,
  val jobId: String,
  val attemptNumber: Int,
  val pilotRevisionId: String,
  val deviceId: String,
  val keyId: String,
  val leaseNonceDigest: String,
  val challengeId: String,
  val challengeDigest: String,
  /** Sensitive and intentionally absent from status projections and observations. */
  val rawReference: String,
  val referenceFingerprint: String,
  val referenceBindingProfile: String,
  val referenceBindingDigest: String,
  val sourceProfile: String,
  val receiverRevisionId: String,
  val receiverProfileId: String,
  val receiverProfileDigest: String,
  val receiverConfigurationDigest: String,
  val receiverNameNormalizerVersion: String,
  /** Sensitive and intentionally absent from status projections and observations. */
  val expectedReceiverNameNormalized: String,
  val expectedReceiverNameDigest: String,
  val adapterVersion: String,
  val parserVersion: String,
  val factsNormalizerVersion: String,
  val issuedAt: String,
  val expiresAt: String,
) {
  init {
    LivePrivatePilotProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    listOf(
        "assignmentId" to assignmentId,
        "requestId" to requestId,
        "jobId" to jobId,
        "pilotRevisionId" to pilotRevisionId,
        "deviceId" to deviceId,
        "keyId" to keyId,
        "challengeId" to challengeId,
        "receiverRevisionId" to receiverRevisionId,
        "receiverProfileId" to receiverProfileId,
      )
      .forEach { (field, value) -> LivePrivatePilotProtocol.requireOpaqueId(value, field) }
    require(attemptNumber in 1..1_000_000)
    listOf(
        "leaseNonceDigest" to leaseNonceDigest,
        "challengeDigest" to challengeDigest,
        "referenceBindingDigest" to referenceBindingDigest,
        "receiverProfileDigest" to receiverProfileDigest,
        "receiverConfigurationDigest" to receiverConfigurationDigest,
        "expectedReceiverNameDigest" to expectedReceiverNameDigest,
      )
      .forEach { (field, value) -> LivePrivatePilotProtocol.requireSha256(value, field) }
    LivePrivatePilotProtocol.requireRawReference(rawReference)
    LivePrivatePilotProtocol.requireReferenceFingerprint(referenceFingerprint)
    require(referenceBindingProfile == LivePrivatePilotProtocol.REFERENCE_BINDING_PROFILE)
    require(sourceProfile == LivePrivatePilotProtocol.SOURCE_PROFILE)
    require(receiverNameNormalizerVersion == LivePrivatePilotProtocol.RECEIVER_NAME_NORMALIZER_VERSION)
    require(
      LivePilotNameNormalizer.normalize(expectedReceiverNameNormalized) ==
        expectedReceiverNameNormalized,
    )
    require(
      LivePilotCanonicalTranscripts.receiverNameDigest(expectedReceiverNameNormalized) ==
        expectedReceiverNameDigest,
    )
    require(
      LivePilotCanonicalTranscripts.referenceBindingDigest(rawReference, referenceFingerprint) ==
        referenceBindingDigest,
    )
    require(adapterVersion == LivePrivatePilotProtocol.ADAPTER_VERSION)
    require(parserVersion == LivePrivatePilotProtocol.PARSER_VERSION)
    require(factsNormalizerVersion == LivePrivatePilotProtocol.FACTS_NORMALIZER_VERSION)
    LivePrivatePilotProtocol.requireTimestamp(issuedAt, "issuedAt")
    LivePrivatePilotProtocol.requireTimestamp(expiresAt, "expiresAt")
    require(issuedAt < expiresAt)
  }

  override fun toString(): String =
    "LivePilotAssignmentBody(assignmentId=<redacted>,rawReference=<redacted>,expectedReceiverNameNormalized=<redacted>)"
}

data class LivePilotSignedAssignment(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val transcriptVersion: String,
  val bodyDigestAlgorithm: String,
  val bodyDigest: String,
  val signatureAlgorithm: String,
  val signatureEncoding: String,
  val signerKeyId: String,
  val body: LivePilotAssignmentBody,
  val signature: String,
) {
  init {
    LivePrivatePilotProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    require(transcriptVersion == LivePrivatePilotProtocol.ASSIGNMENT_TRANSCRIPT_VERSION)
    require(bodyDigestAlgorithm == LivePrivatePilotProtocol.DIGEST_ALGORITHM)
    LivePrivatePilotProtocol.requireSha256(bodyDigest, "bodyDigest")
    require(signatureAlgorithm == LivePrivatePilotProtocol.SIGNATURE_ALGORITHM)
    require(signatureEncoding == LivePrivatePilotProtocol.SIGNATURE_ENCODING)
    LivePrivatePilotProtocol.requireOpaqueId(signerKeyId, "signerKeyId")
    LivePrivatePilotProtocol.requireSignature(signature)
  }
}

sealed interface LivePilotReceiptFacts {
  val lookupOutcome: String
}

data class LivePilotReviewRequiredFacts(
  override val lookupOutcome: String = "review_required",
  val reviewReason: String,
  val retrievedAt: String?,
) : LivePilotReceiptFacts {
  init {
    require(lookupOutcome == "review_required")
    require(
      reviewReason in
        setOf(
          "provider_not_found_unattested",
          "provider_unavailable",
          "network_unavailable",
          "unknown_layout",
          "invalid_layout",
          "parser_uncertain",
          "device_error",
        ),
    )
    retrievedAt?.let { LivePrivatePilotProtocol.requireTimestamp(it, "retrievedAt") }
  }
}

data class LivePilotFoundFacts(
  override val lookupOutcome: String = "found",
  val evidenceSource: String,
  val layoutAttestation: String,
  val providerFinalStatus: String,
  val canonicalReferencePresent: Boolean,
  val referenceMatch: String,
  val amountMinor: Long?,
  val currencyCode: String,
  val receiverMatch: String,
  val creditedPartyNameDigest: String?,
  val paymentMode: String,
  val paymentReason: String,
  val paymentChannel: String,
  val occurredAt: String?,
  val retrievedAt: String,
) : LivePilotReceiptFacts {
  init {
    require(lookupOutcome == "found")
    require(evidenceSource == "provider_receipt_lookup")
    require(layoutAttestation == "recognized_layout_v1")
    require(providerFinalStatus in setOf("completed", "pending", "failed", "reversed", "unknown"))
    require(referenceMatch in setOf("matched", "mismatched", "unknown"))
    require(if (canonicalReferencePresent) referenceMatch != "unknown" else referenceMatch == "unknown")
    require(amountMinor == null || amountMinor in 1..9_007_199_254_740_991L)
    require(currencyCode == if (amountMinor == null) "unknown" else "ETB")
    require(receiverMatch in setOf("matched", "mismatched", "unknown"))
    if (receiverMatch == "unknown") {
      require(creditedPartyNameDigest == null)
    } else {
      LivePrivatePilotProtocol.requireSha256(requireNotNull(creditedPartyNameDigest), "creditedPartyNameDigest")
    }
    require(paymentMode in setOf("telebirr", "other", "unknown"))
    require(paymentReason in setOf("send_money_to_registered_customer", "other", "unknown"))
    require(paymentChannel in setOf("api_app", "other", "unknown"))
    occurredAt?.let { LivePrivatePilotProtocol.requireTimestamp(it, "occurredAt") }
    LivePrivatePilotProtocol.requireTimestamp(retrievedAt, "retrievedAt")
    require(occurredAt == null || occurredAt <= retrievedAt)
  }
}

data class LivePilotObservationBody(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val assignmentId: String,
  val requestId: String,
  val jobId: String,
  val attemptNumber: Int,
  val pilotRevisionId: String,
  val deviceId: String,
  val keyId: String,
  val leaseNonceDigest: String,
  val challengeId: String,
  val challengeDigest: String,
  val assignmentBodyDigest: String,
  val referenceFingerprint: String,
  val referenceBindingDigest: String,
  val sourceProfile: String,
  val receiverRevisionId: String,
  val receiverProfileId: String,
  val receiverProfileDigest: String,
  val receiverConfigurationDigest: String,
  val receiverNameNormalizerVersion: String,
  val expectedReceiverNameDigest: String,
  val adapterVersion: String,
  val parserVersion: String,
  val factsNormalizerVersion: String,
  val sourceDocumentDigest: String,
  val normalizedFactsDigest: String,
  val observedAt: String,
  val facts: LivePilotReceiptFacts,
) {
  init {
    LivePrivatePilotProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    listOf(
        "assignmentId" to assignmentId,
        "requestId" to requestId,
        "jobId" to jobId,
        "pilotRevisionId" to pilotRevisionId,
        "deviceId" to deviceId,
        "keyId" to keyId,
        "challengeId" to challengeId,
        "receiverRevisionId" to receiverRevisionId,
        "receiverProfileId" to receiverProfileId,
      )
      .forEach { (field, value) -> LivePrivatePilotProtocol.requireOpaqueId(value, field) }
    require(attemptNumber in 1..1_000_000)
    listOf(
        "leaseNonceDigest" to leaseNonceDigest,
        "challengeDigest" to challengeDigest,
        "assignmentBodyDigest" to assignmentBodyDigest,
        "referenceBindingDigest" to referenceBindingDigest,
        "receiverProfileDigest" to receiverProfileDigest,
        "receiverConfigurationDigest" to receiverConfigurationDigest,
        "expectedReceiverNameDigest" to expectedReceiverNameDigest,
        "sourceDocumentDigest" to sourceDocumentDigest,
        "normalizedFactsDigest" to normalizedFactsDigest,
      )
      .forEach { (field, value) -> LivePrivatePilotProtocol.requireSha256(value, field) }
    LivePrivatePilotProtocol.requireReferenceFingerprint(referenceFingerprint)
    require(sourceProfile == LivePrivatePilotProtocol.SOURCE_PROFILE)
    require(receiverNameNormalizerVersion == LivePrivatePilotProtocol.RECEIVER_NAME_NORMALIZER_VERSION)
    require(adapterVersion == LivePrivatePilotProtocol.ADAPTER_VERSION)
    require(parserVersion == LivePrivatePilotProtocol.PARSER_VERSION)
    require(factsNormalizerVersion == LivePrivatePilotProtocol.FACTS_NORMALIZER_VERSION)
    LivePrivatePilotProtocol.requireTimestamp(observedAt, "observedAt")
  }
}

data class LivePilotSignedObservation(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val transcriptVersion: String,
  val bodyDigestAlgorithm: String,
  val bodyDigest: String,
  val signatureAlgorithm: String,
  val signatureEncoding: String,
  val body: LivePilotObservationBody,
  val signature: String,
) {
  init {
    LivePrivatePilotProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    require(transcriptVersion == LivePrivatePilotProtocol.OBSERVATION_TRANSCRIPT_VERSION)
    require(bodyDigestAlgorithm == LivePrivatePilotProtocol.DIGEST_ALGORITHM)
    LivePrivatePilotProtocol.requireSha256(bodyDigest, "bodyDigest")
    require(signatureAlgorithm == LivePrivatePilotProtocol.SIGNATURE_ALGORITHM)
    require(signatureEncoding == LivePrivatePilotProtocol.SIGNATURE_ENCODING)
    LivePrivatePilotProtocol.requireSignature(signature)
  }
}

object LivePilotNameNormalizer {
  fun normalize(value: String): String? {
    if (
      value.any { character ->
        val code = character.code
        code in 0x0000..0x0008 ||
          code in 0x000e..0x001f ||
          code in 0x007f..0x009f ||
          Character.isSurrogate(character)
      }
    ) {
      return null
    }
    val nfc = Normalizer.normalize(value, Normalizer.Form.NFC)
    val output = StringBuilder(nfc.length)
    var pendingSpace = false
    for (character in nfc) {
      if (character == ' ' || character in '\u0009'..'\u000d') {
        if (output.isNotEmpty()) pendingSpace = true
        continue
      }
      if (pendingSpace) {
        output.append(' ')
        pendingSpace = false
      }
      output.append(if (character in 'A'..'Z') character.lowercaseChar() else character)
    }
    val normalized = output.toString()
    return normalized.takeIf {
      it.length in 2..160 && it.toByteArray(StandardCharsets.UTF_8).size <= 320
    }
  }
}

object LivePilotCanonicalTranscripts {
  private sealed interface Scalar {
    data class Text(val value: String) : Scalar
    data class Number(val value: Long) : Scalar
    data class BooleanValue(val value: Boolean) : Scalar
    data object NullValue : Scalar
  }

  private data class Field(val name: String, val value: Scalar)

  fun receiverNameDigest(value: String): String? {
    val normalized = LivePilotNameNormalizer.normalize(value) ?: return null
    return sha256(
      encode(
        "fetanagent:telebirr:live-private-pilot:receiver-name:v1",
        listOf(
          field("normalizerVersion", LivePrivatePilotProtocol.RECEIVER_NAME_NORMALIZER_VERSION),
          field("normalizedName", normalized),
        ),
      ),
    )
  }

  fun referenceBindingDigest(rawReference: String, referenceFingerprint: String): String {
    LivePrivatePilotProtocol.requireRawReference(rawReference)
    LivePrivatePilotProtocol.requireReferenceFingerprint(referenceFingerprint)
    return sha256(
      encode(
        "fetanagent:telebirr:live-private-pilot:reference-binding:v1",
        listOf(
          field("providerCode", LivePrivatePilotProtocol.PROVIDER_CODE),
          field("sourceProfile", LivePrivatePilotProtocol.SOURCE_PROFILE),
          field("referenceBindingProfile", LivePrivatePilotProtocol.REFERENCE_BINDING_PROFILE),
          field("rawReference", rawReference),
          field("referenceFingerprint", referenceFingerprint),
        ),
      ),
    )
  }

  fun assignmentBodyBytes(body: LivePilotAssignmentBody): ByteArray =
    encode(
      "fetanagent:telebirr:live-private-pilot:assignment-body:v1",
      listOf(
        field("contractVersion", body.contractVersion.toLong()),
        field("providerCode", body.providerCode),
        field("protocolMode", body.protocolMode),
        field("assignmentId", body.assignmentId),
        field("requestId", body.requestId),
        field("jobId", body.jobId),
        field("attemptNumber", body.attemptNumber.toLong()),
        field("pilotRevisionId", body.pilotRevisionId),
        field("deviceId", body.deviceId),
        field("keyId", body.keyId),
        field("leaseNonceDigest", body.leaseNonceDigest),
        field("challengeId", body.challengeId),
        field("challengeDigest", body.challengeDigest),
        field("rawReference", body.rawReference),
        field("referenceFingerprint", body.referenceFingerprint),
        field("referenceBindingProfile", body.referenceBindingProfile),
        field("referenceBindingDigest", body.referenceBindingDigest),
        field("sourceProfile", body.sourceProfile),
        field("receiverRevisionId", body.receiverRevisionId),
        field("receiverProfileId", body.receiverProfileId),
        field("receiverProfileDigest", body.receiverProfileDigest),
        field("receiverConfigurationDigest", body.receiverConfigurationDigest),
        field("receiverNameNormalizerVersion", body.receiverNameNormalizerVersion),
        field("expectedReceiverNameNormalized", body.expectedReceiverNameNormalized),
        field("expectedReceiverNameDigest", body.expectedReceiverNameDigest),
        field("adapterVersion", body.adapterVersion),
        field("parserVersion", body.parserVersion),
        field("factsNormalizerVersion", body.factsNormalizerVersion),
        field("issuedAt", body.issuedAt),
        field("expiresAt", body.expiresAt),
      ),
    )

  fun assignmentBodyDigest(body: LivePilotAssignmentBody): String = sha256(assignmentBodyBytes(body))

  fun assignmentSignatureBytes(body: LivePilotAssignmentBody): ByteArray {
    val bodyDigest = assignmentBodyDigest(body)
    return encode(
      "fetanagent:telebirr:live-private-pilot:assignment-signature:v1",
      signatureFields(
        LivePrivatePilotProtocol.ASSIGNMENT_TRANSCRIPT_VERSION,
        bodyDigest,
      ),
    )
  }

  fun receiptFactsBytes(facts: LivePilotReceiptFacts): ByteArray =
    encode("fetanagent:telebirr:live-private-pilot:facts:v1", factsFields(facts))

  fun receiptFactsDigest(facts: LivePilotReceiptFacts): String = sha256(receiptFactsBytes(facts))

  fun observationBodyBytes(body: LivePilotObservationBody): ByteArray =
    encode(
      "fetanagent:telebirr:live-private-pilot:observation-body:v1",
      listOf(
        field("contractVersion", body.contractVersion.toLong()),
        field("providerCode", body.providerCode),
        field("protocolMode", body.protocolMode),
        field("assignmentId", body.assignmentId),
        field("requestId", body.requestId),
        field("jobId", body.jobId),
        field("attemptNumber", body.attemptNumber.toLong()),
        field("pilotRevisionId", body.pilotRevisionId),
        field("deviceId", body.deviceId),
        field("keyId", body.keyId),
        field("leaseNonceDigest", body.leaseNonceDigest),
        field("challengeId", body.challengeId),
        field("challengeDigest", body.challengeDigest),
        field("assignmentBodyDigest", body.assignmentBodyDigest),
        field("referenceFingerprint", body.referenceFingerprint),
        field("referenceBindingDigest", body.referenceBindingDigest),
        field("sourceProfile", body.sourceProfile),
        field("receiverRevisionId", body.receiverRevisionId),
        field("receiverProfileId", body.receiverProfileId),
        field("receiverProfileDigest", body.receiverProfileDigest),
        field("receiverConfigurationDigest", body.receiverConfigurationDigest),
        field("receiverNameNormalizerVersion", body.receiverNameNormalizerVersion),
        field("expectedReceiverNameDigest", body.expectedReceiverNameDigest),
        field("adapterVersion", body.adapterVersion),
        field("parserVersion", body.parserVersion),
        field("factsNormalizerVersion", body.factsNormalizerVersion),
        field("sourceDocumentDigest", body.sourceDocumentDigest),
        field("normalizedFactsDigest", body.normalizedFactsDigest),
        field("observedAt", body.observedAt),
      ) + factsFields(body.facts),
    )

  fun observationBodyDigest(body: LivePilotObservationBody): String =
    sha256(observationBodyBytes(body))

  fun observationSignatureBytes(body: LivePilotObservationBody): ByteArray =
    encode(
      "fetanagent:telebirr:live-private-pilot:observation-signature:v1",
      signatureFields(
        LivePrivatePilotProtocol.OBSERVATION_TRANSCRIPT_VERSION,
        observationBodyDigest(body),
      ),
    )

  fun sha256(bytes: ByteArray): String =
    "sha256:" + MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

  private fun signatureFields(transcriptVersion: String, bodyDigest: String): List<Field> =
    listOf(
      field("contractVersion", LivePrivatePilotProtocol.CONTRACT_VERSION.toLong()),
      field("providerCode", LivePrivatePilotProtocol.PROVIDER_CODE),
      field("protocolMode", LivePrivatePilotProtocol.PROTOCOL_MODE),
      field("transcriptVersion", transcriptVersion),
      field("bodyDigestAlgorithm", LivePrivatePilotProtocol.DIGEST_ALGORITHM),
      field("bodyDigest", bodyDigest),
      field("signatureAlgorithm", LivePrivatePilotProtocol.SIGNATURE_ALGORITHM),
      field("signatureEncoding", LivePrivatePilotProtocol.SIGNATURE_ENCODING),
    )

  private fun factsFields(facts: LivePilotReceiptFacts): List<Field> =
    when (facts) {
      is LivePilotReviewRequiredFacts ->
        listOf(
          field("facts.lookupOutcome", facts.lookupOutcome),
          field("facts.reviewReason", facts.reviewReason),
          field("facts.retrievedAt", facts.retrievedAt),
        )
      is LivePilotFoundFacts ->
        listOf(
          field("facts.lookupOutcome", facts.lookupOutcome),
          field("facts.evidenceSource", facts.evidenceSource),
          field("facts.layoutAttestation", facts.layoutAttestation),
          field("facts.providerFinalStatus", facts.providerFinalStatus),
          field("facts.canonicalReferencePresent", facts.canonicalReferencePresent),
          field("facts.referenceMatch", facts.referenceMatch),
          field("facts.amountMinor", facts.amountMinor),
          field("facts.currencyCode", facts.currencyCode),
          field("facts.receiverMatch", facts.receiverMatch),
          field("facts.creditedPartyNameDigest", facts.creditedPartyNameDigest),
          field("facts.paymentMode", facts.paymentMode),
          field("facts.paymentReason", facts.paymentReason),
          field("facts.paymentChannel", facts.paymentChannel),
          field("facts.occurredAt", facts.occurredAt),
          field("facts.retrievedAt", facts.retrievedAt),
        )
    }

  private fun encode(domain: String, fields: List<Field>): ByteArray {
    val values = mutableListOf(domain, fields.size.toString())
    fields.forEach { field ->
      values += field.name
      values += scalarText(field.value)
    }
    return ByteArrayOutputStream().use { bytes ->
      DataOutputStream(bytes).use { output ->
        values.forEach { value ->
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

  private fun field(name: String, value: Long?): Field =
    Field(name, value?.let(Scalar::Number) ?: Scalar.NullValue)

  private fun field(name: String, value: Boolean): Field =
    Field(name, Scalar.BooleanValue(value))

  private fun ByteArray.toHex(): String = joinToString(separator = "") { "%02x".format(it) }
}

data class LivePilotAssignmentAssessment(
  val disposition: String,
  val reasonCode: String,
  val authenticatedAssignment: AuthenticatedLivePilotAssignment?,
  val advisoryEvidenceOnly: Boolean = true,
  val capabilities: LivePilotDisabledCapabilities = LivePrivatePilotProtocol.CAPABILITIES,
) {
  init {
    require(disposition == "would_open_assignment" || disposition == "would_review")
    require((disposition == "would_open_assignment") == (authenticatedAssignment != null))
  }
}

class AuthenticatedLivePilotAssignment internal constructor(internal val body: LivePilotAssignmentBody) {
  override fun toString(): String = "AuthenticatedLivePilotAssignment(<redacted>)"
}

/** Verifies the trusted server signature and device/receiver/pilot bindings without doing I/O. */
object LivePilotAssignmentVerifier {
  fun verify(
    signer: LivePilotTrustedAssignmentSigner,
    enrollment: LivePilotDeviceEnrollment,
    signedAssignment: LivePilotSignedAssignment,
    signerPublicSpkiDer: ByteArray,
    devicePublicMaterial: IdentityPublicMaterial,
    assessedAt: String,
  ): LivePilotAssignmentAssessment {
    return runCatching {
        LivePrivatePilotProtocol.requireTimestamp(assessedAt, "assessedAt")
        val body = signedAssignment.body
        if (signer.state == "revoked") return review("assignment_signer_revoked")
        if (
          assessedAt < signer.validFrom ||
            assessedAt >= signer.validUntil ||
            body.issuedAt < signer.validFrom ||
            body.issuedAt >= signer.validUntil ||
            body.expiresAt > signer.validUntil
        ) {
          return review("assignment_signer_expired")
        }
        if (enrollment.state == "revoked") return review("device_revoked")
        if (
          assessedAt < enrollment.validFrom ||
            assessedAt >= enrollment.validUntil ||
            body.issuedAt < enrollment.validFrom ||
            body.issuedAt >= enrollment.validUntil ||
            body.expiresAt > enrollment.validUntil
        ) {
          return review("device_enrollment_expired")
        }
        if (signer.signerKeyId != signedAssignment.signerKeyId) return review("binding_mismatch")
        if (
          enrollment.deviceId != body.deviceId ||
            enrollment.keyId != body.keyId ||
            enrollment.pilotRevisionId != body.pilotRevisionId ||
            enrollment.receiverRevisionId != body.receiverRevisionId ||
            enrollment.receiverProfileId != body.receiverProfileId ||
            enrollment.receiverProfileDigest != body.receiverProfileDigest ||
            enrollment.receiverConfigurationDigest != body.receiverConfigurationDigest
        ) {
          return review("binding_mismatch")
        }
        if (
          enrollment.keyId != devicePublicMaterial.keyId ||
            enrollment.publicKeySpkiSha256 != devicePublicMaterial.publicKeySpkiSha256
        ) {
          return review("device_key_mismatch")
        }
        if (assessedAt < body.issuedAt || assessedAt >= body.expiresAt) {
          return review("assignment_expired")
        }
        val bodyDigest = LivePilotCanonicalTranscripts.assignmentBodyDigest(body)
        if (bodyDigest != signedAssignment.bodyDigest) return review("assignment_body_digest_mismatch")
        val publicKey =
          runCatching {
              KeyFactory.getInstance("EC")
                .generatePublic(X509EncodedKeySpec(signerPublicSpkiDer)) as ECPublicKey
            }
            .getOrElse { return review("assignment_signer_key_invalid") }
        if (publicKey.params.curve.field.fieldSize != 256 || !publicKey.encoded.contentEquals(signerPublicSpkiDer)) {
          return review("assignment_signer_key_invalid")
        }
        if (LivePilotCanonicalTranscripts.sha256(signerPublicSpkiDer) != signer.publicKeySpkiSha256) {
          return review("assignment_signer_key_mismatch")
        }
        val signatureBytes =
          runCatching { Base64.getUrlDecoder().decode(signedAssignment.signature) }
            .getOrElse { return review("assignment_signature_invalid") }
        if (signatureBytes.size != 64) return review("assignment_signature_invalid")
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(publicKey)
        verifier.update(LivePilotCanonicalTranscripts.assignmentSignatureBytes(body))
        if (!verifier.verify(EcdsaP1363.p1363ToDer(signatureBytes))) {
          return review("assignment_signature_invalid")
        }
        LivePilotAssignmentAssessment(
          disposition = "would_open_assignment",
          reasonCode = "signed_assignment_verified",
          authenticatedAssignment = AuthenticatedLivePilotAssignment(body),
        )
      }
      .getOrElse { review("invalid_request") }
  }

  private fun review(reason: String): LivePilotAssignmentAssessment =
    LivePilotAssignmentAssessment(
      disposition = "would_review",
      reasonCode = reason,
      authenticatedAssignment = null,
    )
}

object LivePilotSignedObservationFactory {
  fun create(
    assignment: AuthenticatedLivePilotAssignment,
    facts: LivePilotReceiptFacts,
    sourceDocumentDigest: String,
    observedAt: String,
    identity: P256Identity,
  ): LivePilotSignedObservation {
    val assigned = assignment.body
    require(identity.keyId == assigned.keyId)
    LivePrivatePilotProtocol.requireSha256(sourceDocumentDigest, "sourceDocumentDigest")
    LivePrivatePilotProtocol.requireTimestamp(observedAt, "observedAt")
    require(observedAt >= assigned.issuedAt && observedAt < assigned.expiresAt)
    val body =
      LivePilotObservationBody(
        contractVersion = LivePrivatePilotProtocol.CONTRACT_VERSION,
        providerCode = LivePrivatePilotProtocol.PROVIDER_CODE,
        protocolMode = LivePrivatePilotProtocol.PROTOCOL_MODE,
        assignmentId = assigned.assignmentId,
        requestId = assigned.requestId,
        jobId = assigned.jobId,
        attemptNumber = assigned.attemptNumber,
        pilotRevisionId = assigned.pilotRevisionId,
        deviceId = assigned.deviceId,
        keyId = assigned.keyId,
        leaseNonceDigest = assigned.leaseNonceDigest,
        challengeId = assigned.challengeId,
        challengeDigest = assigned.challengeDigest,
        assignmentBodyDigest = LivePilotCanonicalTranscripts.assignmentBodyDigest(assigned),
        referenceFingerprint = assigned.referenceFingerprint,
        referenceBindingDigest = assigned.referenceBindingDigest,
        sourceProfile = assigned.sourceProfile,
        receiverRevisionId = assigned.receiverRevisionId,
        receiverProfileId = assigned.receiverProfileId,
        receiverProfileDigest = assigned.receiverProfileDigest,
        receiverConfigurationDigest = assigned.receiverConfigurationDigest,
        receiverNameNormalizerVersion = assigned.receiverNameNormalizerVersion,
        expectedReceiverNameDigest = assigned.expectedReceiverNameDigest,
        adapterVersion = assigned.adapterVersion,
        parserVersion = assigned.parserVersion,
        factsNormalizerVersion = assigned.factsNormalizerVersion,
        sourceDocumentDigest = sourceDocumentDigest,
        normalizedFactsDigest = LivePilotCanonicalTranscripts.receiptFactsDigest(facts),
        observedAt = observedAt,
        facts = facts,
      )
    val bodyDigest = LivePilotCanonicalTranscripts.observationBodyDigest(body)
    val signature = identity.signP1363(LivePilotCanonicalTranscripts.observationSignatureBytes(body))
    require(signature.size == 64)
    return LivePilotSignedObservation(
      contractVersion = LivePrivatePilotProtocol.CONTRACT_VERSION,
      providerCode = LivePrivatePilotProtocol.PROVIDER_CODE,
      protocolMode = LivePrivatePilotProtocol.PROTOCOL_MODE,
      transcriptVersion = LivePrivatePilotProtocol.OBSERVATION_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm = LivePrivatePilotProtocol.DIGEST_ALGORITHM,
      bodyDigest = bodyDigest,
      signatureAlgorithm = LivePrivatePilotProtocol.SIGNATURE_ALGORITHM,
      signatureEncoding = LivePrivatePilotProtocol.SIGNATURE_ENCODING,
      body = body,
      signature = Base64.getUrlEncoder().withoutPadding().encodeToString(signature),
    )
  }
}
