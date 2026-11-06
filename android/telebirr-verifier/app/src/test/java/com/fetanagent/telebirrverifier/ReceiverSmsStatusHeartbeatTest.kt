package com.fetanagent.telebirrverifier

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.Signature
import java.time.Instant
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiverSmsStatusHeartbeatTest {
  @Test fun `phone signs a reference-free SMS service report`() {
    val identity = JvmP256Identity()
    var captured: ByteArray? = null
    val exchange = DeviceBridgeExchange { path, contentType, body ->
      assertEquals(ReceiverSmsBridgeProtocol.STATUS_PATH, path)
      assertEquals(ReceiverSmsBridgeProtocol.STATUS_CONTENT_TYPE, contentType)
      captured = body
      DeviceBridgeRawResponse(202, contentType,
        """{"outcome":"receiver_sms_status_recorded","advisoryOnly":true,"financialActionAllowed":false}"""
          .toByteArray(StandardCharsets.UTF_8))
    }
    val result = ReceiverSmsStatusHeartbeat("receiver_phone_01", identity, exchange,
      now = { Instant.parse("2026-11-03T09:00:00Z") })
      .send(LivePilotRuntimeStatus(LivePilotRuntimeState.READY, "sms_inbox_idle"), 17)
    assertEquals(DeviceBridgeHeartbeatResult.Acknowledged, result)
    val outer = StrictJson.parse(requireNotNull(captured)).requireObject(
      setOf("publicKeySpki", "signedStatus"))
    val envelope = outer.value("signedStatus").requireObject(
      setOf("contractVersion", "protocolMode", "bodyDigest", "body", "signature"))
    val report = envelope.value("body").requireObject(setOf("contractVersion",
      "protocolMode", "deviceId", "keyId", "state", "observedAt", "queuedSmsCount"))
    assertEquals("ready", report.string("state"))
    assertEquals(17, report.int("queuedSmsCount"))
    val transcript = """["fetanagent:receiver-sms-status-body:v1",1,"receiver_sms_status_v1","receiver_phone_01","${report.string("keyId")}","ready","2026-11-03T09:00:00.000Z",17]"""
    val digest = "sha256:" + MessageDigest.getInstance("SHA-256")
      .digest(transcript.toByteArray(StandardCharsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
    assertEquals(digest, envelope.string("bodyDigest"))
    val signatureTranscript = """["fetanagent:receiver-sms-status-signature:v1","$digest"]"""
    val verifier = Signature.getInstance("SHA256withECDSA")
    verifier.initVerify(identity.keyPair.public)
    verifier.update(signatureTranscript.toByteArray(StandardCharsets.UTF_8))
    assertTrue(verifier.verify(EcdsaP1363.p1363ToDer(
      Base64.getUrlDecoder().decode(envelope.string("signature")))))
  }
}
