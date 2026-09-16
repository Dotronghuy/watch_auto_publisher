package vn.zenwatch.mobileworker

import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

class ReelActionRailTest {
    private val width = 869
    private val height = 1884
    private fun node(label: String, x: Float, y: Float, w: Float = 60f, h: Float = 60f) =
        FacebookScreenNode(listOf(label), x - w / 2, y - h / 2, x + w / 2, y + h / 2)

    // Geometry from the supplied fullscreen video: no Reels title, two menus.
    private val rail = listOf(
        node("Thích", 814f, 1155f), node("Bình luận", 814f, 1298f),
        node("Chia sẻ", 814f, 1399f), node("Lưu thước phim", 814f, 1500f),
        node("Bình luận...", 434f, 1709f, 810f, 82f),
    )
    private val toolbarMenu = node("More options", 815f, 145f)
    private val videoMenu = node("More options", 814f, 1582f, 60f, 44f)
    private fun target(nodes: List<FacebookScreenNode>) =
        FacebookScreenPolicy.directReelMenuTarget(nodes, width.toFloat(), height.toFloat())

    @Test fun selectsLowerMenuWithoutReelsTitleOrClickableNodes() {
        assertFalse(FacebookScreenPolicy.hasVideoSurface(rail, height.toFloat()))
        val found = target(rail + toolbarMenu + videoMenu)!!
        assertEquals(rail.size + 1, found.nodeIndex)
        assertEquals(1582f, found.y, 0.1f)
    }

    @Test fun saveActionIsNotAnOpenSheetButSaveRowIs() {
        assertFalse(FacebookScreenPolicy.hasReelOptionsSheet(rail, width.toFloat(), height.toFloat()))
        val sheet = rail + node("Lưu thước phim", 320f, 1200f, 600f, 80f)
        assertTrue(FacebookScreenPolicy.hasReelOptionsSheet(sheet, width.toFloat(), height.toFloat()))
        assertNull(target(sheet + videoMenu))
        assertNull(ReelMenuVisualPolicy.region(sheet, width, height))
    }

    @Test fun neverFallsBackToPlayerToolbarWhenLowerMenuIsMissing() {
        assertNull(target(rail + toolbarMenu))
        assertNull(target(listOf(node("Reels", 100f, 80f), toolbarMenu)))
    }

    @Test fun railRequiresDistinctOrderedVerticalActions() {
        for (invalid in listOf(listOf(rail[3]), listOf(rail[3], rail[3]),
            listOf(rail[0], rail[2].copy(top = rail[0].top, bottom = rail[0].bottom)),
            listOf(rail[0].copy(left = 0f, right = 60f), rail[2]),
            listOf(rail[3].copy(top = 1100f, bottom = 1160f), rail[2]))) {
            assertNull(ReelMenuVisualPolicy.region(invalid, width, height))
        }
    }

    @Test fun duplicateNodesAndEnglishLabelsStillIdentifyRail() {
        val english = rail.take(4).mapIndexed { i, n -> n.copy(labels = listOf(
            listOf("Like, button", "Comments", "Share video", "Save reel")[i])) }
        assertNotNull(ReelMenuVisualPolicy.region(english + english, width, height))
        assertNotNull(ReelMenuVisualPolicy.region(english.take(3), width, height))
    }

    @Test fun ambiguousLowerMenusAndProfileOrFeedStayRejected() {
        assertNull(target(rail + videoMenu + videoMenu.copy(top = 1620f, bottom = 1640f)))
        val profile = rail + listOf(node("All", 100f, 400f).copy(interactive = true),
            node("Photos", 260f, 400f).copy(interactive = true))
        val feed = rail + listOf(node("1 phút", 100f, 300f), node("2 phút", 100f, 700f))
        for (nodes in listOf(profile, feed)) {
            assertNull(target(nodes + videoMenu))
            assertNull(ReelMenuVisualPolicy.region(nodes, width, height))
        }
        assertNull(ReelMenuVisualPolicy.region(rail, height, width))
    }

    private val region get() = ReelMenuVisualPolicy.region(rail, width, height)!!
    private fun pixels(xs: List<Int> = listOf(798, 814, 830), y: Int = 1582,
                       background: Int = 0xff422116.toInt(), dot: Int = -1): IntArray =
        IntArray(region.width * region.height) { i ->
            val x = region.left + i % region.width
            val py = region.top + i / region.width
            if (xs.any { (x - it) * (x - it) + (py - y) * (py - y) <= 16 }) dot else background
        }

    @Test fun visualTargetIsBelowSaveAndAboveComposer() {
        assertTrue(region.top > rail[3].bottom)
        assertTrue(region.bottom < rail[4].top)
        val found = ReelMenuVisualPolicy.detect(pixels(), region, width)!!
        assertEquals(814f, found.x, 0.1f)
        assertEquals(1582f, found.y, 0.1f)
        assertEquals("visual_reel_dots", found.evidence)
        assertEquals(1, FacebookMenuTapPolicy.attemptLimit(found.evidence))
        assertFalse(FacebookMenuTapPolicy.preferNodeClick(found.evidence, 0))
    }

    @Test fun rejectsToolbarDotsMissingDotsBrightBackgroundAndColoredShapes() {
        assertNull(ReelMenuVisualPolicy.detect(pixels(y = 145), region, width))
        for (xs in listOf(emptyList(), listOf(814), listOf(798, 814), listOf(782, 798, 814, 830),
            listOf(778, 814, 830))) {
            assertNull(ReelMenuVisualPolicy.detect(pixels(xs), region, width))
        }
        assertNull(ReelMenuVisualPolicy.detect(pixels(background = -1), region, width))
        assertNull(ReelMenuVisualPolicy.detect(pixels(dot = 0xffffff00.toInt()), region, width))
        val a = pixels()
        val b = pixels(y = 1620)
        assertNull(ReelMenuVisualPolicy.detect(IntArray(a.size) { if (a[it] == -1) a[it] else b[it] }, region, width))
    }

    /** Optional private screenshot; kept out of Git and the APK. */
    @Test fun suppliedVideoScreenshotAtMultipleScales() {
        val path = System.getenv("ZENWATCH_REEL_MENU_REFERENCE_IMAGE").orEmpty()
        assumeTrue("Set ZENWATCH_REEL_MENU_REFERENCE_IMAGE to the reference PNG", path.isNotBlank())
        val original = Class.forName("javax.imageio.ImageIO").getMethod("read", File::class.java).invoke(null, File(path))
        val imageClass = original.javaClass
        assertEquals(width, imageClass.getMethod("getWidth").invoke(original))
        assertEquals(height, imageClass.getMethod("getHeight").invoke(original))
        val intType = Int::class.javaPrimitiveType!!
        val source = imageClass.getMethod("getRGB", intType, intType, intType, intType,
            IntArray::class.java, intType, intType).invoke(original, 0, 0, width, height, null, 0, width) as IntArray
        for (scale in listOf(0.5, 0.75, 1.0, 1.25, 1.5)) {
            val scaledWidth = (width * scale).toInt()
            val scaledNodes = rail.map { it.copy(left = (it.left * scale).toFloat(), top = (it.top * scale).toFloat(),
                right = (it.right * scale).toFloat(), bottom = (it.bottom * scale).toFloat()) }
            val crop = ReelMenuVisualPolicy.region(scaledNodes, scaledWidth, (height * scale).toInt())!!
            val pixels = IntArray(crop.width * crop.height) { i ->
                sampleBilinear(source, (crop.left + i % crop.width + 0.5) / scale - 0.5,
                    (crop.top + i / crop.width + 0.5) / scale - 0.5)
            }
            val target = ReelMenuVisualPolicy.detect(pixels, crop, scaledWidth)
            assertNotNull("No video dots at scale=$scale", target)
            assertEquals((814 * scale).toFloat(), target!!.x, (4 * scale).toFloat())
            assertEquals((1582 * scale).toFloat(), target.y, (4 * scale).toFloat())
        }
        imageClass.getMethod("flush").invoke(original)
    }

    private fun sampleBilinear(pixels: IntArray, x: Double, y: Double): Int {
        val x0 = kotlin.math.floor(x).toInt().coerceIn(0, width - 2)
        val y0 = kotlin.math.floor(y).toInt().coerceIn(0, height - 2)
        val dx = x - x0
        val dy = y - y0
        var result = 0xff000000.toInt()
        for (shift in listOf(16, 8, 0)) {
            fun channel(px: Int, py: Int) = (pixels[py * width + px] ushr shift and 255).toDouble()
            val value = (channel(x0, y0) * (1 - dx) + channel(x0 + 1, y0) * dx) * (1 - dy) +
                (channel(x0, y0 + 1) * (1 - dx) + channel(x0 + 1, y0 + 1) * dx) * dy
            result = result or (value.toInt().coerceIn(0, 255) shl shift)
        }
        return result
    }
}
