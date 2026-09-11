package vn.zenwatch.mobileworker

import org.junit.Assert.*
import org.junit.Test

class DirectPostScreenTest {
    private val caption = "Trước cuộc họp chiếc đồng hồ có thể nói thay phong cách của bạn"
    private fun node(label: String, left: Float, top: Float, right: Float, bottom: Float, button: Boolean = false) =
        FacebookScreenNode(listOf(label), left, top, right, bottom, button)
    private fun screen() = listOf(
        node("1 phút ·", 20f, 180f, 200f, 220f),
        node(caption, 20f, 250f, 780f, 450f),
        node("More options", 890f, 170f, 970f, 230f, true),
    )
    private fun menu(nodes: List<FacebookScreenNode>) =
        FacebookScreenPolicy.directPostMenuIndex(caption, nodes, 1000f, 1000f)

    @Test fun correctDetailCardHasOneVerifiedMenu() {
        assertEquals(2, menu(screen()))
    }
    @Test fun wrongCaptionCannotOpenMenu() {
        assertNull(menu(screen().toMutableList().apply {
            this[1] = node("Nội dung một bài khác", 20f, 250f, 780f, 450f)
        }))
    }
    @Test fun unlabeledGlobalMenuAndCaptionExpansionAreRejected() {
        for (label in listOf("", "Menu", "Xem thêm", "Share", "Boost post")) {
            assertNull(menu(screen().toMutableList().apply {
                this[2] = node(label, 890f, 170f, 970f, 230f, true)
            }))
        }
    }
    @Test fun menuFromAnotherHeaderPositionCannotBeUsed() {
        assertNull(menu(screen().toMutableList().apply {
            this[2] = node("More options", 890f, 600f, 970f, 660f, true)
        }))
    }
    @Test fun profileOrSecondCardRejectsDetailDestination() {
        assertNull(menu(screen() + listOf(
            node("All", 20f, 60f, 200f, 110f, true),
            node("Photos", 230f, 60f, 450f, 110f, true),
        )))
        assertNull(menu(screen() + node("2 phút ·", 20f, 600f, 200f, 640f)))
    }
    @Test fun duplicateNestedOptionsAreOneButton() {
        assertEquals(2, menu(screen() + node("More options", 900f, 180f, 960f, 220f, true)))
    }
    @Test fun twoSeparateOptionsNearHeaderFailClosed() {
        assertNull(menu(screen() + node("More options", 770f, 170f, 840f, 230f, true)))
    }
}
