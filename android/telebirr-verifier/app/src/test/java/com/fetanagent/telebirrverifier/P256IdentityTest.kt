package com.fetanagent.telebirrverifier

import java.security.Signature
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class P256IdentityTest {
  @Test
  fun `signs and verifies the canonical transcript as P256 P1363`() {
    val identity = JvmP256Identity()
    val observation = SignedObservationFactory.create(vectorBody(), identity)
    val p1363 = Base64.getUrlDecoder().decode(observation.signature)

    assertEquals(64, p1363.size)
    assertEquals(identity.publicMaterial().publicKeySpkiSha256, CanonicalTranscripts.sha256(identity.keyPair.public.encoded))

    val verifier = Signature.getInstance("SHA256withECDSA")
    verifier.initVerify(identity.keyPair.public)
    verifier.update(CanonicalTranscripts.signatureTranscriptBytes(observation.body))
    assertTrue(verifier.verify(EcdsaP1363.p1363ToDer(p1363)))
  }

  @Test
  fun `rejects malformed DER and wrong signer binding`() {
    assertThrows(IllegalArgumentException::class.java) {
      EcdsaP1363.derToP1363(byteArrayOf(0x30, 0x00))
    }
    val identity = JvmP256Identity(keyId = "different-key-0001")
    assertThrows(IllegalArgumentException::class.java) {
      SignedObservationFactory.create(vectorBody(), identity)
    }
  }
}
