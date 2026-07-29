package vn.zenwatch.mobileworker

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class ShopeeAccessibilityService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private val processRunnable = Runnable { processCurrentStep() }
    private val menuSemanticTapAttempts = mutableMapOf<String, Int>()
    private val menuFallbackTapAttempts = mutableMapOf<String, Int>()
    private val saveFallbackAttempts = mutableSetOf<String>()

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.packageName?.toString() != FACEBOOK_PACKAGE) return
        if (JobStore.load(this) == null) return
        handler.removeCallbacks(processRunnable)
        handler.postDelayed(processRunnable, EVENT_SETTLE_MS)
    }

    override fun onInterrupt() = Unit

    override fun onServiceConnected() {
        super.onServiceConnected()
        handler.postDelayed(processRunnable, EVENT_SETTLE_MS)
    }

    override fun onDestroy() {
        handler.removeCallbacks(processRunnable)
        super.onDestroy()
    }

    private fun processCurrentStep() {
        val active = JobStore.load(this) ?: return
        if (active.step == AutomationStep.REPORTING) return
        val root = rootInActiveWindow
        if (root == null) {
            // Facebook can open before Android has exposed its accessibility tree.
            // Keep polling so the flow does not depend on receiving another UI event.
            scheduleNext(ROOT_RETRY_MS)
            return
        }

        try {
            when (active.step) {
                AutomationStep.OPEN_MENU -> openPostMenu(root, active)
                AutomationStep.OPEN_LINK_MANAGER -> openLinkManager(root, active)
                AutomationStep.FILL_URL -> fillUrl(root, active)
                AutomationStep.FILL_NAME -> fillName(root, active)
                AutomationStep.SAVE -> saveLink(root, active)
                AutomationStep.VERIFY -> verifySaved(root, active)
                AutomationStep.REPORTING -> Unit
            }
        } catch (error: Exception) {
            JobStore.markForReport(
                this,
                success = false,
                message = "Lỗi Accessibility tại ${active.step.name}: ${error.message}",
            )
        }
    }

    private fun openPostMenu(root: AccessibilityNodeInfo, active: ActiveJob) {
        val linkManagerAlreadyVisible = findBestNode(
            root,
            listOf(
                "Quản lý liên kết đến sản phẩm",
                "Thêm liên kết sản phẩm",
                "Manage product links",
                "Add product link",
            ),
        )
        if (linkManagerAlreadyVisible != null) {
            JobStore.setStep(this, AutomationStep.OPEN_LINK_MANAGER)
            scheduleNext(250)
            return
        }

        val fallbackKey = "${active.job.id}:${active.job.attempt}"
        val semanticTapAttempts = menuSemanticTapAttempts[fallbackKey] ?: 0
        val fallbackTapAttempts = menuFallbackTapAttempts[fallbackKey] ?: 0
        val button = findBestNode(
            root,
            listOf(
                "Lựa chọn khác cho bài viết",
                "Lựa chọn khác",
                "Tùy chọn khác",
                "Tùy chọn bài viết",
                "Hành động đối với bài viết",
                "More options",
                "Actions for this post",
                "Post options",
                "feed_story_header_more",
                "story_header_more",
                "post_header_more",
                "more_button",
            ),
        )
        if (button != null && semanticTapAttempts < POST_MENU_SEMANTIC_TAP_LIMIT) {
            // Facebook can report ACTION_CLICK as accepted without actually opening
            // the menu. Dispatch a real accessibility gesture at the detected node
            // first, and retry it before using screen-coordinate fallbacks.
            val gestureDispatched = tapNodeByGesture(button)
            val clicked = if (!gestureDispatched) click(button) else false
            menuSemanticTapAttempts[fallbackKey] = semanticTapAttempts + 1
            scheduleNext(if (gestureDispatched || clicked) 1_000 else 450)
            return
        }

        val anchorYFraction = findPostHeaderAnchorYFraction(root)
        val tapTargets = postMenuTapTargets(anchorYFraction)
        if (
            elapsedInStep(active) >= 1_500
            && fallbackTapAttempts < tapTargets.size
        ) {
            val geometryButton = if (fallbackTapAttempts == 0) {
                findPostMenuByGeometry(root, anchorYFraction)
            } else {
                null
            }
            val geometryGestureDispatched = geometryButton?.let { tapNodeByGesture(it) } == true
            val geometryClicked = if (!geometryGestureDispatched) {
                geometryButton?.let { click(it) } == true
            } else {
                false
            }
            val coordinateGestureDispatched = if (!geometryGestureDispatched && !geometryClicked) {
                tapPostMenuByGesture(tapTargets[fallbackTapAttempts])
            } else {
                false
            }
            menuFallbackTapAttempts[fallbackKey] = fallbackTapAttempts + 1
            if (geometryGestureDispatched || geometryClicked || coordinateGestureDispatched) {
                scheduleNext(1_200)
                return
            }
        }

        failStepAfter(
            active,
            35_000,
            "Không tìm thấy nút ba chấm của bài viết. ${postMenuDiagnostics(root)}",
        )
    }

    private fun openLinkManager(root: AccessibilityNodeInfo, active: ActiveJob) {
        val urlFormAlreadyVisible = findEditableNodes(root).any {
            nodeLabel(it).contains("url", ignoreCase = true)
        }
        if (urlFormAlreadyVisible) {
            JobStore.setStep(this, AutomationStep.FILL_URL)
            scheduleNext(250)
            return
        }

        val button = findBestNode(
            root,
            listOf(
                "Quản lý liên kết đến sản phẩm",
                "Thêm liên kết sản phẩm",
                "Manage product links",
                "Add product link",
            ),
        )
        if (button != null && click(button)) {
            scheduleNext(1_200)
            return
        }

        failStepAfter(active, 20_000, "Không tìm thấy mục Quản lý liên kết đến sản phẩm")
    }

    private fun fillUrl(root: AccessibilityNodeInfo, active: ActiveJob) {
        val inputs = findEditableNodes(root)
        val urlInput = inputs.firstOrNull { nodeLabel(it).contains("url", ignoreCase = true) }
            ?: inputs.firstOrNull()
        if (urlInput != null && setText(urlInput, active.job.shopeeUrl)) {
            JobStore.setStep(this, AutomationStep.FILL_NAME)
            scheduleNext(800)
            return
        }
        failStepAfter(active, 20_000, "Không tìm thấy ô URL")
    }

    private fun fillName(root: AccessibilityNodeInfo, active: ActiveJob) {
        val inputs = findEditableNodes(root)
        val nameInput = inputs.firstOrNull {
            val label = nodeLabel(it)
            label.contains("Tên liên kết", ignoreCase = true)
                || label.contains("Link name", ignoreCase = true)
        } ?: inputs.firstOrNull {
            it.text?.toString() != active.job.shopeeUrl
                && !nodeLabel(it).contains("url", ignoreCase = true)
        }

        if (nameInput == null || setText(nameInput, active.job.linkName)) {
            JobStore.setStep(this, AutomationStep.SAVE)
            scheduleNext(800)
            return
        }
        failStepAfter(active, 15_000, "Không nhập được tên liên kết")
    }

    private fun saveLink(root: AccessibilityNodeInfo, active: ActiveJob) {
        val saveButton = findBestNode(root, listOf("Lưu", "Save"), exactFirst = true)
        if (saveButton != null && click(saveButton)) {
            JobStore.setStep(this, AutomationStep.VERIFY)
            scheduleNext(2_000)
            return
        }

        val fallbackKey = "${active.job.id}:${active.job.attempt}"
        if (elapsedInStep(active) >= 2_000 && saveFallbackAttempts.add(fallbackKey)) {
            val gestureDispatched = saveButton?.let { tapNodeByGesture(it) }
                ?: tapSaveByGesture()
            if (gestureDispatched) {
                JobStore.setStep(this, AutomationStep.VERIFY)
                scheduleNext(2_000)
                return
            }
        }

        failStepAfter(active, 25_000, "Không tìm thấy nút Lưu")
    }

    private fun verifySaved(root: AccessibilityNodeInfo, active: ActiveJob) {
        val error = findBestNode(
            root,
            listOf(
                "Không thể lưu",
                "Liên kết không hợp lệ",
                "Đã xảy ra lỗi",
                "Unable to save",
                "Invalid link",
                "Something went wrong",
            ),
        )
        if (error != null) {
            JobStore.markForReport(this, false, "Facebook báo lỗi: ${nodeLabel(error)}")
            return
        }

        val saveStillVisible = findBestNode(
            root,
            listOf("Lưu", "Save"),
            exactFirst = true,
        ) != null
        val formStillVisible = saveStillVisible || findEditableNodes(root).any { node ->
            val label = nodeLabel(node)
            label.contains("url", ignoreCase = true)
                || label.contains("Tên liên kết", ignoreCase = true)
                || label.contains("Link name", ignoreCase = true)
                || node.text?.toString() == active.job.shopeeUrl
        }
        val savedLinkVisible = !formStillVisible && findBestNode(
            root,
            listOf(
                active.job.linkName,
                "Shopee",
                "Đủ điều kiện nhận tiền hoa hồng",
                "Eligible for commissions",
            ),
        ) != null

        val verifyFallbackKey = "${active.job.id}:${active.job.attempt}:verify-save"
        if (
            formStillVisible
            && elapsedInStep(active) >= 3_000
            && saveFallbackAttempts.add(verifyFallbackKey)
        ) {
            val saveButton = findBestNode(root, listOf("Lưu", "Save"), exactFirst = true)
            val gestureDispatched = saveButton?.let { tapNodeByGesture(it) }
                ?: tapSaveByGesture()
            if (gestureDispatched) {
                scheduleNext(2_000)
                return
            }
        }

        if (savedLinkVisible && elapsedInStep(active) >= 2_000) {
            JobStore.markForReport(
                this,
                success = true,
                message = "Đã gắn link Shopee và lưu trên Facebook",
            )
            return
        }

        if (elapsedInStep(active) > 15_000) {
            JobStore.markForReport(
                this,
                success = false,
                message = if (formStillVisible) {
                    "Facebook vẫn hiển thị form sau khi bấm Lưu"
                } else {
                    "Facebook đã đóng form nhưng chưa xác nhận liên kết được lưu"
                },
            )
        } else {
            scheduleNext(1_000)
        }
    }

    private fun findBestNode(
        root: AccessibilityNodeInfo,
        keywords: List<String>,
        exactFirst: Boolean = false,
    ): AccessibilityNodeInfo? {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)

        if (exactFirst) {
            nodes.firstOrNull { node ->
                keywords.any { keyword -> nodeLabel(node).trim().equals(keyword, true) }
            }?.let { return it }
        }

        return nodes
            .filter { node ->
                val label = nodeLabel(node)
                keywords.any { keyword -> label.contains(keyword, ignoreCase = true) }
            }
            .sortedBy { node ->
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                bounds.top
            }
            .firstOrNull()
    }

    private fun findEditableNodes(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        return nodes.filter { node ->
            node.isEditable
                || node.className?.toString()?.contains("EditText", ignoreCase = true) == true
                || node.actionList.any { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT }
        }
    }

    private fun findPostHeaderAnchorYFraction(root: AccessibilityNodeInfo): Float? {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)

        val width = resources.displayMetrics.widthPixels
        val height = resources.displayMetrics.heightPixels
        if (width <= 0 || height <= 0) return null

        return nodes
            .asSequence()
            .filter { it.isVisibleToUser }
            .mapNotNull { node ->
                val label = listOfNotNull(
                    node.text?.toString(),
                    node.contentDescription?.toString(),
                ).joinToString(" ").trim()
                if (
                    label.isBlank()
                    || label.length > 120
                    || !POST_AGE_PATTERN.containsMatchIn(label)
                ) {
                    return@mapNotNull null
                }

                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                if (
                    bounds.isEmpty
                    || bounds.centerX() > width * 0.78f
                    || bounds.centerY() < height * 0.10f
                    || bounds.centerY() > height * 0.48f
                ) {
                    null
                } else {
                    bounds.centerY().toFloat() / height
                }
            }
            .minOrNull()
    }

    private fun postMenuTapTargets(anchorYFraction: Float?): List<Float> {
        val targets = mutableListOf<Float>()
        if (anchorYFraction != null) {
            listOf(-0.035f, 0f, 0.035f, 0.07f).forEach { offset ->
                targets += (anchorYFraction + offset).coerceIn(0.12f, 0.48f)
            }
        }
        targets += MENU_TAP_Y_FRACTIONS.toList()
        return targets.distinctBy { (it * 1000).toInt() }
    }

    private fun findPostMenuByGeometry(
        root: AccessibilityNodeInfo,
        anchorYFraction: Float?,
    ): AccessibilityNodeInfo? {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)

        val width = resources.displayMetrics.widthPixels
        val height = resources.displayMetrics.heightPixels
        val targetX = width * 0.93f
        val targetY = height * (anchorYFraction ?: 0.22f)

        return nodes
            .asSequence()
            .filter { it.isVisibleToUser }
            .mapNotNull { node ->
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                if (
                    bounds.isEmpty
                    || bounds.centerX() < width * 0.75f
                    || bounds.top < height * 0.08f
                    || bounds.bottom > height * 0.52f
                    || bounds.width() > width * 0.26f
                    || bounds.height() > height * 0.14f
                ) {
                    null
                } else {
                    val className = node.className?.toString().orEmpty()
                    val label = nodeLabel(node)
                    val normalizedLabel = label.lowercase()
                    val excluded = POST_MENU_EXCLUDED_LABELS.any {
                        normalizedLabel.contains(it)
                    }
                    val looksInteractive = node.isClickable
                        || node.parent?.isClickable == true
                        || className.contains("Button", ignoreCase = true)
                        || className.contains("ImageView", ignoreCase = true)
                    if (!looksInteractive || excluded) {
                        null
                    } else {
                        val semanticMatch = POST_MENU_LABEL_HINTS.any {
                            normalizedLabel.contains(it)
                        }
                        val score = kotlin.math.abs(bounds.centerX() - targetX)
                            + (kotlin.math.abs(bounds.centerY() - targetY) * 1.8f)
                            + when {
                                semanticMatch -> -250f
                                label.isBlank() -> 0f
                                else -> 60f
                            }
                        node to score
                    }
                }
            }
            .minByOrNull { it.second }
            ?.first
    }

    private fun postMenuDiagnostics(root: AccessibilityNodeInfo): String {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)

        val width = resources.displayMetrics.widthPixels
        val height = resources.displayMetrics.heightPixels
        val candidates = nodes
            .asSequence()
            .filter { it.isVisibleToUser }
            .mapNotNull { node ->
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                if (
                    bounds.isEmpty
                    || bounds.centerX() < width * 0.68f
                    || bounds.centerY() < height * 0.08f
                    || bounds.centerY() > height * 0.55f
                    || bounds.width() > width * 0.32f
                ) {
                    return@mapNotNull null
                }

                val label = nodeLabel(node).trim().replace(Regex("\\s+"), " ")
                val safeLabel = if (label.isBlank()) "<không nhãn>" else label.take(50)
                "$safeLabel@${bounds.centerX()},${bounds.centerY()}"
            }
            .distinct()
            .take(6)
            .toList()

        return if (candidates.isEmpty()) {
            "Không có nút ứng viên ở mép phải."
        } else {
            "Ứng viên: ${candidates.joinToString(" | ")}"
        }
    }

    private fun tapPostMenuByGesture(yFraction: Float): Boolean {
        val width = resources.displayMetrics.widthPixels.toFloat()
        val height = resources.displayMetrics.heightPixels.toFloat()
        val path = Path().apply {
            moveTo(width * 0.93f, height * yFraction)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 120))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    private fun tapSaveByGesture(): Boolean {
        val width = resources.displayMetrics.widthPixels.toFloat()
        val height = resources.displayMetrics.heightPixels.toFloat()
        val path = Path().apply {
            moveTo(width * 0.93f, height * 0.09f)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 120))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    private fun tapNodeByGesture(node: AccessibilityNodeInfo): Boolean {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.isEmpty) return false

        val path = Path().apply {
            moveTo(bounds.exactCenterX(), bounds.exactCenterY())
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 120))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    private fun activate(node: AccessibilityNodeInfo): Boolean =
        click(node) || tapNodeByGesture(node)

    private fun collectNodes(
        node: AccessibilityNodeInfo,
        output: MutableList<AccessibilityNodeInfo>,
    ) {
        output += node
        for (index in 0 until node.childCount) {
            node.getChild(index)?.let { child -> collectNodes(child, output) }
        }
    }

    private fun nodeLabel(node: AccessibilityNodeInfo): String = listOfNotNull(
        node.text?.toString(),
        node.contentDescription?.toString(),
        node.hintText?.toString(),
        node.viewIdResourceName,
    ).joinToString(" ")

    private fun click(node: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = node
        repeat(5) {
            if (current?.isClickable == true) {
                return current?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
            }
            current = current?.parent
        }
        return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun setText(node: AccessibilityNodeInfo, value: String): Boolean {
        node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val arguments = Bundle().apply {
            putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                value,
            )
        }
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
    }

    private fun failStepAfter(active: ActiveJob, timeoutMs: Long, message: String) {
        if (elapsedInStep(active) > timeoutMs) {
            JobStore.markForReport(this, false, message)
        } else {
            scheduleNext(1_000)
        }
    }

    private fun elapsedInStep(active: ActiveJob): Long =
        System.currentTimeMillis() - active.stepStartedAt

    private fun scheduleNext(delayMs: Long) {
        handler.removeCallbacks(processRunnable)
        handler.postDelayed(processRunnable, delayMs)
    }

    companion object {
        private const val POST_MENU_SEMANTIC_TAP_LIMIT = 3
        private const val FACEBOOK_PACKAGE = "com.facebook.katana"
        private const val EVENT_SETTLE_MS = 600L
        private const val ROOT_RETRY_MS = 500L
        private val MENU_TAP_Y_FRACTIONS =
            floatArrayOf(0.16f, 0.20f, 0.24f, 0.28f, 0.32f, 0.36f, 0.40f)
        private val POST_AGE_PATTERN = Regex(
            """(?i)(^|\s)(vừa xong|\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm|sec|secs|min|mins|hr|hrs|day|days|week|weeks|month|months|year|years|s|m|h|d|w|y))(\s|[·•]|$)""",
        )
        private val POST_MENU_LABEL_HINTS = listOf(
            "lựa chọn khác",
            "tùy chọn",
            "hành động đối với bài viết",
            "more options",
            "actions for this post",
            "post options",
            "xem thêm",
            "feed_story_header_more",
            "story_header_more",
            "post_header_more",
            "more_button",
        )
        private val POST_MENU_EXCLUDED_LABELS = listOf(
            "tìm kiếm",
            "search",
            "quay lại",
            "back",
            "đóng",
            "close",
            "messenger",
            "thông báo",
            "notification",
            "chia sẻ",
            "share",
        )
    }
}
