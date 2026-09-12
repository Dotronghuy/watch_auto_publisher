package vn.zenwatch.mobileworker

import org.junit.Assert.*
import org.junit.Test

class DirectPostScreenTest {
    private fun node(label: String, left: Float, top: Float, right: Float, bottom: Float,
                     button: Boolean = false, icon: Boolean = false, resource: String = "") =
        FacebookScreenNode(listOf(label), left, top, right, bottom, button, icon, resource)
    private fun screen() = listOf(
        node("1 phút ·", 20f, 180f, 200f, 220f),
        node("More options", 890f, 170f, 970f, 230f, true),
    )
    private fun menu(nodes: List<FacebookScreenNode>) =
        FacebookScreenPolicy.directPostMenuTarget(nodes, 1000f, 1000f)

    @Test fun detailMenuWorksWithoutAnyCaption() {
        assertEquals(1, menu(screen())?.nodeIndex)
    }
    @Test fun unrelatedOrHiddenTextDoesNotGateTheMenu() {
        for (text in listOf("", "Nội dung khác", "caption bị cắt...")) {
            assertEquals(1, menu(screen() + node(text, 20f, 850f, 780f, 1000f))?.nodeIndex)
        }
    }
    @Test fun unlabeledHeaderIconIsRecognized() {
        val result = menu(screen().toMutableList().apply {
            this[1] = node("", 910f, 165f, 970f, 205f, icon = true)
        })
        assertEquals(1, result?.nodeIndex)
        assertEquals("header_icon", result?.evidence)
    }
    @Test fun globalMenuCaptionExpansionShareAndBoostAreNotOptions() {
        for (label in listOf("Menu", "Xem thêm", "Share", "Boost post")) {
            assertNull(menu(screen().toMutableList().apply {
                this[1] = node(label, 890f, 170f, 970f, 230f, true)
            }))
        }
    }
    @Test fun anEllipsisOrExactResourceIdIsAnOptionsControl() {
        for (label in listOf("…", "...", "⋯", "⋮")) {
            assertEquals(1, menu(screen().toMutableList().apply {
                this[1] = node(label, 890f, 170f, 970f, 230f, true)
            })?.nodeIndex)
        }
        assertEquals(1, menu(screen().toMutableList().apply {
            this[1] = node("", 890f, 170f, 970f, 230f, true, resource = "com.facebook.katana:id/story_header_more")
        })?.nodeIndex)
    }
    @Test fun wrongRowOrToolbarIconCannotBeUsed() {
        assertNull(menu(listOf(screen()[0], node("", 910f, 40f, 970f, 100f, icon = true))))
        assertNull(menu(listOf(screen()[0], node("More options", 890f, 600f, 970f, 660f, true))))
    }
    @Test fun profileOrSecondCardRejectsDetailDestination() {
        assertNull(menu(screen() + listOf(
            node("All", 20f, 60f, 200f, 110f, true),
            node("Photos", 230f, 60f, 450f, 110f, true),
        )))
        assertNull(menu(screen() + node("2 phút ·", 20f, 600f, 200f, 640f)))
    }
    @Test fun duplicateNestedOptionsAreOneButton() {
        assertEquals(1, menu(screen() + node("More options", 900f, 180f, 960f, 220f, true))?.nodeIndex)
    }
    @Test fun twoSeparateOptionsNearHeaderFailClosed() {
        assertNull(menu(screen() + node("More options", 770f, 170f, 840f, 230f, true)))
        assertNull(menu(listOf(screen()[0],
            node("", 880f, 160f, 920f, 200f, true),
            node("", 940f, 160f, 980f, 200f, true))))
    }

    // Synthetic layout reconstructed from the supplied 869x1884 screenshot,
    // not an accessibility dump: no caption and no exposed three-dot node.
    private fun suppliedPhotoDetail() = listOf(
        node("Đóng", 25f, 95f, 95f, 155f, true),
        node("Tìm kiếm", 690f, 95f, 750f, 155f, true),
        node("Vua Đồng Hồ", 137f, 215f, 465f, 258f),
        node("1 phút ·", 137f, 268f, 300f, 307f),
        node("Bình luận dưới tên Vua Đồng Hồ", 28f, 1675f, 837f, 1760f, true),
    )
    @Test fun suppliedPhotoDetailUsesAuthorRowWhenDotsAreOmittedFromTree() {
        val result = FacebookScreenPolicy.directPostMenuTarget(suppliedPhotoDetail(), 869f, 1884f)
        assertNotNull(result)
        assertNull(result?.nodeIndex)
        assertEquals("header_row", result?.evidence)
        assertEquals(823f, result!!.x, 1f)
        assertEquals(236.5f, result.y, 1f)
    }
    @Test fun noCoordinateFallbackWithoutDetailChromeOrAuthor() {
        for (missing in listOf(0, 1, 2, 4)) {
            assertNull(FacebookScreenPolicy.directPostMenuTarget(
                suppliedPhotoDetail().filterIndexed { index, _ -> index != missing }, 869f, 1884f))
        }
    }
    @Test fun knownNonMenuControlBlocksHeaderCoordinateFallback() {
        for (label in listOf("Share", "Boost post", "Tìm kiếm", "Menu", "Xem thêm")) {
            val nodes = suppliedPhotoDetail() + node(label, 790f, 213f, 853f, 261f, true)
            assertNull(label, FacebookScreenPolicy.directPostMenuTarget(nodes, 869f, 1884f))
        }
    }
    @Test fun unknownReactionsBelowPhotoAreNeverHeaderIcons() {
        assertNull(menu(listOf(screen()[0], node("", 910f, 800f, 970f, 850f, icon = true))))
    }
}
