package com.fetanagent.telebirrverifier

import java.security.MessageDigest
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
  private val sms = "You have received ETB 100.00 from Synthetic Sender " +
    "on 20/10/2026 17:47:00. Your transaction number is SYNTHETIC001. " +
    "Thank you for using telebirr"

  @Test fun `phone signs an incoming SMS without customer assignment`() {
    val message = ReceiverSmsSignedObservation.Message(5,
      Instant.parse("2026-10-20T14:47:00Z").toEpochMilli(), sms)
    val envelope = ReceiverSmsSignedObservation.create("receiver_device_001", message,
      identity, Instant.parse("2026-10-20T14:48:00Z"))
    assertEquals("telebirr", envelope.body.providerCode)
    assertEquals("SYNTHETIC001", envelope.body.transactionReference)
    assertEquals(10_000L, envelope.body.amountMinor)
    assertEquals("2026-10-20T14:47:00.000Z", envelope.body.occurredAt)
    assertFalse(envelope.body.toString().contains("SYNTHETIC001"))
    assertFalse(envelope.toString().contains("ETB 100.00"))
    val verifier = Signature.getInstance("SHA256withECDSA")
    verifier.initVerify(identity.keyPair.public)
    verifier.update(ReceiverSmsSignedObservation.signatureBytes(envelope.bodyDigest))
    assertTrue(verifier.verify(EcdsaP1363.p1363ToDer(
      Base64.getUrlDecoder().decode(envelope.signature))))
  }

  @Test fun `clock and oversized messages fail closed`() {
    val now = Instant.parse("2026-10-20T14:48:00Z")
    assertThrows(IllegalArgumentException::class.java) {
      ReceiverSmsSignedObservation.create("receiver_device_001",
        ReceiverSmsSignedObservation.Message(5, now.plusSeconds(600).toEpochMilli(), sms),
        identity, now)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ReceiverSmsSignedObservation.create("receiver_device_001",
        ReceiverSmsSignedObservation.Message(5, now.toEpochMilli(), "X".repeat(2_049)),
        identity, now)
    }
  }

  @Test fun `SMS event transcript matches server digest`() {
    val body = ReceiverSmsSignedObservation.Body(
      1, ReceiverSmsSignedObservation.PROTOCOL_MODE,
      "receiver_device_001", "receiver_key_001", 5,
      "sha256:" + "e".repeat(64),
      "telebirr", "SYNTHETIC001", 10_000L, "2026-10-20T14:47:00.000Z",
      "2026-10-20T14:47:00.000Z", "2026-10-20T14:48:00.000Z",
    )
    val digest = MessageDigest.getInstance("SHA-256")
      .digest(ReceiverSmsSignedObservation.bodyBytes(body))
      .joinToString("") { "%02x".format(it) }
    assertEquals("56ba3d983fe669636fbfb379fbc2322c4584385b8ad51ae7653210786007d207", digest)
  }
}
