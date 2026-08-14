package vn.zenwatch.mobileworker

import java.text.Normalizer

object ReelProfilePolicy {
    private val compositePostId = Regex("^(\\d+)_(\\d+)$")
    private val combiningMarks = Regex("\\p{Mn}+")
    private val nonWord = Regex("[^a-z0-9]+")
    private val ignoredTerms = setOf(
        "cua", "cho", "voi", "nhung", "mot", "cac", "khi", "nay", "tai",
        "the", "and", "with", "this", "that", "from", "your", "facebook",
    )

    fun pageIdFromPostId(postId: String): String? =
        compositePostId.matchEntire(postId.trim())?.groupValues?.get(1)

    fun profileWebUrl(postId: String): String? = pageIdFromPostId(postId)?.let { pageId ->
        "https://www.facebook.com/$pageId"
    }

    fun captionMatchScore(postText: String, visibleText: String): Int {
        val targetTerms = significantTerms(postText)
        if (targetTerms.isEmpty()) return 0
        val visibleTerms = normalize(visibleText).split(' ').filter { it.isNotBlank() }.toSet()
        return targetTerms.count(visibleTerms::contains)
    }

    fun hasStrongCaptionMatch(postText: String, visibleText: String): Boolean {
        val targetTerms = significantTerms(postText)
        if (targetTerms.isEmpty()) return false
        val required = minOf(3, targetTerms.size)
        return captionMatchScore(postText, visibleText) >= required
    }

    private fun significantTerms(value: String): List<String> = normalize(value)
        .split(' ')
        .asSequence()
        .filter { it.length >= 3 && it !in ignoredTerms && it.toIntOrNull() == null }
        .distinct()
        .take(12)
        .toList()

    private fun normalize(value: String): String = combiningMarks
        .replace(Normalizer.normalize(value.lowercase(), Normalizer.Form.NFD), "")
        .replace('đ', 'd')
        .replace(nonWord, " ")
        .trim()
}
