package com.fetanagent.telebirrverifier

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class RoutineTelebirrLookupAssignmentTest {
  private val signer = JvmP256Identity("routine-server-key-0001")
  private val device = JvmP256Identity("routine-device-key-0001")
  private val body =
    RoutineLookupAssignmentBody(
      candidateId = "8b9b4a1c-616d-495b-a259-56d39ffef5d1",
      rawReference = PILOT_REFERENCE,
      referenceFingerprint = "a".repeat(64),
      referenceKeyVersion = 2,
      referenceProfileVersion = 2,
      submittedAt = "2026-10-05T18:00:00.000Z",
      receiverRevisionId = "98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803",
      receiverVersion = 3,
      receiverProfileDigest = repeatedDigest('b'),
      receiverNameNormalizerVersion = RoutineTelebirrReceiverName.NORMALIZER_VERSION,
      expectedReceiverNameNormalized = PILOT_RECEIVER_NAME,
      expectedReceiverNameDigest =
        requireNotNull(RoutineTelebirrReceiverName.digest(PILOT_RECEIVER_NAME)),
      deviceId = "routine-device-0001",
      keyId = device.keyId,
      challengeId = "328535af-2636-44cd-84be-6effdfe9cac1",
      challengeDigest = repeatedDigest('d'),
      sourceProfile = RoutineTelebirrLookupProtocol.SOURCE_PROFILE,
      issuedAt = "2026-10-05T18:02:00.000Z",
      expiresAt = "2026-10-05T18:05:00.000Z",
    )
  private val trustedSigner =
    RoutineLookupTrustedSigner(
      signerKeyId = signer.keyId,
      publicKeySpkiSha256 = signer.publicMaterial().publicKeySpkiSha256,
      state = "active",
      validFrom = "2026-10-05T17:00:00.000Z",
      validUntil = "2026-10-06T17:00:00.000Z",
    )
  private val enrollment =
    RoutineLookupDeviceEnrollment(
      deviceId = body.deviceId,
      keyId = device.keyId,
      publicKeySpkiSha256 = device.publicMaterial().publicKeySpkiSha256,
      state = "active",
      validFrom = "2026-10-05T17:00:00.000Z",
      validUntil = "2026-10-06T17:00:00.000Z",
      receiverRevisionId = body.receiverRevisionId,
      receiverVersion = body.receiverVersion,
      receiverProfileDigest = body.receiverProfileDigest,
    )

  private fun signed(assigned: RoutineLookupAssignmentBody = body): RoutineSignedLookupAssignment =
    RoutineSignedLookupAssignment(
      bodyDigest = RoutineLookupCanonicalTranscripts.bodyDigest(assigned),
      signerKeyId = signer.keyId,
      body = assigned,
      signature =
        Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString(signer.signP1363(RoutineLookupCanonicalTranscripts.signatureBytes(assigned))),
    )

  private fun verify(
    assignment: RoutineSignedLookupAssignment = signed(),
    trusted: RoutineLookupTrustedSigner = trustedSigner,
    enrolled: RoutineLookupDeviceEnrollment = enrollment,
    signerSpki: ByteArray = signer.keyPair.public.encoded,
    localMaterial: IdentityPublicMaterial = device.publicMaterial(),
    assessedAt: String = "2026-10-05T18:03:00.000Z",
  ): RoutineLookupAssignmentAssessment =
    RoutineLookupAssignmentVerifier.verify(
      signer = trusted,
      enrollment = enrolled,
      signedAssignment = assignment,
      signerPublicSpkiDer = signerSpki,
      localDevicePublicMaterial = localMaterial,
      assessedAt = assessedAt,
    )

  @Test
  fun `body digest matches the TypeScript fixture transcript`() {
    assertEquals(
      "sha256:6a602dad56e2ac5ea6929b8be6dc1943ba8089340a6e6f519194bc5f9b986790",
      RoutineLookupCanonicalTranscripts.bodyDigest(body),
    )
  }

  @Test
  fun `verifies a TypeScript signed assignment with the same synthetic body`() {
    val signerSpki =
      Base64.getUrlDecoder().decode(
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2lFZHkVAex62LE6nsQhGzX2l3Qdr6QDLJMMpHTpZGC6GaXoqewf_-DYO_XSM4ZpeCbWJWD-w8rWMWd0-0h9P7g",
      )
    val assignment =
      signed().copy(
        signature =
          "L4uJUojm-uZoXftAKVRLnB31FJc6Lk6P2gmTSyEgGkBgAo4qXWoqevjFdBJVgvTVofsCrVBoNOeNkCbAsOaZ6w",
      )
    val trusted =
      trustedSigner.copy(
        publicKeySpkiSha256 =
          "sha256:ddebcd2503c19381dcabaf31b0bfe093296ffdd2e255f1c96437be004b77ff7a",
      )

    assertEquals(
      "would_open_assignment",
      verify(assignment = assignment, trusted = trusted, signerSpki = signerSpki).disposition,
    )
  }

  @Test
  fun `verifies a signed routine lookup and yields only a guarded receipt expectation`() {
    val assessment = verify()
    assertEquals("would_open_assignment", assessment.disposition)
    assertEquals("signed_assignment_matches_binding", assessment.reasonCode)
    assertEquals(false, assessment.candidateDatabaseBindingPerformed)
    assertEquals(false, assessment.sourceAuthenticationPerformed)
    assertEquals(false, assessment.financialActionAllowed)
    val authenticated = requireNotNull(assessment.authenticatedAssignment)
    val lookup = authenticated.receiptExpectation()
    assertEquals(body.candidateId, lookup.candidateId)
    assertEquals(body.expectedReceiverNameDigest, lookup.expectedReceiverNameDigest)
    val parsed = RoutineTelebirrReceiptParser().parse(livePilotProviderFound(), lookup)
      as RoutineTelebirrParsedReceipt.Observed
    assertEquals(body.expectedReceiverNameDigest, parsed.facts.creditedPartyNameDigest)
    assertFalse(assessment.toString().contains(PILOT_REFERENCE))
    assertFalse(authenticated.toString().contains(PILOT_REFERENCE))
    assertFalse(body.toString().contains(PILOT_RECEIVER_NAME))
  }

  @Test
  fun `rejects a different trusted signer or local device key`() {
    val other = JvmP256Identity("other-device-key-0001")
    assertEquals(
      "signer_key_mismatch",
      verify(signerSpki = other.keyPair.public.encoded).reasonCode,
    )
    assertEquals(
      "device_key_mismatch",
      verify(localMaterial = other.publicMaterial()).reasonCode,
    )
  }

  @Test
  fun `rejects revoked enrollment, receiver rotation and expired lookup`() {
    assertEquals(
      "signer_revoked_or_expired",
      verify(trusted = trustedSigner.copy(state = "revoked")).reasonCode,
    )
    assertEquals(
      "device_revoked_or_expired",
      verify(enrolled = enrollment.copy(state = "revoked")).reasonCode,
    )
    assertEquals(
      "device_binding_mismatch",
      verify(enrolled = enrollment.copy(receiverVersion = 4)).reasonCode,
    )
    val expired = verify(assessedAt = body.expiresAt)
    assertEquals("lookup_expired", expired.reasonCode)
    assertNull(expired.authenticatedAssignment)
  }

  @Test
  fun `rejects changed body, digest and signature`() {
    val changedBody = signed().copy(body = body.copy(rawReference = "PILOT9ABC9999"))
    assertEquals("body_digest_mismatch", verify(assignment = changedBody).reasonCode)
    val changedDigest = signed().copy(bodyDigest = repeatedDigest('f'))
    assertEquals("body_digest_mismatch", verify(assignment = changedDigest).reasonCode)
    val signature = signed().signature
    val changedSignature =
      signed().copy(signature = (if (signature[0] == 'A') "B" else "A") + signature.drop(1))
    assertEquals("signature_invalid", verify(assignment = changedSignature).reasonCode)
  }

  @Test
  fun `pilot protocol and malformed routine bindings cannot be constructed`() {
    assertFails { body.copy(protocolMode = "live_private_pilot_v1") }
    assertFails { body.copy(expectedReceiverNameDigest = repeatedDigest('9')) }
    assertFails { body.copy(rawReference = "bad/ref") }
    assertFails { body.copy(receiverVersion = 0) }
    assertNotNull(verify().authenticatedAssignment)
  }

  private fun assertFails(block: () -> Unit) {
    var failed = false
    try {
      block()
    } catch (_: IllegalArgumentException) {
      failed = true
    }
    assertEquals(true, failed)
  }
}
