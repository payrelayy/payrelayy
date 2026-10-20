package com.fetanagent.telebirrverifier

import java.math.BigDecimal
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import java.util.Locale

/**
 * Parses a receiver-account SMS on the configured subscription. The parser never treats a
 * missing, changed, or ambiguous SMS as evidence that a customer payment is invalid. No raw
 * message, payer, or receiver is retained in the parsed result.
 */
internal class ReceiverPaymentSmsParser {
  internal enum class Provider { TELEBIRR, CBE_BIRR }

  internal class Source(
    val provider: Provider,
    val subscriptionId: Int,
    val expectedReceiverName: String,
    val expectedReceiverPhone: String? = null,
  ) {
    init {
      require(subscriptionId >= 0)
      require(LivePilotNameNormalizer.normalize(expectedReceiverName) != null)
      require(provider != Provider.CBE_BIRR ||
        expectedReceiverPhone?.matches(Regex("^251[0-9]{9}$")) == true)
      require(provider != Provider.TELEBIRR || expectedReceiverPhone == null)
    }

    override fun toString(): String = "ReceiverPaymentSmsParser.Source(<redacted>)"
  }

  internal class Message(
    val subscriptionId: Int,
    val receivedAtMillis: Long,
    val body: String,
  ) {
    override fun toString(): String = "ReceiverPaymentSmsParser.Message(<redacted>)"
  }

  internal sealed interface Result {
    data object NoMatch : Result
    class Review(val reasonCode: String) : Result {
      override fun toString(): String = "ReceiverPaymentSmsParser.Review($reasonCode)"
    }
    class Match(
      val provider: Provider,
      val subscriptionId: Int,
      val reference: String,
      val amountMinor: Long,
      val occurredAt: Instant,
      val receivedAt: Instant,
      val messageDigest: String,
    ) : Result {
      override fun toString(): String = "ReceiverPaymentSmsParser.Match(<redacted>)"
    }
  }

  fun parse(message: Message, source: Source, expectedReference: String): Result {
    if (message.subscriptionId != source.subscriptionId) return Result.NoMatch
    if (!expectedReference.matches(REFERENCE)) return Result.Review("invalid_assignment")
    val body = message.body.trim()
    if (body.toByteArray(StandardCharsets.UTF_8).size !in 40..2_048 ||
      body.any { it == '\u0000' || it.code in 0x0001..0x0008 ||
        it.code in 0x000e..0x001f || it.code in 0x007f..0x009f }) {
      return Result.Review("sms_format_uncertain")
    }
    val match = when (source.provider) {
      Provider.TELEBIRR -> TELEBIRR_MESSAGE.matchEntire(body)
      Provider.CBE_BIRR -> CBE_MESSAGE.matchEntire(body)
    } ?: return Result.Review("sms_format_uncertain")
    val reference = match.groups["reference"]?.value
      ?: return Result.Review("sms_format_uncertain")
    if (reference != expectedReference) return Result.NoMatch
    val receiver = match.groups["receiver"]?.value
      ?: return Result.Review("sms_format_uncertain")
    if (LivePilotNameNormalizer.normalize(receiver) !=
      LivePilotNameNormalizer.normalize(source.expectedReceiverName)) {
      return Result.Review("sms_receiver_uncertain")
    }
    if (source.provider == Provider.CBE_BIRR &&
      (match.groups["invoiceReference"]?.value != reference ||
        match.groups["invoicePhone"]?.value != source.expectedReceiverPhone)) {
      return Result.Review("sms_receiver_uncertain")
    }
    val amount = try {
      BigDecimal(requireNotNull(match.groups["amount"]?.value).replace(",", ""))
        .movePointRight(2).longValueExact()
    } catch (_: Exception) { return Result.Review("sms_format_uncertain") }
    if (amount <= 0 || amount > 9_007_199_254_740_991L)
      return Result.Review("sms_format_uncertain")
    val occurredAt = try {
      val raw = requireNotNull(match.groups["occurred"]?.value)
      val format = if (source.provider == Provider.TELEBIRR) TELEBIRR_DATE else CBE_DATE
      LocalDateTime.parse(raw, format).atZone(ADDIS_ABABA).toInstant()
    } catch (_: Exception) { return Result.Review("sms_format_uncertain") }
    val receivedAt = try { Instant.ofEpochMilli(message.receivedAtMillis) }
      catch (_: Exception) { return Result.Review("sms_format_uncertain") }
    if (occurredAt > receivedAt.plusSeconds(5 * 60))
      return Result.Review("sms_time_uncertain")
    val digest = "sha256:" + MessageDigest.getInstance("SHA-256")
      .digest(body.toByteArray(StandardCharsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
    return Result.Match(source.provider, source.subscriptionId, reference, amount,
      occurredAt, receivedAt, digest)
  }

  private companion object {
    val REFERENCE = Regex("^[A-Z0-9]{8,32}$")
    val ADDIS_ABABA: ZoneId = ZoneId.of("Africa/Addis_Ababa")
    val TELEBIRR_DATE: DateTimeFormatter = DateTimeFormatter
      .ofPattern("dd/MM/uuuu HH:mm:ss", Locale.ROOT).withResolverStyle(ResolverStyle.STRICT)
    val CBE_DATE: DateTimeFormatter = DateTimeFormatter
      .ofPattern("dd/MM/uu HH:mm", Locale.ROOT).withResolverStyle(ResolverStyle.STRICT)
    val TELEBIRR_MESSAGE = Regex(
      "^Dear (?<receiver>[^,\\r\\n]{2,160}),?\\s+You have received ETB " +
        "(?<amount>(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\\.[0-9]{2}) " +
        "from [^\\r\\n]{2,160} on (?<occurred>[0-9]{2}/[0-9]{2}/[0-9]{4} " +
        "[0-9]{2}:[0-9]{2}:[0-9]{2})\\. Your transaction number is " +
        "(?<reference>[A-Z0-9]{8,32})\\. Your current E-Money Account balance is ETB " +
        "(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\\.[0-9]{2}\\. " +
        "Thank you for using telebirr\\s+Ethio telecom$",
      RegexOption.IGNORE_CASE,
    )
    val CBE_MESSAGE = Regex(
      "^Dear (?<receiver>[^,\\r\\n]{2,160}), you received " +
        "(?<amount>(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\\.[0-9]{2})Br\\. " +
        "from 251[0-9]{9} - [^\\r\\n]{2,160} on " +
        "(?<occurred>[0-9]{2}/[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2})," +
        "Txn ID (?<reference>[A-Z0-9]{8,32})\\.Your CBE Birr account balance is " +
        "(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\\.[0-9]{2}Br\\. Thank you! " +
        "For invoice https://cbepay1\\.cbe\\.com\\.et/aureceipt\\?TID=" +
        "(?<invoiceReference>[A-Z0-9]{8,32})&PH=(?<invoicePhone>251[0-9]{9})$",
      RegexOption.IGNORE_CASE,
    )
  }
}
