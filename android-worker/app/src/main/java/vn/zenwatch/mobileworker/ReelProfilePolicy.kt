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

    fun profileAppUri(postId: String): String? = pageIdFromPostId(postId)?.let { pageId ->
        "fb://page/$pageId"
    }

    /**
     * Return a card only when exactly one visible card contains a deterministic
     * prefix of the caption sent to Facebook. Ambiguity must fail closed instead
     * of selecting the first or newest card.
     */
    fun strongCaptionMatchIndex(postText: String, visibleTexts: List<String>): Int? {
        val matches = visibleTexts.mapIndexedNotNull { index, visibleText ->
            index.takeIf { hasStrongCaptionMatch(postText, visibleText) }
        }
        return matches.singleOrNull()
    }

    fun captionMatchScore(postText: String, visibleText: String): Int {
        val targetTokens = captionTokens(postText).take(MAX_FINGERPRINT_TOKENS)
        if (targetTokens.isEmpty()) return 0
        val visibleTokens = captionTokens(visibleText)
        val prefixRun = longestTargetPrefixRun(targetTokens, visibleTokens)
        val targetTerms = significantTerms(postText)
        val visibleTerms = normalize(visibleText).split(' ').filter { it.isNotBlank() }.toSet()
        val significantMatches = targetTerms.count(visibleTerms::contains)
        return prefixRun * PREFIX_SCORE_WEIGHT + significantMatches
    }

    fun hasStrongCaptionMatch(postText: String, visibleText: String): Boolean {
        val targetTokens = captionTokens(postText).take(MAX_FINGERPRINT_TOKENS)
        if (targetTokens.size < MIN_CAPTION_TOKENS) return false
        val visibleTokens = captionTokens(visibleText)
        val requiredPrefix = minOf(REQUIRED_PREFIX_TOKENS, targetTokens.size)
        if (longestTargetPrefixRun(targetTokens, visibleTokens) < requiredPrefix) return false

        val targetTerms = significantTerms(postText)
        if (targetTerms.isEmpty()) return false
        val visibleTerms = normalize(visibleText).split(' ').filter { it.isNotBlank() }.toSet()
        val requiredTerms = minOf(REQUIRED_SIGNIFICANT_TERMS, targetTerms.size)
        return targetTerms.count(visibleTerms::contains) >= requiredTerms
    }

    private fun longestTargetPrefixRun(targetTokens: List<String>, visibleTokens: List<String>): Int {
        if (targetTokens.isEmpty() || visibleTokens.isEmpty()) return 0
        var longest = 0
        visibleTokens.forEachIndexed { start, token ->
            if (token != targetTokens.first()) return@forEachIndexed
            var run = 0
            while (
                run < targetTokens.size
                && start + run < visibleTokens.size
                && visibleTokens[start + run] == targetTokens[run]
            ) {
                run += 1
            }
            if (run > longest) longest = run
        }
        return longest
    }

    private fun captionTokens(value: String): List<String> = normalize(value)
        .split(' ')
        .filter { it.isNotBlank() }

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

    private const val MIN_CAPTION_TOKENS = 4
    private const val REQUIRED_PREFIX_TOKENS = 10
    private const val REQUIRED_SIGNIFICANT_TERMS = 4
    private const val MAX_FINGERPRINT_TOKENS = 12
    private const val PREFIX_SCORE_WEIGHT = 100
}
