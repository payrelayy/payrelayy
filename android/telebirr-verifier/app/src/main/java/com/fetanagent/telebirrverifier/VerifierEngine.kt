package com.fetanagent.telebirrverifier

enum class ReferenceBindingVerdict {
  MATCHED,
  MISMATCHED,
  UNAVAILABLE,
}

/**
 * A separately provisioned trust boundary must prove that the raw lookup reference belongs to the
 * protected fingerprint in the leased request. The compatibility-only application intentionally
 * ships no implementation that can return [ReferenceBindingVerdict.MATCHED].
 */
fun interface ProtectedReferenceBindingVerifier {
  fun verify(
    reference: CanonicalReference,
    protectedReferenceFingerprint: String,
  ): ReferenceBindingVerdict
}

class VerifierEngine(
  private val transport: ProviderTransport,
  private val parser: OfficialReceiptParser,
  private val referenceBindingVerifier: ProtectedReferenceBindingVerifier,
  private val clock: MillisClock = MillisClock(System::currentTimeMillis),
) {
  fun observe(
    enrollment: RelayEnrollment,
    request: RelayRequest,
    lease: RelayLease,
    reference: CanonicalReference,
    identity: P256Identity,
  ): SignedRelayObservation {
    validateBindings(enrollment, request, lease, identity)
    require(
      referenceBindingVerifier.verify(reference, request.referenceFingerprint) ==
        ReferenceBindingVerdict.MATCHED,
    ) {
      "Protected reference binding is unavailable or mismatched"
    }
    val observedAt = SafeOfficialReceiptTransport.canonicalTimestamp(clock.nowMillis())
    require(observedAt >= lease.issuedAt && observedAt < lease.expiresAt) { "Lease is not active" }
    require(observedAt >= enrollment.validFrom && observedAt < enrollment.validUntil) {
      "Enrollment is not active"
    }
    require(enrollment.state == "active") { "Enrollment is revoked" }

    val route = OfficialReceiptRoute.forReference(reference)
    val parsed = parser.parse(transport.retrieve(route), reference)
    val body =
      RelayObservationBody(
        contractVersion = RelayProtocol.CONTRACT_VERSION,
        providerCode = RelayProtocol.PROVIDER_CODE,
        protocolMode = RelayProtocol.PROTOCOL_MODE,
        requestId = request.requestId,
        jobId = request.jobId,
        attemptNumber = request.attemptNumber,
        leaseId = lease.leaseId,
        deviceId = lease.deviceId,
        keyId = lease.keyId,
        leaseNonceDigest = lease.leaseNonceDigest,
        challengeId = lease.challengeId,
        challengeDigest = lease.challengeDigest,
        referenceFingerprint = request.referenceFingerprint,
        sourceProfile = RelayProtocol.SOURCE_PROFILE,
        receiverProfileId = request.receiverProfileId,
        receiverProfileDigest = request.receiverProfileDigest,
        adapterVersion = RelayProtocol.ADAPTER_VERSION,
        parserVersion = RelayProtocol.PARSER_VERSION,
        normalizerVersion = RelayProtocol.NORMALIZER_VERSION,
        sourceDocumentDigest = parsed.sourceDocumentDigest,
        normalizedFactsDigest = CanonicalTranscripts.receiptFactsDigest(parsed.facts),
        observedAt = observedAt,
        facts = parsed.facts,
      )
    return SignedObservationFactory.create(body, identity)
  }

  private fun validateBindings(
    enrollment: RelayEnrollment,
    request: RelayRequest,
    lease: RelayLease,
    identity: P256Identity,
  ) {
    require(request.requestId == lease.requestId)
    require(request.jobId == lease.jobId)
    require(request.attemptNumber == lease.attemptNumber)
    require(request.referenceFingerprint == lease.referenceFingerprint)
    require(request.sourceProfile == lease.sourceProfile)
    require(request.receiverProfileId == lease.receiverProfileId)
    require(request.receiverProfileDigest == lease.receiverProfileDigest)
    require(request.parserVersion == lease.parserVersion)
    require(request.normalizerVersion == lease.normalizerVersion)
    require(enrollment.deviceId == lease.deviceId)
    require(enrollment.keyId == lease.keyId)
    require(enrollment.receiverProfileId == lease.receiverProfileId)
    require(enrollment.receiverProfileDigest == lease.receiverProfileDigest)
    require(identity.keyId == lease.keyId)
    require(identity.publicMaterial().publicKeySpkiSha256 == enrollment.publicKeySpkiSha256)
  }
}

data class RedactedObservationProjection(
  val contractVersion: Int,
  val providerCode: String,
  val protocolMode: String,
  val sourceProfile: String,
  val transcriptVersion: String,
  val signatureAlgorithm: String,
  val lookupOutcome: String,
  val providerFinalStatus: String?,
  val advisoryOnly: Boolean,
  val databaseWriteAllowed: Boolean,
  val settlementAllowed: Boolean,
  val financialActionAllowed: Boolean,
)

object Redaction {
  fun forStatus(observation: SignedRelayObservation): RedactedObservationProjection {
    val found = observation.body.facts as? FoundReceiptFacts
    return RedactedObservationProjection(
      contractVersion = observation.contractVersion,
      providerCode = observation.providerCode,
      protocolMode = observation.protocolMode,
      sourceProfile = observation.body.sourceProfile,
      transcriptVersion = observation.transcriptVersion,
      signatureAlgorithm = observation.signatureAlgorithm,
      lookupOutcome = observation.body.facts.lookupOutcome,
      providerFinalStatus = found?.providerFinalStatus,
      advisoryOnly = true,
      databaseWriteAllowed = false,
      settlementAllowed = false,
      financialActionAllowed = false,
    )
  }
}
