package com.fetanagent.telebirrverifier

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiverPaymentSmsParserTest {
  private val parser = ReceiverPaymentSmsParser()
  private val telebirrSource = ReceiverPaymentSmsParser.Source(
    ReceiverPaymentSmsParser.Provider.TELEBIRR, 5, "Test Receiver")
  private val cbeSource = ReceiverPaymentSmsParser.Source(
    ReceiverPaymentSmsParser.Provider.CBE_BIRR, 5,
    "Test Receiver", "251900000001")

  private fun telebirr(reference: String = "SYNTHREF001", receiver: String = "Test Receiver") =
    "Dear $receiver, You have received ETB 100.00 from Synthetic Payer on " +
      "20/10/2026 17:41:00. Your transaction number is $reference. " +
      "Your current E-Money Account balance is ETB 1,000.00. " +
      "Thank you for using telebirr Ethio telecom"

  private fun cbe(reference: String = "SYNTHCBE001", invoice: String = reference,
    phone: String = "251900000001") =
    "Dear Test Receiver, you received 3,000.00Br. from 251900000002 - Synthetic Payer " +
      "on 20/10/26 17:46,Txn ID $reference.Your CBE Birr account balance is " +
      "50,025.20Br. Thank you! For invoice " +
      "https://cbepay1.cbe.com.et/aureceipt?TID=$invoice&PH=$phone"

  private fun sms(subscriptionId: Int, body: String) =
    ReceiverPaymentSmsParser.Message(subscriptionId,
      Instant.parse("2026-10-20T14:48:00Z").toEpochMilli(), body)

  @Test fun `direct TeleBirr SMS yields bounded facts without raw text`() {
    val result = parser.parse(sms(5, telebirr()), telebirrSource,
      "SYNTHREF001") as ReceiverPaymentSmsParser.Result.Match
    assertEquals(10_000L, result.amountMinor)
    assertEquals(Instant.parse("2026-10-20T14:41:00Z"), result.occurredAt)
    assertTrue(result.messageDigest.matches(Regex("^sha256:[0-9a-f]{64}$")))
    assertFalse(result.toString().contains("SYNTHREF001"))
    assertFalse(result.toString().contains("Synthetic Payer"))
  }

  @Test fun `direct CBE SMS requires matching invoice and receiver phone`() {
    val result = parser.parse(sms(5, cbe()), cbeSource,
      "SYNTHCBE001") as ReceiverPaymentSmsParser.Result.Match
    assertEquals(300_000L, result.amountMinor)
    assertEquals(Instant.parse("2026-10-20T14:46:00Z"), result.occurredAt)
    for (changed in listOf(cbe(invoice = "SYNTHCBE002"),
      cbe(phone = "251900000003"))) {
      assertTrue(parser.parse(sms(5, changed), cbeSource,
        "SYNTHCBE001") is ReceiverPaymentSmsParser.Result.Review)
    }
  }

  @Test fun `SIM must match and another reference is not a rejection`() {
    for (message in listOf(sms(1, telebirr()), sms(5,
        telebirr(reference = "SYNTHREF002")))) {
      assertEquals(ReceiverPaymentSmsParser.Result.NoMatch,
        parser.parse(message, telebirrSource, "SYNTHREF001"))
    }
  }

  @Test fun `changed layout receiver or date produces review only`() {
    for (changed in listOf(telebirr().replace("You have received", "You got"),
      telebirr(receiver = "Other Receiver"),
      telebirr().replace("20/10/2026", "32/10/2026"))) {
      assertTrue(parser.parse(sms(5, changed), telebirrSource,
        "SYNTHREF001") is ReceiverPaymentSmsParser.Result.Review)
    }
  }

  @Test fun `malformed or future CBE SMS never becomes a match`() {
    for (changed in listOf(cbe().replace("3,000.00Br.", "3,000.00 USD"),
      cbe().replace("20/10/26 17:46", "20/10/26 23:46"),
      cbe() + " unexpected")) {
      assertTrue(parser.parse(sms(5, changed), cbeSource,
        "SYNTHCBE001") is ReceiverPaymentSmsParser.Result.Review)
    }
  }
}
