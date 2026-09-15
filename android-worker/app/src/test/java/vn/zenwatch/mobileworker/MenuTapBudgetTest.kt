package vn.zenwatch.mobileworker

import org.junit.Assert.*
import org.junit.Test

class MenuTapBudgetTest {
    @Test fun rejectedDispatchDoesNotConsumeTheSingleCoordinateTap() {
        val budget = MenuTapBudget()
        budget.record(false)
        assertEquals(0, budget.acceptedTaps)
        assertTrue(budget.canAttempt("header_row"))
        budget.record(true)
        assertFalse(budget.canAttempt("header_row"))
    }

    @Test fun rejectedDispatchesCannotLoopForever() {
        val budget = MenuTapBudget()
        repeat(3) { budget.record(false) }
        assertFalse(budget.canAttempt("header_row"))
        assertFalse(budget.canAttempt("semantic_node"))
    }

    @Test fun semanticTapsKeepTheirBoundDespiteFailures() {
        val budget = MenuTapBudget()
        budget.record(false)
        repeat(3) {
            assertTrue(budget.canAttempt("semantic_node"))
            budget.record(true)
        }
        assertFalse(budget.canAttempt("semantic_node"))
    }
}
