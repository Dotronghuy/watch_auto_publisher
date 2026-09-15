package vn.zenwatch.mobileworker

import kotlin.math.abs
import kotlin.math.ceil

internal data class MenuImageRegion(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val width get() = right - left
    val height get() = bottom - top
}

/** Only the upper header of one ordinary post. No caption or fixed tap coordinate. */
internal object PostMenuVisualPolicy {
    fun region(nodes: List<FacebookScreenNode>, width: Int, height: Int): MenuImageRegion? {
        if (width < 240 || height <= width ||
            FacebookScreenPolicy.profileTabIndices(nodes, width.toFloat(), height.toFloat()).isNotEmpty()) return null
        val header = FacebookScreenPolicy.headerCenters(nodes, width.toFloat(), height.toFloat()).singleOrNull()
            ?: return null
        if (header !in height * 0.11f..height * 0.30f) return null
        return MenuImageRegion((width * 0.86f).toInt(), maxOf(height * 0.09f, header - height * 0.065f).toInt(),
            (width * 0.99f).toInt(), minOf(height * 0.30f, header + height * 0.018f).toInt())
    }

    /** Pixels are ONLY this small crop, never retained or uploaded. White-theme horizontal dots only. */
    fun detect(pixels: IntArray, region: MenuImageRegion, screenWidth: Int): FacebookMenuTarget? {
        val w = region.width
        val h = region.height
        if (w <= 0 || h <= 0 || screenWidth < 240 || pixels.size != w * h) return null
        fun dark(pixel: Int): Boolean {
            val r = pixel ushr 16 and 255
            val g = pixel ushr 8 and 255
            val b = pixel and 255
            return maxOf(r, g, b) <= 185 && maxOf(r, g, b) - minOf(r, g, b) <= 32
        }
        fun white(pixel: Int): Boolean = (pixel ushr 16 and 255) >= 235 &&
            (pixel ushr 8 and 255) >= 235 && (pixel and 255) >= 235
        val visited = BooleanArray(pixels.size)
        val queue = IntArray(pixels.size)
        val dots = mutableListOf<Dot>()
        val minSize = maxOf(3, (screenWidth * 0.005f).toInt())
        val maxSize = ceil(screenWidth * 0.017f).toInt()
        for (start in pixels.indices) {
            if (visited[start] || !dark(pixels[start])) continue
            var tail = 1
            var head = 0
            queue[0] = start
            visited[start] = true
            var left = w
            var right = 0
            var top = h
            var bottom = 0
            while (head < tail) {
                val p = queue[head++]
                val x = p % w
                val y = p / w
                left = minOf(left, x); right = maxOf(right, x)
                top = minOf(top, y); bottom = maxOf(bottom, y)
                for (dy in -1..1) for (dx in -1..1) {
                    val nx = x + dx
                    val ny = y + dy
                    if (nx !in 0 until w || ny !in 0 until h) continue
                    val next = ny * w + nx
                    if (!visited[next] && dark(pixels[next])) {
                        visited[next] = true
                        queue[tail++] = next
                    }
                }
            }
            val dw = right - left + 1
            val dh = bottom - top + 1
            if (dw !in minSize..maxSize || dh !in minSize..maxSize ||
                dw.toFloat() / dh !in 0.7f..1.4f || tail.toFloat() / (dw * dh) !in 0.52f..0.94f) continue
            // Isolated round components, not text strokes or components inside a photo.
            val padding = maxOf(2, (screenWidth * 0.003f).toInt())
            if (left < padding || top < padding || right + padding >= w || bottom + padding >= h) continue
            var whiteCount = 0
            var ringCount = 0
            for (y in top - padding..bottom + padding) for (x in left - padding..right + padding) {
                // Ignore the one-pixel antialias fringe; require white beyond it.
                if (x in (left - 1)..(right + 1) && y in (top - 1)..(bottom + 1)) continue
                ringCount++
                if (white(pixels[y * w + x])) whiteCount++
            }
            if (whiteCount.toFloat() / ringCount < 0.9f) continue
            dots += Dot((left + right) / 2f, (top + bottom) / 2f, (dw + dh) / 2f)
            if (dots.size > 24) return null // Busy/textured crop, also bounds combination work.
        }
        val groups = mutableListOf<List<Dot>>()
        for (a in dots) for (b in dots) for (c in dots) {
            if (a.x >= b.x || b.x >= c.x) continue
            val size = (a.size + b.size + c.size) / 3f
            val gap1 = b.x - a.x
            val gap2 = c.x - b.x
            if (listOf(a, b, c).any { abs(it.size - size) > size * 0.25f || abs(it.y - b.y) > size * 0.3f } ||
                gap1 / size !in 1.35f..2.8f || gap2 / size !in 1.35f..2.8f ||
                abs(gap1 - gap2) > size * 0.3f) continue
            // Four dots / neighbouring text are not a three-dot options icon.
            if (dots.any { it != a && it != b && it != c &&
                    abs(it.y - b.y) <= size && it.x in (a.x - gap1 * 1.3f)..(c.x + gap2 * 1.3f) }) continue
            groups += listOf(a, b, c)
        }
        val only = groups.singleOrNull() ?: return null
        return FacebookMenuTarget(null, region.left + only[1].x, region.top + only[1].y, "visual_dots")
    }

    private data class Dot(val x: Float, val y: Float, val size: Float)
}

/** Bounded asynchronous capture; old callbacks cannot act on a newer navigation. */
internal class MenuScreenshotGate {
    private var navigation: String? = null
    private var attempts = 0
    private var serial = 0L
    private var pending: Long? = null
    private var requestedAt = 0L

    fun waiting(key: String, now: Long): Boolean {
        if (navigation != key) reset(key)
        if (now - requestedAt !in 0..2_000L) pending = null
        return pending != null
    }

    fun begin(key: String, now: Long): Long? {
        if (waiting(key, now) || attempts >= 3 || (attempts > 0 && now - requestedAt < 1_000L)) return null
        attempts++
        requestedAt = now
        return (++serial).also { pending = it }
    }

    fun finish(key: String, token: Long, now: Long): Boolean {
        if (navigation != key || pending != token || now - requestedAt !in 0..2_000L) return false
        pending = null
        return true
    }

    fun reset(key: String? = null) {
        navigation = key
        attempts = 0
        pending = null
    }
}
