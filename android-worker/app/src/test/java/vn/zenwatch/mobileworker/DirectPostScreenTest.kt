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

    @Test fun mergedParentAndChildTimeAreOneHeaderAtTheChildRow() {
        val nodes = suppliedPhotoDetail() +
            node("Vua Đồng Hồ 1 phút ·", 137f, 215f, 465f, 309f, true)
        assertEquals(listOf(287.5f), FacebookScreenPolicy.headerCenters(nodes, 869f, 1884f))
        val target = FacebookScreenPolicy.directPostMenuTarget(nodes, 869f, 1884f)
        assertEquals("header_row", target?.evidence)
        assertEquals(236.5f, target!!.y, 1f)
    }

    @Test fun mergedContainerDoesNotCollapseTwoSeparatePostHeaders() {
        val nodes = suppliedPhotoDetail() + listOf(
            node("Vua Đồng Hồ 1 phút · 2 phút ·", 100f, 180f, 500f, 900f),
            node("2 phút ·", 137f, 620f, 300f, 660f),
            node("More options", 790f, 213f, 853f, 261f, true),
        )
        assertEquals(2, FacebookScreenPolicy.headerCenters(nodes, 869f, 1884f).size)
        assertNull(FacebookScreenPolicy.directPostMenuTarget(nodes, 869f, 1884f))
    }

    @Test fun recognisedPostMenuDoesNotRequireAParseableTimestampWithDetailChrome() {
        for (time in listOf("", "Hôm qua lúc 15:27", "12/09/2026")) {
            val nodes = suppliedPhotoDetail().toMutableList().apply {
                this[3] = node(time, 137f, 268f, 400f, 307f)
                add(node("More options", 790f, 213f, 853f, 261f, true))
            }
            assertEquals(time, emptyList<Float>(), FacebookScreenPolicy.headerCenters(nodes, 869f, 1884f))
            val target = FacebookScreenPolicy.directPostMenuTarget(nodes, 869f, 1884f)
            assertEquals(time, "semantic_node", target?.evidence)
            assertEquals(time, 5, target?.nodeIndex)
        }
    }

    @Test fun semanticNonClickableViewOrResourceIdUsesItsOwnNode() {
        for (control in listOf(
            node("More options", 790f, 213f, 853f, 261f),
            node("", 790f, 213f, 853f, 261f, resource = "com.facebook.katana:id/story_header_more"),
        )) {
            val target = FacebookScreenPolicy.directPostMenuTarget(
                suppliedPhotoDetail() + control, 869f, 1884f)
            assertEquals("semantic_node", target?.evidence)
            assertEquals(5, target?.nodeIndex)
            assertEquals(237f, target!!.y, 1f)
        }
    }

    @Test fun timestampFreeSemanticMenuStillRequiresTheWholeDetailChrome() {
        val withoutTime = suppliedPhotoDetail().filterIndexed { index, _ -> index != 3 } +
            node("More options", 790f, 213f, 853f, 261f, true)
        for (missing in listOf(0, 1, 3)) {
            assertNull(FacebookScreenPolicy.directPostMenuTarget(
                withoutTime.filterIndexed { index, _ -> index != missing }, 869f, 1884f))
        }
        assertNull(FacebookScreenPolicy.directPostMenuTarget(
            suppliedPhotoDetail().filterIndexed { index, _ -> index != 3 } +
                node("", 790f, 213f, 853f, 261f, icon = true), 869f, 1884f))
    }

    @Test fun toolbarOptionsCannotBecomeThePostMenuEvenWithDetailChrome() {
        val toolbarOptions = node("More options", 790f, 95f, 853f, 155f, true)
        val withoutTime = suppliedPhotoDetail().filterIndexed { index, _ -> index != 3 }
        assertNull(FacebookScreenPolicy.directPostMenuTarget(
            withoutTime + toolbarOptions, 869f, 1884f))
        val withPostMenu = withoutTime + listOf(
            toolbarOptions, node("More options", 790f, 213f, 853f, 261f, true))
        assertEquals(5, FacebookScreenPolicy.directPostMenuTarget(withPostMenu, 869f, 1884f)?.nodeIndex)
    }

    @Test fun timestampFreeDetailRejectsTwoDistinctMenusAndProfileTabs() {
        val detail = suppliedPhotoDetail().filterIndexed { index, _ -> index != 3 } +
            node("More options", 790f, 213f, 853f, 261f, true)
        assertNull(FacebookScreenPolicy.directPostMenuTarget(
            detail + node("More options", 720f, 213f, 780f, 261f, true), 869f, 1884f))
        assertNull(FacebookScreenPolicy.directPostMenuTarget(detail + listOf(
            node("All", 20f, 400f, 180f, 450f, true),
            node("Photos", 230f, 400f, 400f, 450f, true),
        ), 869f, 1884f))
    }

    @Test fun commaSeparatedTimeStillSupportsTheHeaderFallback() {
        val nodes = suppliedPhotoDetail().toMutableList().apply {
            this[3] = node("1 phút, Công khai", 137f, 268f, 400f, 307f)
        }
        assertEquals(listOf(287.5f), FacebookScreenPolicy.headerCenters(nodes, 869f, 1884f))
        assertEquals("header_row", FacebookScreenPolicy.directPostMenuTarget(nodes, 869f, 1884f)?.evidence)
    }

    @Test fun timestampFreeDetailCannotUseAnOptionsButtonDownInTheComments() {
        val nodes = suppliedPhotoDetail().filterIndexed { index, _ -> index != 3 } +
            node("More options", 790f, 1420f, 853f, 1470f, true)
        assertNull(FacebookScreenPolicy.directPostMenuTarget(nodes, 869f, 1884f))
    }

    @Test fun unimportantBlankChildOfShareDoesNotBecomeTheMenu() {
        val nodes = suppliedPhotoDetail() + listOf(
            node("Share", 790f, 213f, 853f, 261f, true),
            node("", 805f, 221f, 841f, 251f, icon = true),
        )
        assertNull(FacebookScreenPolicy.directPostMenuTarget(nodes, 869f, 1884f))
    }
}
