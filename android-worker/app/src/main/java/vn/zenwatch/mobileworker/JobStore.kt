package vn.zenwatch.mobileworker

import android.content.Context
import org.json.JSONObject

object JobStore {
    private const val PREFS = "active_mobile_link_job"
    private const val KEY_JOB = "job_json"
    private const val KEY_STEP = "step"
    private const val KEY_STARTED_AT = "started_at"
    private const val KEY_STEP_STARTED_AT = "step_started_at"
    private const val KEY_REPORT_STATUS = "report_status"
    private const val KEY_REPORT_MESSAGE = "report_message"

    fun save(context: Context, job: MobileLinkJob) {
        val now = System.currentTimeMillis()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .putString(KEY_JOB, job.toJson().toString())
            .putString(KEY_STEP, AutomationStep.OPEN_POST.name)
            .putLong(KEY_STARTED_AT, now)
            .putLong(KEY_STEP_STARTED_AT, now)
            .apply()
    }

    fun load(context: Context): ActiveJob? {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val rawJob = preferences.getString(KEY_JOB, null) ?: return null
        return try {
            ActiveJob(
                job = MobileLinkJob.fromJson(JSONObject(rawJob)),
                step = AutomationStep.valueOf(
                    preferences.getString(KEY_STEP, AutomationStep.OPEN_POST.name)
                        ?: AutomationStep.OPEN_POST.name,
                ),
                startedAt = preferences.getLong(KEY_STARTED_AT, System.currentTimeMillis()),
                stepStartedAt = preferences.getLong(
                    KEY_STEP_STARTED_AT,
                    System.currentTimeMillis(),
                ),
                reportStatus = preferences.getString(KEY_REPORT_STATUS, null),
                reportMessage = preferences.getString(KEY_REPORT_MESSAGE, null),
            )
        } catch (_: Exception) {
            clear(context)
            null
        }
    }

    fun setStep(context: Context, step: AutomationStep) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_STEP, step.name)
            .putLong(KEY_STEP_STARTED_AT, System.currentTimeMillis())
            .apply()
    }

    /**
     * A service/app restart invalidates every assumption about Facebook's current
     * screen. Restart from the exact-post gate instead of resuming on a stale
     * menu or product-link form left by an older job.
     */
    fun restartNavigation(context: Context) {
        setStep(context, AutomationStep.OPEN_POST)
    }

    fun markForReport(context: Context, success: Boolean, message: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_STEP, AutomationStep.REPORTING.name)
            .putString(KEY_REPORT_STATUS, if (success) "SUCCEEDED" else "FAILED")
            .putString(KEY_REPORT_MESSAGE, message.take(500))
            .putLong(KEY_STEP_STARTED_AT, System.currentTimeMillis())
            .apply()
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
    }
}
