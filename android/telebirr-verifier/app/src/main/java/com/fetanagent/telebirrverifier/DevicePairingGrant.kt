package com.fetanagent.telebirrverifier

data class DevicePairingGrant(
  val pairingId: String,
  val pairingNonceDigest: String,
  val expiresAt: String,
) {
  init {
    require(
      Regex(
          "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        )
        .matches(pairingId),
    )
    DeviceBridgeProtocol.requireSha256(pairingNonceDigest, "pairingNonceDigest")
    DeviceBridgeProtocol.requireTimestamp(expiresAt, "expiresAt")
  }

  override fun toString(): String = "DevicePairingGrant(<redacted>)"
}

