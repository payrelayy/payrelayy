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
}
