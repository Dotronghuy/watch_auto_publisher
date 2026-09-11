package vn.zenwatch.mobileworker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReelProfilePolicyTest {
    @Test fun conflictingModelAfterSharedIntroductionIsRejected() {
        val intro = "Trước cuộc họp chiếc đồng hồ có thể nói thay phong cách của bạn Olevs "
        assertFalse(ReelProfilePolicy.hasStrongCaptionMatch(intro + "9931", intro + "9932"))
        assertTrue(ReelProfilePolicy.hasStrongCaptionMatch(intro + "9931", intro + "9931"))
    }

    @Test fun hiddenModelDoesNotAuthorizeTruncatedGenericCaption() {
        val intro = "Trước cuộc họp chiếc đồng hồ có thể nói thay phong cách của bạn"
        assertFalse(ReelProfilePolicy.hasStrongCaptionMatch(intro + " DW001", intro + "..."))
    }

    @Test fun conflictingUntruncatedTailDoesNotMatchJustBecauseOpeningMatches() {
        val intro = "Trước cuộc họp chiếc đồng hồ có thể nói thay phong cách của bạn "
        assertFalse(ReelProfilePolicy.hasStrongCaptionMatch(intro + "màu trắng thanh lịch",
            intro + "màu đen cá tính"))
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
