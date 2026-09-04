package com.fetanagent.telebirrverifier

import java.io.File
import java.nio.file.Files
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EncryptedLivePilotWorkStoreTest {
  private val roots = mutableListOf<File>()

  @After
  fun cleanUp() {
    roots.forEach(File::deleteRecursively)
  }

  @Test
  fun `pending signed evidence is encrypted and survives process recreation exactly`() {
    val directory = queueDirectory()
    val cipher = TestQueueCipher()
    val pending = pendingUpload()
    val first = EncryptedFileLivePilotWorkStore(directory, cipher)

    assertEquals(LivePilotWorkClaim.Acquired, first.claim(pending.assignment.bodyDigest))
    first.stage(
      pending.assignment.bodyDigest,
      pending.assignment,
      pending.observation,
    )

    val record = requireNotNull(directory.listFiles()).single()
    val sealedText = record.readBytes().toString(Charsets.ISO_8859_1)
    assertFalse(sealedText.contains(PILOT_REFERENCE))
    assertFalse(sealedText.contains(PILOT_RECEIVER_NAME))
    assertFalse(sealedText.contains(pending.assignment.signature))
    assertFalse(sealedText.contains(pending.observation.signature))
    assertFalse(first.toString().contains(PILOT_REFERENCE))

    val recovered = EncryptedFileLivePilotWorkStore(directory, cipher)
    assertEquals(pending, recovered.nextPending())
    val claim = recovered.claim(pending.assignment.bodyDigest) as LivePilotWorkClaim.Pending
    assertEquals(pending, claim.upload)
    assertEquals(pending.observation.signature, claim.upload.observation.signature)

    recovered.acknowledge(
      pending.assignment.bodyDigest,
      pending.observation.bodyDigest,
    )
    val completed = EncryptedFileLivePilotWorkStore(directory, cipher)
    assertEquals(
      LivePilotWorkClaim.Acknowledged,
      completed.claim(pending.assignment.bodyDigest),
    )
    assertNull(completed.nextPending())
  }

  @Test
  fun `restart drains exact staged evidence before asking for another assignment`() {
    val directory = queueDirectory()
    val cipher = TestQueueCipher()
    val (authenticated, signer, device) = authenticateLivePilotAssignment()
    val assignment = livePilotSignedAssignment(authenticated.body, signer)
    var firstTransportCalls = 0
    val firstStore = EncryptedFileLivePilotWorkStore(directory, cipher)
    val first =
      coordinator(
        signer,
        device,
        firstStore,
        assignmentSource = LivePilotAssignmentSource { assignment },
        transport = ProviderTransport {
          firstTransportCalls += 1
          livePilotProviderFound()
        },
        uploader = LivePilotObservationUploader { _, _ -> LivePilotUploadResult.Retryable },
      )

    val pendingStatus = first.runOnce()
    val staged = requireNotNull(firstStore.nextPending())
    assertEquals(LivePilotRuntimeState.UPLOAD_PENDING, pendingStatus.state)
    assertEquals(1, firstTransportCalls)

    var assignmentCalls = 0
    var recoveryTransportCalls = 0
    var recoveredObservation: LivePilotSignedObservation? = null
    val recoveredStore = EncryptedFileLivePilotWorkStore(directory, cipher)
    val recovered =
      coordinator(
        signer,
        device,
        recoveredStore,
        assignmentSource = LivePilotAssignmentSource {
          assignmentCalls += 1
          error("Pending evidence must drain before another lease")
        },
        transport = ProviderTransport {
          recoveryTransportCalls += 1
          error("Pending evidence must not refetch the provider receipt")
        },
        uploader = LivePilotObservationUploader { recoveredAssignment, observation ->
          assertEquals(staged.assignment, recoveredAssignment)
          recoveredObservation = observation
          LivePilotUploadResult.Acknowledged(observation.bodyDigest)
        },
      )

    val completed = recovered.runOnce()
    assertEquals(LivePilotRuntimeState.READY, completed.state)
    assertEquals("observation_acknowledged", completed.code)
    assertEquals(0, assignmentCalls)
    assertEquals(0, recoveryTransportCalls)
    assertNotNull(recoveredObservation)
    assertEquals(staged.observation.bodyDigest, recoveredObservation?.bodyDigest)
    assertEquals(staged.observation.signature, recoveredObservation?.signature)
  }

  @Test
  fun `tampered encrypted record fails closed without exposing queued material`() {
    val directory = queueDirectory()
    val cipher = TestQueueCipher()
    val pending = pendingUpload()
    val store = EncryptedFileLivePilotWorkStore(directory, cipher)
    store.claim(pending.assignment.bodyDigest)
    store.stage(pending.assignment.bodyDigest, pending.assignment, pending.observation)
    val record = requireNotNull(directory.listFiles()).single()
    val tampered = record.readBytes()
    tampered[tampered.lastIndex] = (tampered.last().toInt() xor 1).toByte()
    record.writeBytes(tampered)

    val failure = runCatching { EncryptedFileLivePilotWorkStore(directory, cipher) }.exceptionOrNull()
    assertNotNull(failure)
    assertFalse(failure.toString().contains(PILOT_REFERENCE))
    assertFalse(failure.toString().contains(PILOT_RECEIVER_NAME))
  }

  @Test
  fun `interrupted pre-stage claim is released on process recovery`() {
    val directory = queueDirectory()
    val cipher = TestQueueCipher()
    val digest = livePilotSignedAssignment(livePilotAssignmentBody(), JvmP256Identity("pilot-server-key-0001")).bodyDigest
    val first = EncryptedFileLivePilotWorkStore(directory, cipher)
    assertEquals(LivePilotWorkClaim.Acquired, first.claim(digest))

    val recovered = EncryptedFileLivePilotWorkStore(directory, cipher)
    assertEquals(LivePilotWorkClaim.Acquired, recovered.claim(digest))
  }

  @Test
  fun `rejection tombstone survives restart and blocks re-observation`() {
    val directory = queueDirectory()
    val cipher = TestQueueCipher()
    val pending = pendingUpload()
    val first = EncryptedFileLivePilotWorkStore(directory, cipher)
    first.claim(pending.assignment.bodyDigest)
    first.stage(pending.assignment.bodyDigest, pending.assignment, pending.observation)
    first.reject(pending.assignment.bodyDigest, LivePilotUploadRejection.PILOT_STOPPED)

    val recovered = EncryptedFileLivePilotWorkStore(directory, cipher)
    assertEquals(
      LivePilotWorkClaim.Rejected(LivePilotUploadRejection.PILOT_STOPPED),
      recovered.claim(pending.assignment.bodyDigest),
    )
    assertNull(recovered.nextPending())
  }

  private fun pendingUpload(): LivePilotPendingUpload {
    val (authenticated, signer, device) = authenticateLivePilotAssignment()
    val assignment = livePilotSignedAssignment(authenticated.body, signer)
    val observation =
      LivePilotSignedObservationFactory.create(
        assignment = authenticated,
        facts = livePilotFoundFacts(),
        sourceDocumentDigest = repeatedDigest('8'),
        observedAt = "2026-08-20T18:03:00.000Z",
        identity = device,
      )
    return LivePilotPendingUpload(assignment, observation)
  }

  private fun coordinator(
    signer: JvmP256Identity,
    device: JvmP256Identity,
    store: LivePilotWorkStore,
    assignmentSource: LivePilotAssignmentSource,
    transport: ProviderTransport,
    uploader: LivePilotObservationUploader,
  ): LivePrivatePilotRuntimeCoordinator =
    LivePrivatePilotRuntimeCoordinator(
      gate = LivePilotRuntimeGate(true, true, true),
      trustedSigner = livePilotTrustedSigner(signer),
      enrollment = livePilotEnrollment(device),
      signerPublicSpkiDer = signer.keyPair.public.encoded,
      identity = device,
      assignmentSource = assignmentSource,
      transport = transport,
      parser = LivePrivatePilotReceiptParser(),
      uploader = uploader,
      workStore = store,
      clock = MillisClock { java.time.Instant.parse("2026-08-20T18:03:00.000Z").toEpochMilli() },
    )

  private fun queueDirectory(): File {
    val root = Files.createTempDirectory("fetanagent-android-queue-test-").toFile()
    roots += root
    return File(root, "queue")
  }

  private class TestQueueCipher : LivePilotQueueCipher {
    private val key =
      SecretKeySpec(ByteArray(32) { index -> (index * 7 + 11).toByte() }, "AES")
    private val random = SecureRandom()

    override fun seal(plaintext: ByteArray, associatedData: ByteArray): ByteArray {
      val nonce = ByteArray(12).also(random::nextBytes)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce))
      cipher.updateAAD(associatedData)
      return nonce + cipher.doFinal(plaintext)
    }

    override fun open(sealed: ByteArray, associatedData: ByteArray): ByteArray {
      require(sealed.size > 12 + 16)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
      cipher.updateAAD(associatedData)
      return cipher.doFinal(sealed.copyOfRange(12, sealed.size))
    }
  }
}
