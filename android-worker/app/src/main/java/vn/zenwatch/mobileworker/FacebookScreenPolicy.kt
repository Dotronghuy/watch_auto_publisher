package vn.zenwatch.mobileworker

/** Snapshot values only: no Android dependency, so real screen layouts can be replayed in tests. */
internal data class FacebookScreenNode(
    val labels: List<String>,
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
    val interactive: Boolean = false,
) {
    val centerX get() = (left + right) / 2
    val centerY get() = (top + bottom) / 2
    val width get() = right - left
    val height get() = bottom - top
}

internal object FacebookScreenPolicy {
    val postsTabLabels = listOf("Tất cả", "All", "Bài viết", "Posts")
    private val tabLabels = postsTabLabels + listOf(
        "Ảnh", "Photos", "Reels", "Video", "Videos", "Giới thiệu", "About",
    )
    private val agePattern = Regex(
        """(?i)(^|\s)(vừa xong|\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm|sec|secs|min|mins|hr|hrs|day|days|week|weeks|month|months|year|years|s|m|h|d|w|y))(\s|[·•]|$)""",
    )

    fun tabMatches(labels: List<String>, expected: List<String>): Boolean = labels.any { value ->
        expected.any { label ->
            val text = value.trim()
            text.equals(label, true) || text.startsWith("$label,", true)
        }
    }

    /** A horizontal tab row is evidence of a profile surface, NOT proof of post identity. */
    fun profileTabIndices(nodes: List<FacebookScreenNode>, width: Float, height: Float): Set<Int> {
        if (width <= 0 || height <= 0) return emptySet()
        val tabs = nodes.indices.filter { i ->
            val node = nodes[i]
            node.interactive && node.width in 1f..width * 0.55f &&
                node.height in 1f..height * 0.14f &&
                node.bottom > 0 && node.top < height &&
                tabMatches(node.labels, tabLabels)
        }
        return tabs.map { index ->
            tabs.filter { other ->
                kotlin.math.abs(nodes[other].centerY - nodes[index].centerY) <= height * 0.035f
            }.toSet()
        }.filter { row ->
            // Duplicate text/description nodes of one tab must not count as two tabs.
            val names = tabLabels.filter { label ->
                row.any { tabMatches(nodes[it].labels, listOf(label)) }
            }
            names.size >= 2 && row.any { a ->
                row.any { b -> kotlin.math.abs(nodes[a].centerX - nodes[b].centerX) > width * 0.08f }
            }
        }.maxByOrNull(Set<Int>::size).orEmpty()
    }

    fun headerCenters(nodes: List<FacebookScreenNode>, width: Float, height: Float): List<Float> =
        if (width <= 0 || height <= 0) emptyList() else nodes.asSequence().filter { node ->
            node.width > 0 && node.height > 0 && node.centerX <= width * 0.78f &&
                node.centerY in height * 0.08f..height * 0.96f &&
                node.labels.any { it.length <= 140 && agePattern.containsMatchIn(it.trim()) }
        }.map(FacebookScreenNode::centerY)
            .distinctBy { (it / height * 100).toInt() }.sorted().toList()

    /** Bind a caption to its OWN header. Never search the whole screen then use the first header. */
    fun matchingHeaderY(
        postText: String, nodes: List<FacebookScreenNode>, width: Float, height: Float,
    ): Float? {
        val headers = headerCenters(nodes, width, height)
        val cardTexts = headers.mapIndexed { index, y ->
            val top = y - height * 0.015f
            val bottom = headers.getOrNull(index + 1)?.minus(height * 0.02f) ?: height
            nodes.asSequence().filter { node ->
                // A parent spanning multiple cards is not evidence for either one.
                node.width > 0 && node.height > 0 &&
                    node.top >= top && node.bottom <= bottom
            }.flatMap { it.labels.asSequence() }
                .filter { it.isNotBlank() && it.length <= 4_000 }
                .distinct().take(120).joinToString(" ")
        }
        val index = ReelProfilePolicy.strongCaptionMatchIndex(postText, cardTexts) ?: return null
        return headers[index] / height
    }

    /** One detail card, one caption-bound semantic options button, never an unlabelled guess. */
    fun directPostMenuIndex(
        postText: String, nodes: List<FacebookScreenNode>, width: Float, height: Float,
    ): Int? {
        if (width <= 0 || height <= 0 || profileTabIndices(nodes, width, height).isNotEmpty()) return null
        if (headerCenters(nodes, width, height).size != 1) return null
        val headerY = matchingHeaderY(postText, nodes, width, height)?.times(height) ?: return null
        val options = nodes.indices.filter { index ->
            val node = nodes[index]
            val semantic = ProductLinkUiPolicy.hasExactLabel(node.labels, POST_OPTIONS_LABELS) ||
                node.labels.any { label -> POST_OPTIONS_IDS.any { label.endsWith("/$it") || label == it } }
            semantic && node.interactive && node.width in 1f..width * 0.24f &&
                node.height in 1f..height * 0.12f && node.centerX >= width * 0.75f &&
                kotlin.math.abs(node.centerY - headerY) <= maxOf(48f, height * 0.075f)
        }
        return uniqueOptionsIndex(options, nodes, width, height)
    }

    /** Fullscreen Reel: a caption near the bottom does not need a post-age header. */
    fun directReelMenuIndex(
        postText: String, nodes: List<FacebookScreenNode>, width: Float, height: Float,
    ): Int? {
        if (width <= 0 || height <= 0 || profileTabIndices(nodes, width, height).isNotEmpty()) return null
        if (headerCenters(nodes, width, height).size > 1) return null
        val staleSheet = nodes.any { ProductLinkUiPolicy.hasExactLabel(it.labels,
            listOf("Lưu thước phim", "Save reel", "Remix thước phim này", "Remix this reel")) }
        if (staleSheet) return null
        if (!hasVideoSurface(nodes, height)) return null
        val captionNodes = nodes.filter { node ->
            node.width > 0 && node.height in 1f..height * 0.45f &&
                node.top >= 0 && node.bottom <= height &&
                node.labels.any { it.length <= 4_000 && ReelProfilePolicy.hasStrongCaptionMatch(postText, it) }
        }
        // Nested accessibility text/description nodes may describe one caption.
        // Two disjoint caption regions indicate a feed/recommendations, not one Reel.
        val captionRegions = mutableListOf<FacebookScreenNode>()
        captionNodes.sortedBy { it.height }.forEach { node ->
            if (captionRegions.none { other -> overlaps(node, other) }) captionRegions.add(node)
        }
        if (captionRegions.size != 1) return null
        val options = nodes.indices.filter { index ->
            val node = nodes[index]
            node.interactive && node.width in 1f..width * 0.27f &&
                node.height in 1f..height * 0.15f &&
                node.centerX >= width * 0.65f && node.centerY in height * 0.06f..height * 0.96f &&
                ProductLinkUiPolicy.hasExactLabel(node.labels, REEL_OPTIONS_LABELS)
        }
        return uniqueOptionsIndex(options, nodes, width, height)
    }

    private fun uniqueOptionsIndex(
        options: List<Int>, nodes: List<FacebookScreenNode>, width: Float, height: Float,
    ): Int? {
        val distinctOptions = mutableListOf<Int>()
        options.forEach { index ->
            if (distinctOptions.none { previous ->
                    overlaps(nodes[index], nodes[previous]) &&
                        kotlin.math.abs(nodes[index].centerX - nodes[previous].centerX) < width * 0.025f &&
                        kotlin.math.abs(nodes[index].centerY - nodes[previous].centerY) < height * 0.015f
                }) distinctOptions.add(index)
        }
        return distinctOptions.singleOrNull()
    }

    fun hasVideoSurface(nodes: List<FacebookScreenNode>, height: Float): Boolean = nodes.any { node ->
        (node.top < height * 0.35f && ProductLinkUiPolicy.hasExactLabel(node.labels,
            listOf("Reels", "Thước phim"))) ||
            ProductLinkUiPolicy.hasExactLabel(node.labels,
                listOf("Phát video", "Tạm dừng video", "Play video", "Pause video"))
    }

    private fun overlaps(a: FacebookScreenNode, b: FacebookScreenNode): Boolean =
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

    private val REEL_OPTIONS_LABELS = listOf(
        "Lựa chọn khác", "Tùy chọn khác", "Tùy chọn thước phim", "Tùy chọn video",
        "Lựa chọn khác cho thước phim", "Lựa chọn khác cho video",
        "Hành động đối với thước phim", "Hành động đối với video",
        "More options", "Reel options", "Video options",
        "More options for this reel", "More options for this video",
    )
    private val POST_OPTIONS_LABELS = listOf(
        "Lựa chọn khác", "Tùy chọn", "Tùy chọn khác", "Hành động đối với bài viết",
        "More options", "Actions for this post", "Post options",
    )
    private val POST_OPTIONS_IDS = listOf(
        "feed_story_header_more", "story_header_more", "post_header_more", "more_button",
    )
}
