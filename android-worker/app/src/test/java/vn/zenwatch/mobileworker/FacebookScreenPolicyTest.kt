package vn.zenwatch.mobileworker

import org.junit.Assert.*
import org.junit.Test

class FacebookScreenPolicyTest {
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

    @Test fun detectsOneHeaderWithoutPostText() {
        assertEquals(listOf(190f), FacebookScreenPolicy.headerCenters(
            listOf(node("1 phút ·", 180f, 200f)), 1000f, 1000f))
    }

    @Test fun separateHeadersAreNotCollapsedIntoOne() {
        assertEquals(2, FacebookScreenPolicy.headerCenters(listOf(
            node("1 phút ·", 180f, 200f), node("2 phút ·", 550f, 570f),
        ), 1000f, 1000f).size)
    }
}
