package com.fetanagent.telebirrverifier

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RoutineTelebirrSignedObservationTest {
  private val facts =
    RoutineTelebirrObservedReceiptFacts(
      amountMinor = 2_500,
      canonicalReferencePresent = true,
      creditedPartyNameDigest =
        requireNotNull(RoutineTelebirrReceiverName.digest(PILOT_RECEIVER_NAME)),
      currencyCode = "ETB",
      evidenceSource = "provider_receipt_lookup",
      occurredAt = "2026-10-05T18:01:45.000Z",
      paymentChannel = "api_app",
      paymentMode = "telebirr",
      paymentReason = "send_money_to_registered_customer",
      providerFinalStatus = "completed",
      providerIdentity = "matched",
      receiverMatch = "matched",
      referenceMatch = "matched",
      retrievedAt = "2026-10-05T18:03:00.000Z",
      sourceProfile = "telebirr_official_receipt_v1",
    )
  private val body =
    RoutineTelebirrObservationBody(
      candidateId = "8b9b4a1c-616d-495b-a259-56d39ffef5d1",
      referenceFingerprint = "a".repeat(64),
      receiverRevisionId = "98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803",
      receiverVersion = 3,
      receiverProfileDigest = repeatedDigest('b'),
      expectedReceiverNameDigest = facts.creditedPartyNameDigest,
      deviceId = "routine-device-0001",
      keyId = "routine-device-key-0001",
      challengeId = "328535af-2636-44cd-84be-6effdfe9cac1",
      challengeDigest = repeatedDigest('d'),
      sourceDocumentDigest = repeatedDigest('e'),
      normalizedFactsDigest = RoutineTelebirrObservationCanonical.factsDigest(facts),
      observedAt = facts.retrievedAt,
      facts = facts,
    )

  @Test
  fun `facts and body digests match TypeScript signed-observation vectors`() {
    assertEquals(
      "sha256:e3a4bd12da42132a07bf3fbcefc0ce16e2ab20a4e2068797645d96b241c78b6f",
      RoutineTelebirrObservationCanonical.factsDigest(facts),
    )
    assertEquals(
      "sha256:a314d72dbfd5efc47b9575e393ba4453930e24aa5978311a082b437016e447ba",
      RoutineTelebirrObservationCanonical.bodyDigest(body),
    )
    assertFalse(body.toString().contains(PILOT_REFERENCE))
    assertFalse(facts.toString().contains(PILOT_RECEIVER_NAME))
  }
}
