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
        livePilotProviderFound(
          livePilotHtml(),
          ProviderDocumentOriginAttestation.UNATTESTED,
        ),
      )
    val facts = documents.map { parser.parse(it, assignment).facts }
    assertTrue(facts.all { it is LivePilotReviewRequiredFacts })
    assertEquals(
      listOf(
        "unknown_layout_payment_reason",
        "unknown_layout_invoice_number",
        "invalid_layout",
        "unknown_layout_provider_identity",
      ),
      facts.map { (it as LivePilotReviewRequiredFacts).reviewReason },
    )
  }

  @Test
  fun `uses the authenticated transport origin instead of mutable receipt branding`() {
    val withoutLegacyBranding =
      livePilotHtml().replace("Ethio telecom Share Company", "Current TeleBirr Receipt")
    val facts =
      parser.parse(livePilotProviderFound(withoutLegacyBranding), assignment).facts
        as LivePilotFoundFacts

    assertEquals("matched", facts.referenceMatch)
    assertEquals("matched", facts.receiverMatch)
    assertEquals("completed", facts.providerFinalStatus)
    assertEquals("recognized_layout_v1", facts.layoutAttestation)
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

  @Test
  fun `accepts the current official three-column receipt with malformed status markup`() {
    val facts =
      parser.parse(livePilotProviderFound(currentOfficialLivePilotHtml()), assignment).facts
        as LivePilotFoundFacts

    assertEquals("matched", facts.referenceMatch)
    assertEquals("matched", facts.receiverMatch)
    assertEquals(2_500L, facts.amountMinor)
    assertEquals("completed", facts.providerFinalStatus)
    assertEquals("telebirr", facts.paymentMode)
    assertEquals("send_money_to_registered_customer", facts.paymentReason)
    assertEquals("api_app", facts.paymentChannel)
  }

  @Test
  fun `accepts the same exact receipt facts in the official card container layout`() {
    val facts =
      parser.parse(livePilotProviderFound(currentOfficialCardLivePilotHtml()), assignment).facts
        as LivePilotFoundFacts

    assertEquals("matched", facts.referenceMatch)
    assertEquals("matched", facts.receiverMatch)
    assertEquals(2_500L, facts.amountMinor)
    assertEquals("completed", facts.providerFinalStatus)
    assertEquals("recognized_layout_v1", facts.layoutAttestation)
    assertEquals("telebirr", facts.paymentMode)
    assertEquals("send_money_to_registered_customer", facts.paymentReason)
    assertEquals("api_app", facts.paymentChannel)
  }

  @Test
  fun `emits only fixed missing-field diagnostics for an unrecognized card layout`() {
    val cases =
      listOf(
        "Invoice No.:" to "unknown_layout_invoice_number",
        "Transaction Status:" to "unknown_layout_transaction_status",
        "Settled Amount:" to "unknown_layout_settled_amount",
        "Payment Date:" to "unknown_layout_payment_date",
        "Credited Party Name:" to "unknown_layout_credited_party_name",
        "Payment Mode:" to "unknown_layout_payment_mode",
        "Payment Reason:" to "unknown_layout_payment_reason",
        "Payment Channel:" to "unknown_layout_payment_channel",
      )

    for ((label, expectedReason) in cases) {
      val html =
        currentOfficialCardLivePilotHtml()
          .replace(Regex("<div>[^<]*${Regex.escape(label)}</div><div>[^<]*</div>"), "")
      val facts = parser.parse(livePilotProviderFound(html), assignment).facts
        as LivePilotReviewRequiredFacts
      assertEquals(expectedReason, facts.reviewReason)
      assertFalse(facts.toString().contains(PILOT_REFERENCE))
      assertFalse(facts.toString().contains(PILOT_RECEIVER_NAME))
    }
  }

  @Test
  fun `rejects ambiguous values in current three-cell detail rows`() {
    val ambiguous =
      currentOfficialLivePilotHtml().replace(
        "<td>telebirr</td><td></td>",
        "<td>telebirr</td><td>unexpected</td>",
      )
    val facts = parser.parse(livePilotProviderFound(ambiguous), assignment).facts

    assertTrue(facts is LivePilotReviewRequiredFacts)
    assertEquals("invalid_layout", (facts as LivePilotReviewRequiredFacts).reviewReason)
  }
}
