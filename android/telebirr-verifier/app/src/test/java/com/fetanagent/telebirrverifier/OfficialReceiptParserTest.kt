package com.fetanagent.telebirrverifier

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OfficialReceiptParserTest {
  private val parser = OfficialReceiptParser()
  private val reference = CanonicalReference.fromCanonical(SYNTHETIC_REFERENCE)

  @Test
  fun `extracts only conservative provider facts and principal minor units`() {
    val result = parser.parse(providerFound(), reference)
    val facts = result.facts as FoundReceiptFacts

    assertEquals("completed", facts.providerFinalStatus)
    assertEquals(15_000L, facts.amountMinor)
    assertEquals("ETB", facts.currencyCode)
    assertEquals("2026-08-20T18:02:30.000Z", facts.occurredAt)
    assertEquals("matched", facts.referenceMatch)
    assertEquals("unknown", facts.receiverMatch)
    assertEquals("telebirr", facts.paymentMode)
    assertEquals("send_money_to_registered_customer", facts.paymentReason)
    assertEquals("api_app", facts.paymentChannel)
  }

  @Test
  fun `never defaults an unfamiliar receipt status to completed`() {
    for (status in listOf("Successful", "Success", "Future New State", "")) {
      val result = parser.parse(providerFound(officialHtml(status = status)), reference)
      val facts = result.facts
      if (status.isEmpty()) {
        assertEquals("unavailable", facts.lookupOutcome)
      } else {
        assertEquals("unknown", (facts as FoundReceiptFacts).providerFinalStatus)
      }
    }
  }

  @Test
  fun `fails closed for missing duplicate malformed or future facts`() {
    val documents =
      listOf(
        providerFound(officialHtml(includePaymentReason = false)),
        providerFound(officialHtml(duplicateInvoice = true)),
        providerFound(officialHtml(settledAmount = "152.345 Birr")),
        providerFound(officialHtml(paymentDate = "21-08-2026 21:02:30")),
        providerFound("<html><body>not an official receipt</body></html>"),
      )
    for (document in documents) {
      val facts = parser.parse(document, reference).facts
      assertEquals("unavailable", facts.lookupOutcome)
      assertEquals("parser", (facts as UnavailableReceiptFacts).uncertainty)
    }
  }

  @Test
  fun `reports reference mismatch without exposing either reference`() {
    val result =
      parser.parse(
        providerFound(officialHtml(reference = "DHK9130XYZ")),
        reference,
      )
    val facts = result.facts as FoundReceiptFacts

    assertEquals("mismatched", facts.referenceMatch)
    assertFalse(result.toString().contains("DHK9130XYZ"))
    assertTrue(result.toString().contains("sourceDocumentDigest=<redacted>"))
    assertTrue(reference.toString().contains("<redacted>"))
  }

  @Test
  fun `preserves provider not found as a narrow fact`() {
    val document = ProviderDocument.NotFound(repeatedDigest('9'))
    val result = parser.parse(document, reference)

    assertEquals(NotFoundReceiptFacts("not_found"), result.facts)
  }
}
