package com.fetanagent.telebirrverifier

import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiverSmsPhoneUploadTest {
  private val cipher = object : LivePilotQueueCipher {
    override fun seal(plaintext: ByteArray, associatedData: ByteArray): ByteArray =
      associatedData + plaintext
    override fun open(sealed: ByteArray, associatedData: ByteArray): ByteArray {
      require(sealed.take(associatedData.size) == associatedData.toList())
      return sealed.copyOfRange(associatedData.size, sealed.size)
    }
  }

  @Test fun `upload retries without loss and acknowledges only an exact receipt`() {
    val root = Files.createTempDirectory("receiver-sms-upload-test").toFile()
    try {
      val outbox = ReceiverSmsEncryptedOutbox(root, cipher)
      val sms = "You have received ETB 100.00 from Synthetic Sender " +
        "on 20/10/2026 17:47:00. Your transaction number is SYNTHETIC001. " +
        "Your balance is ETB 900.00. Thank you for using telebirr"
      outbox.stage(ReceiverSmsSignedObservation.Message(1,
        Instant.parse("2026-10-20T14:47:05Z").toEpochMilli(), sms))
      var attempts = 0
      var submitted = ""
      val exchange = DeviceBridgeExchange { path, contentType, body ->
        assertEquals(ReceiverSmsBridgeProtocol.PATH, path)
        assertEquals(ReceiverSmsBridgeProtocol.CONTENT_TYPE, contentType)
        submitted = String(body, StandardCharsets.UTF_8)
        attempts++
        if (attempts == 1) throw DeviceBridgeRetryableException()
        DeviceBridgeRawResponse(202, contentType,
          ("{\"outcome\":\"receiver_sms_recorded\",\"advisoryOnly\":true," +
            "\"pairedPhoneEvidenceVerified\":true," +
            "\"sourceAuthenticationPerformed\":false," +
            "\"financialActionAllowed\":false}")
            .toByteArray(StandardCharsets.UTF_8))
      }
      val uploader = ReceiverSmsPhoneUpload(outbox, exchange) {
        Instant.parse("2026-10-20T14:48:00Z")
      }
      val identity = JvmP256Identity()
      assertEquals(ReceiverSmsUploadResult.Retry, uploader.run("receiver_device_001", identity))
      assertEquals(1, outbox.pendingCount())
      assertEquals(ReceiverSmsUploadResult.Recorded,
        uploader.run("receiver_device_001", identity))
      assertEquals(0, outbox.pendingCount())
      assertTrue(submitted.contains("SYNTHETIC001"))
      assertFalse(submitted.contains("Synthetic Sender"))
      assertFalse(submitted.contains("balance"))
      assertEquals(ReceiverSmsUploadResult.Empty, uploader.run("receiver_device_001", identity))
    } finally { root.deleteRecursively() }
  }

  @Test fun `a server conflict retains the SMS for review and unblocks later messages`() {
    val root = Files.createTempDirectory("receiver-sms-conflict-test").toFile()
    try {
      val outbox = ReceiverSmsEncryptedOutbox(root, cipher)
      val sms = "You have received ETB 100.00 from Synthetic Sender " +
        "on 20/10/2026 17:47:00. Your transaction number is SYNTHETIC002. " +
        "Thank you for using telebirr"
      outbox.stage(ReceiverSmsSignedObservation.Message(1,
        Instant.parse("2026-10-20T14:47:05Z").toEpochMilli(), sms))
      val exchange = DeviceBridgeExchange { _, contentType, _ ->
        DeviceBridgeRawResponse(409, contentType,
          "{\"code\":\"sms_conflict\"}".toByteArray(StandardCharsets.UTF_8))
      }
      val uploader = ReceiverSmsPhoneUpload(outbox, exchange) {
        Instant.parse("2026-10-20T14:48:00Z")
      }
      val result = uploader.run("receiver_device_001", JvmP256Identity())
      assertTrue(result is ReceiverSmsUploadResult.Review &&
        result.reasonCode == "sms_payment_conflict")
      assertEquals(0, outbox.pendingCount())
      assertTrue(root.listFiles().orEmpty().any { it.name.endsWith(".review.sealed") })
    } finally { root.deleteRecursively() }
  }

  @Test fun `a terminal malformed event is sealed for review and unblocks the queue`() {
    val root = Files.createTempDirectory("receiver-sms-reject-test").toFile()
    try {
      val outbox = ReceiverSmsEncryptedOutbox(root, cipher)
      val sms = "You have received ETB 100.00 from Synthetic Sender " +
        "on 20/10/2026 17:47:00. Your transaction number is SYNTHETIC003. " +
        "Thank you for using telebirr"
      outbox.stage(ReceiverSmsSignedObservation.Message(1,
        Instant.parse("2026-10-20T14:47:05Z").toEpochMilli(), sms))
      val exchange = DeviceBridgeExchange { _, contentType, _ ->
        DeviceBridgeRawResponse(403, contentType,
          "{\"code\":\"sms_event_review\"}".toByteArray(StandardCharsets.UTF_8))
      }
      val result = ReceiverSmsPhoneUpload(outbox, exchange) {
        Instant.parse("2026-10-20T14:48:00Z")
      }.run("receiver_device_001", JvmP256Identity())
      assertTrue(result is ReceiverSmsUploadResult.Review &&
        result.reasonCode == "sms_server_review")
      assertEquals(0, outbox.pendingCount())
      assertTrue(root.listFiles().orEmpty().any { it.name.endsWith(".review.sealed") })
    } finally { root.deleteRecursively() }
  }
}
