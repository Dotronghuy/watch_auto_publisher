package vn.zenwatch.mobileworker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class MobileWorkerService : Service() {
    private val running = AtomicBoolean(false)
    private var workerThread: Thread? = null
    private lateinit var wakeController: DeviceWakeController
    private var lastLaunchedAttemptKey: String? = null

    override fun onCreate() {
        super.onCreate()
        automationSession.pause()
        wakeController = DeviceWakeController(this)
        wakeController.startPolling()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, notification("Đang khởi động…"))
        running.set(true)
        isRunning = true
        workerThread = thread(name = "mobile-link-worker") { workerLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        automationSession.pause()
        running.set(false)
        workerThread?.interrupt()
        workerThread = null
        wakeController.shutdown()
        isRunning = false
        lastStatus = "Worker đã dừng"
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun workerLoop() {
        val deviceId = WorkerConfig.deviceId(this)
        while (running.get()) {
            var sleepMs = IDLE_POLL_MS
            try {
                val settings = WorkerConfig.load(this)
                val active = JobStore.load(this)
                if (!WorkerConfig.isValid(settings)) {
                    pauseAutomation()
                    updateStatus("Chờ cấu hình URL/token")
                } else {
                    val api = MobileWorkerApi(settings)
                    if (active?.reportStatus != null) {
                        // Deliver an already-completed result even if Accessibility
                        // has since been disabled or the screen is now locked.
                        pauseAutomation()
                        updateStatus("Đang gửi kết quả ${active.reportStatus}…")
                        val outcome = api.report(
                            active.job.id, deviceId, active.job.attempt,
                            active.reportStatus, active.reportMessage.orEmpty(),
                        )
                        if (!running.get()) return
                        lastJobResult = when (outcome) {
                            MobileWorkerReportOutcome.REPORTED ->
                                "${active.reportStatus}: ${active.reportMessage.orEmpty()}".take(240)
                            MobileWorkerReportOutcome.STALE ->
                                "STALE: backend không còn nhận kết quả job ${active.job.id}".take(240)
                        }
                        JobStore.clear(this)
                        updateStatus(lastJobResult)
                    } else if (!WorkerConfig.isAccessibilityEnabled(this)) {
                        pauseAutomation()
                        updateStatus("Chờ bật quyền Trợ năng")
                    } else if (active != null) {
                        sleepMs = ACTIVE_POLL_MS
                        processActiveJob(active, api, deviceId)
                    } else if (wakeController.isSecurelyLocked()) {
                        pauseAutomation()
                        updateStatus("Máy đang khóa bằng PIN/mật khẩu • chưa nhận job mới")
                    } else {
                        pauseAutomation()
                        updateStatus("Đang chờ tác vụ mới…")
                        val job = api.claimNext(deviceId)
                        if (!running.get()) return
                        if (job != null) {
                            JobStore.save(this, job)
                            updateStatus("Đã nhận job ${job.id} • xác nhận lượt xử lý")
                            sleepMs = 350L
                        }
                    }
                }
            } catch (_: InterruptedException) {
                return
            } catch (error: Exception) {
                pauseAutomation()
                if (!running.get()) return
                updateStatus("Lỗi Worker: ${error.message?.take(160)}")
            }
            try {
                sleepInterruptibly(sleepMs)
            } catch (_: InterruptedException) {
                return
            }
        }
    }

    private fun processActiveJob(active: ActiveJob, api: MobileWorkerApi, deviceId: String) {
        if (System.currentTimeMillis() - active.startedAt > JOB_TIMEOUT_MS) {
            pauseAutomation()
            JobStore.markForReport(this, false, "Quá thời gian tại bước ${active.step.name}")
            return
        }

        // Confirm ownership before resuming a persisted job or opening Facebook.
        // A stale attempt may have been reassigned while this process was stopped.
        val outcome = api.heartbeat(active.job.id, deviceId, active.job.attempt)
        if (!running.get()) return
        if (outcome == MobileWorkerHeartbeatOutcome.STALE) {
            pauseAutomation()
            lastJobResult = "STALE: backend đã hết hạn attempt ${active.job.attempt}"
            JobStore.clear(this)
            updateStatus("Attempt cũ đã hết hạn • đang chờ tác vụ mới")
            return
        }

        val current = JobStore.load(this) ?: return
        if (current.job.attemptKey != active.job.attemptKey || current.reportStatus != null) return
        if (!wakeController.wakeForJob()) {
            pauseAutomation()
            JobStore.markForReport(this, false, "Máy đang khóa bằng PIN/mật khẩu; Worker không thể tự mở khóa")
            return
        }
        val attemptKey = active.job.attemptKey
        if (lastLaunchedAttemptKey != attemptKey || !canAutomate(active.job)) {
            automationSession.pause()
            JobStore.restartNavigation(this)
            updateStatus("Đang mở lại bài ${active.job.postId}")
            if (!launchFacebookPost(active.job)) {
                JobStore.markForReport(this, false, "Không mở được đúng bài viết Facebook")
                return
            }
            lastLaunchedAttemptKey = attemptKey
            sleepInterruptibly(DEVICE_WAKE_SETTLE_MS)
        }
        if (!running.get()) return
        automationSession.confirm(attemptKey, SystemClock.elapsedRealtime())
        updateStatus("Đang xử lý ${active.job.id} • ${JobStore.load(this)?.step?.name.orEmpty()}")
    }

    private fun pauseAutomation() {
        automationSession.pause()
        lastLaunchedAttemptKey = null
        wakeController.finishJob()
    }

    private fun launchFacebookPost(job: MobileLinkJob): Boolean {
        return FacebookPostLauncher.launch(this, job)
    }

    private fun updateStatus(message: String) {
        lastStatus = message
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification(message))
    }

    private fun notification(message: String): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_worker)
            .setContentTitle("ZenWatch Link Worker")
            .setContentText(message)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Android Worker",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }
    }

    private fun sleepInterruptibly(durationMs: Long) {
        if (running.get()) Thread.sleep(durationMs)
    }

    companion object {
        internal val automationSession = AutomationSession()

        internal fun canAutomate(job: MobileLinkJob): Boolean = isRunning &&
            automationSession.permits(job.attemptKey, SystemClock.elapsedRealtime())

        private const val CHANNEL_ID = "zenwatch_mobile_worker"
        private const val NOTIFICATION_ID = 7201
        private const val IDLE_POLL_MS = 12_000L
        private const val ACTIVE_POLL_MS = 5_000L
        private const val DEVICE_WAKE_SETTLE_MS = 800L
        private const val JOB_TIMEOUT_MS = 4 * 60 * 1000L

        @Volatile
        var isRunning: Boolean = false

        @Volatile
        var lastStatus: String = ""

        @Volatile
        var lastJobResult: String = ""

        fun start(context: Context) {
            val intent = Intent(context, MobileWorkerService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
