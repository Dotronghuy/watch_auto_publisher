package vn.zenwatch.mobileworker

/** Snapshot values only: no Android dependency, so real screen layouts can be replayed in tests. */
internal data class FacebookScreenNode(
    val labels: List<String>,
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
    val interactive: Boolean = false,
    val iconLike: Boolean = false,
    val resourceId: String = "",
) {
    val centerX get() = (left + right) / 2
    val centerY get() = (top + bottom) / 2
    val width get() = right - left
    val height get() = bottom - top
}

/** A detected node, or the verified detail header's options position. */
internal data class FacebookMenuTarget(
    val nodeIndex: Int?,
    val x: Float,
    val y: Float,
    val evidence: String,
)

internal object FacebookMenuTapPolicy {
    fun attemptLimit(evidence: String): Int = if (evidence in setOf("header_row", "visual_dots", "visual_reel_dots")) 1 else 3

    fun preferNodeClick(evidence: String, attempt: Int): Boolean =
        evidence in setOf("semantic_node", "video_options") && attempt % 2 == 0
}

internal object FacebookScreenPolicy {
    val postsTabLabels = listOf("Tất cả", "All", "Bài viết", "Posts")
    private val tabLabels = postsTabLabels + listOf(
        "Ảnh", "Photos", "Reels", "Video", "Videos", "Giới thiệu", "About",
    )
    private val agePattern = Regex(
        """(?i)(^|[\s,·•])(vừa xong|\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm|sec|secs|min|mins|hr|hrs|day|days|week|weeks|month|months|year|years|s|m|h|d|w|y))(\s|[,·•]|$)""",
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

    fun headerCenters(nodes: List<FacebookScreenNode>, width: Float, height: Float): List<Float> {
        if (width <= 0 || height <= 0) return emptyList()
        val candidates = nodes.filter { node ->
            node.width > 0 && node.height > 0 && node.centerX <= width * 0.78f &&
                node.centerY in height * 0.08f..height * 0.96f &&
                node.labels.any { it.length <= 140 && agePattern.containsMatchIn(it.trim()) }
        }
        // Accessibility can repeat the time in a merged author/header parent.
        // Keep the compact contained time node; a parent containing two separate
        // cards must not collapse their two real timestamps into one header.
        return candidates.filter { parent ->
            candidates.none { child ->
                child.width * child.height < parent.width * parent.height &&
                    child.left >= parent.left && child.right <= parent.right &&
                    child.top >= parent.top && child.bottom <= parent.bottom
            }
        }.map(FacebookScreenNode::centerY)
            .distinctBy { (it / height * 100).toInt() }.sorted().toList()
    }

    /** No post text is accepted here: the job's validated direct URL selects the content. */
    fun directPostMenuTarget(
        nodes: List<FacebookScreenNode>, width: Float, height: Float,
    ): FacebookMenuTarget? {
        if (width <= 0 || height <= 0 || profileTabIndices(nodes, width, height).isNotEmpty()) return null
        val headers = headerCenters(nodes, width, height)
        if (headers.size > 1) return null
        val headerY = headers.singleOrNull()
        val toolbarBottom = postDetailToolbarBottom(nodes, height)
        val options = nodes.indices.filter { index ->
            val node = nodes[index]
            // Recognised menu labels/IDs also work on non-clickable View nodes:
            // the service can gesture on that node, without clicking its ancestor.
            optionsSemantic(node, POST_OPTIONS_LABELS) &&
                node.width in 1f..width * 0.24f && node.height in 1f..height * 0.12f &&
                node.centerX >= width * 0.75f &&
                node.left >= 0f && node.right <= width && node.top >= 0f && node.bottom <= height &&
                (toolbarBottom == null || node.top >= toolbarBottom) &&
                (if (headerY != null) {
                    kotlin.math.abs(node.centerY - headerY) <= maxOf(48f, height * 0.075f)
                } else toolbarBottom != null && node.centerY <= toolbarBottom + height * 0.15f)
        }
        if (options.isNotEmpty()) {
            return uniqueOptionsIndex(options, nodes, width, height)?.let {
                nodeTarget(it, nodes, "semantic_node")
            }
        }
        // A missing/absolute timestamp may authorize a recognised menu node via
        // detail chrome, never an unlabelled icon or a guessed coordinate.
        if (headerY == null) return null
        val authorY = headerAuthorY(nodes, width, height, headerY)
        // Facebook can expose the three dots as an unlabelled ImageView/View.
        // Limit those nodes to the right edge of this one post header, never the toolbar.
        val icons = nodes.indices.filter { index ->
            val node = nodes[index]
            val inRow = if (authorY != null) {
                kotlin.math.abs(node.centerY - authorY) <= maxOf(16f, height * 0.018f)
            } else node.centerY in (headerY - height * 0.055f)..(headerY + height * 0.018f)
            node.labels.all(String::isBlank) && (node.interactive || node.iconLike) &&
                node.width in width * 0.015f..width * 0.16f &&
                node.height in height * 0.008f..height * 0.065f &&
                node.centerX in width * 0.88f..width * 0.985f && inRow &&
                !coveredByNonMenuControl(nodes, node.centerX, node.centerY, width, height)
        }
        if (icons.isNotEmpty()) {
            return uniqueOptionsIndex(icons, nodes, width, height)?.let {
                nodeTarget(it, nodes, "header_icon")
            }
        }
        // Layout observed in the user's 869x1884 screenshot: close/search toolbar,
        // a single author/time header, and comment composer. Some versions omit the
        // dots from the accessibility tree entirely. Use the author's actual row Y,
        // not a fixed screen Y; OPEN_MENU permits only one such attempt and requires
        // the product menu to appear before any link input.
        if (authorY != null && toolbarBottom != null) {
            val x = width * 0.947f
            // Missing dots are different from a known non-menu control at that point.
            // Ignore large containers, but never tap through a labelled Share/Boost/etc.
            if (coveredByNonMenuControl(nodes, x, authorY, width, height)) return null
            return FacebookMenuTarget(null, x, authorY, "header_row")
        }
        return null
    }

    /** Fullscreen video options do not depend on a caption or an age header. */
    fun directReelMenuTarget(
        nodes: List<FacebookScreenNode>, width: Float, height: Float,
    ): FacebookMenuTarget? {
        if (width <= 0 || height <= 0 || profileTabIndices(nodes, width, height).isNotEmpty()) return null
        if (headerCenters(nodes, width, height).size > 1) return null
        val rail = videoActionRailAnchor(nodes, width, height)
        if (hasReelOptionsSheet(nodes, width, height) || (!hasVideoSurface(nodes, height) && rail == null)) return null
        val railRegion = ReelMenuVisualPolicy.region(nodes, width.toInt(), height.toInt())
        val options = nodes.indices.filter { index ->
            val node = nodes[index]
            node.width in 1f..width * 0.27f &&
                node.height in 1f..height * 0.15f &&
                node.left >= 0 && node.right <= width && node.top >= 0 && node.bottom <= height &&
                node.centerX >= width * 0.65f && node.centerY in height * 0.30f..height * 0.96f &&
                // The top-right player menu is not the Reel's product menu. When the
                // action rail is exposed, require the options below its last action.
                (rail == null || (railRegion != null && node.centerX in railRegion.left.toFloat()..railRegion.right.toFloat() &&
                    node.centerY in railRegion.top.toFloat()..railRegion.bottom.toFloat())) &&
                optionsSemantic(node, REEL_OPTIONS_LABELS)
        }
        // An unlabelled Reel action rail also contains reactions/share/audio:
        // unlike a post header, its unknown icons have no unique menu location.
        return uniqueOptionsIndex(options, nodes, width, height)?.let {
            nodeTarget(it, nodes, "video_options")
        }
    }

    /** Ordered, aligned actions identify fullscreen video even without a Reels title. */
    fun videoActionRailAnchor(nodes: List<FacebookScreenNode>, width: Float, height: Float): FacebookScreenNode? {
        if (width <= 0 || height <= 0) return null
        val actions = nodes.mapNotNull { node ->
            val kind = RAIL_ACTIONS.indexOfFirst { labels -> node.labels.any { actionLabel(it, labels) } }
            if (kind >= 0 && isRailIcon(node, width, height)) node to kind else null
        }
        val rails = actions.map { (anchor, _) ->
            actions.filter { (node, _) -> kotlin.math.abs(node.centerX - anchor.centerX) < width * 0.055f }
        }.filter { group ->
            group.map { it.second }.toSet().size >= 2 && group.any { it.second >= 2 } &&
                group.maxOf { it.first.centerY } - group.minOf { it.first.centerY } >= height * 0.045f &&
                group.all { (a, ak) -> group.all { (b, bk) -> ak == bk ||
                    (if (ak < bk) a.centerY < b.centerY else a.centerY > b.centerY) } }
        }
        return rails.maxByOrNull { it.map { entry -> entry.second }.toSet().size }
            ?.maxByOrNull { it.first.centerY }?.first
    }

    fun hasReelOptionsSheet(nodes: List<FacebookScreenNode>, width: Float, height: Float): Boolean =
        nodes.any { node ->
            node.labels.any { label -> REEL_SHEET_LABELS.any { label.contains(it, true) } } &&
                // The bookmark in the right rail can itself be labelled "Save reel".
                !(isRailIcon(node, width, height) && node.labels.any { actionLabel(it, RAIL_ACTIONS[3]) })
        }

    private fun isRailIcon(node: FacebookScreenNode, width: Float, height: Float): Boolean =
        node.width in 1f..width * 0.22f && node.height in 1f..height * 0.12f &&
            node.centerX in width * 0.82f..width && node.centerY in height * 0.35f..height * 0.93f &&
            node.left >= 0 && node.right <= width && node.top >= 0 && node.bottom <= height

    private fun actionLabel(value: String, labels: List<String>): Boolean = labels.any { label ->
        val text = value.trim()
        text.equals(label, true) || text.startsWith("$label,", true) ||
            text.startsWith("$label ", true) || text.startsWith("$label…", true) || text.startsWith("$label...", true)
    }

    private val RAIL_ACTIONS = listOf(
        listOf("Thích", "Bỏ thích", "Like", "Unlike"),
        listOf("Bình luận", "Comment", "Comments"),
        listOf("Chia sẻ", "Share"),
        listOf("Lưu", "Đã lưu", "Bỏ lưu", "Save", "Saved", "Unsave"),
    )
    private val REEL_SHEET_LABELS = listOf(
        "Lưu thước phim", "Save reel", "Remix thước phim này", "Remix this reel",
        "Tại sao tôi nhìn thấy video này?", "Why am I seeing this video?",
        "Xếp hạng trải nghiệm phát lại video", "Rate video playback experience",
    )

    fun isMenuPointUnobstructed(nodes: List<FacebookScreenNode>, target: FacebookMenuTarget,
                               width: Float, height: Float): Boolean = nodes.none { node ->
        // The pixel shape identifies the icon even when Facebook gives it an unknown label.
        // Still refuse an explicitly identified different action at the same position.
        node.width in 1f..width * 0.24f && node.height in 1f..height * 0.12f &&
            target.x in node.left..node.right && target.y in node.top..node.bottom &&
            node.labels.any { label -> listOf("Chia sẻ", "Share", "Quảng bá", "Boost", "Đóng", "Close",
                "Tìm kiếm", "Search", "Thích", "Like", "Bình luận", "Comment").any {
                label.equals(it, true) || label.startsWith("$it ", true) || label.startsWith("$it,", true)
            } }
    }

    private fun coveredByNonMenuControl(
        nodes: List<FacebookScreenNode>, x: Float, y: Float, width: Float, height: Float,
    ): Boolean = nodes.any { node ->
        node.width in 1f..width * 0.24f && node.height in 1f..height * 0.12f &&
            x in node.left..node.right && y in node.top..node.bottom &&
            node.labels.any(String::isNotBlank) && !optionsSemantic(node, POST_OPTIONS_LABELS)
    }

    private fun nodeTarget(index: Int, nodes: List<FacebookScreenNode>, evidence: String) =
        FacebookMenuTarget(index, nodes[index].centerX, nodes[index].centerY, evidence)

    private fun optionsSemantic(node: FacebookScreenNode, labels: List<String>): Boolean =
        ProductLinkUiPolicy.hasExactLabel(node.labels, labels + listOf("…", "...", "⋯", "⋮")) ||
            POST_OPTIONS_IDS.any { node.resourceId.endsWith("/$it") || node.resourceId == it }

    private fun headerAuthorY(
        nodes: List<FacebookScreenNode>, width: Float, height: Float, headerY: Float,
    ): Float? {
        val candidates = nodes.filter { node ->
            node.left >= width * 0.1f && node.centerX <= width * 0.78f &&
                node.width in width * 0.1f..width * 0.8f && node.height in 1f..height * 0.055f &&
                node.centerY in (headerY - height * 0.06f)..(headerY - height * 0.008f) &&
                node.labels.any { label ->
                    label.isNotBlank() && label.length <= 100 && !agePattern.containsMatchIn(label) &&
                        !ProductLinkUiPolicy.hasExactLabel(listOf(label),
                            listOf("Đóng", "Close", "Tìm kiếm", "Search", "Facebook", "Reels", "Thước phim"))
                }
        }
        // The closest text row immediately above the post time is the author line.
        return candidates.maxOfOrNull(FacebookScreenNode::centerY)
    }

    private fun postDetailToolbarBottom(nodes: List<FacebookScreenNode>, height: Float): Float? {
        val close = nodes.filter { it.width > 0 && it.height > 0 &&
            it.centerY < height * 0.14f &&
            ProductLinkUiPolicy.hasExactLabel(it.labels, listOf("Đóng", "Close", "Dismiss")) }
        val search = nodes.filter { it.width > 0 && it.height > 0 &&
            it.centerY < height * 0.14f &&
            ProductLinkUiPolicy.hasExactLabel(it.labels, listOf("Tìm kiếm", "Search")) }
        val composer = nodes.any { node ->
            node.centerY > height * 0.6f && node.labels.any { label ->
                listOf("Bình luận dưới tên", "Viết bình luận", "Comment as", "Write a comment")
                    .any { label.startsWith(it, true) }
            }
        }
        return if (close.isNotEmpty() && search.isNotEmpty() && composer) {
            (close + search).maxOf(FacebookScreenNode::bottom)
        } else null
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
