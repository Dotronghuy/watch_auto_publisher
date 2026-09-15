package vn.zenwatch.mobileworker

import android.content.Context
import android.content.Intent
import android.net.Uri

/** Delivers only validated direct post/video URLs to Facebook; delivery is not identity proof. */
object FacebookPostLauncher {
    fun launch(context: Context, job: MobileLinkJob, targetIndex: Int = 0): Boolean {
        val targets = targetUrls(job)
        if (targetIndex !in targets.indices) return false
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(targets[targetIndex]))
            .setPackage(FACEBOOK_PACKAGE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return try {
            if (intent.resolveActivity(context.packageManager) == null) false
            else { context.startActivity(intent); true }
        } catch (_: Exception) { false }
    }

    fun targetCount(job: MobileLinkJob): Int = targetUrls(job).size

    internal fun targetUrls(job: MobileLinkJob): List<String> =
        FacebookDirectLinkPolicy.targets(job.postId, job.postUrl, job.contentType)

    fun isPageVideoJob(job: MobileLinkJob): Boolean = job.contentType == "reel"

    private const val FACEBOOK_PACKAGE = "com.facebook.katana"
}
