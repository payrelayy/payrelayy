package com.fetanagent.telebirrverifier

import java.util.Base64

internal const val PILOT_REFERENCE = "PILOT9ABC1234"
internal const val PILOT_RECEIVER_NAME = "pilot receiver"

internal fun pilotFingerprint(character: Char): String =
  "hmac-sha256:" + character.toString().repeat(64)

internal fun livePilotAssignmentBody(
  rawReference: String = PILOT_REFERENCE,
  referenceFingerprint: String = pilotFingerprint('2'),
  expectedReceiverNameNormalized: String = PILOT_RECEIVER_NAME,
): LivePilotAssignmentBody =
  LivePilotAssignmentBody(
    contractVersion = 1,
    providerCode = "telebirr",
    protocolMode = "live_private_pilot_v1",
    assignmentId = "pilot-assignment-0001",
    requestId = "pilot-request-0001",
    jobId = "pilot-job-0001",
    attemptNumber = 1,
    pilotRevisionId = "pilot-revision-0001",
    deviceId = "pilot-device-0001",
    keyId = "pilot-device-key-0001",
    leaseNonceDigest = repeatedDigest('3'),
    challengeId = "pilot-challenge-0001",
    challengeDigest = repeatedDigest('4'),
    rawReference = rawReference,
    referenceFingerprint = referenceFingerprint,
    referenceBindingProfile = "telebirr-provider-reference-binding-v1",
    referenceBindingDigest =
      LivePilotCanonicalTranscripts.referenceBindingDigest(rawReference, referenceFingerprint),
    sourceProfile = "telebirr_official_receipt_v1",
    receiverRevisionId = "pilot-receiver-revision-0001",
    receiverProfileId = "pilot-receiver-profile-0001",
    receiverProfileDigest = repeatedDigest('1'),
    receiverConfigurationDigest = repeatedDigest('0'),
    receiverNameNormalizerVersion = "telebirr-credited-party-name-normalizer-v1",
    expectedReceiverNameNormalized = expectedReceiverNameNormalized,
    expectedReceiverNameDigest =
      requireNotNull(
        LivePilotCanonicalTranscripts.receiverNameDigest(expectedReceiverNameNormalized),
      ),
    adapterVersion = "telebirr-live-private-pilot-adapter-v1",
    parserVersion = "telebirr-official-receipt-live-pilot-parser-v1",
    factsNormalizerVersion = "telebirr-live-private-pilot-facts-normalizer-v1",
    issuedAt = "2026-08-20T18:02:00.000Z",
    expiresAt = "2026-08-20T18:04:00.000Z",
  )

internal fun livePilotSignedAssignment(
  body: LivePilotAssignmentBody,
  signer: JvmP256Identity,
): LivePilotSignedAssignment {
  val signature = signer.signP1363(LivePilotCanonicalTranscripts.assignmentSignatureBytes(body))
  return LivePilotSignedAssignment(
    contractVersion = 1,
    providerCode = "telebirr",
    protocolMode = "live_private_pilot_v1",
    transcriptVersion = "telebirr-live-private-pilot-assignment-transcript-v1",
    bodyDigestAlgorithm = "sha256",
    bodyDigest = LivePilotCanonicalTranscripts.assignmentBodyDigest(body),
    signatureAlgorithm = "ecdsa-p256-sha256",
    signatureEncoding = "ieee-p1363-base64url",
    signerKeyId = signer.keyId,
    body = body,
    signature = Base64.getUrlEncoder().withoutPadding().encodeToString(signature),
  )
}

internal fun livePilotTrustedSigner(signer: JvmP256Identity): LivePilotTrustedAssignmentSigner =
  LivePilotTrustedAssignmentSigner(
    contractVersion = 1,
    providerCode = "telebirr",
    protocolMode = "live_private_pilot_v1",
    signerKeyId = signer.keyId,
    publicKeySpkiSha256 = signer.publicMaterial().publicKeySpkiSha256,
    signatureAlgorithm = "ecdsa-p256-sha256",
    state = "active",
    validFrom = "2026-08-20T17:00:00.000Z",
    validUntil = "2026-08-21T17:00:00.000Z",
  )

internal fun livePilotEnrollment(device: JvmP256Identity): LivePilotDeviceEnrollment =
  LivePilotDeviceEnrollment(
    contractVersion = 1,
    providerCode = "telebirr",
    protocolMode = "live_private_pilot_v1",
    enrollmentId = "pilot-enrollment-0001",
    deviceId = "pilot-device-0001",
    keyId = device.keyId,
    publicKeySpkiSha256 = device.publicMaterial().publicKeySpkiSha256,
    signatureAlgorithm = "ecdsa-p256-sha256",
    state = "active",
    validFrom = "2026-08-20T17:00:00.000Z",
    validUntil = "2026-08-21T17:00:00.000Z",
    pilotRevisionId = "pilot-revision-0001",
    receiverRevisionId = "pilot-receiver-revision-0001",
    receiverProfileId = "pilot-receiver-profile-0001",
    receiverProfileDigest = repeatedDigest('1'),
    receiverConfigurationDigest = repeatedDigest('0'),
  )

internal fun authenticateLivePilotAssignment(
  body: LivePilotAssignmentBody = livePilotAssignmentBody(),
  signer: JvmP256Identity = JvmP256Identity("pilot-server-key-0001"),
  device: JvmP256Identity = JvmP256Identity("pilot-device-key-0001"),
): Triple<AuthenticatedLivePilotAssignment, JvmP256Identity, JvmP256Identity> {
  val assessment =
    LivePilotAssignmentVerifier.verify(
      signer = livePilotTrustedSigner(signer),
      enrollment = livePilotEnrollment(device),
      signedAssignment = livePilotSignedAssignment(body, signer),
      signerPublicSpkiDer = signer.keyPair.public.encoded,
      devicePublicMaterial = device.publicMaterial(),
      assessedAt = "2026-08-20T18:03:00.000Z",
    )
  return Triple(requireNotNull(assessment.authenticatedAssignment), signer, device)
}

internal fun livePilotFoundFacts(
  referenceMatch: String = "matched",
  receiverMatch: String = "matched",
  creditedPartyNameDigest: String? =
    LivePilotCanonicalTranscripts.receiverNameDigest(PILOT_RECEIVER_NAME),
): LivePilotFoundFacts =
  LivePilotFoundFacts(
    evidenceSource = "provider_receipt_lookup",
    layoutAttestation = "recognized_layout_v1",
    providerFinalStatus = "completed",
    canonicalReferencePresent = true,
    referenceMatch = referenceMatch,
    amountMinor = 2_500,
    currencyCode = "ETB",
    receiverMatch = receiverMatch,
    creditedPartyNameDigest = creditedPartyNameDigest,
    paymentMode = "telebirr",
    paymentReason = "send_money_to_registered_customer",
    paymentChannel = "api_app",
    occurredAt = "2026-08-20T18:01:45.000Z",
    retrievedAt = "2026-08-20T18:03:00.000Z",
  )

internal fun livePilotHtml(
  reference: String = PILOT_REFERENCE,
  receiverName: String = "PILOT RECEIVER",
  status: String = "Completed",
  includePaymentReason: Boolean = true,
  duplicateInvoice: Boolean = false,
): String {
  fun row(label: String, value: String) = "<tr><td>$label</td><td>$value</td></tr>"
  return buildString {
    append("<html><body><h1>Ethio telecom Share Company</h1><table>")
    append(row("Invoice No.", reference))
    if (duplicateInvoice) append(row("Invoice No.", reference))
    append(row("Payment date", "20-08-2026 21:01:45"))
    append(row("Settled Amount", "25 Birr"))
    append(row("Credited Party name", receiverName))
    append(row("transaction status", status))
    append(row("Payment Mode", "telebirr"))
    if (includePaymentReason) append(row("Payment Reason", "Send Money to Registered Customer"))
    append(row("Payment channel", "API/App"))
    append("</table></body></html>")
  }
}

internal fun livePilotProviderFound(html: String = livePilotHtml()): ProviderDocument.Found =
  ProviderDocument.Found(
    utf8Body = html,
    sourceDocumentDigest = LivePilotCanonicalTranscripts.sha256(html.toByteArray()),
    retrievedAt = "2026-08-20T18:03:00.000Z",
  )
