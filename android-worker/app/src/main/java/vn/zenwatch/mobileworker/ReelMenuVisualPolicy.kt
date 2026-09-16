package vn.zenwatch.mobileworker

/** Search below the live action rail, never in the player toolbar or caption. */
internal object ReelMenuVisualPolicy {
    fun region(nodes: List<FacebookScreenNode>, width: Int, height: Int): MenuImageRegion? {
        val w = width.toFloat()
        val h = height.toFloat()
        if (width < 240 || height <= width ||
            FacebookScreenPolicy.profileTabIndices(nodes, w, h).isNotEmpty() ||
            FacebookScreenPolicy.headerCenters(nodes, w, h).size > 1 ||
            FacebookScreenPolicy.hasReelOptionsSheet(nodes, w, h)) return null
        val anchor = FacebookScreenPolicy.videoActionRailAnchor(nodes, w, h) ?: return null
        val composerTop = nodes.filter { node ->
            node.left < w * 0.5f && node.width > w * 0.35f && node.top > h * 0.6f &&
                node.labels.any { label -> listOf("Bình luận", "Viết bình luận", "Comment", "Write a comment")
                    .any { label.startsWith(it, true) } }
        }.minOfOrNull(FacebookScreenNode::top) ?: h * 0.93f
        val top = (anchor.bottom + h * 0.002f).toInt()
        val bottom = minOf(anchor.bottom + h * 0.12f, composerTop - h * 0.005f, h * 0.93f).toInt()
        if (bottom - top < h * 0.018f) return null
        return MenuImageRegion(maxOf(w * 0.84f, anchor.centerX - w * 0.075f).toInt(), top,
            minOf(w * 0.995f, anchor.centerX + w * 0.075f).toInt(), bottom)
    }

    fun detect(pixels: IntArray, region: MenuImageRegion, screenWidth: Int): FacebookMenuTarget? =
        PostMenuVisualPolicy.detect(pixels, region, screenWidth, brightDots = true)
}
