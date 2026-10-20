package com.fetanagent.telebirrverifier

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.provider.Telephony
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** Listens only while the verifier's foreground service is running. */
internal class ReceiverSmsCapture(
  private val context: Context,
  private val outbox: ReceiverSmsEncryptedOutbox,
  private val report: (String) -> Unit,
) {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "fetanagent-sms-capture").apply { isDaemon = true }
  }
  private var registered = false
  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val pending = goAsync()
      try {
        executor.execute {
          try {
            when (val read = ReceiverPaymentSmsInbox.read(intent)) {
              ReceiverPaymentSmsInbox.Read.Irrelevant -> Unit
              is ReceiverPaymentSmsInbox.Read.Review -> report(read.reasonCode)
              is ReceiverPaymentSmsInbox.Read.Relevant -> {
                outbox.stage(read.message)
                report("sms_queued")
              }
            }
          } catch (_: Exception) {
            report("sms_queue_unavailable")
          } finally { pending.finish() }
        }
      } catch (_: Exception) {
        report("sms_queue_unavailable")
        pending.finish()
      }
    }
  }

  fun start() {
    check(!registered)
    val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, Manifest.permission.BROADCAST_SMS, null,
        Context.RECEIVER_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      context.registerReceiver(receiver, filter, Manifest.permission.BROADCAST_SMS, null)
    }
    registered = true
  }

  fun close() {
    if (registered) {
      context.unregisterReceiver(receiver)
      registered = false
    }
    executor.shutdown()
  }
}
