package com.fetanagent.telebirrverifier

import java.time.Instant

object RelayProtocol {
  const val CONTRACT_VERSION = 1
  const val PROVIDER_CODE = "telebirr"
  /**
   * Deliberately matches the only published server transcript. This verifier is disabled; a future
   * live rollout must introduce and jointly deploy a separately reviewed live protocol mode.
   */
  const val PROTOCOL_MODE = "synthetic_shadow"
  const val COMPATIBILITY_ONLY = true
  const val TRANSCRIPT_VERSION = "telebirr-signed-relay-transcript-v1"
  const val BODY_DIGEST_ALGORITHM = "sha256"
  const val SIGNATURE_ALGORITHM = "ecdsa-p256-sha256"
  const val SIGNATURE_ENCODING = "ieee-p1363-base64url"
  const val ADAPTER_VERSION = "telebirr-synthetic-relay-adapter-v1"
  const val PARSER_VERSION = "telebirr-official-receipt-parser-v1"
  const val NORMALIZER_VERSION = "telebirr-official-receipt-normalizer-v1"
  const val SOURCE_PROFILE = "telebirr_official_receipt_v1"

  val CAPABILITIES = DisabledCapabilities()

  private val opaqueIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")
  private val sha256Pattern = Regex("^sha256:[a-f0-9]{64}$")
  private val referenceFingerprintPattern =
    Regex("^(?:hmac-sha256|fixture-hmac-sha256):[a-f0-9]{64}$")
  private val timestampPattern = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")
  private val canonicalReferencePattern = Regex("^[A-Z0-9]{8,64}$")

  fun requireHeader(contractVersion: Int, providerCode: String, protocolMode: String) {
    require(contractVersion == CONTRACT_VERSION) { "Unsupported relay contract version" }
    require(providerCode == PROVIDER_CODE) { "Unsupported provider" }
    require(protocolMode == PROTOCOL_MODE) { "Unsupported relay mode" }
  }

  fun requireOpaqueId(value: String, field: String) {
    require(opaqueIdPattern.matches(value)) { "$field is not a bounded opaque identifier" }
  }

  fun requireSha256(value: String, field: String) {
    require(sha256Pattern.matches(value)) { "$field is not a canonical SHA-256 digest" }
  }

  fun requireReferenceFingerprint(value: String) {
    require(referenceFingerprintPattern.matches(value)) {
      "referenceFingerprint is not a protected reference fingerprint"
    }
  }

  fun requireAttemptNumber(value: Int) {
    require(value in 1..1_000_000) { "attemptNumber is outside the relay bound" }
  }

  fun requireTimestamp(value: String, field: String) {
    require(timestampPattern.matches(value)) { "$field is not a canonical millisecond UTC timestamp" }
    runCatching { Instant.parse(value) }.getOrElse {
      throw IllegalArgumentException("$field is not a valid UTC timestamp", it)
    }
  }

  fun requireCanonicalReference(value: String) {
    require(canonicalReferencePattern.matches(value)) {
      "Reference must already be canonical uppercase ASCII alphanumeric text"
    }
  }
}

/** This mobile process cannot authorize SQL or any persistence or financial action. */
data class DisabledCapabilities(
  val databaseReadAllowed: Boolean = false,
  val databaseWriteAllowed: Boolean = false,
  val supabaseAccessAllowed: Boolean = false,
  val persistenceAllowed: Boolean = false,
  val claimAllowed: Boolean = false,
  val settlementAllowed: Boolean = false,
  val enqueueAllowed: Boolean = false,
  val kemerbetAccessAllowed: Boolean = false,
  val executionAllowed: Boolean = false,
  val financialActionAllowed: Boolean = false,
)

data class RelayEnrollment(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val enrollmentId: String,
  val deviceId: String,
  val keyId: String,
  val publicKeySpkiSha256: String,
  val signatureAlgorithm: String,
  val state: String,
  val enrolledAt: String,
  val validFrom: String,
  val validUntil: String,
  val sourceProfile: String,
  val receiverProfileId: String,
  val receiverProfileDigest: String,
  val parserVersion: String,
  val normalizerVersion: String,
) {
  init {
    RelayProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    RelayProtocol.requireOpaqueId(enrollmentId, "enrollmentId")
    RelayProtocol.requireOpaqueId(deviceId, "deviceId")
    RelayProtocol.requireOpaqueId(keyId, "keyId")
    RelayProtocol.requireSha256(publicKeySpkiSha256, "publicKeySpkiSha256")
    require(signatureAlgorithm == RelayProtocol.SIGNATURE_ALGORITHM)
    require(state == "active" || state == "revoked")
    RelayProtocol.requireTimestamp(enrolledAt, "enrolledAt")
    RelayProtocol.requireTimestamp(validFrom, "validFrom")
    RelayProtocol.requireTimestamp(validUntil, "validUntil")
    require(enrolledAt <= validFrom && validFrom < validUntil)
    require(sourceProfile == RelayProtocol.SOURCE_PROFILE)
    RelayProtocol.requireOpaqueId(receiverProfileId, "receiverProfileId")
    RelayProtocol.requireSha256(receiverProfileDigest, "receiverProfileDigest")
    require(parserVersion == RelayProtocol.PARSER_VERSION)
    require(normalizerVersion == RelayProtocol.NORMALIZER_VERSION)
  }
}

data class RelayRequest(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val requestId: String,
  val jobId: String,
  val attemptNumber: Int,
  val referenceFingerprint: String,
  val sourceProfile: String,
  val receiverProfileId: String,
  val receiverProfileDigest: String,
  val parserVersion: String,
  val normalizerVersion: String,
  val requestedAt: String,
) {
  init {
    RelayProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    RelayProtocol.requireOpaqueId(requestId, "requestId")
    RelayProtocol.requireOpaqueId(jobId, "jobId")
    RelayProtocol.requireAttemptNumber(attemptNumber)
    RelayProtocol.requireReferenceFingerprint(referenceFingerprint)
    require(sourceProfile == RelayProtocol.SOURCE_PROFILE)
    RelayProtocol.requireOpaqueId(receiverProfileId, "receiverProfileId")
    RelayProtocol.requireSha256(receiverProfileDigest, "receiverProfileDigest")
    require(parserVersion == RelayProtocol.PARSER_VERSION)
    require(normalizerVersion == RelayProtocol.NORMALIZER_VERSION)
    RelayProtocol.requireTimestamp(requestedAt, "requestedAt")
  }
}

data class RelayLease(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val leaseId: String,
  val requestId: String,
  val jobId: String,
  val attemptNumber: Int,
  val deviceId: String,
  val keyId: String,
  val leaseNonceDigest: String,
  val challengeId: String,
  val challengeDigest: String,
  val referenceFingerprint: String,
  val sourceProfile: String,
  val receiverProfileId: String,
  val receiverProfileDigest: String,
  val parserVersion: String,
  val normalizerVersion: String,
  val issuedAt: String,
  val expiresAt: String,
) {
  init {
    RelayProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    RelayProtocol.requireOpaqueId(leaseId, "leaseId")
    RelayProtocol.requireOpaqueId(requestId, "requestId")
    RelayProtocol.requireOpaqueId(jobId, "jobId")
    RelayProtocol.requireAttemptNumber(attemptNumber)
    RelayProtocol.requireOpaqueId(deviceId, "deviceId")
    RelayProtocol.requireOpaqueId(keyId, "keyId")
    RelayProtocol.requireSha256(leaseNonceDigest, "leaseNonceDigest")
    RelayProtocol.requireOpaqueId(challengeId, "challengeId")
    RelayProtocol.requireSha256(challengeDigest, "challengeDigest")
    RelayProtocol.requireReferenceFingerprint(referenceFingerprint)
    require(sourceProfile == RelayProtocol.SOURCE_PROFILE)
    RelayProtocol.requireOpaqueId(receiverProfileId, "receiverProfileId")
    RelayProtocol.requireSha256(receiverProfileDigest, "receiverProfileDigest")
    require(parserVersion == RelayProtocol.PARSER_VERSION)
    require(normalizerVersion == RelayProtocol.NORMALIZER_VERSION)
    RelayProtocol.requireTimestamp(issuedAt, "issuedAt")
    RelayProtocol.requireTimestamp(expiresAt, "expiresAt")
    require(issuedAt < expiresAt)
  }
}

sealed interface RelayReceiptFacts {
  val lookupOutcome: String
}

data class FoundReceiptFacts(
  override val lookupOutcome: String,
  val evidenceSource: String,
  val providerIdentity: String,
  val providerFinalStatus: String,
  val canonicalReferencePresent: Boolean,
  val referenceMatch: String,
  val amountMinor: Long?,
  val currencyCode: String,
  val receiverMatch: String,
  val maskedReceiverDiagnostic: String,
  val paymentMode: String,
  val paymentReason: String,
  val paymentChannel: String,
  val occurredAt: String?,
  val retrievedAt: String?,
) : RelayReceiptFacts {
  init {
    require(lookupOutcome == "found")
    require(evidenceSource == "provider_receipt_lookup")
    require(providerIdentity in setOf("matched", "mismatched", "unknown"))
    require(providerFinalStatus in setOf("completed", "pending", "failed", "reversed", "unknown"))
    require(referenceMatch in setOf("matched", "mismatched", "unknown"))
    require(if (canonicalReferencePresent) referenceMatch != "unknown" else referenceMatch == "unknown")
    require(amountMinor == null || amountMinor in 1..9_007_199_254_740_991L)
    require(currencyCode == if (amountMinor == null) "unknown" else "ETB")
    require(receiverMatch in setOf("matched", "mismatched", "unknown"))
    require(maskedReceiverDiagnostic in setOf("matched", "mismatched", "unknown"))
    require(paymentMode in setOf("telebirr", "other", "unknown"))
    require(paymentReason in setOf("send_money_to_registered_customer", "other", "unknown"))
    require(paymentChannel in setOf("api_app", "other", "unknown"))
    occurredAt?.let { RelayProtocol.requireTimestamp(it, "occurredAt") }
    retrievedAt?.let { RelayProtocol.requireTimestamp(it, "retrievedAt") }
    require(occurredAt == null || retrievedAt == null || occurredAt <= retrievedAt)
  }
}

data class NotFoundReceiptFacts(
  override val lookupOutcome: String,
) : RelayReceiptFacts {
  init {
    require(lookupOutcome == "not_found")
  }
}

data class UnavailableReceiptFacts(
  override val lookupOutcome: String,
  val uncertainty: String,
) : RelayReceiptFacts {
  init {
    require(lookupOutcome == "unavailable")
    require(uncertainty in setOf("provider", "network", "parser", "device"))
  }
}

data class RelayObservationBody(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val requestId: String,
  val jobId: String,
  val attemptNumber: Int,
  val leaseId: String,
  val deviceId: String,
  val keyId: String,
  val leaseNonceDigest: String,
  val challengeId: String,
  val challengeDigest: String,
  val referenceFingerprint: String,
  val sourceProfile: String,
  val receiverProfileId: String,
  val receiverProfileDigest: String,
  val adapterVersion: String,
  val parserVersion: String,
  val normalizerVersion: String,
  val sourceDocumentDigest: String,
  val normalizedFactsDigest: String,
  val observedAt: String,
  val facts: RelayReceiptFacts,
) {
  init {
    RelayProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    RelayProtocol.requireOpaqueId(requestId, "requestId")
    RelayProtocol.requireOpaqueId(jobId, "jobId")
    RelayProtocol.requireAttemptNumber(attemptNumber)
    RelayProtocol.requireOpaqueId(leaseId, "leaseId")
    RelayProtocol.requireOpaqueId(deviceId, "deviceId")
    RelayProtocol.requireOpaqueId(keyId, "keyId")
    RelayProtocol.requireSha256(leaseNonceDigest, "leaseNonceDigest")
    RelayProtocol.requireOpaqueId(challengeId, "challengeId")
    RelayProtocol.requireSha256(challengeDigest, "challengeDigest")
    RelayProtocol.requireReferenceFingerprint(referenceFingerprint)
    require(sourceProfile == RelayProtocol.SOURCE_PROFILE)
    RelayProtocol.requireOpaqueId(receiverProfileId, "receiverProfileId")
    RelayProtocol.requireSha256(receiverProfileDigest, "receiverProfileDigest")
    require(adapterVersion == RelayProtocol.ADAPTER_VERSION)
    require(parserVersion == RelayProtocol.PARSER_VERSION)
    require(normalizerVersion == RelayProtocol.NORMALIZER_VERSION)
    RelayProtocol.requireSha256(sourceDocumentDigest, "sourceDocumentDigest")
    RelayProtocol.requireSha256(normalizedFactsDigest, "normalizedFactsDigest")
    RelayProtocol.requireTimestamp(observedAt, "observedAt")
  }
}

data class SignedRelayObservation(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val transcriptVersion: String,
  val bodyDigestAlgorithm: String,
  val bodyDigest: String,
  val signatureAlgorithm: String,
  val signatureEncoding: String,
  val body: RelayObservationBody,
  val signature: String,
) {
  init {
    RelayProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    require(transcriptVersion == RelayProtocol.TRANSCRIPT_VERSION)
    require(bodyDigestAlgorithm == RelayProtocol.BODY_DIGEST_ALGORITHM)
    RelayProtocol.requireSha256(bodyDigest, "bodyDigest")
    require(signatureAlgorithm == RelayProtocol.SIGNATURE_ALGORITHM)
    require(signatureEncoding == RelayProtocol.SIGNATURE_ENCODING)
    require(Regex("^[A-Za-z0-9_-]{86}$").matches(signature))
  }
}

/** A sensitive in-memory value. Its text projection is always redacted. */
class CanonicalReference private constructor(private val value: String) {
  fun <T> use(block: (String) -> T): T = block(value)

  override fun toString(): String = "CanonicalReference(<redacted>)"

  companion object {
    fun fromCanonical(value: String): CanonicalReference {
      RelayProtocol.requireCanonicalReference(value)
      return CanonicalReference(value)
    }
  }
}
