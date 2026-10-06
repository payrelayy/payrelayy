package com.fetanagent.telebirrverifier

import java.nio.charset.StandardCharsets

/**
 * Dormant routine-only wire shapes. This does not select a server, open a connection, enroll a
 * device, authenticate TeleBirr, upload evidence, or authorize a financial action. The caller must
 * verify the server signature and independently trusted routine enrollment before opening a lookup.
 */
internal object RoutineTelebirrJsonCodec {
  private const val MAX_ASSIGNMENT_BYTES = 16 * 1024
  private const val MAX_OBSERVATION_BYTES = 16 * 1024
  private const val MAX_SAFE_AMOUNT_MINOR = 9_007_199_254_740_991L

  private val assignmentEnvelopeKeys =
    setOf(
      "contractVersion", "providerCode", "protocolMode", "transcriptVersion",
      "bodyDigestAlgorithm", "bodyDigest", "signatureAlgorithm", "signatureEncoding",
      "signerKeyId", "body", "signature",
    )
  private val assignmentBodyKeys =
    setOf(
      "contractVersion", "providerCode", "protocolMode", "candidateId", "rawReference",
      "referenceFingerprint", "referenceKeyVersion", "referenceProfileVersion", "submittedAt",
      "receiverRevisionId", "receiverVersion", "receiverProfileDigest",
      "receiverNameNormalizerVersion", "expectedReceiverNameNormalized",
      "expectedReceiverNameDigest", "deviceId", "keyId", "challengeId", "challengeDigest",
      "sourceProfile", "issuedAt", "expiresAt",
    )

  /** Duplicate keys, extra fields, malformed UTF-8, unknown versions, and stale digests fail closed. */
  fun decodeSignedAssignment(bytes: ByteArray): RoutineSignedLookupAssignment? =
    runCatching {
        require(bytes.size in 1..MAX_ASSIGNMENT_BYTES)
        val value = StrictJson.parse(bytes).requireObject(assignmentEnvelopeKeys)
        val body = value.value("body").requireObject(assignmentBodyKeys)
        val decodedBody =
          RoutineLookupAssignmentBody(
            contractVersion = body.int("contractVersion"),
            providerCode = body.string("providerCode"),
            protocolMode = body.string("protocolMode"),
            candidateId = body.string("candidateId"),
            rawReference = body.string("rawReference"),
            referenceFingerprint = body.string("referenceFingerprint"),
            referenceKeyVersion = body.int("referenceKeyVersion"),
            referenceProfileVersion = body.int("referenceProfileVersion"),
            submittedAt = body.string("submittedAt"),
            receiverRevisionId = body.string("receiverRevisionId"),
            receiverVersion = body.int("receiverVersion"),
            receiverProfileDigest = body.string("receiverProfileDigest"),
            receiverNameNormalizerVersion = body.string("receiverNameNormalizerVersion"),
            expectedReceiverNameNormalized = body.string("expectedReceiverNameNormalized"),
            expectedReceiverNameDigest = body.string("expectedReceiverNameDigest"),
            deviceId = body.string("deviceId"),
            keyId = body.string("keyId"),
            challengeId = body.string("challengeId"),
            challengeDigest = body.string("challengeDigest"),
            sourceProfile = body.string("sourceProfile"),
            issuedAt = body.string("issuedAt"),
            expiresAt = body.string("expiresAt"),
          )
        RoutineSignedLookupAssignment(
          contractVersion = value.int("contractVersion"),
          providerCode = value.string("providerCode"),
          protocolMode = value.string("protocolMode"),
          transcriptVersion = value.string("transcriptVersion"),
          bodyDigestAlgorithm = value.string("bodyDigestAlgorithm"),
          bodyDigest = value.string("bodyDigest"),
          signatureAlgorithm = value.string("signatureAlgorithm"),
          signatureEncoding = value.string("signatureEncoding"),
          signerKeyId = value.string("signerKeyId"),
          body = decodedBody,
          signature = value.string("signature"),
        ).also {
          require(it.bodyDigest == RoutineLookupCanonicalTranscripts.bodyDigest(it.body))
        }
      }
      .getOrNull()

  /** Serializes only signed, normalized receipt facts; never the raw reference or HTML document. */
  fun encodeSignedObservation(observation: RoutineTelebirrSignedObservation): ByteArray {
    val body = observation.body
    val facts = body.facts
    require(facts.amountMinor in 0..MAX_SAFE_AMOUNT_MINOR)
    require(RoutineTelebirrLookupProtocol.DIGEST.matches(facts.creditedPartyNameDigest))
    RoutineTelebirrLookupProtocol.requireUtc(facts.occurredAt)
    RoutineTelebirrLookupProtocol.requireUtc(facts.retrievedAt)
    require(facts.retrievedAt == body.observedAt)
    require(facts.sourceProfile == RoutineTelebirrLookupProtocol.SOURCE_PROFILE)
    require(facts.currencyCode in setOf("ETB", "unknown"))
    require(facts.evidenceSource in setOf("provider_receipt_lookup", "unknown"))
    require(facts.paymentMode in setOf("telebirr", "other", "unknown"))
    require(facts.paymentReason in setOf("send_money_to_registered_customer", "other", "unknown"))
    require(facts.paymentChannel in setOf("api_app", "other", "unknown"))
    require(facts.providerFinalStatus in setOf("completed", "pending", "failed", "reversed", "unknown"))
    require(facts.providerIdentity in setOf("matched", "mismatched", "unknown"))
    require(facts.receiverMatch in setOf("matched", "mismatched", "unknown"))
    require(facts.referenceMatch in setOf("matched", "mismatched", "unknown"))
    require(body.normalizedFactsDigest == RoutineTelebirrObservationCanonical.factsDigest(facts))
    require(observation.bodyDigest == RoutineTelebirrObservationCanonical.bodyDigest(body))

    val bytes =
      StrictJson.encode(
          obj(
            "contractVersion" to number(observation.contractVersion.toLong()),
            "providerCode" to text(observation.providerCode),
            "protocolMode" to text(observation.protocolMode),
            "transcriptVersion" to text(observation.transcriptVersion),
            "bodyDigestAlgorithm" to text(observation.bodyDigestAlgorithm),
            "bodyDigest" to text(observation.bodyDigest),
            "signatureAlgorithm" to text(observation.signatureAlgorithm),
            "signatureEncoding" to text(observation.signatureEncoding),
            "body" to
              obj(
                "contractVersion" to number(body.contractVersion.toLong()),
                "providerCode" to text(body.providerCode),
                "protocolMode" to text(body.protocolMode),
                "candidateId" to text(body.candidateId),
                "referenceFingerprint" to text(body.referenceFingerprint),
                "receiverRevisionId" to text(body.receiverRevisionId),
                "receiverVersion" to number(body.receiverVersion.toLong()),
                "receiverProfileDigest" to text(body.receiverProfileDigest),
                "expectedReceiverNameDigest" to text(body.expectedReceiverNameDigest),
                "deviceId" to text(body.deviceId),
                "keyId" to text(body.keyId),
                "challengeId" to text(body.challengeId),
                "challengeDigest" to text(body.challengeDigest),
                "sourceDocumentDigest" to text(body.sourceDocumentDigest),
                "normalizedFactsDigest" to text(body.normalizedFactsDigest),
                "observedAt" to text(body.observedAt),
                "facts" to
                  obj(
                    "amountMinor" to number(facts.amountMinor),
                    "canonicalReferencePresent" to bool(facts.canonicalReferencePresent),
                    "creditedPartyNameDigest" to text(facts.creditedPartyNameDigest),
                    "currencyCode" to text(facts.currencyCode),
                    "evidenceSource" to text(facts.evidenceSource),
                    "occurredAt" to text(facts.occurredAt),
                    "paymentChannel" to text(facts.paymentChannel),
                    "paymentMode" to text(facts.paymentMode),
                    "paymentReason" to text(facts.paymentReason),
                    "providerFinalStatus" to text(facts.providerFinalStatus),
                    "providerIdentity" to text(facts.providerIdentity),
                    "receiverMatch" to text(facts.receiverMatch),
                    "referenceMatch" to text(facts.referenceMatch),
                    "retrievedAt" to text(facts.retrievedAt),
                    "sourceProfile" to text(facts.sourceProfile),
                  ),
              ),
            "signature" to text(observation.signature),
          ),
        )
        .toByteArray(StandardCharsets.UTF_8)
    require(bytes.size in 1..MAX_OBSERVATION_BYTES)
    return bytes
  }
}
