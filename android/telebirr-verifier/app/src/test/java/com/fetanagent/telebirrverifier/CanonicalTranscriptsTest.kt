package com.fetanagent.telebirrverifier

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class CanonicalTranscriptsTest {
  @Test
  fun `matches the TypeScript signed relay byte vectors`() {
    val facts = vectorFacts()
    val body = vectorBody(facts)
    val transcript = CanonicalTranscripts.signatureTranscriptBytes(body)

    assertEquals(753, CanonicalTranscripts.receiptFactsBytes(facts).size)
    assertEquals(
      "sha256:bb2556964474fe998e977ac6b879fc1f5a33f6e58ea1e54f16d069855b3614e6",
      CanonicalTranscripts.receiptFactsDigest(facts),
    )
    assertEquals(2168, CanonicalTranscripts.observationBodyBytes(body).size)
    assertEquals(
      "sha256:4fc9c9aa89d47398b7cfa8f109daeb59a36b7a84070505e89ee2dd4e169d2ecc",
      CanonicalTranscripts.observationBodyDigest(body),
    )
    assertEquals(472, transcript.size)
    assertEquals(
      "sha256:8406eaba1075b454a94ffd380d35ce5db9f721db02ebe916012f17d4ba5ec317",
      CanonicalTranscripts.sha256(transcript),
    )
  }

  @Test
  fun `rejects malformed identifiers timestamps and fact correlations`() {
    assertThrows(IllegalArgumentException::class.java) {
      CanonicalReference.fromCanonical("https://attacker.invalid/receipt/TEST9ABC1234")
    }
    assertThrows(IllegalArgumentException::class.java) {
      NotFoundReceiptFacts("found")
    }
    assertThrows(IllegalArgumentException::class.java) {
      vectorFacts().copy(canonicalReferencePresent = false, referenceMatch = "matched")
    }
    assertThrows(IllegalArgumentException::class.java) {
      vectorFacts().copy(retrievedAt = "2026-08-20T18:02:00.000Z")
    }
  }

  @Test
  fun `exposes no database KemerBet settlement or financial authority`() {
    RelayProtocol.CAPABILITIES.javaClass.declaredFields
      .filter { it.type == Boolean::class.javaPrimitiveType }
      .forEach { field ->
        field.isAccessible = true
        assertFalse(field.name, field.getBoolean(RelayProtocol.CAPABILITIES))
      }
  }
}
