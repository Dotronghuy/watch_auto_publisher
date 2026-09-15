package vn.zenwatch.mobileworker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileLinkJobTest {
    @Test
    fun `normalizes the two canonical content types`() {
        assertEquals("post", MobileLinkJob.normalizeContentType(" POST "))
        assertEquals("reel", MobileLinkJob.normalizeContentType("Reel"))
    }

    @Test
    fun `rejects legacy and missing content types`() {
        assertThrows(IllegalArgumentException::class.java) {
            MobileLinkJob.normalizeContentType("video")
        }
        assertThrows(IllegalArgumentException::class.java) {
            MobileLinkJob.normalizeContentType("")
        }
    }
}
