package com.fetanagent.telebirrverifier

import com.google.gson.stream.JsonWriter
import java.io.StringWriter
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import java.util.Base64

/** A signed service-health report. It contains no SMS body, reference, or payment details. */
internal class ReceiverSmsStatusHeartbeat(
  private val deviceId: String,
  private val identity: P256Identity,
  private val exchange: DeviceBridgeExchange,
  private val now: () -> Instant = Instant::now,
) {
  fun send(status: LivePilotRuntimeStatus): DeviceBridgeHeartbeatResult {
    val state = if (status.state == LivePilotRuntimeState.READY &&
      status.code in setOf("sms_inbox_idle", "sms_event_recorded")) "ready" else "attention"
    val observedAt = DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(now())
    val keyId = identity.publicMaterial().keyId
    val digest = digest(transcript("fetanagent:receiver-sms-status-body:v1",
      listOf(1, "receiver_sms_status_v1", deviceId, keyId, state, observedAt)))
    val signature = Base64.getUrlEncoder().withoutPadding().encodeToString(
      identity.signP1363(transcript("fetanagent:receiver-sms-status-signature:v1",
        listOf(digest))))
    val body = StrictJson.encode(obj(
      "publicKeySpki" to text(identity.publicMaterial().publicKeySpkiBase64Url),
      "signedStatus" to obj(
        "contractVersion" to number(1L),
        "protocolMode" to text("receiver_sms_status_v1"),
        "bodyDigest" to text(digest),
        "body" to obj(
          "contractVersion" to number(1L),
          "protocolMode" to text("receiver_sms_status_v1"),
          "deviceId" to text(deviceId),
          "keyId" to text(keyId),
          "state" to text(state),
          "observedAt" to text(observedAt),
        ),
        "signature" to text(signature),
      ),
    )).toByteArray(StandardCharsets.UTF_8)
    return try {
      val response = exchange.post(ReceiverSmsBridgeProtocol.STATUS_PATH,
        ReceiverSmsBridgeProtocol.STATUS_CONTENT_TYPE, body)
      when (response.statusCode) {
        202 -> {
          val accepted = StrictJson.parse(response.body).requireObject(setOf("outcome",
            "advisoryOnly", "financialActionAllowed"))
          if (accepted.string("outcome") == "receiver_sms_status_recorded" &&
            accepted.boolean("advisoryOnly") && !accepted.boolean("financialActionAllowed"))
            DeviceBridgeHeartbeatResult.Acknowledged else DeviceBridgeHeartbeatResult.Retryable
        }
        401 -> DeviceBridgeHeartbeatResult.EnrollmentRejected
        else -> DeviceBridgeHeartbeatResult.Retryable
      }
    } catch (_: Exception) { DeviceBridgeHeartbeatResult.Retryable }
  }

  private fun digest(bytes: ByteArray): String = "sha256:" +
    MessageDigest.getInstance("SHA-256").digest(bytes)
      .joinToString("") { "%02x".format(it) }

  private fun transcript(domain: String, values: List<Any>): ByteArray {
    val output = StringWriter()
    JsonWriter(output).use { writer ->
      writer.setHtmlSafe(false)
      writer.beginArray()
      writer.value(domain)
      for (value in values) when (value) {
        is String -> writer.value(value)
        is Int -> writer.value(value)
        else -> error("Unsupported SMS status value")
      }
      writer.endArray()
    }
    return output.toString().toByteArray(StandardCharsets.UTF_8)
  }
}
