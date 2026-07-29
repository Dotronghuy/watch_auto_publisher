package vn.zenwatch.mobileworker

import android.app.KeyguardManager
import android.content.Context
import android.os.PowerManager

/**
 * Keeps polling alive while the display is off, then wakes and holds the
 * display only while an actual Facebook automation job is active.
 */
class DeviceWakeController(context: Context) {
    private val appContext = context.applicationContext
    private val powerManager =
        appContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    private val keyguardManager =
        appContext.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

    private var pollingWakeLock: PowerManager.WakeLock? = null
    private var jobWakeLock: PowerManager.WakeLock? = null

    @Suppress("DEPRECATION")
    private var keyguardLock: KeyguardManager.KeyguardLock? = null

    @Synchronized
    fun startPolling() {
        if (pollingWakeLock?.isHeld == true) return
        pollingWakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "${appContext.packageName}:worker-polling",
        ).apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    fun isSecurelyLocked(): Boolean =
        keyguardManager.isKeyguardLocked && keyguardManager.isKeyguardSecure

    @Suppress("DEPRECATION")
    @Synchronized
    fun wakeForJob(): Boolean {
        if (isSecurelyLocked()) return false

        if (!powerManager.isInteractive && jobWakeLock?.isHeld == true) {
            jobWakeLock?.release()
            jobWakeLock = null
        }

        if (jobWakeLock?.isHeld != true) {
            val flags = PowerManager.FULL_WAKE_LOCK or
                PowerManager.ACQUIRE_CAUSES_WAKEUP or
                PowerManager.ON_AFTER_RELEASE
            jobWakeLock = powerManager.newWakeLock(
                flags,
                "${appContext.packageName}:active-job-screen",
            ).apply {
                setReferenceCounted(false)
                acquire(JOB_SCREEN_TIMEOUT_MS)
            }
        }

        if (keyguardManager.isKeyguardLocked) {
            if (keyguardLock == null) {
                keyguardLock = keyguardManager.newKeyguardLock(
                    "${appContext.packageName}:job-keyguard",
                )
            }
            keyguardLock?.disableKeyguard()
        }
        return true
    }

    @Suppress("DEPRECATION")
    @Synchronized
    fun finishJob() {
        jobWakeLock?.let { wakeLock ->
            if (wakeLock.isHeld) wakeLock.release()
        }
        jobWakeLock = null
        keyguardLock?.reenableKeyguard()
        keyguardLock = null
    }

    @Synchronized
    fun shutdown() {
        finishJob()
        pollingWakeLock?.let { wakeLock ->
            if (wakeLock.isHeld) wakeLock.release()
        }
        pollingWakeLock = null
    }

    companion object {
        private const val JOB_SCREEN_TIMEOUT_MS = 6 * 60 * 1000L
    }
}
