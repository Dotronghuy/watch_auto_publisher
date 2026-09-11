package vn.zenwatch.mobileworker

import java.text.Normalizer

/** Caption identity checks only; no profile navigation. */
object ReelProfilePolicy {
    private val combiningMarks = Regex("\\p{Mn}+")
    private val nonWord = Regex("[^a-z0-9]+")
    private val ignoredTerms = setOf(
        "cua", "cho", "voi", "nhung", "mot", "cac", "khi", "nay", "tai",
        "the", "and", "with", "this", "that", "from", "your", "facebook",
    )

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

    fun hasStrongCaptionMatch(postText: String, visibleText: String): Boolean {
        val targetTokens = captionTokens(postText)
        if (targetTokens.size < MIN_CAPTION_TOKENS) return false
        val visibleTokens = captionTokens(visibleText)
        // A common marketing introduction cannot authorize a different model/SKU.
        // If a distinctive code is hidden by truncation, leave the job unverified.
        val modelTokens = targetTokens.filter { token ->
            token.any(Char::isDigit) && (token.any(Char::isLetter) || token.length >= 3)
        }.toSet()
        if (!visibleTokens.containsAll(modelTokens)) return false
        val requiredPrefix = minOf(REQUIRED_PREFIX_TOKENS, targetTokens.size)
        val prefixRun = longestTargetPrefixRun(targetTokens, visibleTokens)
        if (prefixRun < requiredPrefix) return false
        if (prefixRun < targetTokens.size) {
            val truncated = visibleText.contains("…") || visibleText.contains("...") ||
                Regex("(?i)(xem thêm|see more)").containsMatchIn(visibleText)
            val endsAtPrefix = visibleTokens.takeLast(prefixRun) == targetTokens.take(prefixRun)
            if (!truncated && !endsAtPrefix) return false
        }

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
    private const val REQUIRED_PREFIX_TOKENS = 12
    private const val REQUIRED_SIGNIFICANT_TERMS = 4
}
