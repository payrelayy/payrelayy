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
}
