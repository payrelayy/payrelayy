package com.fetanagent.telebirrverifier

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

object CanonicalTranscripts {
  private const val FACTS_DOMAIN = "fetanagent:telebirr:relay:facts:v1"
  private const val OBSERVATION_DOMAIN = "fetanagent:telebirr:relay:observation-body:v1"
  private const val SIGNATURE_DOMAIN = "fetanagent:telebirr:relay:signature-transcript:v1"

  private sealed interface Scalar {
    data class Text(val value: String) : Scalar
    data class Number(val value: Long) : Scalar
    data class BooleanValue(val value: Boolean) : Scalar
    data object NullValue : Scalar
  }

  private data class Field(val name: String, val value: Scalar)

  fun receiptFactsBytes(facts: RelayReceiptFacts): ByteArray =
    encodeCanonicalFields(FACTS_DOMAIN, factsFields(facts))

  fun receiptFactsDigest(facts: RelayReceiptFacts): String = sha256(receiptFactsBytes(facts))

  fun observationBodyBytes(body: RelayObservationBody): ByteArray =
    encodeCanonicalFields(OBSERVATION_DOMAIN, observationFields(body))

  fun observationBodyDigest(body: RelayObservationBody): String = sha256(observationBodyBytes(body))

  fun signatureTranscriptBytes(body: RelayObservationBody): ByteArray =
    signatureTranscriptBytes(observationBodyDigest(body))

  fun signatureTranscriptBytes(bodyDigest: String): ByteArray {
    RelayProtocol.requireSha256(bodyDigest, "bodyDigest")
    return encodeCanonicalFields(
      SIGNATURE_DOMAIN,
      listOf(
        field("contractVersion", RelayProtocol.CONTRACT_VERSION.toLong()),
        field("providerCode", RelayProtocol.PROVIDER_CODE),
        field("protocolMode", RelayProtocol.PROTOCOL_MODE),
        field("transcriptVersion", RelayProtocol.TRANSCRIPT_VERSION),
        field("bodyDigestAlgorithm", RelayProtocol.BODY_DIGEST_ALGORITHM),
        field("bodyDigest", bodyDigest),
        field("signatureAlgorithm", RelayProtocol.SIGNATURE_ALGORITHM),
        field("signatureEncoding", RelayProtocol.SIGNATURE_ENCODING),
      ),
    )
  }

  fun sha256(bytes: ByteArray): String =
    "sha256:" + MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

  private fun factsFields(facts: RelayReceiptFacts): List<Field> =
    when (facts) {
      is NotFoundReceiptFacts -> listOf(field("facts.lookupOutcome", facts.lookupOutcome))
      is UnavailableReceiptFacts ->
        listOf(
          field("facts.lookupOutcome", facts.lookupOutcome),
          field("facts.uncertainty", facts.uncertainty),
        )
      is FoundReceiptFacts ->
        listOf(
          field("facts.lookupOutcome", facts.lookupOutcome),
          field("facts.evidenceSource", facts.evidenceSource),
          field("facts.providerIdentity", facts.providerIdentity),
          field("facts.providerFinalStatus", facts.providerFinalStatus),
          field("facts.canonicalReferencePresent", facts.canonicalReferencePresent),
          field("facts.referenceMatch", facts.referenceMatch),
          field("facts.amountMinor", facts.amountMinor),
          field("facts.currencyCode", facts.currencyCode),
          field("facts.receiverMatch", facts.receiverMatch),
          field("facts.maskedReceiverDiagnostic", facts.maskedReceiverDiagnostic),
          field("facts.paymentMode", facts.paymentMode),
          field("facts.paymentReason", facts.paymentReason),
          field("facts.paymentChannel", facts.paymentChannel),
          field("facts.occurredAt", facts.occurredAt),
          field("facts.retrievedAt", facts.retrievedAt),
        )
    }

  private fun observationFields(body: RelayObservationBody): List<Field> =
    listOf(
      field("contractVersion", body.contractVersion.toLong()),
      field("providerCode", body.providerCode),
      field("protocolMode", body.protocolMode),
      field("requestId", body.requestId),
      field("jobId", body.jobId),
      field("attemptNumber", body.attemptNumber.toLong()),
      field("leaseId", body.leaseId),
      field("deviceId", body.deviceId),
      field("keyId", body.keyId),
      field("leaseNonceDigest", body.leaseNonceDigest),
      field("challengeId", body.challengeId),
      field("challengeDigest", body.challengeDigest),
      field("referenceFingerprint", body.referenceFingerprint),
      field("sourceProfile", body.sourceProfile),
      field("receiverProfileId", body.receiverProfileId),
      field("receiverProfileDigest", body.receiverProfileDigest),
      field("adapterVersion", body.adapterVersion),
      field("parserVersion", body.parserVersion),
      field("normalizerVersion", body.normalizerVersion),
      field("sourceDocumentDigest", body.sourceDocumentDigest),
      field("normalizedFactsDigest", body.normalizedFactsDigest),
      field("observedAt", body.observedAt),
    ) + factsFields(body.facts)

  private fun encodeCanonicalFields(domain: String, fields: List<Field>): ByteArray {
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

  private fun field(name: String, value: Long?): Field =
    Field(name, value?.let(Scalar::Number) ?: Scalar.NullValue)

  private fun field(name: String, value: Boolean): Field = Field(name, Scalar.BooleanValue(value))

  private fun ByteArray.toHex(): String = joinToString(separator = "") { "%02x".format(it) }
}
