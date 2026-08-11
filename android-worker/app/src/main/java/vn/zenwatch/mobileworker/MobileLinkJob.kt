package vn.zenwatch.mobileworker

import org.json.JSONObject

data class MobileLinkJob(
    val id: String,
    val postId: String,
    val postUrl: String,
    val shopeeUrl: String,
    val linkName: String,
    val attempt: Int,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("postId", postId)
        .put("postUrl", postUrl)
        .put("shopeeUrl", shopeeUrl)
        .put("linkName", linkName)
        .put("attempt", attempt)

    companion object {
        fun fromJson(json: JSONObject): MobileLinkJob = MobileLinkJob(
            id = json.getString("id"),
            postId = json.getString("postId"),
            postUrl = json.getString("postUrl"),
            shopeeUrl = json.getString("shopeeUrl"),
            linkName = json.optString("linkName", "Mua ở đây"),
            attempt = json.optInt("attempt", 1),
        )
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
