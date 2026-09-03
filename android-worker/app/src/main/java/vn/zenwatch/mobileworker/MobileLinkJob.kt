package vn.zenwatch.mobileworker

import org.json.JSONObject

data class MobileLinkJob(
    val id: String,
    val postId: String,
    val postUrl: String,
    val shopeeUrl: String,
    val linkName: String,
    val postText: String,
    val contentType: String,
    val attempt: Int,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("postId", postId)
        .put("postUrl", postUrl)
        .put("shopeeUrl", shopeeUrl)
        .put("linkName", linkName)
        .put("postText", postText)
        .put("contentType", contentType)
        .put("attempt", attempt)

    companion object {
        fun fromJson(json: JSONObject): MobileLinkJob {
            val postUrl = json.getString("postUrl")
            val contentType = normalizeContentType(json.optString("contentType", ""))
            return MobileLinkJob(
                id = json.getString("id"),
                postId = json.getString("postId"),
                postUrl = postUrl,
                shopeeUrl = json.getString("shopeeUrl"),
                linkName = json.optString("linkName", "Mua ở đây"),
                postText = json.optString("postText", ""),
                contentType = contentType,
                attempt = json.optInt("attempt", 1),
            )
        }

        internal fun normalizeContentType(value: String): String {
            val normalized = value.trim().lowercase()
            require(normalized == "post" || normalized == "reel") {
                "contentType phải là post hoặc reel"
            }
            return normalized
        }
    }
}

enum class AutomationStep {
    OPEN_POST,
    OPEN_MENU,
    OPEN_LINK_MANAGER,
    FILL_URL,
    FILL_NAME,
    SAVE,
    VERIFY,
    REPORTING,
}

data class ActiveJob(
    val job: MobileLinkJob,
    val step: AutomationStep,
    val startedAt: Long,
    val stepStartedAt: Long,
    val reportStatus: String?,
    val reportMessage: String?,
)
