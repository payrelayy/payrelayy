package com.fetanagent.telebirrverifier

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony

/** Bounded, read-only inbox lookup. It performs no SMS deletion, forwarding, or network access. */
internal class ReceiverPaymentSmsInbox(
  private val parser: ReceiverPaymentSmsParser = ReceiverPaymentSmsParser(),
) {
  sealed interface Lookup {
    data object NoMatch : Lookup
    class Review(val reasonCode: String) : Lookup
    class Match(val facts: ReceiverPaymentSmsParser.Result.Match) : Lookup
  }

  fun find(
    context: Context,
    source: ReceiverPaymentSmsParser.Source,
    expectedReference: String,
    nowMillis: Long = System.currentTimeMillis(),
  ): Lookup {
    if (context.checkSelfPermission(Manifest.permission.READ_SMS) !=
      PackageManager.PERMISSION_GRANTED) return Lookup.Review("sms_permission_missing")
    if (!expectedReference.matches(Regex("^[A-Z0-9]{8,32}$")))
      return Lookup.Review("invalid_assignment")
    val earliest = nowMillis - MAX_LOOKBACK_MILLIS
    if (earliest <= 0) return Lookup.Review("sms_clock_uncertain")
    // Selection arguments keep the reference out of SQL text and logs. Query only one bound
    // subscription and messages containing the assigned reference.
    val selection = "sub_id = ? AND ${Telephony.Sms.DATE} >= ? AND " +
      "${Telephony.Sms.BODY} LIKE ?"
    val cursor = try {
      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf("sub_id", Telephony.Sms.DATE, Telephony.Sms.BODY),
        selection,
        arrayOf(source.subscriptionId.toString(), earliest.toString(),
          "%$expectedReference%"),
        "${Telephony.Sms.DATE} DESC",
      )
    } catch (_: Exception) { null } ?: return Lookup.Review("sms_inbox_unavailable")
    cursor.use {
      val subscriptionColumn = it.getColumnIndex("sub_id")
      val dateColumn = it.getColumnIndex(Telephony.Sms.DATE)
      val bodyColumn = it.getColumnIndex(Telephony.Sms.BODY)
      if (subscriptionColumn < 0 || dateColumn < 0 || bodyColumn < 0)
        return Lookup.Review("sms_inbox_unavailable")
      var rows = 0
      var matched: ReceiverPaymentSmsParser.Result.Match? = null
      while (it.moveToNext()) {
        rows++
        if (rows > MAX_MATCHING_ROWS) return Lookup.Review("sms_inbox_ambiguous")
        val message = try {
          ReceiverPaymentSmsParser.Message(
            it.getInt(subscriptionColumn), it.getLong(dateColumn), it.getString(bodyColumn),
          )
        } catch (_: Exception) { return Lookup.Review("sms_inbox_unavailable") }
        when (val result = parser.parse(message, source, expectedReference)) {
          ReceiverPaymentSmsParser.Result.NoMatch -> Unit
          is ReceiverPaymentSmsParser.Result.Review -> return Lookup.Review(result.reasonCode)
          is ReceiverPaymentSmsParser.Result.Match -> {
            if (result.receivedAt.toEpochMilli() > nowMillis + CLOCK_SKEW_MILLIS)
              return Lookup.Review("sms_clock_uncertain")
            val previous = matched
            if (previous != null && previous.messageDigest != result.messageDigest)
              return Lookup.Review("sms_inbox_ambiguous")
            matched = result
          }
        }
      }
      return matched?.let { Lookup.Match(it) } ?: Lookup.NoMatch
    }
  }

  companion object {
    private const val MAX_LOOKBACK_MILLIS = 30L * 24 * 60 * 60 * 1_000
    private const val CLOCK_SKEW_MILLIS = 5L * 60 * 1_000
    private const val MAX_MATCHING_ROWS = 20
  }
}
