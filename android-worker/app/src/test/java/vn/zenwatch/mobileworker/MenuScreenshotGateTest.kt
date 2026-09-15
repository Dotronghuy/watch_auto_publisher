package vn.zenwatch.mobileworker

import org.junit.Assert.*
import org.junit.Test

class MenuScreenshotGateTest {
    @Test fun oneCaptureInFlightAndRateLimited() {
        val gate = MenuScreenshotGate()
        val token = gate.begin("a", 1000)!!
        assertNull(gate.begin("a", 1200))
        assertTrue(gate.finish("a", token, 1300))
        assertNull(gate.begin("a", 1500))
        assertNotNull(gate.begin("a", 2000))
    }

    @Test fun threeCapturesMaximumPerNavigation() {
        val gate = MenuScreenshotGate()
        for (now in listOf(1000L, 2000L, 3000L)) {
            assertTrue(gate.finish("a", gate.begin("a", now)!!, now + 100))
        }
        assertNull(gate.begin("a", 4000))
        assertNotNull(gate.begin("next-target", 5000))
    }

    @Test fun timeoutAndDuplicateCallbacksCannotComplete() {
        val gate = MenuScreenshotGate()
        val old = gate.begin("a", 1000)!!
        assertFalse(gate.finish("a", old, 3100))
        assertFalse(gate.waiting("a", 3100))
        val current = gate.begin("a", 3200)!!
        assertFalse(gate.finish("a", old, 3300))
        assertTrue(gate.finish("a", current, 3350))
        assertFalse(gate.finish("a", current, 3400))
    }

    @Test fun resetAndChangedNavigationDiscardOldCapture() {
        val gate = MenuScreenshotGate()
        val old = gate.begin("a", 1000)!!
        gate.reset()
        val current = gate.begin("a", 1100)!!
        assertNotEquals(old, current)
        assertFalse(gate.finish("a", old, 1200))
        gate.begin("b", 1300)
        assertFalse(gate.finish("a", current, 1400))
    }

    @Test fun backwardsClockDoesNotAuthorizeCapture() {
        val gate = MenuScreenshotGate()
        val token = gate.begin("a", 1000)!!
        assertFalse(gate.finish("a", token, 999))
    }
}
