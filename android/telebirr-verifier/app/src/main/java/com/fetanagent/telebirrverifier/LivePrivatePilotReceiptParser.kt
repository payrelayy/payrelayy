package com.fetanagent.telebirrverifier

import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import java.util.Locale

data class LivePilotParsedProviderObservation(
  val facts: LivePilotReceiptFacts,
  val sourceDocumentDigest: String,
) {
  override fun toString(): String =
    "LivePilotParsedProviderObservation(lookupOutcome=${facts.lookupOutcome},sourceDocumentDigest=<redacted>)"
}

/**
 * Pure on-device parser. It accepts only a previously authenticated assignment, compares the exact
 * normalized credited-party full name, and emits only name digests/match facts. It performs no I/O.
 */
class LivePrivatePilotReceiptParser {
  fun parse(
    document: ProviderDocument,
    assignment: AuthenticatedLivePilotAssignment,
  ): LivePilotParsedProviderObservation =
    when (document) {
      is ProviderDocument.NotFound ->
        review(
          sourceDocumentDigest = document.sourceDocumentDigest,
          reason = "provider_not_found_unattested",
          retrievedAt = null,
        )
      is ProviderDocument.Unavailable ->
        review(
          sourceDocumentDigest = document.sourceDocumentDigest,
          reason =
            when (document.uncertainty) {
              "network" -> "network_unavailable"
              "parser" -> "parser_uncertain"
              "device" -> "device_error"
              else -> "provider_unavailable"
            },
          retrievedAt = null,
        )
      is ProviderDocument.Found ->
        runCatching { parseFound(document, assignment.body) }
          .getOrElse {
            review(document.sourceDocumentDigest, "parser_uncertain", document.retrievedAt)
          }
    }

  private fun parseFound(
    document: ProviderDocument.Found,
    assignment: LivePilotAssignmentBody,
  ): LivePilotParsedProviderObservation {
    val rows = parseRows(document.utf8Body)
      ?: return review(document.sourceDocumentDigest, "invalid_layout", document.retrievedAt)
    if (document.originAttestation != ProviderDocumentOriginAttestation.OFFICIAL_TLS_ORIGIN) {
      return review(
        document.sourceDocumentDigest,
        "unknown_layout_provider_identity",
        document.retrievedAt,
      )
    }
    val invoiceNumber = unique(rows, "invoice no")
      ?: return review(
        document.sourceDocumentDigest,
        "unknown_layout_invoice_number",
        document.retrievedAt,
      )
    val status = unique(rows, "transaction status")
      ?: return review(
        document.sourceDocumentDigest,
        "unknown_layout_transaction_status",
        document.retrievedAt,
      )
    val amount = unique(rows, "settled amount")
      ?: return review(
        document.sourceDocumentDigest,
        "unknown_layout_settled_amount",
        document.retrievedAt,
      )
    val paymentDate = unique(rows, "payment date")
      ?: return review(
        document.sourceDocumentDigest,
        "unknown_layout_payment_date",
        document.retrievedAt,
      )
    val receiverName = unique(rows, "credited party name")
      ?: return review(
        document.sourceDocumentDigest,
        "unknown_layout_credited_party_name",
        document.retrievedAt,
      )
    val paymentMode = unique(rows, "payment mode")
      ?: return review(
        document.sourceDocumentDigest,
        "unknown_layout_payment_mode",
        document.retrievedAt,
      )
    val paymentReason = unique(rows, "payment reason")
      ?: return review(
        document.sourceDocumentDigest,
        "unknown_layout_payment_reason",
        document.retrievedAt,
      )
    val paymentChannel = unique(rows, "payment channel")
      ?: return review(
        document.sourceDocumentDigest,
        "unknown_layout_payment_channel",
        document.retrievedAt,
      )

    if (!Regex("^[A-Z0-9]{8,64}$").matches(invoiceNumber)) {
      return review(document.sourceDocumentDigest, "invalid_layout", document.retrievedAt)
    }
    val normalizedReceiver = LivePilotNameNormalizer.normalize(receiverName)
      ?: return review(document.sourceDocumentDigest, "invalid_layout", document.retrievedAt)
    val creditedPartyNameDigest =
      LivePilotCanonicalTranscripts.receiverNameDigest(normalizedReceiver)
        ?: return review(document.sourceDocumentDigest, "parser_uncertain", document.retrievedAt)
    val amountMinor = parseMinorUnits(amount)
      ?: return review(document.sourceDocumentDigest, "invalid_layout", document.retrievedAt)
    val occurredAt = parseOccurredAt(paymentDate)
      ?: return review(document.sourceDocumentDigest, "invalid_layout", document.retrievedAt)

    return LivePilotParsedProviderObservation(
      facts =
        LivePilotFoundFacts(
          evidenceSource = "provider_receipt_lookup",
          layoutAttestation = "recognized_layout_v1",
          providerFinalStatus = strictStatus(status),
          canonicalReferencePresent = true,
          referenceMatch = if (invoiceNumber == assignment.rawReference) "matched" else "mismatched",
          amountMinor = amountMinor,
          currencyCode = "ETB",
          receiverMatch =
            if (normalizedReceiver == assignment.expectedReceiverNameNormalized) {
              "matched"
            } else {
              "mismatched"
            },
          creditedPartyNameDigest = creditedPartyNameDigest,
          paymentMode = strictPaymentMode(paymentMode),
          paymentReason = strictPaymentReason(paymentReason),
          paymentChannel = strictPaymentChannel(paymentChannel),
          occurredAt = occurredAt,
          retrievedAt = document.retrievedAt,
        ),
      sourceDocumentDigest = document.sourceDocumentDigest,
    )
  }

  private fun parseRows(html: String): Map<String, List<String>>? {
    if (html.length > MAX_HTML_CHARACTERS || html.indexOf('\u0000') >= 0) return null
    val tableRowsByLabel = linkedMapOf<String, MutableList<String>>()
    val tableCells =
      rowPattern.findAll(html).map { match ->
        cellPattern
          .findAll(match.groupValues[1])
          .map { visibleText(it.groupValues[1]) }
          .toList()
      }.toList()

    fun add(
      destination: MutableMap<String, MutableList<String>>,
      label: String,
      value: String,
    ): Boolean {
      val bounded = value.trim()
      if (bounded.isEmpty() || bounded.length > MAX_CELL_CHARACTERS) return false
      destination.getOrPut(label) { mutableListOf() } += bounded
      return true
    }

    for ((index, cells) in tableCells.withIndex()) {
      if (cells.isEmpty()) continue

      if (cells.map(::canonicalLabel) == invoiceColumnLabels) {
        val values = tableCells.getOrNull(index + 1) ?: return null
        if (values.size != invoiceColumnLabels.size) return null
        for (column in invoiceColumnLabels.indices) {
          if (!add(tableRowsByLabel, invoiceColumnLabels[column], values[column])) return null
        }
        continue
      }

      val label = canonicalLabel(cells[0])
      if (label != null) {
        val values = cells.drop(1).map(String::trim).filter(String::isNotEmpty)
        if (values.size != 1 || !add(tableRowsByLabel, label, values.single())) return null
        continue
      }

      if (cells.size == 1) {
        val inline = canonicalInlinePair(cells.single()) ?: continue
        if (!add(tableRowsByLabel, inline.first, inline.second)) return null
      }
    }

    // The official receipt has used table rows plus several card/heading tag combinations. Keep
    // the accepted vocabulary identical, but derive bounded text nodes independently of tag names
    // and pair only an isolated canonical label with its immediately adjacent value. Raw labels,
    // values, and HTML never leave the device.
    val cardRowsByLabel = linkedMapOf<String, MutableList<String>>()
    val textNodes =
      html
        .replace(commentPattern, " ")
        .replace(scriptPattern, " ")
        .replace(stylePattern, " ")
        .split(tagPattern)
        .map(::decodeEntities)
        .map { value -> value.replace(whitespace, " ").trim() }
        .filter(String::isNotEmpty)
    for (index in textNodes.indices) {
      val current = textNodes[index]
      val inline = canonicalInlinePair(current)
      if (inline != null) {
        if (!add(cardRowsByLabel, inline.first, inline.second)) return null
        continue
      }
      val label = canonicalLabel(current) ?: continue
      val value = textNodes.getOrNull(index + 1) ?: continue
      // A run of labels is the official multi-column header, not an adjacent card pair. The table
      // parser above binds that header to its following values row.
      if (
        (index > 0 && canonicalLabel(textNodes[index - 1]) != null) ||
          canonicalLabel(value) != null
      ) {
        continue
      }
      if (!add(cardRowsByLabel, label, value)) return null
    }

    val candidates = listOf(tableRowsByLabel, cardRowsByLabel).filter { it.isNotEmpty() }
    if (candidates.isEmpty()) return emptyMap()
    val bestCount = candidates.maxOf { candidate -> candidate.keys.count(requiredLabels::contains) }
    val best = candidates.filter { candidate ->
      candidate.keys.count(requiredLabels::contains) == bestCount
    }
    if (best.size == 1) return best.single()
    return best.firstOrNull()?.takeIf { candidate -> best.all(candidate::equals) }
  }

  private fun unique(rows: Map<String, List<String>>, label: String): String? =
    rows[label]?.singleOrNull()

  private fun canonicalLabel(raw: String): String? {
    val english = canonicalEnglish(raw)
    val label = english.removeSuffix(":").removeSuffix(".")
    return labelAliases.singleOrNull { it.first == label }?.second
  }

  private fun canonicalInlinePair(raw: String): Pair<String, String>? {
    if (canonicalLabel(raw) != null) return null
    val english = normalizedWhitespace(raw)
    val candidates =
      labelAliases.mapNotNull { (alias, canonical) ->
        val match =
          Regex(
              "(?:^|/)\\s*${Regex.escape(alias)}\\s*[.:]?\\s+(.+)$",
              RegexOption.IGNORE_CASE,
            )
            .find(english) ?: return@mapNotNull null
        match.groupValues[1].trim().takeIf(String::isNotEmpty)?.let { canonical to it }
      }
    return candidates.distinct().singleOrNull()
  }

  private fun canonicalEnglish(raw: String): String =
    canonicalWhitespace(raw).substringAfterLast('/').trim()

  private fun canonicalWhitespace(raw: String): String =
    normalizedWhitespace(raw).lowercase(Locale.ROOT)

  private fun normalizedWhitespace(raw: String): String = raw.trim().replace(whitespace, " ")

  private fun visibleText(fragment: String): String =
    decodeEntities(
        fragment
          .replace(commentPattern, " ")
          .replace(scriptPattern, " ")
          .replace(stylePattern, " ")
          .replace(tagPattern, " "),
      )
      .replace(whitespace, " ")
      .trim()

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
    return runCatching { Math.addExact(Math.multiplyExact(whole.toLong(), 100L), fraction.toLong()) }
      .getOrNull()
      ?.takeIf { it in 1..9_007_199_254_740_991L }
  }

  private fun parseOccurredAt(value: String): String? {
    for (formatter in dateFormatters) {
      val timestamp = runCatching { LocalDateTime.parse(value.trim(), formatter) }.getOrNull() ?: continue
      return SafeOfficialReceiptTransport.canonicalTimestamp(
        timestamp.atZone(ADDIS_ABABA).toInstant().toEpochMilli(),
      )
    }
    return null
  }

  private fun strictStatus(value: String): String =
    when (value.trim().lowercase(Locale.ROOT)) {
      "completed", "successful" -> "completed"
      "pending" -> "pending"
      "failed" -> "failed"
      "reversed" -> "reversed"
      else -> "unknown"
    }

  private fun strictPaymentMode(value: String): String =
    if (value.trim().equals("telebirr", ignoreCase = true)) "telebirr" else "other"

  private fun strictPaymentReason(value: String): String =
    if (
      value.trim().equals("Send Money to Registered Customer", ignoreCase = true) ||
        value.trim().equals("Transfer Money", ignoreCase = true)
    ) {
      "send_money_to_registered_customer"
    } else {
      "other"
    }

  private fun strictPaymentChannel(value: String): String =
    if (
      value.trim().equals("API/App", ignoreCase = true) ||
        value.trim().equals("APP", ignoreCase = true)
    ) {
      "api_app"
    } else {
      "other"
    }

  private fun review(
    sourceDocumentDigest: String,
    reason: String,
    retrievedAt: String?,
  ): LivePilotParsedProviderObservation =
    LivePilotParsedProviderObservation(
      facts = LivePilotReviewRequiredFacts(reviewReason = reason, retrievedAt = retrievedAt),
      sourceDocumentDigest = sourceDocumentDigest,
    )

  companion object {
    private const val MAX_HTML_CHARACTERS = 64 * 1024
    private const val MAX_CELL_CHARACTERS = 256
    private val ADDIS_ABABA = ZoneId.of("Africa/Addis_Ababa")
    private val rowPattern =
      Regex("<tr\\b[^>]*>(.*?)</tr>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
    private val cellPattern =
      Regex(
        "<(?:td|th)\\b[^>]*>(.*?)</(?:td|th)>",
        setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
      )
    private val commentPattern = Regex("<!--.*?-->", RegexOption.DOT_MATCHES_ALL)
    private val scriptPattern =
      Regex(
        "<script\\b[^>]*>.*?</script>",
        setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
      )
    private val stylePattern =
      Regex(
        "<style\\b[^>]*>.*?</style>",
        setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
      )
    private val tagPattern = Regex("<[^>]*>")
    private val whitespace = Regex("[\\s\\p{Zs}\\u2007\\u202F]+")
    private val amountPattern =
      Regex("^([0-9]{1,13})(?:\\.([0-9]{1,2}))?\\s*(?:Birr|ETB)$", RegexOption.IGNORE_CASE)
    private val invoiceColumnLabels = listOf("invoice no", "payment date", "settled amount")
    private val labelAliases =
      listOf(
        "invoice no" to "invoice no",
        "invoice number" to "invoice no",
        "receipt no" to "invoice no",
        "receipt number" to "invoice no",
        "payment reference no" to "invoice no",
        "payment reference number" to "invoice no",
        "transaction no" to "invoice no",
        "transaction number" to "invoice no",
        "payment date" to "payment date",
        "transaction time" to "payment date",
        "settled amount" to "settled amount",
        "credited party name" to "credited party name",
        "credited party" to "credited party name",
        "transaction to" to "credited party name",
        "transaction status" to "transaction status",
        "status" to "transaction status",
        "payment mode" to "payment mode",
        "payment reason" to "payment reason",
        "transaction type" to "payment reason",
        "payment channel" to "payment channel",
      )
    private val requiredLabels =
      setOf(
        "invoice no",
        "payment date",
        "settled amount",
        "credited party name",
        "transaction status",
        "payment mode",
        "payment reason",
        "payment channel",
      )
    private val dateFormatters =
      listOf(
          "dd-MM-uuuu HH:mm:ss",
          "dd/MM/uuuu HH:mm:ss",
          "uuuu-MM-dd HH:mm:ss",
          "uuuu/MM/dd HH:mm:ss",
        )
        .map {
        DateTimeFormatter.ofPattern(it, Locale.ROOT).withResolverStyle(ResolverStyle.STRICT)
      }
  }
}
