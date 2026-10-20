package com.fetanagent.telebirrverifier

import android.content.Intent
import android.provider.Telephony
import java.nio.charset.StandardCharsets

/** Reads only incoming payment-like SMS broadcasts. No sender label is consulted. */
internal object ReceiverPaymentSmsInbox {
  sealed interface Read {
    data object Irrelevant : Read
    class Review(val reasonCode: String) : Read
    class Relevant(val message: ReceiverSmsSignedObservation.Message) : Read
  }

  fun isPaymentLike(body: String): Boolean {
    val text = body.lowercase()
    return (text.contains("telebirr") && text.contains("received") &&
      text.contains("transaction")) ||
      (text.contains("cbe birr") && text.contains("received") &&
        text.contains("txn"))
  }

  fun read(intent: Intent, nowMillis: Long = System.currentTimeMillis()): Read {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return Read.Irrelevant
    val segments = try { Telephony.Sms.Intents.getMessagesFromIntent(intent).toList() }
      catch (_: Exception) { return Read.Review("sms_broadcast_unavailable") }
    if (segments.isEmpty() || segments.size > 12) return Read.Review("sms_broadcast_uncertain")
    val body = try { segments.joinToString("") { it.messageBody ?: "" } }
      catch (_: Exception) { return Read.Review("sms_broadcast_uncertain") }
    if (!isPaymentLike(body)) return Read.Irrelevant
    if (body.toByteArray(StandardCharsets.UTF_8).size !in 40..2_048 ||
      body.any { it == '\u0000' || it.code in 0x0001..0x0008 ||
        it.code in 0x000e..0x001f || it.code in 0x007f..0x009f })
      return Read.Review("sms_format_uncertain")
    val carrierTime = segments.minOf { it.timestampMillis }
    if (segments.any { kotlin.math.abs(it.timestampMillis - carrierTime) > 5 * 60_000 })
      return Read.Review("sms_multipart_uncertain")
    if (carrierTime > nowMillis + 5 * 60_000 ||
      carrierTime < nowMillis - 30L * 24 * 60 * 60_000)
      return Read.Review("sms_clock_uncertain")
    val subscriptionId = intent.getIntExtra("subscription", -1)
    if (subscriptionId < -1)
      return Read.Review("sms_subscription_uncertain")
    // SmsMessage.timestampMillis is the carrier timestamp, not proof of when this
    // device received the broadcast. Bind the receipt to the local inbox time.
    return Read.Relevant(ReceiverSmsSignedObservation.Message(subscriptionId, nowMillis, body))
  }
}
