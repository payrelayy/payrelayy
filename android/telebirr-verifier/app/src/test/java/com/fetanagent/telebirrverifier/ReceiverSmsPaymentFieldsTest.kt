package com.fetanagent.telebirrverifier

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiverSmsPaymentFieldsTest {
  @Test fun `TeleBirr payment fields come from received amount rather than balance`() {
    val sms = "Dear Receiver, You have received ETB 1,250.00 from Synthetic Sender " +
      "on 20/10/2026 14:37:18. Your transaction number is SYNTHETB001. " +
      "Your current E-Money Account balance is ETB 80,000.00. Thank you for using telebirr"
    val found = ReceiverSmsPaymentFields.extract(sms,
      Instant.parse("2026-10-20T11:38:00Z").toEpochMilli())
    assertTrue(found is ReceiverSmsPaymentFields.Result.Found)
    val payment = (found as ReceiverSmsPaymentFields.Result.Found).payment
    assertEquals("telebirr", payment.providerCode)
    assertEquals("SYNTHETB001", payment.reference)
    assertEquals(125_000L, payment.amountMinor)
    assertEquals("2026-10-20T11:37:18.000Z", payment.occurredAt)
  }

  @Test fun `CBE Birr payment fields use received amount and Ethiopia local time`() {
    val sms = "Dear Receiver, you received 3,000.00Br. from Synthetic Sender " +
      "on 20/10/26 17:46,Txn ID SYNTHCBE001. Your CBE Birr account balance is 50,025.20Br."
    val found = ReceiverSmsPaymentFields.extract(sms,
      Instant.parse("2026-10-20T14:47:00Z").toEpochMilli())
    assertTrue(found is ReceiverSmsPaymentFields.Result.Found)
    val payment = (found as ReceiverSmsPaymentFields.Result.Found).payment
    assertEquals("cbe_birr", payment.providerCode)
    assertEquals("SYNTHCBE001", payment.reference)
    assertEquals(300_000L, payment.amountMinor)
    assertEquals("2026-10-20T14:46:00.000Z", payment.occurredAt)
  }

  @Test fun `ambiguous or unreadable payment cannot become a creditable record`() {
    val time = Instant.parse("2026-10-20T14:47:00Z").toEpochMilli()
    assertTrue(ReceiverSmsPaymentFields.extract("telebirr CBE Birr received transaction" +
      " with no exact information and no usable payment fields", time)
      is ReceiverSmsPaymentFields.Result.Review)
    assertTrue(ReceiverSmsPaymentFields.extract("CBE Birr received with no transaction" +
      " reference or amount available in this message", time)
      is ReceiverSmsPaymentFields.Result.Review)
  }

  @Test fun `sent and payout messages never produce payment fields`() {
    val time = Instant.parse("2026-10-20T14:47:00Z").toEpochMilli()
    val messages = listOf(
      "Dear Receiver, You have sent ETB 250.00 to Synthetic Payee " +
        "on 20/10/2026 17:46:00. Your transaction number is SYNTHOUT001. telebirr",
      "Dear Receiver, you sent 250.00Br. to Synthetic Payee " +
        "on 20/10/26 17:46,Txn ID SYNTHOUT002. Your CBE Birr account balance is 10,000.00Br.",
      "Dear Receiver, You have received ETB 250.00 from Synthetic Payer " +
        "on 20/10/2026 17:46:00. Your transaction number is SYNTHOUT003. " +
        "This is a payout. telebirr",
      "Dear Receiver, you received 250.00Br. from Synthetic Payer " +
        "on 20/10/26 17:46,Txn ID SYNTHOUT004. CBE Birr payout completed.",
      "Dear Receiver, you received 250.00Br. from Synthetic Payer " +
        "on 20/10/26 17:46,Txn ID SYNTHOUT006. CBE Birr paid out.",
      "Dear Receiver, You have sent ETB 250.00 to Synthetic Payee. " +
        "You have received ETB 250.00 from Synthetic Payer " +
        "on 20/10/2026 17:46:00. Your transaction number is SYNTHOUT005. telebirr",
    )
    for (sms in messages) {
      val result = ReceiverSmsPaymentFields.extract(sms, time)
      assertTrue(result is ReceiverSmsPaymentFields.Result.Review)
      assertEquals("sms_not_incoming_payment",
        (result as ReceiverSmsPaymentFields.Result.Review).reasonCode)
    }
  }
}
