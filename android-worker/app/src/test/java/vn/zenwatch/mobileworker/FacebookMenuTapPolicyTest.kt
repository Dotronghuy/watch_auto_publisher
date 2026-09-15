package vn.zenwatch.mobileworker

import org.junit.Assert.*
import org.junit.Test

class FacebookMenuTapPolicyTest {
    @Test fun unnamedIconsNeverClickAnAncestor() {
        for (evidence in listOf("header_icon", "header_row", "unknown")) {
            for (attempt in 0..2) {
                assertFalse(FacebookMenuTapPolicy.preferNodeClick(evidence, attempt))
            }
        }
    }

    @Test fun semanticOptionsUseGestureOnSecondAttempt() {
        for (evidence in listOf("semantic_node", "video_options")) {
            assertTrue(FacebookMenuTapPolicy.preferNodeClick(evidence, 0))
            assertFalse(FacebookMenuTapPolicy.preferNodeClick(evidence, 1))
            assertTrue(FacebookMenuTapPolicy.preferNodeClick(evidence, 2))
        }
    }

    @Test fun coordinateFallbackHasOnlyOneAttempt() {
        assertEquals(1, FacebookMenuTapPolicy.attemptLimit("header_row"))
        for (evidence in listOf("semantic_node", "video_options", "header_icon")) {
            assertEquals(3, FacebookMenuTapPolicy.attemptLimit(evidence))
        }
    }
}
