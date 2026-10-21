package com.fetanagent.telebirrverifier

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiverPaymentSmsInboxTest {
  @Test fun `only the matching configured sender can enter the payment queue`() {
    val telebirr = "You have received ETB 100.00. " +
      "Your transaction number is SYNTHETIC001. telebirr"
    val cbe = "You received 100.00Br. from Synthetic Payer," +
      "Txn ID SYNTHETIC001. CBE Birr"
    assertTrue(ReceiverPaymentSmsInbox.matchesSender("127", telebirr))
    assertTrue(ReceiverPaymentSmsInbox.matchesSender("CBEBirr", cbe))
    assertFalse(ReceiverPaymentSmsInbox.matchesSender("CBEBirr", telebirr))
    assertFalse(ReceiverPaymentSmsInbox.matchesSender("127", cbe))
    assertFalse(ReceiverPaymentSmsInbox.matchesSender("251900000000", telebirr))
    assertFalse(ReceiverPaymentSmsInbox.matchesSender("251900000000", cbe))
    assertFalse(ReceiverPaymentSmsInbox.matchesSender(null, telebirr))
    assertFalse(ReceiverPaymentSmsInbox.matchesSender("cbebirr", cbe))
    assertFalse(ReceiverPaymentSmsInbox.matchesSender("127 ", telebirr))
    assertFalse(ReceiverPaymentSmsInbox.matchesSender("127", telebirr + " CBE Birr Txn"))
    assertFalse(ReceiverPaymentSmsInbox.matchesSender("127",
      "Personal SMS that mentions telebirr but contains no payment confirmation"))
  }
}
