package com.fetanagent.telebirrverifier

import java.io.File
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceProvisioningTest {
  private val roots = mutableListOf<File>()

  @After
  fun cleanUp() {
    roots.forEach(File::deleteRecursively)
  }

  @Test
  fun `pairing package is canonical bounded and rejects mutation`() {
    val grant = grant()
    val encoded = DeviceBridgeJsonCodec.encodePairingGrantPackage(grant)

    assertTrue(encoded.startsWith("fetanagent-pairing-v1."))
    assertEquals(grant, DeviceBridgeJsonCodec.decodePairingGrantPackage(encoded))
    assertEquals(encoded, DeviceBridgeJsonCodec.encodePairingGrantPackage(grant))
    assertFalse(encoded.contains(grant.pairingNonceDigest))
    assertEquals(null, DeviceBridgeJsonCodec.decodePairingGrantPackage(" $encoded"))
    assertEquals(null, DeviceBridgeJsonCodec.decodePairingGrantPackage(encoded + "="))
    assertEquals(
      null,
      DeviceBridgeJsonCodec.decodePairingGrantPackage(
        encoded.replace("fetanagent-pairing-v1.", "fetanagent-pairing-v2."),
      ),
    )
  }

  @Test
  fun `bootstrap profile validates both independent public trust pins`() {
    val fixture = fixture()
    val profile = profile(fixture)

    profile.requireCertificateBinding(fixture.certificate)
    assertEquals(VerifierRuntimeMode.PAIRING_ONLY, profile.runtimeMode)
    assertFalse(profile.toString().contains(fixture.server.publicMaterial().publicKeySpkiBase64Url))
    assertTrue(
      runCatching {
          DeviceBridgeBootstrapProfile(
            runtimeMode = VerifierRuntimeMode.PAIRING_ONLY,
            serverSignerKeyId = fixture.server.keyId,
            serverSignerPublicKeySpkiDer = fixture.server.keyPair.public.encoded,
            serverSignerPublicKeySpkiSha256 = repeatedDigest('f'),
            assignmentSignerKeyId = fixture.assignmentSigner.keyId,
            assignmentSignerPublicKeySpkiDer = fixture.assignmentSigner.keyPair.public.encoded,
            assignmentSignerPublicKeySpkiSha256 =
              fixture.assignmentSigner.publicMaterial().publicKeySpkiSha256,
          )
        }
        .exceptionOrNull() is IllegalArgumentException,
    )
  }

  @Test
  fun `pending request and certificate survive only as encrypted no-backup state`() {
    val fixture = fixture()
    val directory = provisioningDirectory()
    val cipher = TestProvisioningCipher()
    val store = EncryptedFileDeviceProvisioningStore(directory, cipher)
    val pending = DeviceProvisioningState.Pending(grant(), fixture.pairing)

    store.stagePending(pending)
    val sealed = requireNotNull(directory.listFiles()).single().readBytes()
      .toString(Charsets.ISO_8859_1)
    assertFalse(sealed.contains(pending.grant.pairingNonceDigest))
    assertFalse(sealed.contains(pending.signedPairingRequest.signature))
    assertEquals(
      pending,
      EncryptedFileDeviceProvisioningStore(directory, cipher).load(),
    )

    store.complete(fixture.certificate)
    val recovered = EncryptedFileDeviceProvisioningStore(directory, cipher).load()
    assertEquals(DeviceProvisioningState.Enrolled(fixture.certificate), recovered)
    assertFalse(recovered.toString().contains(fixture.certificate.signature))
  }

  @Test
  fun `lost response retries the exact staged request then commits trusted enrollment`() {
    val grant = grant()
    val packageValue = DeviceBridgeJsonCodec.encodePairingGrantPackage(grant)
    val server = JvmP256Identity("bridge-server-key-0001")
    val assignmentSigner = JvmP256Identity("pilot-server-key-0001")
    val deviceKeyPair = JvmP256Identity("temporary-device-key").keyPair
    val store = EncryptedFileDeviceProvisioningStore(provisioningDirectory(), TestProvisioningCipher())
    var firstFrame: ByteArray? = null
    var exchangeCount = 0
    val exchange =
      DeviceBridgeExchange { path, contentType, frame ->
        assertEquals(DeviceBridgeProtocol.PAIRING_PATH, path)
        assertEquals(DeviceBridgeProtocol.CONTENT_TYPE, contentType)
        exchangeCount += 1
        if (exchangeCount == 1) {
          firstFrame = frame.copyOf()
          throw DeviceBridgeRetryableException()
        }
        assertTrue(requireNotNull(firstFrame).contentEquals(frame))
        val pairing = requireNotNull(DeviceBridgeJsonCodec.decodePairingRequest(frame))
        val certificate = certificate(pairing, server, assignmentSigner)
        DeviceBridgeRawResponse(
          statusCode = 201,
          contentType = DeviceBridgeProtocol.CONTENT_TYPE,
          body = DeviceBridgeJsonCodec.encodePairingResponseForTest(certificate),
        )
      }
    val coordinator =
      DevicePairingCoordinator(
        profile =
          DeviceBridgeBootstrapProfile(
            runtimeMode = VerifierRuntimeMode.PAIRING_ONLY,
            serverSignerKeyId = server.keyId,
            serverSignerPublicKeySpkiDer = server.keyPair.public.encoded,
            serverSignerPublicKeySpkiSha256 = server.publicMaterial().publicKeySpkiSha256,
            assignmentSignerKeyId = assignmentSigner.keyId,
            assignmentSignerPublicKeySpkiDer = assignmentSigner.keyPair.public.encoded,
            assignmentSignerPublicKeySpkiSha256 =
              assignmentSigner.publicMaterial().publicKeySpkiSha256,
          ),
        store = store,
        exchange = exchange,
        identityFactory =
          DevicePairingIdentityFactory { keyId -> JvmP256Identity(keyId, deviceKeyPair) },
        identifierSource =
          DevicePairingIdentifierSource { prefix ->
            if (prefix == "device_key") "device_key_0000000000000001"
            else "device_0000000000000001"
          },
        appVersion = "0.5.0-secure-provisioning-inert",
        clock = MillisClock { instant("2026-09-04T10:00:00.000Z") },
      )

    val firstFailure = runCatching { coordinator.pair(packageValue) }.exceptionOrNull()
    assertTrue(firstFailure is DevicePairingFailure)
    assertEquals("pairing_retry_required", (firstFailure as DevicePairingFailure).code)
    val pending = store.load() as DeviceProvisioningState.Pending
    assertTrue(requireNotNull(firstFrame).contentEquals(DeviceBridgeJsonCodec.encodePairingRequest(pending.signedPairingRequest)))
    assertEquals("2026-09-04T09:59:30.000Z", pending.signedPairingRequest.body.issuedAt)
    assertEquals("2026-09-04T10:05:00.000Z", pending.signedPairingRequest.body.expiresAt)

    val enrolled = coordinator.pair(packageValue)
    assertEquals(2, exchangeCount)
    assertEquals(enrolled, (store.load() as DeviceProvisioningState.Enrolled).certificate)
    assertEquals(server.keyId, enrolled.signerKeyId)
  }

  @Test
  fun `active enrollment refuses an unrelated challenge without replacing durable trust`() {
    val fixture = fixture()
    val store = EncryptedFileDeviceProvisioningStore(provisioningDirectory(), TestProvisioningCipher())
    store.stagePending(DeviceProvisioningState.Pending(grant(), fixture.pairing))
    store.complete(fixture.certificate)
    val newGrant =
      DevicePairingGrant(
        pairingId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        pairingNonceDigest = repeatedDigest('9'),
        expiresAt = "2026-09-04T10:25:00.000Z",
      )
    val coordinator =
      DevicePairingCoordinator(
        profile = profile(fixture),
        store = store,
        exchange = DeviceBridgeExchange { _, _, _ -> error("must not contact bridge") },
        identityFactory = DevicePairingIdentityFactory { fixture.device },
        appVersion = "0.5.0-secure-provisioning-inert",
        clock = MillisClock { instant("2026-09-04T10:00:10.000Z") },
      )

    val failure =
      runCatching {
          coordinator.pair(DeviceBridgeJsonCodec.encodePairingGrantPackage(newGrant))
        }
        .exceptionOrNull() as DevicePairingFailure
    assertEquals("pairing_enrollment_active", failure.code)
    assertEquals(
      DeviceProvisioningState.Enrolled(fixture.certificate),
      store.load(),
    )
  }

  private data class Fixture(
    val device: JvmP256Identity,
    val server: JvmP256Identity,
    val assignmentSigner: JvmP256Identity,
    val pairing: SignedDeviceBridgePairingRequest,
    val certificate: SignedDeviceBridgeEnrollmentCertificate,
  )

  private fun fixture(): Fixture {
    val device = JvmP256Identity("device_key_0000000000000001")
    val server = JvmP256Identity("bridge-server-key-0001")
    val assignmentSigner = JvmP256Identity("pilot-server-key-0001")
    val material = device.publicMaterial()
    val pairing =
      DeviceBridgeSignedFactory.pairing(
        DeviceBridgePairingBody(
          pairingId = grant().pairingId,
          pairingNonceDigest = grant().pairingNonceDigest,
          deviceId = "device_0000000000000001",
          keyId = device.keyId,
          devicePublicKeySpki = material.publicKeySpkiBase64Url,
          devicePublicKeySpkiSha256 = material.publicKeySpkiSha256,
          appVersion = "0.5.0-secure-provisioning-inert",
          issuedAt = "2026-09-04T10:00:00.000Z",
          expiresAt = "2026-09-04T10:05:00.000Z",
        ),
        device,
      )
    return Fixture(
      device,
      server,
      assignmentSigner,
      pairing,
      certificate(pairing, server, assignmentSigner),
    )
  }

  private fun certificate(
    pairing: SignedDeviceBridgePairingRequest,
    server: JvmP256Identity,
    assignmentSigner: JvmP256Identity,
  ): SignedDeviceBridgeEnrollmentCertificate {
    val body =
      DeviceBridgeEnrollmentCertificateBody(
        enrollmentId = "pilot-enrollment-0001",
        pairingId = pairing.body.pairingId,
        pairingRequestBodyDigest = pairing.bodyDigest,
        pairingNonceDigest = pairing.body.pairingNonceDigest,
        deviceId = pairing.body.deviceId,
        keyId = pairing.body.keyId,
        devicePublicKeySpki = pairing.body.devicePublicKeySpki,
        devicePublicKeySpkiSha256 = pairing.body.devicePublicKeySpkiSha256,
        minimumAppVersion = "0.5.0",
        pilotRevisionId = "pilot-revision-0001",
        receiverRevisionId = "pilot-receiver-revision-0001",
        receiverProfileId = "pilot-receiver-profile-0001",
        receiverProfileDigest = repeatedDigest('2'),
        receiverConfigurationDigest = repeatedDigest('3'),
        assignmentSignerKeyId = assignmentSigner.keyId,
        assignmentSignerPublicKeySpkiSha256 =
          assignmentSigner.publicMaterial().publicKeySpkiSha256,
        state = "active",
        issuedAt = "2026-09-04T10:00:00.000Z",
        validFrom = "2026-09-04T10:00:00.000Z",
        validUntil = "2026-09-04T11:00:00.000Z",
      )
    return SignedDeviceBridgeEnrollmentCertificate(
      bodyDigest = DeviceBridgeCanonical.enrollmentCertificateBodyDigest(body),
      signerKeyId = server.keyId,
      body = body,
      signature =
        Base64.getUrlEncoder().withoutPadding().encodeToString(
          server.signP1363(
            DeviceBridgeCanonical.enrollmentCertificateSignatureBytes(body, server.keyId),
          ),
        ),
    )
  }

  private fun profile(fixture: Fixture): DeviceBridgeBootstrapProfile =
    DeviceBridgeBootstrapProfile(
      runtimeMode = VerifierRuntimeMode.PAIRING_ONLY,
      serverSignerKeyId = fixture.server.keyId,
      serverSignerPublicKeySpkiDer = fixture.server.keyPair.public.encoded,
      serverSignerPublicKeySpkiSha256 = fixture.server.publicMaterial().publicKeySpkiSha256,
      assignmentSignerKeyId = fixture.assignmentSigner.keyId,
      assignmentSignerPublicKeySpkiDer = fixture.assignmentSigner.keyPair.public.encoded,
      assignmentSignerPublicKeySpkiSha256 =
        fixture.assignmentSigner.publicMaterial().publicKeySpkiSha256,
    )

  private fun grant(): DevicePairingGrant =
    DevicePairingGrant(
      pairingId = "11111111-2222-4333-8444-555555555555",
      pairingNonceDigest = repeatedDigest('1'),
      expiresAt = "2026-09-04T10:20:00.000Z",
    )

  private fun provisioningDirectory(): File {
    val root = Files.createTempDirectory("fetanagent-provisioning-test-").toFile()
    roots += root
    return File(root, "provisioning")
  }

  private fun instant(value: String): Long = Instant.parse(value).toEpochMilli()

  private class TestProvisioningCipher : LivePilotQueueCipher {
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

