package vn.zenwatch.mobileworker

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Opens the exact Facebook object described by a mobile-link job.
 *
 * Facebook's Android app sometimes treats a permalink as a generic feed route.
 * Reels therefore prefer /reel/{id}, which opens the full-screen viewer required
 * by the product-management flow. Photo posts still prefer the Graph permalink.
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
        val reelJob = isReelJob(job)
        val composite = compositeParts(job.postId)
        if (composite != null) {
            val (pageId, storyId) = composite
            if (reelJob) {
                val canonicalReel = buildReelPermalink(storyId)
                val pageVideo = buildPageVideoPermalink(pageId, storyId)
                return listOfNotNull(
                    graphPermalink,
                    graphPermalink?.let(::faceWebModal),
                    canonicalReel,
                    faceWebModal(canonicalReel),
                    pageVideo,
                    faceWebModal(pageVideo),
                ).distinctBy(Uri::toString)
            }

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
        return if (reelJob) {
            listOfNotNull(
                graphPermalink,
                graphPermalink?.let(::faceWebModal),
                canonicalReel,
                faceWebModal(canonicalReel),
            ).distinctBy(Uri::toString)
        } else {
            listOfNotNull(
                graphPermalink,
                graphPermalink?.let(::faceWebModal),
                canonicalReel,
                faceWebModal(canonicalReel),
            ).distinctBy(Uri::toString)
        }
    }

    fun isReelJob(job: MobileLinkJob): Boolean =
        REEL_URL_HINTS.any { hint -> job.postUrl.contains(hint, ignoreCase = true) }

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

    private fun buildPageVideoPermalink(pageId: String, videoId: String): Uri =
        Uri.Builder()
            .scheme("https")
            .authority("www.facebook.com")
            .appendPath(pageId)
            .appendPath("videos")
            .appendPath(videoId)
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
    private val REEL_URL_HINTS = listOf(
        "/reel/",
        "/reels/",
        "/videos/",
        "/watch/",
        "watch?v=",
        "video.php",
        "fb.watch/",
        "/share/r/",
        "/share/v/",
    )
}
