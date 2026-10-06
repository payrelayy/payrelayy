package com.fetanagent.telebirrverifier

import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutineTelebirrEnrollmentReceiptTest {
  private val roots = mutableListOf<File>()
  private val phone = JvmP256Identity("routine-device-key-0001")
  private val server = JvmP256Identity("routine-server-signer-0001")
  private val challenge = RoutineDevicePairingChallenge(
    pairingId = "55f26210-6754-4b93-8c8d-4ca7cf33e279",
    pairingNonceDigest = repeatedDigest('a'),
    receiverRevisionId = "98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803",
    receiverVersion = 3,
    receiverProfileDigest = repeatedDigest('c'),
    expectedReceiverNameDigest = repeatedDigest('d'),
    issuedAt = "2026-10-06T11:59:00.000Z",
    expiresAt = "2026-10-06T23:59:00.000Z",
  )

  @After fun cleanUp() { roots.forEach(File::deleteRecursively) }

  private fun proof() = RoutineDevicePairingProofFactory.create(
    challenge = challenge,
    deviceId = "routine-device-0001",
    identity = phone,
    issuedAt = "2026-10-06T12:00:00.000Z",
    expiresAt = "2026-10-06T12:05:00.000Z",
  )

  private fun body(proof: RoutineSignedDevicePairingProof) = RoutineEnrollmentReceiptBody(
    enrollmentId = challenge.pairingId,
    pairingEvidenceDigest = proof.bodyDigest,
    deviceId = proof.body.deviceId,
    keyId = proof.body.keyId,
    devicePublicKeySpkiSha256 = proof.body.devicePublicKeySpkiSha256,
    receiverRevisionId = proof.body.receiverRevisionId,
    receiverVersion = proof.body.receiverVersion,
    receiverProfileDigest = proof.body.receiverProfileDigest,
    expectedReceiverNameDigest = proof.body.expectedReceiverNameDigest,
    validFrom = "2026-10-06T12:00:00.000Z",
    validUntil = "2026-11-05T12:00:00.000Z",
    issuedAt = "2026-10-06T12:00:01.000Z",
  )

  private fun receipt(body: RoutineEnrollmentReceiptBody): RoutineSignedEnrollmentReceipt =
    RoutineSignedEnrollmentReceipt(
      bodyDigest = RoutineEnrollmentReceiptProtocol.bodyDigest(body),
      signerKeyId = server.keyId,
      body = body,
      signature = Base64.getUrlEncoder().withoutPadding().encodeToString(
        server.signP1363(RoutineEnrollmentReceiptProtocol.signatureBytes(body, server.keyId)),
      ),
    )

  private fun signer() = RoutineEnrollmentTrustedSigner(
    signerKeyId = server.keyId,
    publicKeySpki = server.publicMaterial().publicKeySpkiBase64Url,
    publicKeySpkiSha256 = server.publicMaterial().publicKeySpkiSha256,
    validFrom = "2026-10-06T00:00:00.000Z",
    validUntil = "2026-11-06T00:00:00.000Z",
    state = "active",
  )

  @Test fun `canonical receipt body matches TypeScript fixed vector`() {
    val fixed = RoutineEnrollmentReceiptBody(
      enrollmentId = challenge.pairingId,
      pairingEvidenceDigest = repeatedDigest('a'),
      deviceId = "routine-device-0001",
      keyId = "routine-key-0001",
      devicePublicKeySpkiSha256 = repeatedDigest('b'),
      receiverRevisionId = challenge.receiverRevisionId,
      receiverVersion = 3,
      receiverProfileDigest = repeatedDigest('c'),
      expectedReceiverNameDigest = repeatedDigest('d'),
      validFrom = "2026-10-06T12:00:00.000Z",
      validUntil = "2026-11-05T12:00:00.000Z",
      issuedAt = "2026-10-06T12:00:01.000Z",
    )
    assertEquals(
      "sha256:216dcfc9894a15bfd2ea197c60f47fa7f165d013aaa87e3460169e255ccfd6eb",
      RoutineEnrollmentReceiptProtocol.bodyDigest(fixed),
    )
  }

  @Test fun `signed receipt authenticates signer, phone and receiver without money authority`() {
    val pending = proof()
    val signed = receipt(body(pending))
    val bytes = RoutineEnrollmentReceiptJsonCodec.encode(signed)
    assertEquals(signed, RoutineEnrollmentReceiptJsonCodec.decode(bytes))
    val binding = RoutineEnrollmentExpectedBinding.fromPairingProof(pending)
    assertTrue(RoutineEnrollmentReceiptProtocol.verify(
      signed, signer(), binding, phone.publicMaterial(), "2026-10-07T12:00:00.000Z"))
    assertFalse(RoutineEnrollmentReceiptProtocol.verify(
      signed, signer().copy(state = "revoked"), binding, phone.publicMaterial(),
      "2026-10-07T12:00:00.000Z"))
    assertFalse(RoutineEnrollmentReceiptProtocol.verify(
      signed, signer(), binding.copy(deviceId = "different-device-0001"), phone.publicMaterial(),
      "2026-10-07T12:00:00.000Z"))
    assertFalse(RoutineEnrollmentReceiptProtocol.verify(
      signed, signer(), binding, phone.publicMaterial(), signed.body.validUntil))
    assertFalse(RoutineEnrollmentReceiptProtocol.verify(
      signed.copy(signature = "A".repeat(86)), signer(), binding, phone.publicMaterial(),
      "2026-10-07T12:00:00.000Z"))
    assertTrue(signed.toString().contains("<redacted>"))
    assertFalse(signed.toString().contains(signed.signature))
  }

  @Test fun `rejects duplicate keys, pilot mode and authority escalation`() {
    val signed = receipt(body(proof()))
    val wire = String(RoutineEnrollmentReceiptJsonCodec.encode(signed), StandardCharsets.UTF_8)
    assertNull(RoutineEnrollmentReceiptJsonCodec.decode(
      wire.replaceFirst("\"enrollmentId\":", "\"enrollmentId\":\"${signed.body.enrollmentId}\",\"enrollmentId\":")
        .toByteArray(StandardCharsets.UTF_8)))
    assertNull(RoutineEnrollmentReceiptJsonCodec.decode(
      wire.replaceFirst(RoutineEnrollmentReceiptProtocol.MODE, "device_bridge_no_money_v1")
        .toByteArray(StandardCharsets.UTF_8)))
    assertNull(RoutineEnrollmentReceiptJsonCodec.decode(
      wire.replaceFirst("\"assignmentPollingAllowed\":false", "\"assignmentPollingAllowed\":true")
        .toByteArray(StandardCharsets.UTF_8)))
    assertTrue(runCatching { signed.body.copy(financialActionAllowed = true) }.isFailure)
  }

  @Test fun `seals exact pending proof across restart and only completes with authenticated receipt`() {
    val root = Files.createTempDirectory("routine-enrollment-test-").toFile().also(roots::add)
    val directory = File(root, "routine-enrollment")
    val cipher = TestCipher()
    val pending = proof()
    val now = Instant.parse("2026-10-06T12:02:00.000Z").toEpochMilli()
    EncryptedRoutineEnrollmentStore(directory, cipher).stagePending(pending, phone, now)
    val restored = EncryptedRoutineEnrollmentStore(directory, cipher)
    assertEquals(pending, restored.loadPending(phone, now))
    assertNull(restored.loadPending(phone, Instant.parse(pending.body.expiresAt).toEpochMilli()))
    val signed = receipt(body(pending))
    assertTrue(runCatching { restored.complete(signed.copy(signature = "A".repeat(86)),
      signer(), phone, "2026-10-07T12:00:00.000Z") }.isFailure)
    assertEquals(pending, restored.loadPending(phone, now))
    restored.complete(signed, signer(), phone, "2026-10-07T12:00:00.000Z")
    val completed = EncryptedRoutineEnrollmentStore(directory, cipher)
    assertEquals(signed, completed.loadEnrolled(signer(), phone, "2026-10-07T12:00:00.000Z"))
    assertNull(completed.loadEnrolled(signer().copy(state = "revoked"), phone,
      "2026-10-07T12:00:00.000Z"))
    assertNull(completed.loadPending(phone, now))
    assertTrue(runCatching { completed.stagePending(pending, phone, now) }.isFailure)
  }

  private class TestCipher : LivePilotQueueCipher {
    private val key = SecretKeySpec(ByteArray(32) { index -> (index * 5 + 17).toByte() }, "AES")
    private val random = SecureRandom()

    override fun seal(plaintext: ByteArray, associatedData: ByteArray): ByteArray {
      val nonce = ByteArray(12).also(random::nextBytes)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce))
      cipher.updateAAD(associatedData)
      return nonce + cipher.doFinal(plaintext)
    }

    override fun open(sealed: ByteArray, associatedData: ByteArray): ByteArray {
      require(sealed.size > 28)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
      cipher.updateAAD(associatedData)
      return cipher.doFinal(sealed.copyOfRange(12, sealed.size))
    }
  }
}
