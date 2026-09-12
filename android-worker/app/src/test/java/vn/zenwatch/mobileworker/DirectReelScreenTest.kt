package vn.zenwatch.mobileworker

import org.junit.Assert.*
import org.junit.Test

class DirectReelScreenTest {
    private fun node(text: String, left: Float, top: Float, right: Float, bottom: Float, button: Boolean = false) =
        FacebookScreenNode(listOf(text), left, top, right, bottom, button)
    private fun screen() = listOf(
        node("Reels", 30f, 60f, 250f, 110f),
        node("More options", 890f, 820f, 970f, 890f, true),
    )
    private fun menu(nodes: List<FacebookScreenNode>) =
        FacebookScreenPolicy.directReelMenuTarget(nodes, 1000f, 1000f)

    @Test fun fullscreenMenuNeedsNeitherCaptionNorTimestamp() {
        assertEquals(1, menu(screen())?.nodeIndex)
        assertTrue(FacebookScreenPolicy.headerCenters(screen(), 1000f, 1000f).isEmpty())
    }
    @Test fun varyingCaptionTextDoesNotGateVideoOptions() {
        for (text in listOf("", "Bất kỳ nội dung nào", "Caption bị cắt...")) {
            assertEquals(1, menu(screen() + node(text, 30f, 640f, 780f, 790f))?.nodeIndex)
        }
    }
    @Test fun blankReactionShareAndExpansionAreNotOptions() {
        for (text in listOf("", "Thích", "Share", "Xem thêm", "Save reel")) {
            assertNull(menu(screen().toMutableList().apply {
                this[1] = node(text, 890f, 820f, 970f, 890f, true)
            }))
        }
    }
    @Test fun twoDistinctOptionsButtonsAreAmbiguous() {
        assertNull(menu(screen() + node("More options", 890f, 300f, 970f, 370f, true)))
    }
    @Test fun duplicateAccessibilityNodesOfOneButtonAreDeduplicated() {
        assertEquals(1, menu(screen() + node("More options", 900f, 830f, 960f, 880f, true))?.nodeIndex)
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
    @Test fun missingVideoSurfaceCannotAuthorizeAReelMenu() {
        assertNull(menu(listOf(screen()[1])))
    }
    @Test fun visibleEllipsisIsAcceptedForVideo() {
        assertEquals(1, menu(screen().toMutableList().apply {
            this[1] = node("⋮", 890f, 820f, 970f, 890f, true)
        })?.nodeIndex)
    }
}
