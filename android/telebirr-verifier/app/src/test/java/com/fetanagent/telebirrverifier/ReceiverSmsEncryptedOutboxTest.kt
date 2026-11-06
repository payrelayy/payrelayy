package com.fetanagent.telebirrverifier

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiverSmsEncryptedOutboxTest {
  private val cipher = object : LivePilotQueueCipher {
    override fun seal(plaintext: ByteArray, associatedData: ByteArray): ByteArray =
      associatedData + plaintext

    override fun open(sealed: ByteArray, associatedData: ByteArray): ByteArray {
      require(sealed.take(associatedData.size) == associatedData.toList())
      return sealed.copyOfRange(associatedData.size, sealed.size)
    }
  }

  private fun directory(): File = Files.createTempDirectory("receiver-sms-outbox-test").toFile()

  private fun message(reference: String) = ReceiverSmsSignedObservation.Message(
    1, 1_761_000_000_000L,
    "You have received ETB 125.00. Your transaction number is $reference. telebirr",
  )

  @Test fun `messages survive restart and acknowledge without retaining SMS body`() {
    val root = directory()
    try {
      val first = ReceiverSmsEncryptedOutbox(root, cipher)
      val key = first.stage(message("SYNTHETICONE"))
      assertEquals(key, first.stage(message("SYNTHETICONE")))
      assertEquals(1, first.pendingCount())
      val restarted = ReceiverSmsEncryptedOutbox(root, cipher)
      assertEquals("SYNTHETICONE", restarted.nextPending()!!.message.body
        .substringAfter("transaction number is ").substringBefore('.'))
      restarted.acknowledge(key)
      assertNull(restarted.nextPending())
      assertEquals(key, restarted.stage(message("SYNTHETICONE")))
      assertEquals(0, restarted.pendingCount())
      val tombstone = File(root, "$key.ack")
      assertTrue(tombstone.isFile)
      assertEquals(1L, tombstone.length())
      assertFalse(String(tombstone.readBytes()).contains("SYNTHETICONE"))
    } finally { root.deleteRecursively() }
  }

  @Test fun `full queue does not discard an unacknowledged payment`() {
    val root = directory()
    try {
      val outbox = ReceiverSmsEncryptedOutbox(root, cipher, maximumPending = 1)
      outbox.stage(message("SYNTHETICONE"))
      assertTrue(runCatching { outbox.stage(message("SYNTHETICTWO")) }.isFailure)
      assertNotNull(outbox.nextPending())
      assertEquals(1, outbox.pendingCount())
    } finally { root.deleteRecursively() }
  }

  @Test fun `unsent SMS expires only after five hours in the queue`() {
    val root = directory()
    try {
      var now = 1_800_000_000_000L
      val first = ReceiverSmsEncryptedOutbox(root, cipher, nowMillis = { now })
      val expiredKey = first.stage(message("EXPIREDAFTERFIVEHOURS"))
      val expired = File(root, "$expiredKey.sealed")
      assertTrue(expired.setLastModified(now))
      now += 5L * 60 * 60_000 - 1
      assertEquals(expiredKey, first.nextPending()!!.key)
      assertEquals(1, first.pendingCount())
      now += 1
      assertNull(first.nextPending())
      assertFalse(expired.exists())
      assertEquals(0, first.pendingCount())
    } finally { root.deleteRecursively() }
  }

  @Test fun `restart removes expired SMS and keeps recent SMS`() {
    val root = directory()
    try {
      var now = 1_800_000_000_000L
      val first = ReceiverSmsEncryptedOutbox(root, cipher, nowMillis = { now })
      val oldKey = first.stage(message("OLDSMS"))
      assertTrue(File(root, "$oldKey.sealed").setLastModified(now))
      now += 4L * 60 * 60_000
      val recentKey = first.stage(message("RECENTSMS"))
      assertTrue(File(root, "$recentKey.sealed").setLastModified(now))
      now += 60 * 60_000
      val restarted = ReceiverSmsEncryptedOutbox(root, cipher, nowMillis = { now })
      assertFalse(File(root, "$oldKey.sealed").exists())
      assertEquals(recentKey, restarted.nextPending()!!.key)
      assertEquals(1, restarted.pendingCount())
    } finally { root.deleteRecursively() }
  }

  @Test fun `successful upload markers cannot block pending SMS after restart`() {
    val root = directory()
    try {
      val first = ReceiverSmsEncryptedOutbox(root, cipher)
      val pendingKey = first.stage(message("STILLPENDING"))
      val reviewedKey = first.stage(message("NEEDSREVIEW"))
      first.archiveForReview(reviewedKey)
      val now = System.currentTimeMillis()
      for (index in 0 until 2_050) {
        val marker = File(root, "%064x.ack".format(index))
        marker.writeBytes(byteArrayOf(1))
        assertTrue(marker.setLastModified(now - (2_050 - index) * 1_000L))
      }

      val recovered = ReceiverSmsEncryptedOutbox(root, cipher)
      assertEquals(512, root.listFiles()!!.count { it.name.endsWith(".ack") })
      assertTrue(File(root, "$reviewedKey.review.sealed").isFile)
      assertEquals(pendingKey, recovered.nextPending()!!.key)
      assertEquals(1, recovered.pendingCount())
    } finally { root.deleteRecursively() }
  }

  @Test fun `private queue accepts a canonicalized parent path`() {
    val parent = directory()
    try {
      val alias = File(parent, "alias")
      assertTrue(alias.mkdir())
      val root = File(alias, "../receiver-sms-outbox-v1")
      val outbox = ReceiverSmsEncryptedOutbox(root, cipher)
      assertEquals(0, outbox.pendingCount())
      assertEquals(root.canonicalFile, File(parent, "receiver-sms-outbox-v1"))
    } finally { parent.deleteRecursively() }
  }

  @Test fun `queue setup reports a fixed code without a filesystem path`() {
    val parent = directory()
    try {
      val regularFile = File(parent, "not-a-directory")
      assertTrue(regularFile.createNewFile())
      val failure = runCatching { ReceiverSmsEncryptedOutbox(regularFile, cipher) }.exceptionOrNull()
      assertTrue(failure is ReceiverSmsEncryptedOutbox.InitializationFailure)
      assertEquals("sms_queue_path_invalid", (failure as ReceiverSmsEncryptedOutbox.InitializationFailure).code)
      assertEquals("sms_queue_path_invalid", ReceiverSmsRuntimeComposition.queueInitializationCode(failure))
    } finally { parent.deleteRecursively() }
  }
}
