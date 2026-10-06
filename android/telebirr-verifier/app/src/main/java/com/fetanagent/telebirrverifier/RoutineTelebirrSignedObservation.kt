package com.fetanagent.telebirrverifier

import com.google.gson.stream.JsonWriter
import java.io.StringWriter
import java.nio.charset.StandardCharsets
import java.util.Base64

/** The exact routine observation body accepted by the advisory TypeScript verifier. */
internal data class RoutineTelebirrObservationBody(
  val contractVersion: Int = RoutineTelebirrLookupProtocol.CONTRACT_VERSION,
  val providerCode: String = RoutineTelebirrLookupProtocol.PROVIDER_CODE,
  val protocolMode: String = RoutineTelebirrLookupProtocol.PROTOCOL_MODE,
  val candidateId: String,
  val referenceFingerprint: String,
  val receiverRevisionId: String,
  val receiverVersion: Int,
  val receiverProfileDigest: String,
  val expectedReceiverNameDigest: String,
  val deviceId: String,
  val keyId: String,
  val challengeId: String,
  val challengeDigest: String,
  val sourceDocumentDigest: String,
  val normalizedFactsDigest: String,
  val observedAt: String,
  val facts: RoutineTelebirrObservedReceiptFacts,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    p.requireHeader(contractVersion, providerCode, protocolMode)
    require(p.UUID_V4.matches(candidateId))
    require(p.FINGERPRINT.matches(referenceFingerprint))
    require(p.UUID_V4.matches(receiverRevisionId) && receiverVersion > 0)
    require(p.DIGEST.matches(receiverProfileDigest))
    require(p.DIGEST.matches(expectedReceiverNameDigest))
    require(p.OPAQUE_ID.matches(deviceId) && p.OPAQUE_ID.matches(keyId))
    require(p.UUID_V4.matches(challengeId) && p.DIGEST.matches(challengeDigest))
    require(p.DIGEST.matches(sourceDocumentDigest))
    require(p.DIGEST.matches(normalizedFactsDigest))
    p.requireUtc(observedAt)
  }

  override fun toString(): String = "RoutineTelebirrObservationBody(<redacted>)"
}

internal data class RoutineTelebirrSignedObservation(
  val contractVersion: Int = RoutineTelebirrLookupProtocol.CONTRACT_VERSION,
  val providerCode: String = RoutineTelebirrLookupProtocol.PROVIDER_CODE,
  val protocolMode: String = RoutineTelebirrLookupProtocol.PROTOCOL_MODE,
  val transcriptVersion: String = RoutineTelebirrObservationCanonical.TRANSCRIPT_VERSION,
  val bodyDigestAlgorithm: String = RoutineTelebirrLookupProtocol.DIGEST_ALGORITHM,
  val bodyDigest: String,
  val signatureAlgorithm: String = RoutineTelebirrLookupProtocol.SIGNATURE_ALGORITHM,
  val signatureEncoding: String = RoutineTelebirrLookupProtocol.SIGNATURE_ENCODING,
  val body: RoutineTelebirrObservationBody,
  val signature: String,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    p.requireHeader(contractVersion, providerCode, protocolMode)
    require(transcriptVersion == RoutineTelebirrObservationCanonical.TRANSCRIPT_VERSION)
    require(bodyDigestAlgorithm == p.DIGEST_ALGORITHM && p.DIGEST.matches(bodyDigest))
    require(signatureAlgorithm == p.SIGNATURE_ALGORITHM)
    require(signatureEncoding == p.SIGNATURE_ENCODING)
    require(p.SIGNATURE.matches(signature))
    require(
      Base64.getUrlEncoder().withoutPadding().encodeToString(Base64.getUrlDecoder().decode(signature)) ==
        signature
    )
  }

  override fun toString(): String = "RoutineTelebirrSignedObservation(<redacted>)"
}

/** Canonical ASCII JSON-array transcripts in the exact TypeScript contract field order. */
internal object RoutineTelebirrObservationCanonical {
  const val TRANSCRIPT_VERSION = "telebirr-routine-observation-transcript-v1"

  fun factsDigest(facts: RoutineTelebirrObservedReceiptFacts): String =
    RoutineLookupCanonicalTranscripts.sha256(
      jsonArray("telebirr-routine-observation-facts-v1", factsValues(facts)),
    )

  fun bodyDigest(body: RoutineTelebirrObservationBody): String =
    RoutineLookupCanonicalTranscripts.sha256(
      jsonArray(
        "telebirr-routine-observation-body-v1",
        listOf(
          body.contractVersion,
          body.providerCode,
          body.protocolMode,
          body.candidateId,
          body.referenceFingerprint,
          body.receiverRevisionId,
          body.receiverVersion,
          body.receiverProfileDigest,
          body.expectedReceiverNameDigest,
          body.deviceId,
          body.keyId,
          body.challengeId,
          body.challengeDigest,
          body.sourceDocumentDigest,
          body.normalizedFactsDigest,
          body.observedAt,
          factsValues(body.facts),
        ),
      ),
    )

  fun signatureBytes(body: RoutineTelebirrObservationBody): ByteArray =
    jsonArray(TRANSCRIPT_VERSION, listOf(bodyDigest(body)))

  private fun factsValues(facts: RoutineTelebirrObservedReceiptFacts): List<Any> =
    listOf(
      facts.amountMinor,
      facts.canonicalReferencePresent,
      facts.creditedPartyNameDigest,
      facts.currencyCode,
      facts.evidenceSource,
      facts.occurredAt,
      facts.paymentChannel,
      facts.paymentMode,
      facts.paymentReason,
      facts.providerFinalStatus,
      facts.providerIdentity,
      facts.receiverMatch,
      facts.referenceMatch,
      facts.retrievedAt,
      facts.sourceProfile,
    )

  private fun jsonArray(domain: String, values: List<Any>): ByteArray {
    val output = StringWriter()
    JsonWriter(output).use { writer ->
      writer.setHtmlSafe(false)
      writer.beginArray()
      writer.value(domain)
      values.forEach { value -> writeValue(writer, value) }
      writer.endArray()
    }
    return output.toString().toByteArray(StandardCharsets.UTF_8)
  }

  private fun writeValue(writer: JsonWriter, value: Any) {
    when (value) {
      is String -> writer.value(value)
      is Int -> writer.value(value)
      is Long -> writer.value(value)
      is Boolean -> writer.value(value)
      is List<*> -> {
        writer.beginArray()
        value.forEach { nested -> writeValue(writer, requireNotNull(nested)) }
        writer.endArray()
      }
      else -> error("Unsupported routine observation transcript value")
    }
  }
}

/** No transport or upload: this can only sign a previously guarded local observation. */
internal object RoutineTelebirrSignedObservationFactory {
  fun create(
    assignment: AuthenticatedRoutineLookupAssignment,
    enrollment: RoutineLookupDeviceEnrollment,
    parsed: RoutineTelebirrParsedReceipt.Observed,
    identity: P256Identity,
  ): RoutineTelebirrSignedObservation {
    val assigned = assignment.body
    val material = identity.publicMaterial()
    require(material.keyId == assigned.keyId && enrollment.keyId == assigned.keyId)
    require(material.publicKeySpkiSha256 == enrollment.publicKeySpkiSha256)
    require(enrollment.deviceId == assigned.deviceId)
    require(enrollment.receiverRevisionId == assigned.receiverRevisionId)
    require(enrollment.receiverVersion == assigned.receiverVersion)
    require(enrollment.receiverProfileDigest == assigned.receiverProfileDigest)
    require(enrollment.state == "active")
    val facts = parsed.facts
    require(facts.amountMinor in 0..9_007_199_254_740_991L)
    require(RoutineTelebirrLookupProtocol.DIGEST.matches(facts.creditedPartyNameDigest))
    require(RoutineTelebirrLookupProtocol.DIGEST.matches(parsed.sourceDocumentDigest))
    RoutineTelebirrLookupProtocol.requireUtc(facts.occurredAt)
    RoutineTelebirrLookupProtocol.requireUtc(facts.retrievedAt)
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
    require(facts.retrievedAt >= assigned.issuedAt && facts.retrievedAt < assigned.expiresAt)
    val body =
      RoutineTelebirrObservationBody(
        candidateId = assigned.candidateId,
        referenceFingerprint = assigned.referenceFingerprint,
        receiverRevisionId = assigned.receiverRevisionId,
        receiverVersion = assigned.receiverVersion,
        receiverProfileDigest = assigned.receiverProfileDigest,
        expectedReceiverNameDigest = assigned.expectedReceiverNameDigest,
        deviceId = assigned.deviceId,
        keyId = assigned.keyId,
        challengeId = assigned.challengeId,
        challengeDigest = assigned.challengeDigest,
        sourceDocumentDigest = parsed.sourceDocumentDigest,
        normalizedFactsDigest = RoutineTelebirrObservationCanonical.factsDigest(facts),
        observedAt = facts.retrievedAt,
        facts = facts,
      )
    val signature = identity.signP1363(RoutineTelebirrObservationCanonical.signatureBytes(body))
    require(signature.size == 64)
    return RoutineTelebirrSignedObservation(
      bodyDigest = RoutineTelebirrObservationCanonical.bodyDigest(body),
      body = body,
      signature = Base64.getUrlEncoder().withoutPadding().encodeToString(signature),
    )
  }
}
