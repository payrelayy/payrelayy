package com.fetanagent.telebirrverifier

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutineTelebirrReceiptParserTest {
  private val lookup =
    RoutineReceiptLookupExpectation(
      candidateId = "c0b2d65a-2934-49c9-8446-6d2c1d477a24",
      rawReference = PILOT_REFERENCE,
      referenceFingerprint = "a".repeat(64),
      expectedReceiverNameNormalized = PILOT_RECEIVER_NAME,
      expectedReceiverNameDigest =
        requireNotNull(RoutineTelebirrReceiverName.digest(PILOT_RECEIVER_NAME)),
      receiverRevisionId = "53d119fa-69d4-4d75-8676-88eaf7a93ab2",
      receiverVersion = 1,
    )
  private val parser = RoutineTelebirrReceiptParser()

  @Test
  fun `maps a trusted official receipt to the exact routine facts vocabulary`() {
    val parsed = parser.parse(livePilotProviderFound(currentOfficialCardLivePilotHtml()), lookup)
      as RoutineTelebirrParsedReceipt.Observed

    assertEquals(2_500L, parsed.facts.amountMinor)
    assertTrue(parsed.facts.canonicalReferencePresent)
    assertEquals(lookup.expectedReceiverNameDigest, parsed.facts.creditedPartyNameDigest)
    assertEquals("ETB", parsed.facts.currencyCode)
    assertEquals("provider_receipt_lookup", parsed.facts.evidenceSource)
    assertEquals("2026-08-20T18:01:45.000Z", parsed.facts.occurredAt)
    assertEquals("api_app", parsed.facts.paymentChannel)
    assertEquals("telebirr", parsed.facts.paymentMode)
    assertEquals("send_money_to_registered_customer", parsed.facts.paymentReason)
    assertEquals("completed", parsed.facts.providerFinalStatus)
    assertEquals("matched", parsed.facts.providerIdentity)
    assertEquals("matched", parsed.facts.receiverMatch)
    assertEquals("matched", parsed.facts.referenceMatch)
    assertEquals("2026-08-20T18:03:00.000Z", parsed.facts.retrievedAt)
    assertEquals("telebirr_official_receipt_v1", parsed.facts.sourceProfile)
    assertFalse(parsed.toString().contains(PILOT_REFERENCE))
    assertFalse(parsed.toString().contains(PILOT_RECEIVER_NAME))
    assertFalse(parsed.facts.toString().contains(PILOT_REFERENCE))
    assertFalse(lookup.toString().contains(PILOT_REFERENCE))
  }

  @Test
  fun `retains mismatches as evidence for later server review`() {
    val parsed =
      parser.parse(
        livePilotProviderFound(
          livePilotHtml(reference = "PILOT9ABC9999", receiverName = "DIFFERENT RECEIVER"),
        ),
        lookup,
      ) as RoutineTelebirrParsedReceipt.Observed

    assertEquals("mismatched", parsed.facts.referenceMatch)
    assertEquals("mismatched", parsed.facts.receiverMatch)
    assertFalse(parsed.toString().contains("DIFFERENT RECEIVER"))
    assertFalse(parsed.facts.toString().contains("DIFFERENT RECEIVER"))
  }

  @Test
  fun `does not promote an unattested page to official evidence`() {
    val parsed =
      parser.parse(
        livePilotProviderFound(
          originAttestation = ProviderDocumentOriginAttestation.UNATTESTED,
        ),
        lookup,
      ) as RoutineTelebirrParsedReceipt.Review

    assertEquals("unknown_layout_provider_identity", parsed.reasonCode)
    assertFalse(parsed.toString().contains(PILOT_REFERENCE))
  }

  @Test
  fun `unknown provider status is observed but not converted into completion`() {
    val parsed =
      parser.parse(livePilotProviderFound(livePilotHtml(status = "Unexpected")), lookup)
        as RoutineTelebirrParsedReceipt.Observed

    assertEquals("unknown", parsed.facts.providerFinalStatus)
  }

  @Test
  fun `missing or ambiguous receipts require review`() {
    val cases =
      listOf(
        ProviderDocument.NotFound(repeatedDigest('6')) to "provider_not_found_unattested",
        livePilotProviderFound(livePilotHtml(duplicateInvoice = true)) to
          "unknown_layout_invoice_number",
        livePilotProviderFound(livePilotHtml(includePaymentReason = false)) to
          "unknown_layout_payment_reason",
      )

    for ((document, reason) in cases) {
      val parsed = parser.parse(document, lookup) as RoutineTelebirrParsedReceipt.Review
      assertEquals(reason, parsed.reasonCode)
      assertFalse(parsed.toString().contains(PILOT_REFERENCE))
    }
  }

  @Test
  fun `expectation rejects malformed candidate and receiver binding`() {
    assertFails { lookup.copy(candidateId = "pilot-assignment-0001") }
    assertFails { lookup.copy(rawReference = "bad/ref") }
    assertFails { lookup.copy(expectedReceiverNameDigest = repeatedDigest('9')) }
    assertFails { lookup.copy(receiverRevisionId = "pilot-revision-0001") }
    assertFails { lookup.copy(receiverVersion = 0) }
  }

  @Test
  fun `routine name digest is distinct from pilot and normalizes the same full name`() {
    assertEquals(
      "sha256:6f4b944f412c74330943d7cedb2a1b96906fe1b3d19f493551bead5d29ce03bd",
      RoutineTelebirrReceiverName.digest(PILOT_RECEIVER_NAME),
    )
    assertEquals(
      RoutineTelebirrReceiverName.digest("  PILOT\tRECEIVER  "),
      RoutineTelebirrReceiverName.digest(PILOT_RECEIVER_NAME),
    )
    assertFalse(
      RoutineTelebirrReceiverName.digest(PILOT_RECEIVER_NAME) ==
        LivePilotCanonicalTranscripts.receiverNameDigest(PILOT_RECEIVER_NAME),
    )
  }

  private fun assertFails(block: () -> Unit) {
    var failed = false
    try {
      block()
    } catch (_: IllegalArgumentException) {
      failed = true
    }
    assertTrue(failed)
  }
}
