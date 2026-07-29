package vn.zenwatch.mobileworker

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.provider.Settings
import android.view.accessibility.AccessibilityManager

data class WorkerSettings(
    val serverUrl: String,
    val token: String,
    val startOnBoot: Boolean,
)

object WorkerConfig {
    private const val PREFS = "worker_config"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_TOKEN = "worker_token"
    private const val KEY_START_ON_BOOT = "start_on_boot"

    fun load(context: Context): WorkerSettings {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return WorkerSettings(
            serverUrl = preferences.getString(KEY_SERVER_URL, "")?.trimEnd('/') ?: "",
            token = preferences.getString(KEY_TOKEN, "") ?: "",
            startOnBoot = preferences.getBoolean(KEY_START_ON_BOOT, false),
        )
    }

    fun save(context: Context, settings: WorkerSettings) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, settings.serverUrl.trim().trimEnd('/'))
            .putString(KEY_TOKEN, settings.token.trim())
            .putBoolean(KEY_START_ON_BOOT, settings.startOnBoot)
            .apply()
    }

    fun isValid(settings: WorkerSettings): Boolean =
        settings.serverUrl.startsWith("https://", ignoreCase = true)
            && settings.token.length >= 16

    fun deviceId(context: Context): String {
        val androidId = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID,
        )
        return "android-${androidId ?: "unknown"}"
    }

    fun isAccessibilityEnabled(context: Context): Boolean {
        val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE)
            as AccessibilityManager
        return manager.getEnabledAccessibilityServiceList(
            AccessibilityServiceInfo.FEEDBACK_ALL_MASK,
        ).any {
            it.resolveInfo.serviceInfo.packageName == context.packageName
                && it.resolveInfo.serviceInfo.name.endsWith("ShopeeAccessibilityService")
        }
    }
}
