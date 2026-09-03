package vn.zenwatch.mobileworker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MobileWorkerApiTest {
    @Test
    fun `accepts successful result responses`() {
        assertEquals(MobileWorkerReportOutcome.REPORTED, reportOutcomeForHttpStatus(200))
        assertEquals(MobileWorkerReportOutcome.REPORTED, reportOutcomeForHttpStatus(204))
    }

    @Test
    fun `treats conflict as a stale terminal attempt`() {
        assertEquals(MobileWorkerReportOutcome.STALE, reportOutcomeForHttpStatus(409))
        assertEquals(MobileWorkerHeartbeatOutcome.STALE, heartbeatOutcomeForHttpStatus(409))
    }

    @Test
    fun `keeps retrying transient or authentication errors`() {
        assertNull(reportOutcomeForHttpStatus(401))
        assertNull(reportOutcomeForHttpStatus(500))
        assertNull(heartbeatOutcomeForHttpStatus(401))
        assertNull(heartbeatOutcomeForHttpStatus(500))
    }

    @Test
    fun `keeps an accepted heartbeat active`() {
        assertEquals(MobileWorkerHeartbeatOutcome.ACTIVE, heartbeatOutcomeForHttpStatus(200))
        assertEquals(MobileWorkerHeartbeatOutcome.ACTIVE, heartbeatOutcomeForHttpStatus(204))
    }
}
