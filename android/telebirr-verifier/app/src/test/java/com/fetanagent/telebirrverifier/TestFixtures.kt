package com.fetanagent.telebirrverifier

import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

internal const val SYNTHETIC_REFERENCE = "TEST9ABC1234"

internal fun repeatedDigest(character: Char): String = "sha256:" + character.toString().repeat(64)

internal fun referenceFingerprint(character: Char): String =
  "fixture-hmac-sha256:" + character.toString().repeat(64)

internal val matchingSyntheticReferenceBinding =
  ProtectedReferenceBindingVerifier { reference, protectedReferenceFingerprint ->
    reference.use { canonical ->
      if (
        canonical == SYNTHETIC_REFERENCE &&
          protectedReferenceFingerprint == referenceFingerprint('2')
      ) {
        ReferenceBindingVerdict.MATCHED
      } else {
        ReferenceBindingVerdict.MISMATCHED
      }
    }
  }

internal fun vectorFacts(): FoundReceiptFacts =
  FoundReceiptFacts(
    lookupOutcome = "found",
    evidenceSource = "provider_receipt_lookup",
    providerIdentity = "matched",
    providerFinalStatus = "completed",
    canonicalReferencePresent = true,
    referenceMatch = "matched",
    amountMinor = 12_500,
    currencyCode = "ETB",
    receiverMatch = "matched",
    maskedReceiverDiagnostic = "matched",
    paymentMode = "telebirr",
    paymentReason = "send_money_to_registered_customer",
    paymentChannel = "api_app",
    occurredAt = "2026-08-20T18:02:30.000Z",
    retrievedAt = "2026-08-20T18:03:00.000Z",
  )

internal fun vectorBody(facts: RelayReceiptFacts = vectorFacts()): RelayObservationBody =
  RelayObservationBody(
    contractVersion = 1,
    providerCode = "telebirr",
    protocolMode = "synthetic_shadow",
    requestId = "synthetic-request-0001",
    jobId = "synthetic-job-0001",
    attemptNumber = 1,
    leaseId = "synthetic-lease-0001",
    deviceId = "synthetic-device-0001",
    keyId = "synthetic-key-0001",
    leaseNonceDigest = repeatedDigest('3'),
    challengeId = "synthetic-challenge-0001",
    challengeDigest = repeatedDigest('4'),
    referenceFingerprint = referenceFingerprint('2'),
    sourceProfile = "telebirr_official_receipt_v1",
    receiverProfileId = "synthetic-receiver-profile-0001",
    receiverProfileDigest = repeatedDigest('1'),
    adapterVersion = "telebirr-synthetic-relay-adapter-v1",
    parserVersion = "telebirr-official-receipt-parser-v1",
    normalizerVersion = "telebirr-official-receipt-normalizer-v1",
    sourceDocumentDigest = repeatedDigest('5'),
    normalizedFactsDigest = CanonicalTranscripts.receiptFactsDigest(facts),
    observedAt = "2026-08-20T18:03:00.000Z",
    facts = facts,
  )

internal class JvmP256Identity(
  override val keyId: String = "synthetic-key-0001",
  val keyPair: KeyPair =
    KeyPairGenerator.getInstance("EC").run {
      initialize(ECGenParameterSpec("secp256r1"))
      generateKeyPair()
    },
) : P256Identity {
  override fun publicMaterial(): IdentityPublicMaterial {
    val spki = keyPair.public.encoded
    return IdentityPublicMaterial(
      keyId = keyId,
      publicKeySpkiBase64Url = Base64.getUrlEncoder().withoutPadding().encodeToString(spki),
      publicKeySpkiSha256 = CanonicalTranscripts.sha256(spki),
    )
  }

  override fun signP1363(message: ByteArray): ByteArray {
    val signer = Signature.getInstance("SHA256withECDSA")
    signer.initSign(keyPair.private)
    signer.update(message)
    return EcdsaP1363.derToP1363(signer.sign())
  }
}

internal fun enrollment(identity: JvmP256Identity): RelayEnrollment =
  RelayEnrollment(
    contractVersion = 1,
    providerCode = "telebirr",
    protocolMode = "synthetic_shadow",
    enrollmentId = "synthetic-enrollment-0001",
    deviceId = "synthetic-device-0001",
    keyId = identity.keyId,
    publicKeySpkiSha256 = identity.publicMaterial().publicKeySpkiSha256,
    signatureAlgorithm = "ecdsa-p256-sha256",
    state = "active",
    enrolledAt = "2026-08-20T17:00:00.000Z",
    validFrom = "2026-08-20T17:00:00.000Z",
    validUntil = "2026-08-21T17:00:00.000Z",
    sourceProfile = "telebirr_official_receipt_v1",
    receiverProfileId = "synthetic-receiver-profile-0001",
    receiverProfileDigest = repeatedDigest('1'),
    parserVersion = "telebirr-official-receipt-parser-v1",
    normalizerVersion = "telebirr-official-receipt-normalizer-v1",
  )

internal fun request(): RelayRequest =
  RelayRequest(
    contractVersion = 1,
    providerCode = "telebirr",
    protocolMode = "synthetic_shadow",
    requestId = "synthetic-request-0001",
    jobId = "synthetic-job-0001",
    attemptNumber = 1,
    referenceFingerprint = referenceFingerprint('2'),
    sourceProfile = "telebirr_official_receipt_v1",
    receiverProfileId = "synthetic-receiver-profile-0001",
    receiverProfileDigest = repeatedDigest('1'),
    parserVersion = "telebirr-official-receipt-parser-v1",
    normalizerVersion = "telebirr-official-receipt-normalizer-v1",
    requestedAt = "2026-08-20T18:01:30.000Z",
  )

internal fun lease(identity: JvmP256Identity): RelayLease =
  RelayLease(
    contractVersion = 1,
    providerCode = "telebirr",
    protocolMode = "synthetic_shadow",
    leaseId = "synthetic-lease-0001",
    requestId = "synthetic-request-0001",
    jobId = "synthetic-job-0001",
    attemptNumber = 1,
    deviceId = "synthetic-device-0001",
    keyId = identity.keyId,
    leaseNonceDigest = repeatedDigest('3'),
    challengeId = "synthetic-challenge-0001",
    challengeDigest = repeatedDigest('4'),
    referenceFingerprint = referenceFingerprint('2'),
    sourceProfile = "telebirr_official_receipt_v1",
    receiverProfileId = "synthetic-receiver-profile-0001",
    receiverProfileDigest = repeatedDigest('1'),
    parserVersion = "telebirr-official-receipt-parser-v1",
    normalizerVersion = "telebirr-official-receipt-normalizer-v1",
    issuedAt = "2026-08-20T18:02:00.000Z",
    expiresAt = "2026-08-20T18:04:00.000Z",
  )

internal fun officialHtml(
  reference: String = SYNTHETIC_REFERENCE,
  status: String = "Completed",
  settledAmount: String = "150 Birr",
  paymentDate: String = "20-08-2026 21:02:30",
  duplicateInvoice: Boolean = false,
  includePaymentReason: Boolean = true,
): String {
  fun row(label: String, value: String) = "<tr><td>$label</td><td>$value</td></tr>"
  return buildString {
    append("<html><body><h1>Ethio telecom Share Company</h1><table>")
    append(row("Invoice No.", reference))
    if (duplicateInvoice) append(row("Invoice No.", reference))
    append(row("Payment date", paymentDate))
    append(row("Settled Amount", settledAmount))
    append(row("Credited Party name", "SYNTHETIC RECEIVER"))
    append(row("transaction status", status))
    append(row("Payment Mode", "telebirr"))
    if (includePaymentReason) append(row("Payment Reason", "Send Money to Registered Customer"))
    append(row("Payment channel", "API/App"))
    append("</table></body></html>")
  }
}

internal fun providerFound(html: String = officialHtml()): ProviderDocument.Found {
  val bytes = html.toByteArray()
  return ProviderDocument.Found(
    utf8Body = html,
    sourceDocumentDigest = CanonicalTranscripts.sha256(bytes),
    retrievedAt = "2026-08-20T18:03:00.000Z",
  )
}
