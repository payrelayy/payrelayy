package com.fetanagent.telebirrverifier

import java.nio.charset.StandardCharsets
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutineTelebirrDevicePairingTest {
  private val challenge =
    RoutineDevicePairingChallenge(
      pairingId = "55f26210-6754-4b93-8c8d-4ca7cf33e279",
      pairingNonceDigest = repeatedDigest('a'),
      receiverRevisionId = "98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803",
      receiverVersion = 3,
      receiverProfileDigest = repeatedDigest('b'),
      expectedReceiverNameDigest = repeatedDigest('c'),
      issuedAt = "2026-10-06T11:59:00.000Z",
      expiresAt = "2026-10-06T12:09:00.000Z",
    )
  private val identity = JvmP256Identity("routine-device-key-0001")

  private fun proof(): RoutineSignedDevicePairingProof =
    RoutineDevicePairingProofFactory.create(
      challenge = challenge,
      deviceId = "routine-device-0001",
      identity = identity,
      issuedAt = "2026-10-06T12:00:00.000Z",
      expiresAt = "2026-10-06T12:05:00.000Z",
    )

  @Test
  fun `body digest matches the TypeScript fixed synthetic SPKI vector`() {
    val spki =
      "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZl_5JsOZvoSviWoLO7NLMkWIxu4s2lmHNEbAY_-WhY6CGVICyKcxwVUSpWve1CrjjNY79QYUfCoUgGxQM4AhMg"
    val fixedBody =
      RoutineDevicePairingBody(
        pairingId = challenge.pairingId,
        pairingNonceDigest = challenge.pairingNonceDigest,
        receiverRevisionId = challenge.receiverRevisionId,
        receiverVersion = challenge.receiverVersion,
        receiverProfileDigest = challenge.receiverProfileDigest,
        expectedReceiverNameDigest = challenge.expectedReceiverNameDigest,
        deviceId = "routine-device-0001",
        keyId = "routine-device-key-0001",
        devicePublicKeySpki = spki,
        devicePublicKeySpkiSha256 =
          RoutineLookupCanonicalTranscripts.sha256(Base64.getUrlDecoder().decode(spki)),
        issuedAt = "2026-10-06T12:00:00.000Z",
        expiresAt = "2026-10-06T12:05:00.000Z",
      )
    assertEquals(
      "sha256:735665c0e0b6a5ce1bd8aab46974defb99be1bdc2bf8fced0b50fd63bab792d5",
      RoutineDevicePairingCanonical.bodyDigest(fixedBody),
    )
  }

  @Test
  fun `signs exact routine proof and encodes a strict wire shape without enrollment`() {
    val signed = proof()
    assertEquals(RoutineDevicePairingCanonical.bodyDigest(signed.body), signed.bodyDigest)
    assertTrue(
      DeviceBridgeCrypto.verifyP1363(
        identity.keyPair.public.encoded,
        RoutineDevicePairingCanonical.signatureBytes(signed.body),
        signed.signature,
      ),
    )
    val wire = RoutineDevicePairingJsonCodec.encode(signed)
    assertEquals(signed, RoutineDevicePairingJsonCodec.decode(wire))
    assertFalse(signed.toString().contains(challenge.pairingNonceDigest))
    assertFalse(signed.body.toString().contains(challenge.receiverProfileDigest))
  }

  @Test
  fun `decodes the exact Owner challenge package but never treats it as an enrollment`() {
    val json =
      """{"contractVersion":1,"providerCode":"telebirr","protocolMode":"routine_device_pairing_v1","pairingId":"${challenge.pairingId}","pairingNonceDigest":"${challenge.pairingNonceDigest}","receiverRevisionId":"${challenge.receiverRevisionId}","receiverVersion":${challenge.receiverVersion},"receiverProfileDigest":"${challenge.receiverProfileDigest}","expectedReceiverNameDigest":"${challenge.expectedReceiverNameDigest}","issuedAt":"${challenge.issuedAt}","expiresAt":"${challenge.expiresAt}"}"""
    val packageValue = "fetanagent-routine-pairing-v1." +
      Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(StandardCharsets.UTF_8))
    assertEquals(challenge, RoutineDevicePairingJsonCodec.decodeChallengePackage(packageValue))
    assertNull(RoutineDevicePairingJsonCodec.decodeChallengePackage(packageValue.replaceFirst("routine-pairing", "pairing")))
    val duplicate = json.replaceFirst("\"pairingId\":", "\"pairingId\":\"${challenge.pairingId}\",\"pairingId\":")
    assertNull(RoutineDevicePairingJsonCodec.decodeChallengePackage(
      "fetanagent-routine-pairing-v1." + Base64.getUrlEncoder().withoutPadding()
        .encodeToString(duplicate.toByteArray(StandardCharsets.UTF_8)),
    ))
  }

  @Test
  fun `rejects pilot relabeling, duplicate keys, stale digest, and noncanonical input`() {
    val signed = proof()
    val wire = String(RoutineDevicePairingJsonCodec.encode(signed), StandardCharsets.UTF_8)
    val duplicate = wire.replaceFirst("\"pairingId\":", "\"pairingId\":\"${challenge.pairingId}\",\"pairingId\":")
    val pilot = wire.replaceFirst(RoutineDevicePairingProtocol.MODE, "device_bridge_no_money_v1")
    val extra = wire.replaceFirst("{", "{\"pilotRevisionId\":\"${challenge.pairingId}\",")
    val stale = wire.replaceFirst(signed.bodyDigest, repeatedDigest('f'))
    for (invalid in listOf(duplicate, pilot, extra, stale)) {
      assertNull(RoutineDevicePairingJsonCodec.decode(invalid.toByteArray(StandardCharsets.UTF_8)))
    }
    assertNull(RoutineDevicePairingJsonCodec.decode(byteArrayOf(0xC3.toByte(), 0x28)))
    assertNull(RoutineDevicePairingJsonCodec.decode(ByteArray(4_097)))
    assertTrue(
      runCatching {
          RoutineDevicePairingProofFactory.create(
            challenge = challenge,
            deviceId = "routine-device-0001",
            identity = identity,
            issuedAt = "2026-10-06T12:10:00.000Z",
            expiresAt = "2026-10-06T12:11:00.000Z",
          )
        }.isFailure,
    )
  }
}
