package vn.zenwatch.mobileworker

import org.junit.Assert.*
import org.junit.Test

class AutomationPolicyTest {
    @Test fun confirmationWakesIdleProcessingWithoutAFacebookEvent() {
        val gate = AutomationTickGate()
        assertTrue(gate.request()) // Service connection schedules its initial tick.
        gate.reset() // That tick ran while idle and did not schedule another one.
        var postedTicks = 0
        val session = AutomationSession { if (gate.request()) postedTicks += 1 }

        session.confirm("job:1", 100)

        assertEquals(1, postedTicks)
        assertTrue(session.permits("job:1", 101))
        assertFalse(gate.request())
    }

    @Test fun everyConfirmedHeartbeatCanRecoverADrainedTick() {
        val gate = AutomationTickGate()
        var postedTicks = 0
        val session = AutomationSession { if (gate.request()) postedTicks += 1 }

        session.confirm("job:1", 100)
        assertEquals(1, postedTicks)
        gate.reset() // No UI event follows this tick.
        session.confirm("job:1", 5_100)

        assertEquals(2, postedTicks)
        assertTrue(session.permits("job:1", 5_101))
    }

    @Test fun confirmedHeartbeatDoesNotReplaceAPendingTick() {
        val gate = AutomationTickGate()
        var postedTicks = 0
        var callbacks = 0
        val session = AutomationSession {
            callbacks += 1
            if (gate.request()) postedTicks += 1
        }

        repeat(20) { session.confirm("job:1", it * 5_000L) }

        assertEquals(20, callbacks)
        assertEquals(1, postedTicks)
    }

    @Test fun pausingDoesNotWakeProcessingOrKeepPermission() {
        var callbacks = 0
        val session = AutomationSession { callbacks += 1 }
        session.pause()
        assertEquals(0, callbacks)
        session.confirm("job:1", 100)
        session.pause()

        assertEquals(1, callbacks)
        assertFalse(session.permits("job:1", 101))
    }

    @Test fun confirmationCallbackRunsAfterStateUpdateOutsideTheSessionMonitor() {
        lateinit var session: AutomationSession
        var callbacks = 0
        session = AutomationSession {
            callbacks += 1
            assertFalse(Thread.holdsLock(session))
            assertTrue(session.permits("job:1", 101))
        }

        session.confirm("job:1", 100)

        assertEquals(1, callbacks)
    }

    @Test fun `invalid cached attempts must be discarded before resuming`() {
        assertEquals(2, MobileLinkJob.normalizeAttempt(2))
        assertThrows(IllegalArgumentException::class.java) { MobileLinkJob.normalizeAttempt(0) }
        assertThrows(IllegalArgumentException::class.java) { MobileLinkJob.normalizeAttempt(-1) }
    }

    @Test fun `menu selection considers vertical position not just the right edge`() {
        val correct = ProductLinkUiPolicy.menuScore(930f, 310f, 930f, 300f, 2f, 0f)
        val wrong = ProductLinkUiPolicy.menuScore(930f, 500f, 930f, 300f, 2f, 0f)
        assertEquals(20f, correct, 0.001f)
        assertEquals(400f, wrong, 0.001f)
        assertTrue(correct < wrong)
    }

    @Test fun `menu label priority is included in the score`() {
        assertEquals(-202f, ProductLinkUiPolicy.menuScore(950f, 310f, 920f, 300f, 1.8f, -250f), 0.001f)
    }

    @Test fun `saved attempt waits for a fresh server confirmation`() {
        val session = AutomationSession()
        assertFalse(session.permits("job:1", 100))
        session.confirm("job:1", 100)
        assertTrue(session.permits("job:1", 101))
        assertFalse(session.permits("job:2", 101))
        assertFalse(session.permits("job:1", 45_100))
    }

    @Test fun `stop and network failure revoke permission immediately`() {
        val session = AutomationSession()
        session.confirm("job:1", 100)
        session.pause()
        assertFalse(session.permits("job:1", 101))
        session.confirm("job:2", 200)
        assertFalse(session.permits("job:1", 201))
        assertTrue(session.permits("job:2", 201))
    }

    @Test fun `continuous UI events cannot postpone a pending tick`() {
        val gate = AutomationTickGate()
        assertTrue(gate.request())
        repeat(1000) { assertFalse(gate.request()) }
        gate.reset()
        assertTrue(gate.request())
    }

    @Test fun `Save text and duplicate description match without matching Save reel`() {
        assertTrue(ProductLinkUiPolicy.hasExactLabel(listOf("Lưu", "Lưu"), listOf("Lưu", "Save")))
        assertTrue(ProductLinkUiPolicy.hasExactLabel(listOf("Save", "Button"), listOf("Lưu", "Save")))
        assertFalse(ProductLinkUiPolicy.hasExactLabel(listOf("Lưu thước phim", "Save reel"), listOf("Lưu", "Save")))
    }

    @Test fun `filled fields remain identifiable after placeholders disappear`() {
        val url = "https://shopee.vn/product/1/2"
        val fields = listOf(ProductLinkField(listOf(url), url), ProductLinkField(listOf("Mua ở đây"), "Mua ở đây"))
        assertEquals(0, ProductLinkUiPolicy.fieldIndex(fields, listOf("url"), url))
        assertEquals(1, ProductLinkUiPolicy.fieldIndex(fields, listOf("Tên liên kết", "Link name"), "Mua ở đây"))
        assertNull(ProductLinkUiPolicy.fieldIndex(fields, listOf("url"), "https://shopee.vn/product/3/4"))
    }

    @Test fun `ambiguous fields do not select a random input`() {
        val fields = listOf(ProductLinkField(listOf("URL"), ""), ProductLinkField(listOf("URL"), ""))
        assertNull(ProductLinkUiPolicy.fieldIndex(fields, listOf("url"), "https://shopee.vn/product/1/2"))
    }

    @Test fun `closing form or returning to product page alone is not proof of saving`() {
        assertFalse(ProductLinkUiPolicy.saved(false, false, false))
        assertFalse(ProductLinkUiPolicy.saved(true, true, true))
        assertTrue(ProductLinkUiPolicy.saved(false, true, false))
        assertTrue(ProductLinkUiPolicy.saved(false, false, true))
    }
}
