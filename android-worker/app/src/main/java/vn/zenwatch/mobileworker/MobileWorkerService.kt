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
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class MobileWorkerService : Service() {
    private val running = AtomicBoolean(false)
    private var workerThread: Thread? = null
    private lateinit var wakeController: DeviceWakeController
    private var lastLaunchedJobId: String? = null

    override fun onCreate() {
        super.onCreate()
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
                if (!WorkerConfig.isValid(settings)) {
                    updateStatus("Chờ cấu hình URL/token")
                    sleepInterruptibly(IDLE_POLL_MS)
                    continue
                }
                if (!WorkerConfig.isAccessibilityEnabled(this)) {
                    updateStatus("Chờ bật quyền Trợ năng")
                    sleepInterruptibly(IDLE_POLL_MS)
                    continue
                }

                val api = MobileWorkerApi(settings)
                val active = JobStore.load(this)
                if (active != null) {
                    sleepMs = ACTIVE_POLL_MS
                    if (active.reportStatus == null && !wakeController.wakeForJob()) {
                        JobStore.markForReport(
                            this,
                            success = false,
                            message = "Máy đang khóa bằng PIN/mật khẩu; Worker không thể tự mở khóa",
                        )
                        sleepInterruptibly(ACTIVE_POLL_MS)
                        continue
                    }
                    if (active.reportStatus != null) {
                        updateStatus("Đang gửi kết quả ${active.reportStatus}…")
                        api.report(
                            active.job.id,
                            deviceId,
                            active.reportStatus,
                            active.reportMessage.orEmpty(),
                        )
                        lastJobResult =
                            "${active.reportStatus}: ${active.reportMessage.orEmpty()}".take(240)
                        JobStore.clear(this)
                        wakeController.finishJob()
                        updateStatus("Đã gửi kết quả job ${active.job.id}")
                    } else if (System.currentTimeMillis() - active.startedAt > JOB_TIMEOUT_MS) {
                        JobStore.markForReport(
                            this,
                            success = false,
                            message = "Quá thời gian tại bước ${active.step.name}",
                        )
                    } else {
                        // An app update or service restart preserves the active job,
                        // but Facebook may still show a menu/form from an older post.
                        // Always invalidate the saved UI step and reopen this job's
                        // exact post once before Accessibility is allowed to continue.
                        if (lastLaunchedJobId != active.job.id) {
                            JobStore.restartNavigation(this)
                            updateStatus("Đang mở lại bài ${active.job.postId}")
                            if (!launchFacebookPost(active.job)) {
                                JobStore.markForReport(
                                    this,
                                    success = false,
                                    message = "Không mở được đúng bài viết Facebook",
                                )
                                sleepInterruptibly(ACTIVE_POLL_MS)
                                continue
                            }
                            lastLaunchedJobId = active.job.id
                            sleepInterruptibly(DEVICE_WAKE_SETTLE_MS)
                        }
                        api.heartbeat(active.job.id, deviceId)
                        updateStatus("Đang xử lý ${active.job.id} • ${active.step.name}")
                    }
                } else if (wakeController.isSecurelyLocked()) {
                    wakeController.finishJob()
                    updateStatus("Máy đang khóa bằng PIN/mật khẩu • chưa nhận job mới")
                } else {
                    wakeController.finishJob()
                    updateStatus("Đang chờ tác vụ mới…")
                    val job = api.claimNext(deviceId)
                    if (job != null) {
                        JobStore.save(this, job)
                        if (!wakeController.wakeForJob()) {
                            JobStore.markForReport(
                                this,
                                success = false,
                                message = "Máy đang khóa bằng PIN/mật khẩu; Worker không thể tự mở khóa",
                            )
                        } else {
                            updateStatus("Đã nhận job ${job.id} • mở Facebook")
                            sleepInterruptibly(DEVICE_WAKE_SETTLE_MS)
                        }
                        if (JobStore.load(this)?.reportStatus == null) {
                            if (!launchFacebookPost(job)) {
                                JobStore.markForReport(
                                    this,
                                    success = false,
                                    message = "Không mở được ứng dụng Facebook",
                                )
                            } else {
                                lastLaunchedJobId = job.id
                            }
                        }
                        sleepMs = ACTIVE_POLL_MS
                    }
                }
            } catch (interrupted: InterruptedException) {
                return
            } catch (error: Exception) {
                updateStatus("Lỗi Worker: ${error.message?.take(160)}")
            }
            sleepInterruptibly(sleepMs)
        }
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
