package vn.zenwatch.mobileworker

/** A rejected dispatch is not a tap. Both accepted taps and transport failures are bounded. */
internal class MenuTapBudget {
    var acceptedTaps = 0
        private set
    var rejectedDispatches = 0
        private set

    fun canAttempt(evidence: String): Boolean =
        acceptedTaps < FacebookMenuTapPolicy.attemptLimit(evidence) && rejectedDispatches < 3

    fun record(accepted: Boolean) {
        if (accepted) acceptedTaps++ else rejectedDispatches++
    }
}
