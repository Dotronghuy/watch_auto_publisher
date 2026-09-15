package vn.zenwatch.mobileworker

/** In-memory permission: a saved job alone never authorizes touching Facebook. */
internal class AutomationSession(private val onConfirmed: () -> Unit = {}) {
    private var attemptKey: String? = null
    private var confirmedAt: Long = 0

    fun confirm(key: String, now: Long) {
        synchronized(this) {
            attemptKey = key
            confirmedAt = now
        }
        // Idle accessibility polling may have drained before this job existed.
        // Wake it after every successful heartbeat, even without a Facebook event.
        // Keep the callback outside this monitor; the queued tick rechecks permission.
        onConfirmed()
    }

    @Synchronized
    fun pause() {
        attemptKey = null
    }

    @Synchronized
    fun permits(key: String, now: Long): Boolean =
        attemptKey == key && now - confirmedAt in 0 until CONFIRMATION_TTL_MS

    companion object {
        // Shorter than the server's five-minute lease, including HTTP timeouts.
        private const val CONFIRMATION_TTL_MS = 45_000L
    }
}

/** Keep the existing tick when Facebook emits a continuous event stream. */
internal class AutomationTickGate {
    private var pending = false

    fun request(): Boolean {
        if (pending) return false
        pending = true
        return true
    }

    fun reset() { pending = false }
}

internal data class ProductLinkField(
    val labels: List<String>,
    val value: String,
)

internal object ProductLinkUiPolicy {
    fun menuScore(x: Float, y: Float, targetX: Float, targetY: Float,
                  verticalWeight: Float, labelPenalty: Float): Float =
        kotlin.math.abs(x - targetX) +
            kotlin.math.abs(y - targetY) * verticalWeight + labelPenalty

    fun hasExactLabel(labels: List<String>, keywords: List<String>): Boolean =
        labels.any { label -> keywords.any { label.trim().equals(it, ignoreCase = true) } }

    fun fieldIndex(fields: List<ProductLinkField>, keywords: List<String>, expected: String): Int? {
        val named = fields.indices.filter { index ->
            fields[index].labels.any { label ->
                keywords.any { label.contains(it, ignoreCase = true) }
            }
        }
        if (named.isNotEmpty()) return named.singleOrNull()
        // Facebook may remove the placeholder/hint as soon as SET_TEXT succeeds.
        return fields.indices.filter { index ->
            expected.isNotBlank() && fields[index].value.trim() == expected.trim()
        }.singleOrNull()
    }

    fun saved(formVisible: Boolean, confirmationSeen: Boolean, exactUrlVisible: Boolean): Boolean =
        !formVisible && (confirmationSeen || exactUrlVisible)
}
