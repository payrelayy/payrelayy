package com.fetanagent.telebirrverifier

import java.time.Instant
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

  @Test fun `only complete incoming payments reach the encrypted queue`() {
    val time = Instant.parse("2026-10-20T14:47:00Z").toEpochMilli()
    val telebirr = "Dear Receiver, You have received ETB 250.00 from Synthetic Payer " +
      "on 20/10/2026 17:46:00. Your transaction number is SYNTHIN001. telebirr"
    val cbe = "Dear Receiver, you received 250.00Br. from Synthetic Payer " +
      "on 20/10/26 17:46,Txn ID SYNTHIN002. CBE Birr account balance is 10,000.00Br."
    assertTrue(ReceiverPaymentSmsInbox.classifyIncoming("127", telebirr, -1, time)
      is ReceiverPaymentSmsInbox.Read.Relevant)
    assertTrue(ReceiverPaymentSmsInbox.classifyIncoming("CBEBirr", cbe, -1, time)
      is ReceiverPaymentSmsInbox.Read.Relevant)
    assertTrue(ReceiverPaymentSmsInbox.classifyIncoming("127",
      telebirr + " This is a payout.", -1, time)
      is ReceiverPaymentSmsInbox.Read.Irrelevant)
    assertTrue(ReceiverPaymentSmsInbox.classifyIncoming("CBEBirr",
      cbe + " This is a payout.", -1, time)
      is ReceiverPaymentSmsInbox.Read.Irrelevant)
    assertTrue(ReceiverPaymentSmsInbox.classifyIncoming("251900000000", telebirr, -1, time)
      is ReceiverPaymentSmsInbox.Read.Irrelevant)
  }
}
