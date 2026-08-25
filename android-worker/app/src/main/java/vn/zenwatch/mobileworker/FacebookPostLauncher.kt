package vn.zenwatch.mobileworker

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Opens the Facebook surface required by a mobile-link job.
 *
 * Video jobs have exactly one navigation route: the owning Page's Posts timeline.
 * The worker identifies the published video card there and must never enter
 * Facebook's generic full-screen Reels viewer. Non-video posts keep their exact
 * permalink fallbacks.
 */
object FacebookPostLauncher {
    private val compositePostId = Regex("^(\\d+)_(\\d+)$")

    fun launch(context: Context, job: MobileLinkJob, targetIndex: Int = 0): Boolean {
        val targets = targetUris(job)
        if (targetIndex !in targets.indices) return false

        val intent = Intent(Intent.ACTION_VIEW, targets[targetIndex])
            .setPackage(FACEBOOK_PACKAGE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return try {
            if (intent.resolveActivity(context.packageManager) != null) {
                context.startActivity(intent)
                true
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }
    }

    fun targetCount(job: MobileLinkJob): Int = targetUris(job).size

    fun exactWebUrl(job: MobileLinkJob): String = job.postUrl

    private fun targetUris(job: MobileLinkJob): List<Uri> {
        val graphPermalink = httpsUri(job.postUrl)
        val videoJob = isPageVideoJob(job)
        val composite = compositeParts(job.postId)
        if (videoJob) {
            // Fail closed for legacy video-only IDs: without pageId there is no
            // safe Page timeline to open. Never fall back to /reel, /videos or
            // /watch because those routes can expose unrelated creator videos.
            return ReelProfilePolicy.pagePostsUrl(job.postId)
                ?.let(Uri::parse)
                ?.let { uri -> listOf(uri) }
                .orEmpty()
        }

        if (composite != null) {
            val (pageId, storyId) = composite
            val canonicalPermalink = buildStoryPermalink(pageId, storyId)
            return listOfNotNull(
                graphPermalink,
                graphPermalink?.let(::faceWebModal),
                canonicalPermalink,
                faceWebModal(canonicalPermalink),
                Uri.Builder()
                    .scheme("fb")
                    .authority("story")
                    .appendQueryParameter("story_fbid", storyId)
                    .appendQueryParameter("id", pageId)
                    .build(),
            ).distinctBy(Uri::toString)
        }

        val canonicalReel = buildReelPermalink(job.postId.trim())
        return listOfNotNull(
            graphPermalink,
            graphPermalink?.let(::faceWebModal),
            canonicalReel,
            faceWebModal(canonicalReel),
        ).distinctBy(Uri::toString)
    }

    fun isPageVideoJob(job: MobileLinkJob): Boolean = job.contentType == "reel"

    private fun compositeParts(postId: String): Pair<String, String>? {
        val match = compositePostId.matchEntire(postId.trim()) ?: return null
        val (pageId, storyId) = match.destructured
        return pageId to storyId
    }

    private fun buildStoryPermalink(pageId: String, storyId: String): Uri =
        Uri.Builder()
            .scheme("https")
            .authority("www.facebook.com")
            .appendPath("permalink.php")
            .appendQueryParameter("story_fbid", storyId)
            .appendQueryParameter("id", pageId)
            .build()

    private fun buildReelPermalink(reelId: String): Uri =
        Uri.Builder()
            .scheme("https")
            .authority("www.facebook.com")
            .appendPath("reel")
            .appendPath(reelId)
            .build()

    private fun httpsUri(value: String): Uri? = runCatching {
        Uri.parse(value.trim()).takeIf { uri ->
            uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()
        }
    }.getOrNull()

    private fun faceWebModal(webUri: Uri): Uri =
        Uri.Builder()
            .scheme("fb")
            .authority("facewebmodal")
            .appendPath("f")
            .appendQueryParameter("href", webUri.toString())
            .build()

    private const val FACEBOOK_PACKAGE = "com.facebook.katana"
}
