package com.fetanagent.telebirrverifier

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LivePrivatePilotReceiptParserTest {
  private val assignment = authenticateLivePilotAssignment().first
  private val parser = LivePrivatePilotReceiptParser()

  @Test
  fun `compares exact normalized credited-party full name on device`() {
    val parsed = parser.parse(livePilotProviderFound(), assignment)
    val facts = parsed.facts as LivePilotFoundFacts

    assertEquals("found", facts.lookupOutcome)
    assertEquals("matched", facts.referenceMatch)
    assertEquals("matched", facts.receiverMatch)
    assertEquals(
      LivePilotCanonicalTranscripts.receiverNameDigest(PILOT_RECEIVER_NAME),
      facts.creditedPartyNameDigest,
    )
    assertEquals(2_500L, facts.amountMinor)
    assertEquals("completed", facts.providerFinalStatus)
    assertEquals("recognized_layout_v1", facts.layoutAttestation)
  }

  @Test
  fun `emits only a digest and mismatch fact for a different receiver name`() {
    val parsed =
      parser.parse(
        livePilotProviderFound(livePilotHtml(receiverName = "different pilot receiver")),
        assignment,
      )
    val facts = parsed.facts as LivePilotFoundFacts

    assertEquals("mismatched", facts.receiverMatch)
    assertNotEquals(
      LivePilotCanonicalTranscripts.receiverNameDigest(PILOT_RECEIVER_NAME),
      facts.creditedPartyNameDigest,
    )
    assertFalse(parsed.toString().contains("different pilot receiver"))
    assertFalse(parsed.toString().contains(PILOT_RECEIVER_NAME))
  }

  @Test
  fun `binds the official invoice number to the authenticated raw reference`() {
    val parsed =
      parser.parse(
        livePilotProviderFound(livePilotHtml(reference = "PILOT9ABC9999")),
        assignment,
      )
    val facts = parsed.facts as LivePilotFoundFacts
    assertEquals("mismatched", facts.referenceMatch)
  }

  @Test
  fun `routes bare not found and every unavailable category to review`() {
    val documents =
      listOf(
        ProviderDocument.NotFound(repeatedDigest('6')),
        ProviderDocument.Unavailable("provider", repeatedDigest('6')),
        ProviderDocument.Unavailable("network", repeatedDigest('6')),
        ProviderDocument.Unavailable("parser", repeatedDigest('6')),
        ProviderDocument.Unavailable("device", repeatedDigest('6')),
      )
    val reasons = documents.map { (parser.parse(it, assignment).facts as LivePilotReviewRequiredFacts).reviewReason }
    assertEquals(
      listOf(
        "provider_not_found_unattested",
        "provider_unavailable",
        "network_unavailable",
        "parser_uncertain",
        "device_error",
      ),
      reasons,
    )
    assertTrue(documents.all { parser.parse(it, assignment).facts.lookupOutcome == "review_required" })
    assertFalse(reasons.any { it.contains("reject") || it.contains("absent") })
  }

  @Test
  fun `routes missing duplicate invalid and unknown layouts to review`() {
    val documents =
      listOf(
        livePilotProviderFound(livePilotHtml(includePaymentReason = false)),
        livePilotProviderFound(livePilotHtml(duplicateInvoice = true)),
        livePilotProviderFound(livePilotHtml().replace("25 Birr", "twenty five Birr")),
        livePilotProviderFound(livePilotHtml().replace("Ethio telecom Share Company", "Unknown")),
      )
    val facts = documents.map { parser.parse(it, assignment).facts }
    assertTrue(facts.all { it is LivePilotReviewRequiredFacts })
    assertTrue(
      facts
        .map { (it as LivePilotReviewRequiredFacts).reviewReason }
        .all { it == "unknown_layout" || it == "invalid_layout" },
    )
  }

  @Test
  fun `retains unknown provider semantics as evidence for server review`() {
    val facts =
      parser.parse(
          livePilotProviderFound(livePilotHtml(status = "Unexpected")),
          assignment,
        )
        .facts as LivePilotFoundFacts
    assertEquals("unknown", facts.providerFinalStatus)
    assertEquals("found", facts.lookupOutcome)
  }

  @Test
  fun `accepts the observed official receipt labels without weakening required facts`() {
    val observedLabelHtml =
      livePilotHtml()
        .replace("Invoice No.", "የደረሰኝ ቁጥር / Invoice No")
        .replace("Payment date", "የክፍያ ቀን / Payment Date")
        .replace("25 Birr", "25.00 ETB")
        .replace("Credited Party name", "የገንዘብ ተቀባይ / Credited Party Name")
    val facts =
      parser.parse(livePilotProviderFound(observedLabelHtml), assignment).facts
        as LivePilotFoundFacts

    assertEquals("matched", facts.referenceMatch)
    assertEquals("matched", facts.receiverMatch)
    assertEquals(2_500L, facts.amountMinor)
    assertEquals("completed", facts.providerFinalStatus)
    assertEquals("recognized_layout_v1", facts.layoutAttestation)
  }
}
