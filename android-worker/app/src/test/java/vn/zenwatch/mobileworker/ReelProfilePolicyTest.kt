package vn.zenwatch.mobileworker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReelProfilePolicyTest {
    @Test
    fun `builds one native Page profile URI from a composite Facebook post ID`() {
        assertEquals(
            "fb://page/101788945134600",
            ReelProfilePolicy.profileAppUri("101788945134600_1498447018965401"),
        )
    }

    @Test
    fun `does not invent a page ID for a legacy video-only job`() {
        assertNull(ReelProfilePolicy.profileAppUri("1498447018965401"))
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

    @Test
    fun `selects only the card whose caption strongly matches`() {
        val postText = "Trước cuộc họp, chiếc đồng hồ có thể nói thay phong cách của bạn"
        assertEquals(
            1,
            ReelProfilePolicy.strongCaptionMatchIndex(
                postText,
                listOf(
                    "1 phút · Một mẫu đồng hồ hoàn toàn khác",
                    "Vừa xong · TRUOC CUOC HOP CHIEC DONG HO CO THE NOI THAY PHONG CACH...",
                ),
            ),
        )
    }

    @Test
    fun `never falls back to the first card when caption does not match`() {
        assertNull(
            ReelProfilePolicy.strongCaptionMatchIndex(
                "Bài vừa đăng của đúng sản phẩm",
                listOf(
                    "Vừa xong · Bài Reel mặc định khác",
                    "2 phút · Nội dung cũ không liên quan",
                ),
            ),
        )
    }

    @Test
    fun `three shared marketing words are not enough to identify a post`() {
        assertFalse(
            ReelProfilePolicy.hasStrongCaptionMatch(
                "Trước cuộc họp chiếc đồng hồ có thể nói thay phong cách của bạn",
                "1 phút · Chiếc đồng hồ phong cách hoàn toàn khác",
            ),
        )
    }

    @Test
    fun `rejects another caption that only shares a generic opening`() {
        assertFalse(
            ReelProfilePolicy.hasStrongCaptionMatch(
                "Một chiếc đồng hồ không chỉ để xem giờ mà còn thể hiện phong cách riêng",
                "Một chiếc đồng hồ không chỉ để xem giờ nhưng đây là bài cũ khác",
            ),
        )
    }

    @Test
    fun `rejects ambiguous duplicate captions instead of selecting the first card`() {
        val postText = "Trước cuộc họp chiếc đồng hồ có thể nói thay phong cách của bạn"
        assertNull(
            ReelProfilePolicy.strongCaptionMatchIndex(
                postText,
                listOf(
                    "Vừa xong · TRƯỚC CUỘC HỌP CHIẾC ĐỒNG HỒ CÓ THỂ NÓI THAY...",
                    "1 ngày · TRƯỚC CUỘC HỌP CHIẾC ĐỒNG HỒ CÓ THỂ NÓI THAY...",
                ),
            ),
        )
    }
}
