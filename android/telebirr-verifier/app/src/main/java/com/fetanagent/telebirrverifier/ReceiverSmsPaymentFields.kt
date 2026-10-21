package com.fetanagent.telebirrverifier

import java.time.DateTimeException
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatterBuilder

/** Minimum field extraction for a receiver payment SMS. No receipt, link, or sender lookup. */
internal object ReceiverSmsPaymentFields {
  class Payment(
    val providerCode: String,
    val reference: String,
    val amountMinor: Long,
    val occurredAt: String,
  ) {
    override fun toString(): String = "ReceiverSmsPaymentFields.Payment(<redacted>)"
  }

  sealed interface Result {
    class Found(val payment: Payment) : Result
    class Review(val reasonCode: String) : Result
  }

  private val telebirrReference =
    Regex("\\btransaction number is\\s+([A-Z0-9]{8,32})(?=[^A-Z0-9]|$)", RegexOption.IGNORE_CASE)
  private val cbeReference =
    Regex("\\bTxn ID\\s+([A-Z0-9]{8,32})(?=[^A-Z0-9]|$)", RegexOption.IGNORE_CASE)
  private val telebirrAmount =
    Regex("\\byou have received ETB\\s+([0-9]{1,3}(?:,[0-9]{3})*|[0-9]{1,8})\\.([0-9]{2})\\b",
      RegexOption.IGNORE_CASE)
  private val cbeAmount =
    Regex("\\byou received\\s+([0-9]{1,3}(?:,[0-9]{3})*|[0-9]{1,8})\\.([0-9]{2})Br\\b",
      RegexOption.IGNORE_CASE)
  private val telebirrTime =
    Regex("\\bon\\s+([0-9]{2})/([0-9]{2})/([0-9]{4})\\s+([0-9]{2}):([0-9]{2}):([0-9]{2})\\.\\s+Your transaction number is\\b",
      RegexOption.IGNORE_CASE)
  private val cbeTime =
    Regex("\\bon\\s+([0-9]{2})/([0-9]{2})/([0-9]{2})\\s+([0-9]{2}):([0-9]{2}),\\s*Txn ID\\b",
      RegexOption.IGNORE_CASE)

  fun extract(body: String, receivedAtMillis: Long): Result {
    if (body.toByteArray(Charsets.UTF_8).size !in 40..2_048 || receivedAtMillis <= 0)
      return Result.Review("sms_fields_unreadable")
    val telebirr = body.contains("telebirr", ignoreCase = true)
    val cbe = body.contains("CBE Birr", ignoreCase = true)
    if (telebirr == cbe) return Result.Review("sms_method_ambiguous")
    val providerCode = if (telebirr) "telebirr" else "cbe_birr"
    val referenceMatch = single(if (telebirr) telebirrReference else cbeReference, body)
    val amountMatch = single(if (telebirr) telebirrAmount else cbeAmount, body)
    val timeMatch = single(if (telebirr) telebirrTime else cbeTime, body)
    if (referenceMatch == null || amountMatch == null || timeMatch == null)
      return Result.Review("sms_fields_unreadable")
    val reference = referenceMatch.groupValues[1].uppercase()
    val major = amountMatch.groupValues[1].replace(",", "").toLongOrNull()
      ?: return Result.Review("sms_fields_unreadable")
    val minor = amountMatch.groupValues[2].toLongOrNull()
      ?: return Result.Review("sms_fields_unreadable")
    if (major !in 0..99_999_999L || minor !in 0..99L)
      return Result.Review("sms_fields_unreadable")
    val amountMinor = major * 100 + minor
    if (amountMinor <= 0) return Result.Review("sms_fields_unreadable")
    val occurredAt = try {
      val parts = timeMatch.groupValues
      val year = if (telebirr) parts[3].toInt() else 2000 + parts[3].toInt()
      val second = if (telebirr) parts[6].toInt() else 0
      LocalDateTime.of(year, parts[2].toInt(), parts[1].toInt(),
        parts[4].toInt(), parts[5].toInt(), second)
        .toInstant(ZoneOffset.ofHours(3))
    } catch (_: DateTimeException) {
      return Result.Review("sms_time_uncertain")
    } catch (_: NumberFormatException) {
      return Result.Review("sms_time_uncertain")
    }
    if (occurredAt.toEpochMilli() > receivedAtMillis + 5 * 60_000L ||
      occurredAt.toEpochMilli() < receivedAtMillis - 30L * 24 * 60 * 60_000L)
      return Result.Review("sms_time_uncertain")
    return Result.Found(Payment(providerCode, reference, amountMinor,
      DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(occurredAt)))
  }

  private fun single(pattern: Regex, body: String): MatchResult? {
    val matches = pattern.findAll(body).take(2).toList()
    return matches.singleOrNull()
  }
}
