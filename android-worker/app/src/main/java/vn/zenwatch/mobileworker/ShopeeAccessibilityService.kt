package vn.zenwatch.mobileworker

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.PointF
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlin.math.abs
import kotlin.math.max

class ShopeeAccessibilityService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private val processRunnable = Runnable { processCurrentStep() }
    private val menuSemanticTapAttempts = mutableMapOf<String, Int>()
    private val menuFallbackTapAttempts = mutableMapOf<String, Int>()
    private val reelScreenshotAttempts = mutableMapOf<String, Int>()
    private val reelScreenshotInFlight = mutableSetOf<String>()
    private val reelOptionsScrollAttempts = mutableMapOf<String, Int>()
    private val affiliateProductTapAttempts = mutableMapOf<String, Int>()
    private val saveFallbackAttempts = mutableSetOf<String>()
    private val exactPostReopenTargets = mutableMapOf<String, Int>()

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
                "Quản lý sản phẩm",
                "Thêm sản phẩm liên kết tiếp thị",
                "Manage product links",
                "Add product link",
                "Manage products",
                "Add affiliate product",
            ),
            visibleOnly = true,
        )
        if (linkManagerAlreadyVisible != null) {
            JobStore.setStep(this, AutomationStep.OPEN_LINK_MANAGER)
            scheduleNext(250)
            return
        }

        val fallbackKey = "${active.job.id}:${active.job.attempt}"

        // Never attach a link to whichever post happens to be first in News Feed.
        // If Facebook interpreted an exact permalink as Home, retry the next
        // exact target. After all targets are exhausted, fail safely instead of
        // touching a potentially unrelated post.
        if (looksLikeFacebookHomeFeed(root)) {
            if (elapsedInStep(active) < EXACT_POST_FIRST_RETRY_MS) {
                scheduleNext(500)
                return
            }

            val currentTarget = exactPostReopenTargets[fallbackKey] ?: 0
            val nextTarget = currentTarget + 1
            if (nextTarget < FacebookPostLauncher.targetCount(active.job)) {
                exactPostReopenTargets[fallbackKey] = nextTarget
                if (FacebookPostLauncher.launch(this, active.job, nextTarget)) {
                    scheduleNext(EXACT_POST_REOPEN_SETTLE_MS)
                    return
                }
            }

            failStepAfter(
                active,
                EXACT_POST_FAIL_TIMEOUT_MS,
                "Facebook van dang o News Feed; Worker da dung de tranh gan link nham bai",
            )
            return
        }

        // Full-screen Reels opens a tall bottom sheet. The product-management row
        // is below the first viewport, so scroll the already-open sheet instead of
        // tapping another three-dot button behind it.
        val priorReelScrollAttempts = reelOptionsScrollAttempts[fallbackKey] ?: 0
        if (isReelOptionsMenuVisible(root) || priorReelScrollAttempts > 0) {
            val scrollAttempts = priorReelScrollAttempts
            if (scrollAttempts < REEL_OPTIONS_SCROLL_LIMIT) {
                reelOptionsScrollAttempts[fallbackKey] = scrollAttempts + 1
                if (swipeReelOptionsUp()) {
                    scheduleNext(1_200)
                    return
                }
            }
            failStepAfter(
                active,
                45_000,
                "Đã mở tùy chọn Reels nhưng không tìm thấy mục Quản lý sản phẩm sau khi cuộn",
            )
            return
        }

        val semanticTapAttempts = menuSemanticTapAttempts[fallbackKey] ?: 0
        val fallbackTapAttempts = menuFallbackTapAttempts[fallbackKey] ?: 0
        val fullscreenReel = isVideoJob(active) || looksLikeFullscreenReel(root)
        val anchorYFraction = findPostHeaderAnchorYFraction(root)
        val tapTargets = postMenuTapTargets(anchorYFraction)

        // Facebook does not reliably expose the lower Reel ellipsis as an
        // accessibility node. Coordinate guesses can hit the bookmark/save button
        // above it, so locate the three bright dots from a temporary screenshot and
        // tap the detected centre instead. Never sweep guessed Reel coordinates.
        if (
            fullscreenReel
            && elapsedInStep(active) >= 900
        ) {
            val screenshotAttempts = reelScreenshotAttempts[fallbackKey] ?: 0
            if (
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                && screenshotAttempts < REEL_SCREENSHOT_TAP_LIMIT
            ) {
                if (reelScreenshotInFlight.add(fallbackKey)) {
                    reelScreenshotAttempts[fallbackKey] = screenshotAttempts + 1
                    captureAndTapReelMenu(fallbackKey)
                }
                scheduleNext(REEL_SCREENSHOT_SETTLE_MS)
                return
            }
        }

        val button = findFullscreenReelMenuButton(root) ?: if (!fullscreenReel) {
            findBestNode(root, POST_MENU_BUTTON_KEYWORDS)
        } else {
            // In Reels there is also a page-level three-dot button at the top.
            // If the lower post button is absent from the accessibility tree, use
            // the measured lower-right coordinate rather than clicking the top one.
            null
        }
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

        if (
            !fullscreenReel
            && elapsedInStep(active) >= 1_500
            && fallbackTapAttempts < tapTargets.size
        ) {
            val geometryButton = if (fallbackTapAttempts == 0 && !fullscreenReel) {
                findPostMenuByGeometry(root, anchorYFraction, fullscreenReel)
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

        // Video/Reels has a second screen. Prefer its affiliate-product row before
        // looking for the first-level menu item, otherwise Facebook can expose the
        // page title as a misleading click candidate and the worker loops here.
        val affiliateProductButton = findBestNode(
            root,
            listOf(
                "Thêm sản phẩm liên kết tiếp thị",
                "Add affiliate product",
            ),
            exactFirst = true,
            visibleOnly = true,
        )
        if (affiliateProductButton != null) {
            val gestureDispatched = tapNodeByGesture(affiliateProductButton)
            val clicked = if (!gestureDispatched) click(affiliateProductButton) else false
            if (gestureDispatched || clicked) {
                scheduleNext(1_200)
                return
            }
        }

        val addProductPageVisible = findBestNode(
            root,
            listOf(
                "Thêm sản phẩm",
                "Add product",
            ),
            exactFirst = true,
            visibleOnly = true,
        ) != null
        if (addProductPageVisible) {
            // Some Facebook versions draw the affiliate row but omit it from the
            // accessibility tree. Tap the stable row position as a bounded fallback.
            val fallbackKey = "${active.job.id}:${active.job.attempt}:affiliate-product"
            val attempts = affiliateProductTapAttempts[fallbackKey] ?: 0
            if (elapsedInStep(active) >= 1_500 && attempts < AFFILIATE_PRODUCT_TAP_LIMIT) {
                affiliateProductTapAttempts[fallbackKey] = attempts + 1
                if (tapAffiliateProductRowByGesture()) {
                    scheduleNext(1_500)
                    return
                }
            }
            scheduleNext(1_200)
            return
        }

        val linkManagerButton = findBestNode(
            root,
            listOf(
                "Quản lý liên kết đến sản phẩm",
                "Thêm liên kết sản phẩm",
                "Quản lý sản phẩm",
                "Manage product links",
                "Add product link",
                "Manage products",
            ),
            exactFirst = true,
            visibleOnly = true,
        )
        if (linkManagerButton != null) {
            val gestureDispatched = tapNodeByGesture(linkManagerButton)
            val clicked = if (!gestureDispatched) click(linkManagerButton) else false
            if (gestureDispatched || clicked) {
                scheduleNext(1_200)
                return
            }
        }

        failStepAfter(
            active,
            40_000,
            "Không tìm thấy mục Quản lý liên kết sản phẩm hoặc Thêm sản phẩm liên kết tiếp thị",
        )
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

        // The Reels options sheet also contains "Lưu thước phim" / "Save reel".
        // Only an exact "Lưu" / "Save" belongs to the product-link form; a
        // substring match here would save the reel after the link form closes.
        val exactSaveButtonVisible = findExactNode(
            root,
            listOf("Lưu", "Save"),
            visibleOnly = true,
        ) != null
        val saveStillVisible = exactSaveButtonVisible
        val formStillVisible = saveStillVisible || findEditableNodes(root).any { node ->
            val label = nodeLabel(node)
            label.contains("url", ignoreCase = true)
                || label.contains("Tên liên kết", ignoreCase = true)
                || label.contains("Link name", ignoreCase = true)
                || node.text?.toString() == active.job.shopeeUrl
        }
        val returnedToProductPage = !formStillVisible && findBestNode(
            root,
            listOf(
                "Thêm sản phẩm",
                "Quản lý sản phẩm",
                "Add product",
                "Manage products",
            ),
            exactFirst = true,
        ) != null

        val verifyFallbackKey = "${active.job.id}:${active.job.attempt}:verify-save"
        if (
            formStillVisible
            && elapsedInStep(active) >= 3_000
            && saveFallbackAttempts.add(verifyFallbackKey)
        ) {
            val saveButton = findExactNode(
                root,
                listOf("Lưu", "Save"),
                visibleOnly = true,
            )
            val gestureDispatched = saveButton?.let { tapNodeByGesture(it) }
                ?: tapSaveByGesture()
            if (gestureDispatched) {
                scheduleNext(2_000)
                return
            }
        }

        if (
            !formStillVisible
            && elapsedInStep(active) >= VERIFY_FORM_CLOSED_SUCCESS_MS
        ) {
            JobStore.markForReport(
                this,
                success = true,
                message = if (returnedToProductPage) {
                    "Đã gắn link Shopee và lưu cho bài video trên Facebook"
                } else {
                    "Đã gắn link Shopee và lưu trên Facebook"
                },
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
        visibleOnly: Boolean = false,
    ): AccessibilityNodeInfo? {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)

        if (exactFirst) {
            nodes.firstOrNull { node ->
                (!visibleOnly || node.isVisibleToUser)
                    && keywords.any { keyword -> nodeLabel(node).trim().equals(keyword, true) }
            }?.let { return it }
        }

        return nodes
            .filter { node ->
                val label = nodeLabel(node)
                (!visibleOnly || node.isVisibleToUser)
                    && keywords.any { keyword -> label.contains(keyword, ignoreCase = true) }
            }
            .sortedBy { node ->
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                bounds.top
            }
            .firstOrNull()
    }

    private fun findExactNode(
        root: AccessibilityNodeInfo,
        keywords: List<String>,
        visibleOnly: Boolean = false,
    ): AccessibilityNodeInfo? {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        return nodes.firstOrNull { node ->
            (!visibleOnly || node.isVisibleToUser)
                && keywords.any { keyword -> nodeLabel(node).trim().equals(keyword, true) }
        }
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

    private fun isVideoJob(active: ActiveJob): Boolean {
        val url = active.job.postUrl.lowercase()
        return VIDEO_URL_HINTS.any { url.contains(it) }
    }

    private fun looksLikeFacebookHomeFeed(root: AccessibilityNodeInfo): Boolean {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)

        val height = resources.displayMetrics.heightPixels
        if (height <= 0) return false

        var hasFacebookHeader = false
        val bottomNavigationLabels = mutableSetOf<String>()
        nodes.forEach { node ->
            if (!node.isVisibleToUser) return@forEach
            val label = nodeLabel(node)
                .trim()
                .replace(Regex("\\s+"), " ")
                .lowercase()
            if (label.isBlank()) return@forEach

            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            if (bounds.isEmpty) return@forEach

            if (
                bounds.centerY() < height * 0.24f
                && (label == "facebook" || label.startsWith("facebook "))
            ) {
                hasFacebookHeader = true
            }

            if (bounds.centerY() > height * 0.70f) {
                HOME_FEED_BOTTOM_NAV_HINTS.firstOrNull { hint ->
                    label == hint || label.startsWith("$hint ") || label.contains(" $hint")
                }?.let(bottomNavigationLabels::add)
            }
        }

        return bottomNavigationLabels.size >= 3 ||
            (hasFacebookHeader && bottomNavigationLabels.isNotEmpty())
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
        fullscreenReel: Boolean,
    ): AccessibilityNodeInfo? {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)

        val width = resources.displayMetrics.widthPixels
        val height = resources.displayMetrics.heightPixels
        val targetX = width * 0.93f
        val targetY = height * when {
            fullscreenReel -> REEL_MENU_PRIMARY_Y_FRACTION
            else -> anchorYFraction ?: 0.22f
        }

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
                    || (!fullscreenReel && bounds.bottom > height * 0.52f)
                    || (fullscreenReel && bounds.centerY() < height * 0.62f)
                    || bounds.bottom > height * 0.92f
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

    private fun findFullscreenReelMenuButton(
        root: AccessibilityNodeInfo,
    ): AccessibilityNodeInfo? {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)

        val width = resources.displayMetrics.widthPixels
        val height = resources.displayMetrics.heightPixels
        if (width <= 0 || height <= 0) return null

        return nodes
            .asSequence()
            .filter { it.isVisibleToUser }
            .mapNotNull { node ->
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                val label = nodeLabel(node).lowercase()
                val semanticMatch = REEL_MENU_LABEL_HINTS.any { label.contains(it) }
                if (
                    bounds.isEmpty
                    || bounds.centerX() < width * 0.86f
                    || bounds.centerY() < height * 0.62f
                    || bounds.centerY() > height * 0.92f
                    || bounds.width() > width * 0.20f
                    || bounds.height() > height * 0.10f
                    || !semanticMatch
                ) {
                    null
                } else {
                    node
                }
            }
            .maxByOrNull { node ->
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                bounds.centerY()
            }
    }

    private fun looksLikeFullscreenReel(root: AccessibilityNodeInfo): Boolean {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)

        val height = resources.displayMetrics.heightPixels
        if (height <= 0) return false

        return nodes.any { node ->
            if (!node.isVisibleToUser) return@any false
            val label = nodeLabel(node).lowercase()
            if (REEL_SCREEN_LABEL_HINTS.any { label.contains(it) }) {
                return@any true
            }

            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            bounds.centerY() > height * 0.62f && (
                label.contains("xem thêm")
                    || label.contains("see more")
            )
        }
    }

    private fun isReelOptionsMenuVisible(root: AccessibilityNodeInfo): Boolean {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        return nodes.any { node ->
            node.isVisibleToUser && REEL_OPTIONS_LABEL_HINTS.any { keyword ->
                nodeLabel(node).contains(keyword, ignoreCase = true)
            }
        }
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
        return tapScreenPoint(width * POST_MENU_X_FRACTION, height * yFraction)
    }

    private fun tapScreenPoint(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 120))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    private fun captureAndTapReelMenu(fallbackKey: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            reelScreenshotInFlight.remove(fallbackKey)
            return
        }

        takeScreenshot(
            Display.DEFAULT_DISPLAY,
            mainExecutor,
            object : TakeScreenshotCallback {
                override fun onSuccess(screenshot: ScreenshotResult) {
                    reelScreenshotInFlight.remove(fallbackKey)
                    val hardwareBuffer = screenshot.hardwareBuffer
                    val bitmap = try {
                        Bitmap.wrapHardwareBuffer(hardwareBuffer, screenshot.colorSpace)
                            ?.copy(Bitmap.Config.ARGB_8888, false)
                    } finally {
                        hardwareBuffer.close()
                    }

                    if (bitmap == null) {
                        scheduleNext(REEL_SCREENSHOT_RETRY_MS)
                        return
                    }

                    val target = try {
                        findReelEllipsisCenter(bitmap)
                    } finally {
                        bitmap.recycle()
                    }

                    if (target != null && tapScreenPoint(target.x, target.y)) {
                        scheduleNext(1_200)
                    } else {
                        scheduleNext(REEL_SCREENSHOT_RETRY_MS)
                    }
                }

                override fun onFailure(errorCode: Int) {
                    reelScreenshotInFlight.remove(fallbackKey)
                    scheduleNext(REEL_SCREENSHOT_RETRY_MS)
                }
            },
        )
    }

    private data class BrightBlob(
        val centerX: Float,
        val centerY: Float,
        val width: Int,
        val height: Int,
        val area: Int,
    )

    /**
     * Finds the three separate bright circles used by Facebook's lower Reel menu.
     * The crop excludes the top page menu and the vertical reaction controls. A
     * bookmark outline is one large component, so it cannot satisfy the triple-dot
     * shape and will never be selected as the target.
     */
    private fun findReelEllipsisCenter(bitmap: Bitmap): PointF? {
        val screenWidth = bitmap.width
        val screenHeight = bitmap.height
        if (screenWidth <= 0 || screenHeight <= 0) return null

        val cropLeft = (screenWidth * REEL_ELLIPSIS_CROP_LEFT).toInt()
        val cropTop = (screenHeight * REEL_ELLIPSIS_CROP_TOP).toInt()
        val cropRight = (screenWidth * REEL_ELLIPSIS_CROP_RIGHT).toInt()
        val cropBottom = (screenHeight * REEL_ELLIPSIS_CROP_BOTTOM).toInt()
        val cropWidth = cropRight - cropLeft
        val cropHeight = cropBottom - cropTop
        if (cropWidth <= 0 || cropHeight <= 0) return null

        val pixels = IntArray(cropWidth * cropHeight)
        bitmap.getPixels(pixels, 0, cropWidth, cropLeft, cropTop, cropWidth, cropHeight)
        val visited = BooleanArray(pixels.size)
        val queue = IntArray(pixels.size)
        val blobs = mutableListOf<BrightBlob>()
        val minDotArea = max(4, screenWidth / 180)
        val maxDotArea = max(180, screenWidth * screenHeight / 2_500)
        val maxDotDiameter = max(16, screenWidth / 28)

        fun isBright(index: Int): Boolean {
            val color = pixels[index]
            val alpha = color ushr 24 and 0xff
            val red = color ushr 16 and 0xff
            val green = color ushr 8 and 0xff
            val blue = color and 0xff
            return alpha >= 200 && red >= 205 && green >= 205 && blue >= 205
        }

        pixels.indices.forEach { start ->
            if (visited[start] || !isBright(start)) return@forEach
            visited[start] = true
            var queueHead = 0
            var queueTail = 0
            queue[queueTail++] = start
            var area = 0
            var minX = cropWidth
            var maxX = 0
            var minY = cropHeight
            var maxY = 0
            var sumX = 0L
            var sumY = 0L

            while (queueHead < queueTail) {
                val current = queue[queueHead++]
                val x = current % cropWidth
                val y = current / cropWidth
                area += 1
                sumX += x
                sumY += y
                minX = minOf(minX, x)
                maxX = maxOf(maxX, x)
                minY = minOf(minY, y)
                maxY = maxOf(maxY, y)

                for (dy in -1..1) {
                    for (dx in -1..1) {
                        if (dx == 0 && dy == 0) continue
                        val nextX = x + dx
                        val nextY = y + dy
                        if (nextX !in 0 until cropWidth || nextY !in 0 until cropHeight) continue
                        val next = nextY * cropWidth + nextX
                        if (!visited[next] && isBright(next)) {
                            visited[next] = true
                            queue[queueTail++] = next
                        }
                    }
                }
            }

            val blobWidth = maxX - minX + 1
            val blobHeight = maxY - minY + 1
            if (
                area in minDotArea..maxDotArea
                && blobWidth <= maxDotDiameter
                && blobHeight <= maxDotDiameter
            ) {
                blobs += BrightBlob(
                    centerX = cropLeft + sumX.toFloat() / area,
                    centerY = cropTop + sumY.toFloat() / area,
                    width = blobWidth,
                    height = blobHeight,
                    area = area,
                )
            }
        }

        val candidates = blobs
            .filter {
                it.centerX >= screenWidth * REEL_ELLIPSIS_MIN_X
                    && it.centerY >= screenHeight * REEL_ELLIPSIS_MIN_Y
                    && it.centerY <= screenHeight * REEL_ELLIPSIS_MAX_Y
            }
            .sortedBy { it.centerX }
        val yTolerance = max(7f, screenHeight * 0.008f)
        val minGap = max(4f, screenWidth * 0.006f)
        val maxGap = max(28f, screenWidth * 0.045f)
        val gapTolerance = max(6f, screenWidth * 0.012f)
        var bestTarget: PointF? = null
        var bestScore = Float.MAX_VALUE

        for (firstIndex in 0 until candidates.size - 2) {
            for (secondIndex in firstIndex + 1 until candidates.size - 1) {
                for (thirdIndex in secondIndex + 1 until candidates.size) {
                    val first = candidates[firstIndex]
                    val second = candidates[secondIndex]
                    val third = candidates[thirdIndex]
                    val minY = minOf(first.centerY, second.centerY, third.centerY)
                    val maxY = maxOf(first.centerY, second.centerY, third.centerY)
                    if (maxY - minY > yTolerance) continue

                    val firstGap = second.centerX - first.centerX
                    val secondGap = third.centerX - second.centerX
                    if (firstGap !in minGap..maxGap || secondGap !in minGap..maxGap) continue
                    if (abs(firstGap - secondGap) > gapTolerance) continue

                    val centerX = (first.centerX + second.centerX + third.centerX) / 3f
                    val centerY = (first.centerY + second.centerY + third.centerY) / 3f
                    val sizeDifference = abs(first.area - second.area) + abs(second.area - third.area)
                    val score = abs(centerY - screenHeight * REEL_ELLIPSIS_EXPECTED_Y)
                        + abs(centerX - screenWidth * REEL_ELLIPSIS_EXPECTED_X) * 0.4f
                        + abs(firstGap - secondGap) * 2f
                        + sizeDifference * 0.15f
                    if (score < bestScore) {
                        bestScore = score
                        bestTarget = PointF(centerX, centerY)
                    }
                }
            }
        }
        return bestTarget
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

    private fun tapAffiliateProductRowByGesture(): Boolean {
        val width = resources.displayMetrics.widthPixels.toFloat()
        val height = resources.displayMetrics.heightPixels.toFloat()
        val path = Path().apply {
            moveTo(width * 0.50f, height * 0.245f)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 120))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    private fun swipeReelOptionsUp(): Boolean {
        val width = resources.displayMetrics.widthPixels.toFloat()
        val height = resources.displayMetrics.heightPixels.toFloat()
        val path = Path().apply {
            // A controlled upward finger swipe moves the bottom-sheet contents just
            // enough to reveal "Quản lý sản phẩm" without skipping past the row.
            moveTo(width * 0.50f, height * 0.82f)
            lineTo(width * 0.50f, height * 0.50f)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 480))
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
        private const val REEL_SCREENSHOT_TAP_LIMIT = 4
        private const val REEL_OPTIONS_SCROLL_LIMIT = 5
        private const val AFFILIATE_PRODUCT_TAP_LIMIT = 3
        private const val EXACT_POST_FIRST_RETRY_MS = 1_200L
        private const val EXACT_POST_REOPEN_SETTLE_MS = 2_000L
        private const val EXACT_POST_FAIL_TIMEOUT_MS = 20_000L
        private const val VERIFY_FORM_CLOSED_SUCCESS_MS = 5_000L
        private const val FACEBOOK_PACKAGE = "com.facebook.katana"
        private const val EVENT_SETTLE_MS = 600L
        private const val ROOT_RETRY_MS = 500L
        private const val REEL_SCREENSHOT_SETTLE_MS = 1_800L
        private const val REEL_SCREENSHOT_RETRY_MS = 450L
        private const val POST_MENU_X_FRACTION = 0.936f
        private const val REEL_MENU_PRIMARY_Y_FRACTION = 0.80f
        private const val REEL_ELLIPSIS_CROP_LEFT = 0.84f
        private const val REEL_ELLIPSIS_CROP_RIGHT = 0.995f
        private const val REEL_ELLIPSIS_CROP_TOP = 0.65f
        private const val REEL_ELLIPSIS_CROP_BOTTOM = 0.91f
        private const val REEL_ELLIPSIS_MIN_X = 0.86f
        private const val REEL_ELLIPSIS_MIN_Y = 0.69f
        private const val REEL_ELLIPSIS_MAX_Y = 0.89f
        private const val REEL_ELLIPSIS_EXPECTED_X = 0.936f
        private const val REEL_ELLIPSIS_EXPECTED_Y = 0.80f
        private val MENU_TAP_Y_FRACTIONS =
            floatArrayOf(0.16f, 0.20f, 0.24f, 0.28f, 0.32f, 0.36f, 0.40f)
        private val HOME_FEED_BOTTOM_NAV_HINTS = listOf(
            "trang ch\u1ee7",
            "b\u1ea3ng \u0111i\u1ec1u khi\u1ec3n chuy\u00ean nghi\u1ec7p",
            "b\u1ea1n b\u00e8",
            "nh\u00f3m",
            "th\u00f4ng b\u00e1o",
            "trang c\u00e1 nh\u00e2n",
            "menu",
            "home",
            "professional dashboard",
            "friends",
            "groups",
            "notifications",
            "profile",
        )
        private val POST_MENU_BUTTON_KEYWORDS = listOf(
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
        )
        private val REEL_MENU_LABEL_HINTS = listOf(
            "lựa chọn khác",
            "tùy chọn",
            "more options",
            "actions for this post",
            "post options",
            "feed_story_header_more",
            "story_header_more",
            "post_header_more",
            "more_button",
        )
        private val REEL_SCREEN_LABEL_HINTS = listOf(
            "tiếp theo:",
            "up next:",
            "lưu thước phim",
            "save reel",
            "remix thước phim",
            "remix this reel",
        )
        private val VIDEO_URL_HINTS = listOf(
            "/reel/",
            "/reels/",
            "/videos/",
            "/watch/",
            "watch?v=",
            "video.php",
            "fb.watch/",
            "/share/r/",
            "/share/v/",
        )
        private val REEL_OPTIONS_LABEL_HINTS = listOf(
            "Lưu thước phim",
            "Save reel",
            "Remix thước phim này",
            "Remix this reel",
            "Tại sao tôi nhìn thấy video này?",
            "Why am I seeing this video?",
            "Xếp hạng trải nghiệm phát lại video",
            "Rate video playback experience",
        )
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
