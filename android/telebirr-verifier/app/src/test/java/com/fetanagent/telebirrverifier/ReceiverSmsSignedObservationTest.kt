package com.fetanagent.telebirrverifier

import java.security.Signature
import java.time.Instant
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiverSmsSignedObservationTest {
  private val identity = JvmP256Identity()
  private val binding = ReceiverSmsSignedObservation.Binding(
    providerCode = "cbe_birr",
    candidateId = "a681cdd0-4d74-47c1-a420-07a14521550b",
    rawReference = "SYNTHCBE001",
    referenceFingerprint = "a".repeat(64),
    receiverRevisionId = "43119b2b-6644-4ce4-adc3-38ab89031704",
    receiverVersion = 3,
    receiverProfileDigest = "sha256:" + "b".repeat(64),
    expectedReceiverNameDigest = "sha256:" + "c".repeat(64),
    deviceId = "receiver_device_001",
    keyId = identity.keyId,
    challengeId = "a2f47ba0-2a89-4f68-ac66-289603f34922",
    challengeDigest = "sha256:" + "d".repeat(64),
    sourceSubscriptionId = 5,
  )
  private val source = ReceiverPaymentSmsParser.Source(
    ReceiverPaymentSmsParser.Provider.CBE_BIRR, 5, "Test Receiver", "251900000001")
  private val text = "Dear Test Receiver, you received 100.00Br. from " +
    "251900000002 - Synthetic Payer on 20/10/26 17:46,Txn ID " +
    "SYNTHCBE001.Your CBE Birr account balance is 1,000.00Br. Thank you! " +
    "For invoice https://cbepay1.cbe.com.et/aureceipt?TID=SYNTHCBE001&PH=251900000001"

  @Test fun `paired identity signs only the normalized SMS facts`() {
    val parsed = ReceiverPaymentSmsParser().parse(
      ReceiverPaymentSmsParser.Message(5,
        Instant.parse("2026-10-20T14:47:00Z").toEpochMilli(), text),
      source, binding.rawReference) as ReceiverPaymentSmsParser.Result.Match
    val signed = ReceiverSmsSignedObservation.create(binding, parsed, identity,
      Instant.parse("2026-10-20T14:48:00Z"))
    assertEquals("cbe_birr", signed.body.providerCode)
    assertEquals(10_000L, signed.body.amountMinor)
    assertEquals("2026-10-20T14:46:00.000Z", signed.body.occurredAt)
    assertFalse(signed.body.toString().contains(binding.rawReference))
    assertFalse(signed.toString().contains("Synthetic Payer"))
    val signature = Base64.getUrlDecoder().decode(signed.signature)
    val verifier = Signature.getInstance("SHA256withECDSA")
    verifier.initVerify(identity.keyPair.public)
    verifier.update(ReceiverSmsSignedObservation.signatureBytes(signed.bodyDigest))
    assertTrue(verifier.verify(EcdsaP1363.p1363ToDer(signature)))
  }

  @Test fun `another reference or subscription cannot be signed for the challenge`() {
    val parsed = ReceiverPaymentSmsParser().parse(
      ReceiverPaymentSmsParser.Message(5,
        Instant.parse("2026-10-20T14:47:00Z").toEpochMilli(), text),
      source, binding.rawReference) as ReceiverPaymentSmsParser.Result.Match
    assertThrows(IllegalArgumentException::class.java) {
      ReceiverSmsSignedObservation.create(ReceiverSmsSignedObservation.Binding(
        binding.providerCode, binding.candidateId, "SYNTHCBE002",
        binding.referenceFingerprint, binding.receiverRevisionId, binding.receiverVersion,
        binding.receiverProfileDigest, binding.expectedReceiverNameDigest,
        binding.deviceId, binding.keyId, binding.challengeId, binding.challengeDigest,
        binding.sourceSubscriptionId), parsed, identity,
        Instant.parse("2026-10-20T14:48:00Z"))
    }
    assertThrows(IllegalArgumentException::class.java) {
      ReceiverSmsSignedObservation.create(ReceiverSmsSignedObservation.Binding(
        binding.providerCode, binding.candidateId, binding.rawReference,
        binding.referenceFingerprint, binding.receiverRevisionId, binding.receiverVersion,
        binding.receiverProfileDigest, binding.expectedReceiverNameDigest,
        binding.deviceId, binding.keyId, binding.challengeId, binding.challengeDigest,
        1), parsed, identity, Instant.parse("2026-10-20T14:48:00Z"))
    }
  }
}
