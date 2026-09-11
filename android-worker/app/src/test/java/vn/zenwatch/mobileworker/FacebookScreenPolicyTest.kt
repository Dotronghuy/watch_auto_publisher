package vn.zenwatch.mobileworker

import org.junit.Assert.*
import org.junit.Test

class FacebookScreenPolicyTest {
    private val caption = "Trước cuộc họp chiếc đồng hồ có thể nói thay phong cách của bạn"
    private fun node(text: String, top: Float, bottom: Float, left: Float = 20f,
                     right: Float = 780f, interactive: Boolean = false) =
        FacebookScreenNode(listOf(text), left, top, right, bottom, interactive)

    @Test fun `profile tabs can be below the old 58 percent cutoff`() {
        val nodes = listOf(
            node("Tất cả", 720f, 780f, 20f, 220f, true),
            node("Ảnh", 720f, 780f, 230f, 400f, true),
            node("Reels", 720f, 780f, 410f, 600f, true),
        )
        assertEquals(setOf(0, 1, 2), FacebookScreenPolicy.profileTabIndices(nodes, 1000f, 1000f))
    }

    @Test fun `Posts and Photos are sufficient without a visible Reels tab`() {
        val nodes = listOf(
            node("Bài viết, Tab 1/4", 500f, 550f, 20f, 220f, true),
            node("Ảnh", 500f, 550f, 230f, 400f, true),
        )
        assertEquals(setOf(0, 1), FacebookScreenPolicy.profileTabIndices(nodes, 1000f, 1000f))
    }

    @Test fun `one duplicated tab is not a profile and caption words are not tabs`() {
        val tab = node("All", 200f, 250f, 20f, 220f, true)
        assertTrue(FacebookScreenPolicy.profileTabIndices(listOf(tab, tab), 1000f, 1000f).isEmpty())
        assertTrue(FacebookScreenPolicy.profileTabIndices(listOf(
            node("All", 200f, 250f), node("Photos", 400f, 450f),
        ), 1000f, 1000f).isEmpty())
        assertFalse(FacebookScreenPolicy.tabMatches(listOf("All these watches"), listOf("All")))
    }

    @Test fun `matching second caption selects second header not first`() {
        val nodes = listOf(
            node("1 phút ·", 180f, 200f),
            node("Bài cũ hoàn toàn khác", 220f, 300f),
            node("2 phút ·", 550f, 570f),
            node(caption, 590f, 680f),
        )
        assertEquals(0.56f, FacebookScreenPolicy.matchingHeaderY(caption, nodes, 1000f, 1000f)!!, 0.001f)
    }

    @Test fun `a lower header still separates cards beyond the old 72 percent cutoff`() {
        val nodes = listOf(
            node("1 phút ·", 180f, 200f),
            node("Bài cũ hoàn toàn khác", 220f, 300f),
            node("2 phút ·", 770f, 790f),
            node(caption, 810f, 900f),
        )
        assertEquals(0.78f, FacebookScreenPolicy.matchingHeaderY(caption, nodes, 1000f, 1000f)!!, 0.001f)
    }

    @Test fun `caption above the first visible header does not belong to that header`() {
        assertNull(FacebookScreenPolicy.matchingHeaderY(caption, listOf(
            node(caption, 80f, 200f), node("1 phút ·", 400f, 420f),
            node("Một bài viết khác", 450f, 520f),
        ), 1000f, 1000f))
    }

    @Test fun `parent spanning two cards must not donate caption to the first card`() {
        assertNull(FacebookScreenPolicy.matchingHeaderY(caption, listOf(
            node(caption, 150f, 850f), node("1 phút ·", 180f, 200f),
            node("2 phút ·", 650f, 670f),
        ), 1000f, 1000f))
    }

    @Test fun `duplicate matching cards still fail closed`() {
        assertNull(FacebookScreenPolicy.matchingHeaderY(caption, listOf(
            node("1 phút ·", 180f, 200f), node(caption, 220f, 300f),
            node("2 phút ·", 550f, 570f), node(caption, 590f, 680f),
        ), 1000f, 1000f))
    }
}
