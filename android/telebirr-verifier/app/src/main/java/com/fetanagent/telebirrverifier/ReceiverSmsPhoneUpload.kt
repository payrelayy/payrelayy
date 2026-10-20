package com.fetanagent.telebirrverifier

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.nio.charset.StandardCharsets
import java.time.Instant

internal object ReceiverSmsBridgeProtocol {
  const val PATH = "/v1/receiver-sms/events:upload"
  const val CONTENT_TYPE = "application/vnd.fetanagent.receiver-sms-event.v1+json"
  const val MAX_REQUEST_BYTES = 8 * 1_024
  const val MAX_RESPONSE_BYTES = 4 * 1_024
}

/** Only the signed structured payment fields leave the phone. */
internal object ReceiverSmsUploadCodec {
  fun encode(envelope: ReceiverSmsSignedObservation.Envelope, publicKeySpki: String): ByteArray {
    val body = envelope.body
    val encoded = StrictJson.encode(obj(
      "publicKeySpki" to text(publicKeySpki),
      "signedEvent" to obj(
        "contractVersion" to number(envelope.contractVersion.toLong()),
        "protocolMode" to text(envelope.protocolMode),
        "bodyDigest" to text(envelope.bodyDigest),
        "body" to obj(
          "contractVersion" to number(body.contractVersion.toLong()),
          "protocolMode" to text(body.protocolMode),
          "deviceId" to text(body.deviceId),
          "keyId" to text(body.keyId),
          "sourceSubscriptionId" to number(body.sourceSubscriptionId.toLong()),
          "sourceMessageDigest" to text(body.sourceMessageDigest),
          "providerCode" to text(body.providerCode),
          "transactionReference" to text(body.transactionReference),
          "amountMinor" to number(body.amountMinor),
          "occurredAt" to text(body.occurredAt),
          "receivedAt" to text(body.receivedAt),
          "observedAt" to text(body.observedAt),
        ),
        "signature" to text(envelope.signature),
      ),
    )).toByteArray(StandardCharsets.UTF_8)
    require(encoded.size in 1..ReceiverSmsBridgeProtocol.MAX_REQUEST_BYTES)
    return encoded
  }
}

internal class FixedReceiverSmsHttpsExchange(
  private val executor: DeviceBridgeHttpsExecutor = PlatformDeviceBridgeHttpsExecutor,
) : DeviceBridgeExchange {
  override fun post(path: String, contentType: String, body: ByteArray): DeviceBridgeRawResponse {
    require(path == ReceiverSmsBridgeProtocol.PATH &&
      contentType == ReceiverSmsBridgeProtocol.CONTENT_TYPE &&
      body.size in 1..ReceiverSmsBridgeProtocol.MAX_REQUEST_BYTES)
    val url = URI("https", null, FixedDeviceBridgeHttpsExchange.ORIGIN_HOST, 443,
      path, null, null).toURL()
    val response = try {
      executor.execute(url, FixedDeviceBridgeHttpsExchange.PRODUCTION_DEPLOYMENT_TARGET,
        contentType, body,
        FixedDeviceBridgeHttpsExchange.CONNECT_TIMEOUT_MILLIS,
        FixedDeviceBridgeHttpsExchange.READ_TIMEOUT_MILLIS,
        ReceiverSmsBridgeProtocol.MAX_RESPONSE_BYTES)
    } catch (_: IOException) { throw DeviceBridgeRetryableException() }
      catch (_: SecurityException) { throw DeviceBridgeRetryableException() }
    if (response.statusCode !in 100..599 || response.statusCode in 300..399 ||
      response.contentTypes.singleOrNull() != contentType ||
      response.contentEncodings.any { !it.equals("identity", ignoreCase = true) } ||
      response.contentEncodings.size > 1 ||
      response.body.size > ReceiverSmsBridgeProtocol.MAX_RESPONSE_BYTES)
      throw DeviceBridgeRetryableException()
    return DeviceBridgeRawResponse(response.statusCode, contentType, response.body.copyOf())
  }
}

internal sealed interface ReceiverSmsUploadResult {
  data object Empty : ReceiverSmsUploadResult
  data object Recorded : ReceiverSmsUploadResult
  data object Retry : ReceiverSmsUploadResult
  class Review(val reasonCode: String) : ReceiverSmsUploadResult
}

/** Bounded one-message cycle; a network error never drops a queued payment SMS. */
internal class ReceiverSmsPhoneUpload(
  private val outbox: ReceiverSmsEncryptedOutbox,
  private val exchange: DeviceBridgeExchange,
  private val now: () -> Instant = Instant::now,
) {
  fun run(deviceId: String, identity: P256Identity): ReceiverSmsUploadResult {
    val pending = try { outbox.nextPending() } catch (_: Exception) {
      return ReceiverSmsUploadResult.Review("sms_queue_unavailable")
    } ?: return ReceiverSmsUploadResult.Empty
    val fields = ReceiverSmsPaymentFields.extract(pending.message.body,
      pending.message.receivedAtMillis)
    if (fields !is ReceiverSmsPaymentFields.Result.Found) {
      try { outbox.archiveForReview(pending.key) } catch (_: Exception) {
        return ReceiverSmsUploadResult.Review("sms_queue_unavailable")
      }
      return ReceiverSmsUploadResult.Review("sms_fields_unreadable")
    }
    val bytes = try {
      val envelope = ReceiverSmsSignedObservation.create(deviceId, pending.message,
        identity, now())
      ReceiverSmsUploadCodec.encode(envelope, identity.publicMaterial().publicKeySpkiBase64Url)
    } catch (_: Exception) { return ReceiverSmsUploadResult.Review("sms_signing_unavailable") }
    val response = try {
      exchange.post(ReceiverSmsBridgeProtocol.PATH, ReceiverSmsBridgeProtocol.CONTENT_TYPE, bytes)
    } catch (_: Exception) { return ReceiverSmsUploadResult.Retry }
    if (response.contentType == ReceiverSmsBridgeProtocol.CONTENT_TYPE &&
      response.statusCode == HttpURLConnection.HTTP_CONFLICT) {
      return try {
        outbox.archiveForReview(pending.key)
        ReceiverSmsUploadResult.Review("sms_payment_conflict")
      } catch (_: Exception) { ReceiverSmsUploadResult.Review("sms_queue_unavailable") }
    }
    if (response.contentType != ReceiverSmsBridgeProtocol.CONTENT_TYPE ||
      response.statusCode != HttpURLConnection.HTTP_ACCEPTED)
      return if (response.statusCode in 400..499)
        ReceiverSmsUploadResult.Review("sms_server_review") else ReceiverSmsUploadResult.Retry
    val accepted = try {
      val frame = StrictJson.parse(response.body).requireObject(setOf("outcome",
        "advisoryOnly", "pairedPhoneEvidenceVerified", "sourceAuthenticationPerformed",
        "financialActionAllowed"))
      frame.string("outcome") == "receiver_sms_recorded" &&
        frame.boolean("advisoryOnly") && frame.boolean("pairedPhoneEvidenceVerified") &&
        !frame.boolean("sourceAuthenticationPerformed") &&
        !frame.boolean("financialActionAllowed")
    } catch (_: Exception) { false }
    if (!accepted) return ReceiverSmsUploadResult.Review("sms_server_review")
    try { outbox.acknowledge(pending.key) } catch (_: Exception) {
      return ReceiverSmsUploadResult.Review("sms_queue_unavailable")
    }
    return ReceiverSmsUploadResult.Recorded
  }
}
