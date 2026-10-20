package com.fetanagent.telebirrverifier

import com.google.gson.stream.JsonWriter
import java.io.StringWriter
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import java.util.Base64

/** A separate protocol from the existing official-receipt observation. */
internal object ReceiverSmsSignedObservation {
  const val PROTOCOL_MODE = "direct_receiver_sms_v1"
  const val SOURCE_PROFILE = "direct_receiver_sms_v1"
  private const val BODY_DOMAIN = "fetanagent:receiver-sms-observation-body:v1"
  private const val SIGNATURE_DOMAIN = "fetanagent:receiver-sms-observation-signature:v1"

  internal class Binding(
    val providerCode: String,
    val candidateId: String,
    val rawReference: String,
    val referenceFingerprint: String,
    val receiverRevisionId: String,
    val receiverVersion: Int,
    val receiverProfileDigest: String,
    val expectedReceiverNameDigest: String,
    val deviceId: String,
    val keyId: String,
    val challengeId: String,
    val challengeDigest: String,
    val sourceSubscriptionId: Int,
  ) {
    override fun toString(): String = "ReceiverSmsSignedObservation.Binding(<redacted>)"
  }

  internal class Body(
    val contractVersion: Int,
    val protocolMode: String,
    val sourceProfile: String,
    val providerCode: String,
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
    val sourceSubscriptionId: Int,
    val sourceMessageDigest: String,
    val amountMinor: Long,
    val currencyCode: String,
    val occurredAt: String,
    val receivedAt: String,
    val observedAt: String,
  ) {
    override fun toString(): String = "ReceiverSmsSignedObservation.Body(<redacted>)"
  }

  internal class Envelope(
    val contractVersion: Int,
    val protocolMode: String,
    val bodyDigest: String,
    val body: Body,
    val signature: String,
  ) {
    override fun toString(): String = "ReceiverSmsSignedObservation.Envelope(<redacted>)"
  }

  fun create(
    binding: Binding,
    match: ReceiverPaymentSmsParser.Result.Match,
    identity: P256Identity,
    observedAt: Instant,
  ): Envelope {
    require(binding.providerCode in setOf("telebirr", "cbe_birr"))
    require(binding.providerCode == when (match.provider) {
      ReceiverPaymentSmsParser.Provider.TELEBIRR -> "telebirr"
      ReceiverPaymentSmsParser.Provider.CBE_BIRR -> "cbe_birr"
    })
    require(binding.rawReference == match.reference &&
      binding.sourceSubscriptionId == match.subscriptionId)
    require(identity.publicMaterial().keyId == binding.keyId && identity.keyId == binding.keyId)
    require(match.amountMinor in 1..9_007_199_254_740_991L)
    require(match.occurredAt <= match.receivedAt.plusSeconds(5 * 60) &&
      match.receivedAt <= observedAt.plusSeconds(5 * 60))
    val utc = DateTimeFormatterBuilder().appendInstant(3).toFormatter()
    val body = Body(1, PROTOCOL_MODE, SOURCE_PROFILE, binding.providerCode,
      binding.candidateId, binding.referenceFingerprint, binding.receiverRevisionId,
      binding.receiverVersion, binding.receiverProfileDigest,
      binding.expectedReceiverNameDigest, binding.deviceId, binding.keyId,
      binding.challengeId, binding.challengeDigest, binding.sourceSubscriptionId,
      match.messageDigest, match.amountMinor, "ETB", utc.format(match.occurredAt),
      utc.format(match.receivedAt), utc.format(observedAt))
    val digest = digest(bodyBytes(body))
    val signature = identity.signP1363(signatureBytes(digest))
    require(signature.size == 64)
    return Envelope(1, PROTOCOL_MODE, digest, body,
      Base64.getUrlEncoder().withoutPadding().encodeToString(signature))
  }

  fun bodyBytes(body: Body): ByteArray = jsonArray(BODY_DOMAIN, listOf(
    body.contractVersion, body.protocolMode, body.sourceProfile, body.providerCode,
    body.candidateId, body.referenceFingerprint, body.receiverRevisionId,
    body.receiverVersion, body.receiverProfileDigest, body.expectedReceiverNameDigest,
    body.deviceId, body.keyId, body.challengeId, body.challengeDigest,
    body.sourceSubscriptionId, body.sourceMessageDigest, body.amountMinor,
    body.currencyCode, body.occurredAt, body.receivedAt, body.observedAt,
  ))

  fun signatureBytes(bodyDigest: String): ByteArray =
    jsonArray(SIGNATURE_DOMAIN, listOf(bodyDigest))

  private fun digest(bytes: ByteArray): String = "sha256:" +
    MessageDigest.getInstance("SHA-256").digest(bytes)
      .joinToString("") { "%02x".format(it) }

  private fun jsonArray(domain: String, values: List<Any>): ByteArray {
    val output = StringWriter()
    JsonWriter(output).use { writer ->
      writer.setHtmlSafe(false)
      writer.beginArray()
      writer.value(domain)
      for (value in values) when (value) {
        is String -> writer.value(value)
        is Int -> writer.value(value)
        is Long -> writer.value(value)
        else -> error("Unsupported SMS observation transcript value")
      }
      writer.endArray()
    }
    return output.toString().toByteArray(StandardCharsets.UTF_8)
  }
}
