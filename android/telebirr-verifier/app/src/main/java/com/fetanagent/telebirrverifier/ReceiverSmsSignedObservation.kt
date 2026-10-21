package com.fetanagent.telebirrverifier

import com.google.gson.stream.JsonWriter
import java.io.StringWriter
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import java.util.Base64

/** Signs an incoming SMS before a customer submits any reference. No receipt lookup occurs. */
internal object ReceiverSmsSignedObservation {
  const val PROTOCOL_MODE = "direct_receiver_sms_event_v1"
  private const val BODY_DOMAIN = "fetanagent:receiver-sms-event-body:v1"
  private const val SIGNATURE_DOMAIN = "fetanagent:receiver-sms-event-signature:v1"

  internal class Message(
    val subscriptionId: Int,
    val receivedAtMillis: Long,
    val body: String,
  ) {
    override fun toString(): String = "ReceiverSmsSignedObservation.Message(<redacted>)"
  }

  internal class Body(
    val contractVersion: Int,
    val protocolMode: String,
    val deviceId: String,
    val keyId: String,
    val sourceSubscriptionId: Int,
    val sourceMessageDigest: String,
    val providerCode: String,
    val transactionReference: String,
    val amountMinor: Long,
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
    deviceId: String,
    message: Message,
    identity: P256Identity,
    observedAt: Instant,
  ): Envelope {
    val keyId = identity.publicMaterial().keyId
    require(identity.keyId == keyId)
    require(deviceId.matches(Regex("^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")))
    require(message.subscriptionId >= -1)
    require(message.body.toByteArray(StandardCharsets.UTF_8).size in 40..2_048)
    val receivedAt = Instant.ofEpochMilli(message.receivedAtMillis)
    require(receivedAt <= observedAt.plusSeconds(5 * 60))
    require(receivedAt >= observedAt.minusSeconds(30L * 24 * 60 * 60))
    val payment = (ReceiverSmsPaymentFields.extract(message.body, message.receivedAtMillis)
      as? ReceiverSmsPaymentFields.Result.Found)?.payment
      ?: throw IllegalArgumentException("Receiver SMS payment fields require review")
    val utc = DateTimeFormatterBuilder().appendInstant(3).toFormatter()
    val body = Body(1, PROTOCOL_MODE, deviceId, keyId, message.subscriptionId,
      digest(message.body.toByteArray(StandardCharsets.UTF_8)),
      payment.providerCode, payment.reference, payment.amountMinor, payment.occurredAt,
      utc.format(receivedAt), utc.format(observedAt))
    val bodyDigest = digest(bodyBytes(body))
    val signature = identity.signP1363(signatureBytes(bodyDigest))
    require(signature.size == 64)
    return Envelope(1, PROTOCOL_MODE, bodyDigest, body,
      Base64.getUrlEncoder().withoutPadding().encodeToString(signature))
  }

  fun bodyBytes(body: Body): ByteArray = jsonArray(BODY_DOMAIN, listOf(
    body.contractVersion, body.protocolMode, body.deviceId, body.keyId,
    body.sourceSubscriptionId, body.sourceMessageDigest, body.providerCode,
    body.transactionReference, body.amountMinor, body.occurredAt, body.receivedAt,
    body.observedAt,
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
        else -> error("Unsupported SMS event transcript value")
      }
      writer.endArray()
    }
    return output.toString().toByteArray(StandardCharsets.UTF_8)
  }
}
