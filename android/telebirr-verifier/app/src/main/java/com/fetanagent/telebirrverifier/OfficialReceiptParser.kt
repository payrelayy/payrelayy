package com.fetanagent.telebirrverifier

import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import java.util.Locale

data class ParsedProviderObservation(
  val facts: RelayReceiptFacts,
  val sourceDocumentDigest: String,
) {
  override fun toString(): String =
    "ParsedProviderObservation(lookupOutcome=${facts.lookupOutcome},sourceDocumentDigest=<redacted>)"
}

class OfficialReceiptParser {
  fun parse(document: ProviderDocument, expectedReference: CanonicalReference): ParsedProviderObservation =
    when (document) {
      is ProviderDocument.NotFound ->
        ParsedProviderObservation(NotFoundReceiptFacts("not_found"), document.sourceDocumentDigest)
      is ProviderDocument.Unavailable ->
        ParsedProviderObservation(
          UnavailableReceiptFacts("unavailable", document.uncertainty),
          document.sourceDocumentDigest,
        )
      is ProviderDocument.Found ->
        runCatching { parseFound(document, expectedReference) }
          .getOrElse { unavailable(document.sourceDocumentDigest) }
    }

  private fun parseFound(
    document: ProviderDocument.Found,
    expectedReference: CanonicalReference,
  ): ParsedProviderObservation {
    val rows = parseRows(document.utf8Body) ?: return unavailable(document.sourceDocumentDigest)
    if (!visibleText(document.utf8Body).contains("Ethio telecom Share Company", ignoreCase = true)) {
      return unavailable(document.sourceDocumentDigest)
    }
    val invoiceNumber = unique(rows, "invoice no") ?: return unavailable(document.sourceDocumentDigest)
    val status = unique(rows, "transaction status") ?: return unavailable(document.sourceDocumentDigest)
    val amount = unique(rows, "settled amount") ?: return unavailable(document.sourceDocumentDigest)
    val paymentDate = unique(rows, "payment date") ?: return unavailable(document.sourceDocumentDigest)
    val receiverName = unique(rows, "credited party name") ?: return unavailable(document.sourceDocumentDigest)
    val paymentMode = unique(rows, "payment mode") ?: return unavailable(document.sourceDocumentDigest)
    val paymentReason = unique(rows, "payment reason") ?: return unavailable(document.sourceDocumentDigest)
    val paymentChannel = unique(rows, "payment channel") ?: return unavailable(document.sourceDocumentDigest)

    if (!Regex("^[A-Z0-9]{8,64}$").matches(invoiceNumber)) return unavailable(document.sourceDocumentDigest)
    if (receiverName.length !in 2..160 || receiverName.any { it.isISOControl() }) {
      return unavailable(document.sourceDocumentDigest)
    }
    val amountMinor = parseMinorUnits(amount) ?: return unavailable(document.sourceDocumentDigest)
    val occurredAt = parseOccurredAt(paymentDate) ?: return unavailable(document.sourceDocumentDigest)
    val referenceMatch = expectedReference.use { if (invoiceNumber == it) "matched" else "mismatched" }

    val facts =
      FoundReceiptFacts(
        lookupOutcome = "found",
        evidenceSource = "provider_receipt_lookup",
        providerIdentity = "matched",
        providerFinalStatus = strictStatus(status),
        canonicalReferencePresent = true,
        referenceMatch = referenceMatch,
        amountMinor = amountMinor,
        currencyCode = "ETB",
        receiverMatch = "unknown",
        maskedReceiverDiagnostic = "unknown",
        paymentMode = strictPaymentMode(paymentMode),
        paymentReason = strictPaymentReason(paymentReason),
        paymentChannel = strictPaymentChannel(paymentChannel),
        occurredAt = occurredAt,
        retrievedAt = document.retrievedAt,
      )
    return ParsedProviderObservation(facts, document.sourceDocumentDigest)
  }

  private fun parseRows(html: String): Map<String, List<String>>? {
    if (html.length > MAX_HTML_CHARACTERS || html.indexOf('\u0000') >= 0) return null
    val rows = linkedMapOf<String, MutableList<String>>()
    for (match in rowPattern.findAll(html)) {
      val cells = cellPattern.findAll(match.groupValues[1]).map { visibleText(it.groupValues[1]) }.toList()
      if (cells.size != 2) continue
      val label = canonicalLabel(cells[0]) ?: continue
      val value = cells[1].trim()
      if (value.isEmpty() || value.length > MAX_CELL_CHARACTERS) return null
      rows.getOrPut(label) { mutableListOf() } += value
    }
    return rows
  }

  private fun unique(rows: Map<String, List<String>>, label: String): String? {
    val values = rows[label] ?: return null
    return values.singleOrNull()
  }

  private fun canonicalLabel(raw: String): String? {
    val english = raw.substringAfterLast('/').trim().lowercase(Locale.ROOT).replace(whitespace, " ")
    return when (english.removeSuffix(".")) {
      "invoice no" -> "invoice no"
      "payment date" -> "payment date"
      "settled amount" -> "settled amount"
      "credited party name" -> "credited party name"
      "transaction status" -> "transaction status"
      "payment mode" -> "payment mode"
      "payment reason" -> "payment reason"
      "payment channel" -> "payment channel"
      else -> null
    }
  }

  private fun visibleText(fragment: String): String {
    val withoutUnsafe =
      fragment
        .replace(commentPattern, " ")
        .replace(scriptPattern, " ")
        .replace(stylePattern, " ")
        .replace(tagPattern, " ")
    return decodeEntities(withoutUnsafe).replace(whitespace, " ").trim()
  }

  private fun decodeEntities(value: String): String =
    value
      .replace("&nbsp;", " ", ignoreCase = true)
      .replace("&#160;", " ", ignoreCase = true)
      .replace("&amp;", "&", ignoreCase = true)
      .replace("&lt;", "<", ignoreCase = true)
      .replace("&gt;", ">", ignoreCase = true)
      .replace("&quot;", "\"", ignoreCase = true)
      .replace("&#39;", "'", ignoreCase = true)

  private fun parseMinorUnits(value: String): Long? {
    val match = amountPattern.matchEntire(value.trim()) ?: return null
    val whole = match.groupValues[1]
    val fraction = match.groupValues[2].padEnd(2, '0')
    return runCatching {
        Math.addExact(Math.multiplyExact(whole.toLong(), 100L), fraction.toLong())
      }
      .getOrNull()
      ?.takeIf { it in 1..9_007_199_254_740_991L }
  }

  private fun parseOccurredAt(value: String): String? {
    for (formatter in dateFormatters) {
      val timestamp = runCatching { LocalDateTime.parse(value.trim(), formatter) }.getOrNull() ?: continue
      val instant = timestamp.atZone(ADDIS_ABABA).toInstant()
      return SafeOfficialReceiptTransport.canonicalTimestamp(instant.toEpochMilli())
    }
    return null
  }

  private fun strictStatus(value: String): String =
    when (value.trim().lowercase(Locale.ROOT)) {
      "completed" -> "completed"
      "pending" -> "pending"
      "failed" -> "failed"
      "reversed" -> "reversed"
      else -> "unknown"
    }

  private fun strictPaymentMode(value: String): String =
    if (value.trim().equals("telebirr", ignoreCase = true)) "telebirr" else "other"

  private fun strictPaymentReason(value: String): String =
    if (value.trim().equals("Send Money to Registered Customer", ignoreCase = true)) {
      "send_money_to_registered_customer"
    } else {
      "other"
    }

  private fun strictPaymentChannel(value: String): String =
    if (value.trim().equals("API/App", ignoreCase = true)) "api_app" else "other"

  private fun unavailable(sourceDocumentDigest: String): ParsedProviderObservation =
    ParsedProviderObservation(
      UnavailableReceiptFacts("unavailable", "parser"),
      sourceDocumentDigest,
    )

  companion object {
    private const val MAX_HTML_CHARACTERS = 64 * 1024
    private const val MAX_CELL_CHARACTERS = 256
    private val ADDIS_ABABA = ZoneId.of("Africa/Addis_Ababa")
    private val rowPattern = Regex("<tr\\b[^>]*>(.*?)</tr>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
    private val cellPattern =
      Regex("<(?:td|th)\\b[^>]*>(.*?)</(?:td|th)>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
    private val commentPattern = Regex("<!--.*?-->", RegexOption.DOT_MATCHES_ALL)
    private val scriptPattern =
      Regex("<script\\b[^>]*>.*?</script>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
    private val stylePattern =
      Regex("<style\\b[^>]*>.*?</style>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
    private val tagPattern = Regex("<[^>]*>")
    private val whitespace = Regex("\\s+")
    private val amountPattern = Regex("^([0-9]{1,13})(?:\\.([0-9]{1,2}))?\\s*(?:Birr|ETB)$", RegexOption.IGNORE_CASE)
    private val dateFormatters =
      listOf("dd-MM-uuuu HH:mm:ss", "dd/MM/uuuu HH:mm:ss").map {
        DateTimeFormatter.ofPattern(it, Locale.ROOT).withResolverStyle(ResolverStyle.STRICT)
      }
  }
}
