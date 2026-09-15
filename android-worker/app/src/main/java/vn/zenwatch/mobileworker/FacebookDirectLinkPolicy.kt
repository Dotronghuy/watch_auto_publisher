package vn.zenwatch.mobileworker

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

/** Only direct object links; never navigate to a Page, feed, or generic Reels screen. */
internal object FacebookDirectLinkPolicy {
    fun targets(postId: String, postUrl: String, contentType: String): List<String> {
        if (contentType !in setOf("post", "reel")) return emptyList()
        val id = postId.trim()
        if (!id.matches(Regex("""\d+(?:_\d+)?"""))) return emptyList()
        val parts = id.split('_')
        val objectId = parts.last()
        val pageId = parts.first().takeIf { parts.size == 2 }
        val fallback = when {
            contentType == "reel" && pageId != null ->
                "https://www.facebook.com/$pageId/videos/$objectId"
            contentType == "reel" -> "https://www.facebook.com/reel/$objectId"
            pageId != null -> "https://www.facebook.com/permalink.php?story_fbid=$objectId&id=$pageId"
            else -> null
        }
        val permalink = validatedPermalink(postUrl, pageId, objectId, contentType)
        val candidates = if (contentType == "reel" && pageId != null) {
            // Prefer the Page/video route.  Facebook's /reel/{id} URL can be
            // handled as the generic Reels surface on Android.
            listOfNotNull(fallback, permalink)
        } else listOfNotNull(permalink, fallback)
        return candidates.distinct().flatMap { url ->
            listOf(url, "fb://facewebmodal/f?href=" + URLEncoder.encode(url, "UTF-8"))
        }
    }

    private fun validatedPermalink(value: String, pageId: String?, objectId: String, type: String): String? =
        runCatching {
            val uri = URI(value.trim())
            val host = uri.host?.lowercase().orEmpty()
            if (uri.scheme != "https" || uri.userInfo != null || uri.port !in setOf(-1, 443) ||
                !(host == "facebook.com" || host.endsWith(".facebook.com"))) return null
            val path = uri.path.orEmpty()
            val params = uri.rawQuery.orEmpty().split('&').filter(String::isNotBlank).map {
                val pair = it.split('=', limit = 2)
                URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair.getOrElse(1) { "" }, "UTF-8")
            }.groupBy({ it.first }, { it.second })
            if (listOf("id", "story_fbid", "v").any { (params[it]?.size ?: 0) > 1 }) return null
            fun param(key: String): String? = params[key]?.singleOrNull()
            val storyPath = path in setOf("/permalink.php", "/story.php")
            val postPath = Regex("""^/([^/]+)/posts/(\d+|pfbid[A-Za-z0-9]+)/?$""").matchEntire(path)
            val videoPath = Regex("""^/(?:([^/]+)/)?(?:reel|reels|videos)/(\d+)/?$""").matchEntire(path)
            val watchPath = path in setOf("/watch", "/watch/")
            val routePage = when {
                storyPath -> param("id")
                postPath != null -> postPath.groupValues[1].takeIf { it.all(Char::isDigit) }
                videoPath != null -> videoPath.groupValues[1].takeIf { it.isNotBlank() && it.all(Char::isDigit) }
                else -> null
            }
            if (pageId != null && routePage != null && pageId != routePage) return null
            if (type == "post" && (videoPath != null || watchPath)) return null
            val routeObject = when {
                storyPath -> param("story_fbid")
                postPath != null -> postPath.groupValues[2]
                videoPath != null -> videoPath.groupValues[2]
                watchPath -> param("v")
                else -> null
            }
            val opaquePost = type == "post" && routeObject?.matches(Regex("pfbid[A-Za-z0-9]+")) == true
            if (routeObject != objectId && !opaquePost) return null
            uri.toASCIIString()
        }.getOrNull()
}
