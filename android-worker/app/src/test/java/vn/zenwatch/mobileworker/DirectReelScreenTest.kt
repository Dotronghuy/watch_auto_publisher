package vn.zenwatch.mobileworker

import org.junit.Assert.*
import org.junit.Test

class DirectReelScreenTest {
    private val caption = "Trước cuộc họp chiếc đồng hồ có thể nói thay phong cách của bạn"
    private fun node(text: String, left: Float, top: Float, right: Float, bottom: Float, button: Boolean = false) =
        FacebookScreenNode(listOf(text), left, top, right, bottom, button)
    private fun screen() = listOf(
        node("Reels", 30f, 60f, 250f, 110f),
        node(caption, 30f, 640f, 780f, 790f),
        node("More options", 890f, 820f, 970f, 890f, true),
    )
    private fun menu(nodes: List<FacebookScreenNode>) =
        FacebookScreenPolicy.directReelMenuIndex(caption, nodes, 1000f, 1000f)

    @Test fun fullscreenCaptionWithoutTimestampCanVerifyDestination() {
        assertEquals(2, menu(screen()))
        assertTrue(FacebookScreenPolicy.headerCenters(screen(), 1000f, 1000f).isEmpty())
    }
    @Test fun wrongCaptionDoesNotAuthorizeTheMenu() {
        assertNull(menu(screen().toMutableList().apply {
            this[1] = node("Một bài hoàn toàn khác", 30f, 640f, 780f, 790f)
        }))
    }
    @Test fun blankReactionShareAndCaptionExpansionAreNotOptions() {
        for (text in listOf("", "Thích", "Share", "Xem thêm", "Save reel")) {
            assertNull(menu(screen().toMutableList().apply {
                this[2] = node(text, 890f, 820f, 970f, 890f, true)
            }))
        }
    }
    @Test fun twoDistinctOptionsButtonsAreAmbiguous() {
        assertNull(menu(screen() + node("More options", 890f, 300f, 970f, 370f, true)))
    }
    @Test fun duplicateAccessibilityNodesOfOneButtonAreDeduplicated() {
        assertEquals(2, menu(screen() + node("More options", 900f, 830f, 960f, 880f, true)))
    }
    @Test fun twoCaptionRegionsCannotBeMistakenForOneReel() {
        assertNull(menu(screen() + node(caption, 30f, 200f, 780f, 350f)))
    }
    @Test fun staleOptionsSheetIsNotASettledDestination() {
        assertNull(menu(screen() + node("Save reel", 20f, 500f, 600f, 560f, true)))
    }
    @Test fun profileRowAndMultiplePostHeadersCannotBeFullscreenReelProof() {
        assertNull(menu(screen() + listOf(
            node("All", 20f, 200f, 200f, 250f, true),
            node("Photos", 230f, 200f, 450f, 250f, true),
        )))
        assertNull(menu(screen() + listOf(
            node("1 phút ·", 20f, 180f, 200f, 220f),
            node("2 phút ·", 20f, 400f, 200f, 440f),
        )))
    }
}
