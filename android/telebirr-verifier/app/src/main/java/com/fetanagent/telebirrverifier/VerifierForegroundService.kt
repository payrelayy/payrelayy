package com.fetanagent.telebirrverifier

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Restart-safe, single-threaded foreground lifecycle for the dedicated verifier phone. The service
 * owns scheduling only; the signed runtime still owns authentication, replay resistance, provider
 * observation, and evidence upload.
 */
class VerifierForegroundService : Service() {
  private lateinit var stateStore: VerifierOperationalStateStore
  private lateinit var runtimeSession: VerifierRuntimeSession
  private lateinit var executor: ScheduledExecutorService
  private val loopStarted = AtomicBoolean(false)
  private val loopGeneration = AtomicLong(0L)
  private val policy = VerifierRunLoopPolicy()

  override fun onCreate() {
    super.onCreate()
    stateStore = VerifierOperationalStateStore(applicationContext)
    executor =
      Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "fetanagent-verifier-loop").apply {
          isDaemon = true
          priority = Thread.NORM_PRIORITY
        }
      }
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopExplicitly()
      return START_NOT_STICKY
    }
    if (intent?.action != null && intent.action != ACTION_START) {
      stopSelf(startId)
      return START_NOT_STICKY
    }

    val snapshot = stateStore.snapshot()
    if (!VerifierPlatformPrerequisites.canStart(this, snapshot)) {
      recordFailedPrerequisite(snapshot)
      stopSelf(startId)
      return START_NOT_STICKY
    }

    if (runCatching { enterForeground(snapshot.status) }.isFailure) {
      failAndStop(attention("foreground_start_unavailable"), startId)
      return START_NOT_STICKY
    }
    if (!::runtimeSession.isInitialized) {
      val composition = runCatching { VerifierRuntimeComposition.create(applicationContext) }
      if (composition.isFailure) {
        failAndStop(attention("runtime_composition_unavailable"), startId)
        return START_NOT_STICKY
      }
      runtimeSession = composition.getOrThrow()
    }
    if (loopStarted.compareAndSet(false, true)) {
      scheduleCycle(0L, loopGeneration.incrementAndGet())
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    loopStarted.set(false)
    loopGeneration.incrementAndGet()
    executor.shutdownNow()
    super.onDestroy()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    loopStarted.set(false)
    loopGeneration.incrementAndGet()
    val status = attention("foreground_time_limit_reached")
    runCatching { stateStore.recordStatus(status) }
    runCatching { stateStore.setOperatorEnabled(false) }
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf(startId)
  }

  private fun scheduleCycle(delayMillis: Long, generation: Long) {
    if (!isActive(generation) || executor.isShutdown) return
    val scheduled =
      runCatching {
          executor.schedule(
            {
              if (isActive(generation)) runCycle(generation)
            },
            delayMillis,
            TimeUnit.MILLISECONDS,
          )
        }
        .isSuccess
    if (!scheduled && isActive(generation)) {
      failAndStop(attention("scheduler_unavailable"))
    }
  }

  private fun runCycle(generation: Long) {
    if (!isActive(generation)) return
    val snapshot = stateStore.snapshot()
    if (!VerifierPlatformPrerequisites.canStart(this, snapshot)) {
      recordFailedPrerequisite(snapshot)
      loopStarted.set(false)
      loopGeneration.incrementAndGet()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return
    }
    var status =
      try {
        runtimeSession.cycle.runOnce()
      } catch (_: Exception) {
        attention("runtime_cycle_unavailable")
      }
    if (!isActive(generation)) return
    var now = SystemClock.elapsedRealtime()
    var decision = policy.decide(status, now)

    if (decision.heartbeatDue) {
      runtimeSession.heartbeat?.let { heartbeat ->
        val heartbeatResult =
          runCatching { heartbeat.heartbeat(status) }
            .getOrDefault(DeviceBridgeHeartbeatResult.Retryable)
        if (heartbeatResult !is DeviceBridgeHeartbeatResult.Retryable) {
          policy.recordHeartbeatAttempt(status, now)
        }
        if (heartbeatResult is DeviceBridgeHeartbeatResult.Rejected) {
          status = attention("heartbeat_${heartbeatResult.reason.wireName}")
          now = SystemClock.elapsedRealtime()
          decision = policy.decide(status, now)
        } else if (heartbeatResult is DeviceBridgeHeartbeatResult.EnrollmentRejected) {
          status =
            LivePilotRuntimeStatus(
              LivePilotRuntimeState.ENROLLMENT_REQUIRED,
              "device_enrollment_rejected",
            )
          now = SystemClock.elapsedRealtime()
          decision = policy.decide(status, now)
        }
      }
    }
    if (!isActive(generation)) return

    try {
      stateStore.recordStatus(status)
      updateNotification(status)
    } catch (_: Exception) {
      status = attention("operational_state_unavailable")
      decision = policy.decide(status, SystemClock.elapsedRealtime())
    }

    if (!decision.continueRunning) {
      loopStarted.set(false)
      loopGeneration.incrementAndGet()
      runCatching { stateStore.setOperatorEnabled(false) }
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return
    }
    scheduleCycle(requireNotNull(decision.delayMillis), generation)
  }

  private fun isActive(generation: Long): Boolean =
    loopStarted.get() && loopGeneration.get() == generation

  private fun enterForeground(status: LivePilotRuntimeStatus) {
    val notification = notification(status)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun updateNotification(status: LivePilotRuntimeStatus) {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(status))
  }

  private fun notification(status: LivePilotRuntimeStatus): Notification {
    val openIntent = Intent(this, MainActivity::class.java)
    val openPendingIntent =
      PendingIntent.getActivity(
        this,
        0,
        openIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    val stopIntent = Intent(this, VerifierForegroundService::class.java).setAction(ACTION_STOP)
    val stopPendingIntent =
      PendingIntent.getService(
        this,
        1,
        stopIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    return Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_verifier_notification)
      .setContentTitle(getString(R.string.app_name))
      .setContentText(VerifierLifecycle.from(status).label)
      .setContentIntent(openPendingIntent)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .addAction(Notification.Action.Builder(null, getString(R.string.stop), stopPendingIntent).build())
      .build()
  }

  private fun createNotificationChannel() {
    val channel =
      NotificationChannel(
        NOTIFICATION_CHANNEL_ID,
        getString(R.string.notification_channel_name),
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = getString(R.string.notification_channel_description)
        setShowBadge(false)
      }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun stopExplicitly() {
    loopStarted.set(false)
    loopGeneration.incrementAndGet()
    runCatching { stateStore.setOperatorEnabled(false) }
    runCatching {
      stateStore.recordStatus(
        LivePilotRuntimeStatus(LivePilotRuntimeState.DISABLED, "operator_stopped"),
      )
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun recordFailedPrerequisite(snapshot: VerifierOperationalSnapshot) {
    if (!snapshot.operatorEnabled) return
    val status =
      if (!BuildConfig.VERIFIER_ENABLED) {
        LivePilotRuntimeStatus(LivePilotRuntimeState.DISABLED, "build_disabled")
      } else {
        attention("notification_permission_required")
      }
    runCatching { stateStore.recordStatus(status) }
    runCatching { stateStore.setOperatorEnabled(false) }
  }

  private fun failAndStop(status: LivePilotRuntimeStatus, startId: Int? = null) {
    loopStarted.set(false)
    loopGeneration.incrementAndGet()
    runCatching { stateStore.recordStatus(status) }
    runCatching { stateStore.setOperatorEnabled(false) }
    stopForeground(STOP_FOREGROUND_REMOVE)
    if (startId == null) stopSelf() else stopSelf(startId)
  }

  private fun attention(code: String): LivePilotRuntimeStatus =
    LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, code)

  companion object {
    private const val ACTION_START =
      "com.fetanagent.telebirrverifier.action.START_FOREGROUND_VERIFIER"
    private const val ACTION_STOP =
      "com.fetanagent.telebirrverifier.action.STOP_FOREGROUND_VERIFIER"
    private const val NOTIFICATION_CHANNEL_ID = "telebirr_verifier_operation_v1"
    private const val NOTIFICATION_ID = 4_204

    fun requestStart(context: Context) {
      val intent =
        Intent(context.applicationContext, VerifierForegroundService::class.java)
          .setAction(ACTION_START)
      context.applicationContext.startForegroundService(intent)
    }

    fun requestStop(context: Context) {
      val intent =
        Intent(context.applicationContext, VerifierForegroundService::class.java)
          .setAction(ACTION_STOP)
      context.applicationContext.startService(intent)
    }
  }
}
