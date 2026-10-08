package com.fetanagent.telebirrverifier

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/** Routine-only receiver-name digest transcript, separate from private-pilot name identities. */
internal object RoutineTelebirrReceiverName {
  const val NORMALIZER_VERSION = "telebirr-credited-party-name-normalizer-v1"

  fun digest(value: String): String? {
    val normalized = LivePilotNameNormalizer.normalize(value) ?: return null
    val fields =
      listOf(
        "fetanagent:telebirr:routine:receiver-name:v1",
        "2",
        "normalizerVersion",
        "string:$NORMALIZER_VERSION",
        "normalizedName",
        "string:$normalized",
      )
    val bytes =
      ByteArrayOutputStream().use { buffer ->
        DataOutputStream(buffer).use { output ->
          fields.forEach { field ->
            val encoded = field.toByteArray(StandardCharsets.UTF_8)
            output.writeInt(encoded.size)
            output.write(encoded)
          }
        }
        buffer.toByteArray()
      }
    val hex =
      MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString(separator = "") { byte -> "%02x".format(byte) }
    return "sha256:$hex"
  }
}

/**
 * A parsed routine receipt is evidence only. This module performs no network request, enrollment,
 * signature, database write, claim, or financial action. A future routine assignment verifier must
 * authenticate the server and exact candidate binding before supplying this expectation.
 */
internal data class RoutineReceiptLookupExpectation(
  val candidateId: String,
  val rawReference: String,
  val referenceFingerprint: String,
  val expectedReceiverNameNormalized: String,
  val expectedReceiverNameDigest: String,
  val receiverRevisionId: String,
  val receiverVersion: Int,
) {
  init {
    require(UUID_V4.matches(candidateId))
    require(Regex("^[A-Z0-9]{8,32}$").matches(rawReference))
    require(Regex("^[0-9a-f]{64}$").matches(referenceFingerprint))
    require(
      LivePilotNameNormalizer.normalize(expectedReceiverNameNormalized) ==
        expectedReceiverNameNormalized
    )
    require(
      RoutineTelebirrReceiverName.digest(expectedReceiverNameNormalized) ==
        expectedReceiverNameDigest
    )
    require(UUID_V4.matches(receiverRevisionId))
    require(receiverVersion > 0)
  }

  override fun toString(): String = "RoutineReceiptLookupExpectation(<redacted>)"

  private companion object {
    val UUID_V4 = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
  }
}

internal data class RoutineTelebirrObservedReceiptFacts(
  val amountMinor: Long,
  val canonicalReferencePresent: Boolean,
  val creditedPartyNameDigest: String,
  val currencyCode: String,
  val evidenceSource: String,
  val occurredAt: String,
  val paymentChannel: String,
  val paymentMode: String,
  val paymentReason: String,
  val providerFinalStatus: String,
  val providerIdentity: String,
  val receiverMatch: String,
  val referenceMatch: String,
  val retrievedAt: String,
  val sourceProfile: String,
  val sourceOriginAttestation: String? = null,
) {
  override fun toString(): String = "RoutineTelebirrObservedReceiptFacts(<redacted>)"
}

internal sealed interface RoutineTelebirrParsedReceipt {
  data class Observed(
    val facts: RoutineTelebirrObservedReceiptFacts,
    val sourceDocumentDigest: String,
  ) : RoutineTelebirrParsedReceipt {
    override fun toString(): String = "RoutineTelebirrParsedReceipt.Observed(<redacted>)"
  }

  data class Review(
    val reasonCode: String,
    val sourceDocumentDigest: String,
  ) : RoutineTelebirrParsedReceipt {
    override fun toString(): String = "RoutineTelebirrParsedReceipt.Review(reasonCode=$reasonCode)"
  }
}

/** Reuses the reviewed official layout parser without treating a pilot assignment as routine. */
internal class RoutineTelebirrReceiptParser(
  private val officialParser: LivePrivatePilotReceiptParser = LivePrivatePilotReceiptParser(),
) {
  fun parse(
    document: ProviderDocument,
    lookup: RoutineReceiptLookupExpectation,
  ): RoutineTelebirrParsedReceipt {
    val parsed = officialParser.parseForExpectedReceipt(
      document,
      lookup.rawReference,
      lookup.expectedReceiverNameNormalized,
      RoutineTelebirrReceiverName::digest,
    )
    val facts = parsed.facts
    if (facts is LivePilotReviewRequiredFacts) {
      return RoutineTelebirrParsedReceipt.Review(facts.reviewReason, parsed.sourceDocumentDigest)
    }
    if (facts !is LivePilotFoundFacts) {
      return RoutineTelebirrParsedReceipt.Review(
        "receipt_semantics_incomplete",
        parsed.sourceDocumentDigest,
      )
    }
    val amountMinor = facts.amountMinor
    val creditedPartyNameDigest = facts.creditedPartyNameDigest
    val occurredAt = facts.occurredAt
    if (amountMinor == null || creditedPartyNameDigest == null || occurredAt == null) {
      return RoutineTelebirrParsedReceipt.Review(
        "receipt_semantics_incomplete",
        parsed.sourceDocumentDigest,
      )
    }
    return RoutineTelebirrParsedReceipt.Observed(
      facts = RoutineTelebirrObservedReceiptFacts(
        amountMinor = amountMinor,
        canonicalReferencePresent = facts.canonicalReferencePresent,
        creditedPartyNameDigest = creditedPartyNameDigest,
        currencyCode = facts.currencyCode,
        evidenceSource = facts.evidenceSource,
        occurredAt = occurredAt,
        paymentChannel = facts.paymentChannel,
        paymentMode = facts.paymentMode,
        paymentReason = facts.paymentReason,
        providerFinalStatus = facts.providerFinalStatus,
        // The parser has checked local transport origin. A paid decision additionally
        // requires the collector's signed version-2 origin assertion and server checks.
        providerIdentity = "matched",
        receiverMatch = facts.receiverMatch,
        referenceMatch = facts.referenceMatch,
        retrievedAt = facts.retrievedAt,
        sourceProfile = LivePrivatePilotProtocol.SOURCE_PROFILE,
      ),
      sourceDocumentDigest = parsed.sourceDocumentDigest,
    )
  }
}
