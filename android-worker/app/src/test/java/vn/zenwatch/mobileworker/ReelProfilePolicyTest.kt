package vn.zenwatch.mobileworker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReelProfilePolicyTest {
    @Test
    fun `builds profile URL from a composite Facebook post ID`() {
        assertEquals(
            "https://www.facebook.com/101788945134600",
            ReelProfilePolicy.profileWebUrl("101788945134600_1498447018965401"),
        )
    }

    @Test
    fun `does not invent a page ID for a legacy video-only job`() {
        assertNull(ReelProfilePolicy.profileWebUrl("1498447018965401"))
    }

    @Test
    fun `matches a visible truncated caption without accents or case sensitivity`() {
        val postText = "Trước cuộc họp, chiếc đồng hồ có thể nói thay phong cách của bạn"
        assertTrue(
            ReelProfilePolicy.hasStrongCaptionMatch(
                postText,
                "TRUOC CUOC HOP CHIEC DONG HO CO THE NOI THAY PHONG CACH...",
            ),
        )
        assertFalse(ReelProfilePolicy.hasStrongCaptionMatch(postText, "Một sản phẩm hoàn toàn khác"))
    }
}
