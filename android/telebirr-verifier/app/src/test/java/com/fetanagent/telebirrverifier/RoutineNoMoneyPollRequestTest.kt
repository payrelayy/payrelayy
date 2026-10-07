package com.fetanagent.telebirrverifier

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutineNoMoneyPollRequestTest {
  private val phone = JvmP256Identity("routine-device-key-0001")
  private val signerIdentity = JvmP256Identity("routine-server-signer-0001")
  private val requestId = "aa7665c4-9aba-478d-a561-624164313426"

  private fun receipt(): RoutineSignedEnrollmentReceipt {
    val body = RoutineEnrollmentReceiptBody(
      enrollmentId = "e0b29bed-3337-4a3d-8c31-87bec24f2056",
      pairingEvidenceDigest = repeatedDigest('b'),
      deviceId = "routine-device-0001",
      keyId = phone.keyId,
      devicePublicKeySpkiSha256 = phone.publicMaterial().publicKeySpkiSha256,
      receiverRevisionId = "20c66227-44ea-414c-9673-63e7b320375d",
      receiverVersion = 3,
      receiverProfileDigest = repeatedDigest('a'),
      expectedReceiverNameDigest = repeatedDigest('c'),
      validFrom = "2026-10-07T10:00:00.000Z",
      validUntil = "2026-10-08T10:00:00.000Z",
      issuedAt = "2026-10-07T10:00:01.000Z",
    )
    return RoutineSignedEnrollmentReceipt(
      bodyDigest = RoutineEnrollmentReceiptProtocol.bodyDigest(body),
      signerKeyId = signerIdentity.keyId,
      body = body,
      signature = Base64.getUrlEncoder().withoutPadding().encodeToString(
        signerIdentity.signP1363(RoutineEnrollmentReceiptProtocol.signatureBytes(body, signerIdentity.keyId)),
      ),
    )
  }

  private fun signer() = RoutineEnrollmentTrustedSigner(
    signerKeyId = signerIdentity.keyId,
    publicKeySpki = signerIdentity.publicMaterial().publicKeySpkiBase64Url,
    publicKeySpkiSha256 = signerIdentity.publicMaterial().publicKeySpkiSha256,
    validFrom = "2026-10-07T00:00:00.000Z",
    validUntil = "2026-10-08T12:00:00.000Z",
    state = "active",
  )

  @Test fun `canonical poll body matches TypeScript vector`() {
    val body = RoutineNoMoneyPollBody(
      enrollmentId = "e0b29bed-3337-4a3d-8c31-87bec24f2056",
      deviceId = "routine-device-0001",
      keyId = "routine-device-key-0001",
      receiverRevisionId = "20c66227-44ea-414c-9673-63e7b320375d",
      receiverProfileDigest = repeatedDigest('a'),
      requestId = requestId,
      issuedAt = "2026-10-07T12:00:00.000Z",
      expiresAt = "2026-10-07T12:01:00.000Z",
    )
    assertEquals(
      "sha256:1156e01f06f84f3c96e72321a07f32dec8af36cf7045c3d949691b5cc127f804",
      RoutineNoMoneyPollProtocol.bodyDigest(body),
    )
    assertTrue(runCatching { body.copy(financialActionAllowed = true) }.isFailure)
  }

  @Test fun `signed poll is bound to an authenticated phone receipt but grants no authority`() {
    val now = Instant.parse("2026-10-07T12:00:30.000Z").toEpochMilli()
    val request = RoutineNoMoneyPollProtocol.create(receipt(), signer(), phone, now, requestId)
    assertEquals("2026-10-07T12:00:00.000Z", request.body.issuedAt)
    assertEquals("2026-10-07T12:01:00.000Z", request.body.expiresAt)
    assertEquals(RoutineNoMoneyPollProtocol.bodyDigest(request.body), request.bodyDigest)
    assertTrue(DeviceBridgeCrypto.verifyP1363(
      Base64.getUrlDecoder().decode(phone.publicMaterial().publicKeySpkiBase64Url),
      RoutineNoMoneyPollProtocol.signatureBytes(request.body), request.signature,
    ))
    val wire = String(RoutineNoMoneyPollProtocol.encode(request), StandardCharsets.UTF_8)
    assertTrue(wire.contains("\"evidenceOnly\":true"))
    assertTrue(wire.contains("\"financialActionAllowed\":false"))
    assertFalse(wire.contains("rawReference"))
    assertFalse(request.toString().contains(request.signature))
  }

  @Test fun `revoked signer, wrong device, and expired receipt cannot sign a poll`() {
    val now = Instant.parse("2026-10-07T12:00:30.000Z").toEpochMilli()
    assertTrue(runCatching { RoutineNoMoneyPollProtocol.create(
      receipt(), signer().copy(state = "revoked"), phone, now, requestId,
    ) }.isFailure)
    assertTrue(runCatching { RoutineNoMoneyPollProtocol.create(
      receipt(), signer(), JvmP256Identity("different-device-key-0001"), now, requestId,
    ) }.isFailure)
    assertTrue(runCatching { RoutineNoMoneyPollProtocol.create(
      receipt(), signer(), phone, Instant.parse("2026-10-08T10:00:00.000Z").toEpochMilli(), requestId,
    ) }.isFailure)
  }
}
