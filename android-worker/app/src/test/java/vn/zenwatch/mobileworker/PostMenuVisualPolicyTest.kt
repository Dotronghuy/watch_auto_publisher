package vn.zenwatch.mobileworker

import java.io.File
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

class PostMenuVisualPolicyTest {
    private val width = 869
    private val height = 1884
    private val nodes = listOf(FacebookScreenNode(listOf("Vừa xong"), 135f, 266f, 315f, 308f))
    private val region = PostMenuVisualPolicy.region(nodes, width, height)!!

    private fun fixture(xs: List<Int> = listOf(808, 824, 840), y: Int = 236,
                        background: Int = -1, color: Int = 0xff686868.toInt()): IntArray =
        IntArray(region.width * region.height) { i ->
            val x = i % region.width + region.left
            val py = i / region.width + region.top
            if (xs.any { (x - it) * (x - it) + (py - y) * (py - y) <= 16 }) color else background
        }

    @Test fun detectsThreeDotsWithoutAccessibleAuthorToolbarOrMenuAndWithoutCaption() {
        assertNull(FacebookScreenPolicy.directPostMenuTarget(nodes, width.toFloat(), height.toFloat()))
        val target = PostMenuVisualPolicy.detect(fixture(), region, width)!!
        assertEquals(824f, target.x, 0.1f)
        assertEquals(236f, target.y, 0.1f)
        assertEquals("visual_dots", target.evidence)
        assertEquals(1, FacebookMenuTapPolicy.attemptLimit(target.evidence))
        assertFalse(FacebookMenuTapPolicy.preferNodeClick(target.evidence, 0))
    }

    @Test fun rejectsBlankAndOneTwoOrFourDots() {
        for (xs in listOf(emptyList(), listOf(824), listOf(808, 824), listOf(792, 808, 824, 840))) {
            assertNull(PostMenuVisualPolicy.detect(fixture(xs), region, width))
        }
    }

    @Test fun rejectsUnequalSpacingAndColoredDots() {
        assertNull(PostMenuVisualPolicy.detect(fixture(listOf(785, 824, 840)), region, width))
        assertNull(PostMenuVisualPolicy.detect(fixture(color = 0xff2040a0.toInt()), region, width))
    }

    @Test fun rejectsTwoOptionsGroups() {
        val a = fixture()
        val b = fixture(y = 284)
        assertNull(PostMenuVisualPolicy.detect(IntArray(a.size) { if (a[it] != -1) a[it] else b[it] }, region, width))
    }

    @Test fun rejectsDimOverlayDarkThemeAndPhotoBackground() {
        for (background in listOf(0xffdddddd.toInt(), 0xff222222.toInt(), 0xff104088.toInt())) {
            assertNull(PostMenuVisualPolicy.detect(fixture(background = background), region, width))
        }
    }

    @Test fun doesNotSearchToolbarCaptionOrLandscape() {
        assertNull(PostMenuVisualPolicy.detect(fixture(y = 126), region, width))
        assertNull(PostMenuVisualPolicy.detect(fixture(y = 1460), region, width))
        assertNull(PostMenuVisualPolicy.region(nodes, height, width))
        assertNull(PostMenuVisualPolicy.region(listOf(nodes[0].copy(top = 1300f, bottom = 1350f)), width, height))
    }

    @Test fun rejectsNoHeaderTwoHeadersAndProfile() {
        assertNull(PostMenuVisualPolicy.region(emptyList(), width, height))
        assertNull(PostMenuVisualPolicy.region(nodes + nodes[0].copy(top = 800f, bottom = 830f), width, height))
        val tabs = listOf(FacebookScreenNode(listOf("Tất cả"), 10f, 300f, 150f, 340f, true),
            FacebookScreenNode(listOf("Ảnh"), 170f, 300f, 300f, 340f, true))
        assertNull(PostMenuVisualPolicy.region(nodes + tabs, width, height))
    }

    @Test fun rejectsLabelledShareButAllowsUnknownLabelOnVisuallyIdentifiedDots() {
        val target = FacebookMenuTarget(null, 824f, 236f, "visual_dots")
        val node = FacebookScreenNode(listOf("Chia sẻ bài viết"), 792f, 210f, 852f, 270f)
        assertFalse(FacebookScreenPolicy.isMenuPointUnobstructed(listOf(node), target, 869f, 1884f))
        assertTrue(FacebookScreenPolicy.isMenuPointUnobstructed(listOf(node.copy(labels = listOf("Menu bài viết"))),
            target, 869f, 1884f))
    }

    @Test fun malformedPixelInputReturnsNoTarget() {
        assertNull(PostMenuVisualPolicy.detect(IntArray(0), region, width))
        assertNull(PostMenuVisualPolicy.detect(IntArray(0), MenuImageRegion(1, 1, 0, 0), width))
    }

    /** Opt-in local private fixtures: never commit or upload the user's screenshots. */
    @Test fun suppliedScreenshotsAtMultipleScales() {
        val paths = System.getenv("ZENWATCH_MENU_REFERENCE_IMAGES").orEmpty().split(';').filter(String::isNotBlank)
        assumeTrue("Set ZENWATCH_MENU_REFERENCE_IMAGES to local reference PNG paths", paths.isNotEmpty())
        for (path in paths) {
            // Android's compile bootclasspath excludes java.desktop. Reflection keeps this
            // optional host-JVM fixture loader out of Android APIs and the shipped APK.
            val original = Class.forName("javax.imageio.ImageIO").getMethod("read", File::class.java).invoke(null, File(path))
            val imageClass = original.javaClass
            val originalWidth = imageClass.getMethod("getWidth").invoke(original) as Int
            val originalHeight = imageClass.getMethod("getHeight").invoke(original) as Int
            val intType = Int::class.javaPrimitiveType!!
            val source = imageClass.getMethod("getRGB", intType, intType, intType, intType,
                IntArray::class.java, intType, intType).invoke(original, 0, 0, originalWidth, originalHeight, null, 0, originalWidth) as IntArray
            for (scale in listOf(0.5, 0.75, 1.0, 1.25, 1.5)) {
                val scaledWidth = (originalWidth * scale).toInt()
                val scaledHeight = (originalHeight * scale).toInt()
                val scaledNodes = nodes.map { it.copy(left = (it.left * scale).toFloat(), top = (it.top * scale).toFloat(),
                    right = (it.right * scale).toFloat(), bottom = (it.bottom * scale).toFloat()) }
                val crop = PostMenuVisualPolicy.region(scaledNodes, scaledWidth, scaledHeight)!!
                val pixels = IntArray(crop.width * crop.height) { i ->
                    sampleBilinear(source, originalWidth, originalHeight,
                        (crop.left + i % crop.width + 0.5) / scale - 0.5,
                        (crop.top + i / crop.width + 0.5) / scale - 0.5)
                }
                val target = PostMenuVisualPolicy.detect(pixels, crop, scaledWidth)
                assertNotNull("No dots: ${File(path).name}, scale=$scale", target)
                assertEquals("Wrong X at scale=$scale", (824 * scale).toFloat(), target!!.x, (3 * scale).toFloat())
                assertEquals("Wrong Y at scale=$scale", (236 * scale).toFloat(), target.y, (3 * scale).toFloat())
            }
            imageClass.getMethod("flush").invoke(original)
        }
    }

    private fun sampleBilinear(pixels: IntArray, width: Int, height: Int, x: Double, y: Double): Int {
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
