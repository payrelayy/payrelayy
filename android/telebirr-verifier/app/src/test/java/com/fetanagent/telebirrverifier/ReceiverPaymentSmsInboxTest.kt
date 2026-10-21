package com.fetanagent.telebirrverifier

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiverPaymentSmsInboxTest {
  @Test fun `payment-like SMS is considered without checking a sender label`() {
    assertTrue(ReceiverPaymentSmsInbox.isPaymentLike(
      "You have received ETB 100.00. Your transaction number is SYNTHETIC001. telebirr"))
    assertTrue(ReceiverPaymentSmsInbox.isPaymentLike(
      "You received 100.00Br. from Synthetic Payer,Txn ID SYNTHETIC001. CBE Birr"))
    assertFalse(ReceiverPaymentSmsInbox.isPaymentLike(
      "Personal SMS that mentions telebirr but contains no payment confirmation"))
  }
}
