package vn.zenwatch.mobileworker

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Opens the exact Facebook object described by a mobile-link job.
 *
 * Facebook's Android app sometimes treats /PageID/posts/PostID as a generic
 * feed route. A Page post's composite Graph ID is more precise, so regular
 * posts are opened with story_fbid + PageID first and then with two exact
 * permalink fallbacks. Reels keep the permalink returned by Graph API.
 */
object FacebookPostLauncher {
    private val compositePostId = Regex("^(\\d+)_(\\d+)$")

    fun launch(context: Context, job: MobileLinkJob, targetIndex: Int = 0): Boolean {
        val targets = targetUris(job)
        if (targetIndex !in targets.indices) return false

        for (uri in targets.drop(targetIndex)) {
            val intent = Intent(Intent.ACTION_VIEW, uri)
                .setPackage(FACEBOOK_PACKAGE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            try {
                if (intent.resolveActivity(context.packageManager) != null) {
                    context.startActivity(intent)
                    return true
                }
            } catch (_: Exception) {
                // Try the next exact permalink representation.
            }
        }
        return false
    }

    fun targetCount(job: MobileLinkJob): Int = targetUris(job).size

    fun exactWebUrl(job: MobileLinkJob): String =
        compositeParts(job.postId)?.let { (pageId, storyId) ->
            buildStoryPermalink(pageId, storyId).toString()
        } ?: job.postUrl

    private fun targetUris(job: MobileLinkJob): List<Uri> {
        val composite = compositeParts(job.postId)
        if (composite != null) {
            val (pageId, storyId) = composite
            val webPermalink = buildStoryPermalink(pageId, storyId)
            return listOf(
                Uri.Builder()
                    .scheme("fb")
                    .authority("story")
                    .appendQueryParameter("story_fbid", storyId)
                    .appendQueryParameter("id", pageId)
                    .build(),
                webPermalink,
                faceWebModal(webPermalink),
            )
        }

        val exactVideoUrl = Uri.parse(job.postUrl)
        return listOf(
            exactVideoUrl,
            faceWebModal(exactVideoUrl),
        ).distinctBy(Uri::toString)
    }

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

    private fun faceWebModal(webUri: Uri): Uri =
        Uri.Builder()
            .scheme("fb")
            .authority("facewebmodal")
            .appendPath("f")
            .appendQueryParameter("href", webUri.toString())
            .build()

    private const val FACEBOOK_PACKAGE = "com.facebook.katana"
}
