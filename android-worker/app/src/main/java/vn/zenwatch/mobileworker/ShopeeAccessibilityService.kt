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
    private val menuTapDispatched = mutableSetOf<String>()
    private val linkManagerNavigationProof = mutableSetOf<String>()
    private val affiliateProductTapAttempts = mutableMapOf<String, Int>()
    private val saveRetryAttempts = mutableSetOf<String>()
    private val exactPostReopenTargets = mutableMapOf<String, Int>()
    private val exactPostLastLaunchAt = mutableMapOf<String, Long>()
    private val reelProfileAllTabAttempts = mutableMapOf<String, Int>()
    private val reelProfileRefreshAttempts = mutableMapOf<String, Int>()
    private val reelProfileScrollAttempts = mutableMapOf<String, Int>()
    private val reelProfileReopenAttempts = mutableMapOf<String, Int>()
    private val reelProfileLastLaunchAt = mutableMapOf<String, Long>()

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.packageName?.toString() != FACEBOOK_PACKAGE) return
        if (JobStore.load(this) == null) return
        handler.removeCallbacks(processRunnable)
        handler.postDelayed(processRunnable, EVENT_SETTLE_MS)
    }

    override fun onInterrupt() = Unit

    override fun onServiceConnected() {
        super.onServiceConnected()
        clearAttemptState()
        JobStore.load(this)?.let { active ->
            if (active.step != AutomationStep.REPORTING) {
                JobStore.restartNavigation(this)
                FacebookPostLauncher.launch(this, active.job)
            }
        }
        handler.postDelayed(processRunnable, EVENT_SETTLE_MS)
    }

    override fun onDestroy() {
        handler.removeCallbacks(processRunnable)
        clearAttemptState()
        super.onDestroy()
    }

    private fun clearAttemptState() {
        menuSemanticTapAttempts.clear()
        menuFallbackTapAttempts.clear()
        menuTapDispatched.clear()
        linkManagerNavigationProof.clear()
        affiliateProductTapAttempts.clear()
        saveRetryAttempts.clear()
        exactPostReopenTargets.clear()
        exactPostLastLaunchAt.clear()
        reelProfileAllTabAttempts.clear()
        reelProfileRefreshAttempts.clear()
        reelProfileScrollAttempts.clear()
        reelProfileReopenAttempts.clear()
        reelProfileLastLaunchAt.clear()
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
                AutomationStep.OPEN_POST -> openExactPost(root, active)
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

    /** Safety gate before any post menu or product form is touched. */
    private fun openExactPost(root: AccessibilityNodeInfo, active: ActiveJob) {
        if (isVideoJob(active)) {
            openLatestVideoOnPage(root, active)
            return
        }

        val fallbackKey = "${active.job.id}:${active.job.attempt}"
        val staleProductUi = hasProductLinkSurface(root) || isReelOptionsMenuVisible(root)
        val homeFeed = looksLikeFacebookHomeFeed(root)
        val boostPostUi = looksLikeBoostPostScreen(root)
        val currentTarget = exactPostReopenTargets[fallbackKey] ?: 0

        if (!staleProductUi && !homeFeed && !boostPostUi && looksLikeExactPostDetail(root, active)) {
            exactPostReopenTargets.remove(fallbackKey)
            exactPostLastLaunchAt.remove(fallbackKey)
            menuSemanticTapAttempts.remove(fallbackKey)
            menuFallbackTapAttempts.remove(fallbackKey)
            menuTapDispatched.remove(fallbackKey)
            linkManagerNavigationProof.remove(fallbackKey)
            affiliateProductTapAttempts.remove("$fallbackKey:affiliate-product")
            saveRetryAttempts.remove("$fallbackKey:verify-save")
            JobStore.setStep(this, AutomationStep.OPEN_MENU)
            scheduleNext(350)
            return
        }

        if (elapsedInStep(active) < EXACT_POST_FIRST_RETRY_MS) {
            scheduleNext(500)
            return
        }

        val sinceLastLaunch = System.currentTimeMillis() -
            (exactPostLastLaunchAt[fallbackKey] ?: 0L)
        if (sinceLastLaunch < EXACT_POST_REOPEN_SETTLE_MS) {
            scheduleNext(EXACT_POST_REOPEN_SETTLE_MS - sinceLastLaunch)
            return
        }

        val nextTarget = currentTarget + 1
        if (nextTarget < FacebookPostLauncher.targetCount(active.job)) {
            exactPostReopenTargets[fallbackKey] = nextTarget
            if (FacebookPostLauncher.launch(this, active.job, nextTarget)) {
                exactPostLastLaunchAt[fallbackKey] = System.currentTimeMillis()
                scheduleNext(EXACT_POST_REOPEN_SETTLE_MS)
                return
            }
        }

        val reason = when {
            staleProductUi -> "Facebook vẫn hiển thị menu/form của bài cũ"
            homeFeed -> "Facebook vẫn đang ở News Feed"
            boostPostUi -> "Facebook mở nhầm màn Quảng bá bài viết"
            active.job.postText.isBlank() -> "Job bài viết không có caption để xác minh"
            else -> "Facebook chưa hiển thị bài có caption khớp chính xác"
        }
        failStepAfter(
            active,
            EXACT_POST_FAIL_TIMEOUT_MS,
            "$reason; Worker đã dừng để tránh gắn nhầm link",
        )
    }

    /**
     * Video-only navigation: stay on the Page Posts timeline, locate the newly
     * published video card, then hand its header position to OPEN_MENU. The caption
     * from the backend is mandatory identity evidence: there is no topmost-card or
     * generic-Reels fallback.
     */
    private fun openLatestVideoOnPage(root: AccessibilityNodeInfo, active: ActiveJob) {
        val fallbackKey = "${active.job.id}:${active.job.attempt}"
        val staleProductUi = hasProductLinkSurface(root) || isReelOptionsMenuVisible(root)
        val profileTimeline = !staleProductUi && looksLikeProfileTimeline(root)
        val anchorY = if (profileTimeline) {
            findProfilePostAnchorY(root, active.job.postText)
        } else {
            null
        }

        if (anchorY != null) {
            reelProfileAllTabAttempts.remove(fallbackKey)
            reelProfileRefreshAttempts.remove(fallbackKey)
            reelProfileScrollAttempts.remove(fallbackKey)
            reelProfileReopenAttempts.remove(fallbackKey)
            reelProfileLastLaunchAt.remove(fallbackKey)
            menuSemanticTapAttempts.remove(fallbackKey)
            menuFallbackTapAttempts.remove(fallbackKey)
            menuTapDispatched.remove(fallbackKey)
            linkManagerNavigationProof.remove(fallbackKey)
            affiliateProductTapAttempts.remove("$fallbackKey:affiliate-product")
            saveRetryAttempts.remove("$fallbackKey:verify-save")
            JobStore.setStep(this, AutomationStep.OPEN_MENU)
            scheduleNext(350)
            return
        }

        if (profileTimeline) {
            val allTabAttempts = reelProfileAllTabAttempts[fallbackKey] ?: 0
            if (allTabAttempts < PROFILE_ALL_TAB_TAP_LIMIT) {
                reelProfileAllTabAttempts[fallbackKey] = allTabAttempts + 1
                val allTab = findProfileTab(root, PROFILE_ALL_TAB_LABELS)
                if (allTab != null) {
                    val gestureDispatched = tapNodeByGesture(allTab)
                    val clicked = if (!gestureDispatched) click(allTab) else false
                    if (gestureDispatched || clicked) {
                        scheduleNext(1_200)
                        return
                    }
                }
            }

            val refreshAttempts = reelProfileRefreshAttempts[fallbackKey] ?: 0
            if (
                elapsedInStep(active) >= PROFILE_REFRESH_START_MS
                && refreshAttempts < PROFILE_REFRESH_LIMIT
            ) {
                reelProfileRefreshAttempts[fallbackKey] = refreshAttempts + 1
                if (refreshProfileTimelineByGesture()) {
                    scheduleNext(2_000)
                    return
                }
            }

            val scrollAttempts = reelProfileScrollAttempts[fallbackKey] ?: 0
            if (
                elapsedInStep(active) >= PROFILE_SCROLL_START_MS
                && scrollAttempts < PROFILE_SEARCH_SCROLL_LIMIT
            ) {
                reelProfileScrollAttempts[fallbackKey] = scrollAttempts + 1
                if (revealProfilePostsByGesture()) {
                    scheduleNext(1_200)
                    return
                }
            }
        }

        if (elapsedInStep(active) < PROFILE_FIRST_RETRY_MS) {
            scheduleNext(500)
            return
        }

        val searchExhausted = !profileTimeline || (
            (reelProfileAllTabAttempts[fallbackKey] ?: 0) >= PROFILE_ALL_TAB_TAP_LIMIT
                && (reelProfileRefreshAttempts[fallbackKey] ?: 0) >= PROFILE_REFRESH_LIMIT
                && (reelProfileScrollAttempts[fallbackKey] ?: 0) >= PROFILE_SEARCH_SCROLL_LIMIT
            )
        if (searchExhausted) {
            val reopenAttempts = reelProfileReopenAttempts[fallbackKey] ?: 0
            val sinceLastLaunch = System.currentTimeMillis() -
                (reelProfileLastLaunchAt[fallbackKey] ?: 0L)
            if (reopenAttempts < PROFILE_REOPEN_LIMIT && sinceLastLaunch < PROFILE_REOPEN_SETTLE_MS) {
                scheduleNext(PROFILE_REOPEN_SETTLE_MS - sinceLastLaunch)
                return
            }

            if (reopenAttempts < PROFILE_REOPEN_LIMIT) {
                reelProfileReopenAttempts[fallbackKey] = reopenAttempts + 1
                if (FacebookPostLauncher.launch(this, active.job)) {
                    reelProfileLastLaunchAt[fallbackKey] = System.currentTimeMillis()
                    reelProfileAllTabAttempts.remove(fallbackKey)
                    reelProfileRefreshAttempts.remove(fallbackKey)
                    reelProfileScrollAttempts.remove(fallbackKey)
                    scheduleNext(PROFILE_REOPEN_SETTLE_MS)
                    return
                }
            }
        }

        val reason = when {
            staleProductUi -> "Facebook vẫn hiển thị menu/form của bài cũ"
            !looksLikeProfileTimeline(root) -> "Facebook chưa mở đúng profile/Page ở tab Tất cả"
            active.job.postText.isBlank() -> "Job video không có caption để xác nhận đúng bài"
            else -> "Không tìm thấy thẻ bài video có caption khớp đúng bài vừa đăng trên Page"
        }
        failStepAfter(
            active,
            PROFILE_POST_FAIL_TIMEOUT_MS,
            "$reason; Worker đã dừng để tránh gắn nhầm link",
        )
    }

    private fun openPostMenu(root: AccessibilityNodeInfo, active: ActiveJob) {
        // OPEN_MENU is reachable only after OPEN_POST has verified the detail
        // screen. If Facebook jumps elsewhere, fail closed instead of reusing a
        // product surface that may belong to an older post.
        if (looksLikeBoostPostScreen(root)) {
            JobStore.restartNavigation(this)
            performGlobalAction(GLOBAL_ACTION_BACK)
            FacebookPostLauncher.launch(this, active.job)
            scheduleNext(EXACT_POST_REOPEN_SETTLE_MS)
            return
        }
        if (hasProductLinkForm(root)) {
            JobStore.restartNavigation(this)
            FacebookPostLauncher.launch(this, active.job)
            scheduleNext(EXACT_POST_REOPEN_SETTLE_MS)
            return
        }
        val fallbackKey = "${active.job.id}:${active.job.attempt}"

        // Home must be rejected before examining any menu labels: a bottom sheet
        // left by an older post can temporarily be exposed on top of News Feed.
        if (looksLikeFacebookHomeFeed(root) && !looksLikeProfileTimeline(root)) {
            JobStore.restartNavigation(this)
            FacebookPostLauncher.launch(this, active.job)
            scheduleNext(EXACT_POST_REOPEN_SETTLE_MS)
            return
        }

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
            if (!menuTapDispatched.contains(fallbackKey)) {
                JobStore.restartNavigation(this)
                FacebookPostLauncher.launch(this, active.job)
                scheduleNext(EXACT_POST_REOPEN_SETTLE_MS)
                return
            }
            JobStore.setStep(this, AutomationStep.OPEN_LINK_MANAGER)
            scheduleNext(250)
            return
        }

        if (isVideoJob(active)) {
            openPageVideoPostMenu(root, active, fallbackKey)
            return
        }

        // Facebook may silently redirect an exact permalink to another post.
        // Re-check identity immediately before every menu tap instead of trusting
        // the detail screen that OPEN_POST saw a moment earlier.
        if (!looksLikeExactPostDetail(root, active)) {
            JobStore.restartNavigation(this)
            FacebookPostLauncher.launch(this, active.job)
            scheduleNext(EXACT_POST_REOPEN_SETTLE_MS)
            return
        }

        val semanticTapAttempts = menuSemanticTapAttempts[fallbackKey] ?: 0
        val fallbackTapAttempts = menuFallbackTapAttempts[fallbackKey] ?: 0
        val anchorYFraction = findPostHeaderAnchorYFraction(root)
        val tapTargets = postMenuTapTargets(anchorYFraction)

        val button = findPostMenuByGeometry(root, anchorYFraction)
            ?: findBestNode(root, POST_MENU_BUTTON_KEYWORDS)
        if (button != null && semanticTapAttempts < POST_MENU_SEMANTIC_TAP_LIMIT) {
            // Facebook can report ACTION_CLICK as accepted without actually opening
            // the menu. Dispatch a real accessibility gesture at the detected node
            // first, and retry it before using screen-coordinate fallbacks.
            val gestureDispatched = tapNodeByGesture(button)
            val clicked = if (!gestureDispatched) click(button) else false
            menuSemanticTapAttempts[fallbackKey] = semanticTapAttempts + 1
            if (gestureDispatched || clicked) {
                menuTapDispatched.add(fallbackKey)
            }
            scheduleNext(if (gestureDispatched || clicked) 1_000 else 450)
            return
        }

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
                menuTapDispatched.add(fallbackKey)
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

    private fun openPageVideoPostMenu(
        root: AccessibilityNodeInfo,
        active: ActiveJob,
        fallbackKey: String,
    ) {
        val anchorY = if (looksLikeProfileTimeline(root)) {
            findProfilePostAnchorY(root, active.job.postText)
        } else {
            null
        }
        if (anchorY == null) {
            JobStore.restartNavigation(this)
            FacebookPostLauncher.launch(this, active.job)
            scheduleNext(PROFILE_REOPEN_SETTLE_MS)
            return
        }
        val semanticAttempts = menuSemanticTapAttempts[fallbackKey] ?: 0
        val fallbackAttempts = menuFallbackTapAttempts[fallbackKey] ?: 0
        val button = findProfilePostMenuButton(root, anchorY)
        if (button != null && semanticAttempts < PROFILE_MENU_SEMANTIC_TAP_LIMIT) {
            val gestureDispatched = tapNodeByGesture(button)
            val clicked = if (!gestureDispatched) click(button) else false
            menuSemanticTapAttempts[fallbackKey] = semanticAttempts + 1
            if (gestureDispatched || clicked) menuTapDispatched.add(fallbackKey)
            scheduleNext(if (gestureDispatched || clicked) 1_000 else 450)
            return
        }

        if (
            elapsedInStep(active) >= 1_200
            && fallbackAttempts < PROFILE_MENU_FALLBACK_LIMIT
        ) {
            menuFallbackTapAttempts[fallbackKey] = fallbackAttempts + 1
            if (tapPostMenuByGesture(anchorY)) {
                menuTapDispatched.add(fallbackKey)
                scheduleNext(1_200)
                return
            }
        }

        failStepAfter(
            active,
            PROFILE_MENU_FAIL_TIMEOUT_MS,
            "Không tìm thấy dấu ba chấm của đúng bài video khớp caption trên Page. ${postMenuDiagnostics(root)}",
        )
    }

    private fun openLinkManager(root: AccessibilityNodeInfo, active: ActiveJob) {
        val navigationKey = "${active.job.id}:${active.job.attempt}"
        val urlFormAlreadyVisible = hasProductLinkForm(root)
        if (urlFormAlreadyVisible) {
            // A URL form left open by an older job is not evidence that this job
            // opened its own product manager. Never paste a new SKU into it.
            if (navigationKey !in linkManagerNavigationProof) {
                JobStore.restartNavigation(this)
                FacebookPostLauncher.launch(this, active.job)
                scheduleNext(EXACT_POST_REOPEN_SETTLE_MS)
                return
            }
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
                linkManagerNavigationProof.add(navigationKey)
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
                    linkManagerNavigationProof.add(navigationKey)
                    scheduleNext(1_500)
                    return
                }
            }
            failStepAfter(
                active,
                40_000,
                "Không mở được mục Thêm sản phẩm liên kết tiếp thị",
            )
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
                linkManagerNavigationProof.add(navigationKey)
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
        if (urlInput == null) {
            failStepAfter(active, 20_000, "Không tìm thấy đúng ô URL")
            return
        }
        if (fieldContainsExpectedValue(urlInput, active.job.shopeeUrl)) {
            JobStore.setStep(this, AutomationStep.FILL_NAME)
            scheduleNext(350)
            return
        }
        if (setText(urlInput, active.job.shopeeUrl)) {
            scheduleNext(600)
            return
        }
        failStepAfter(active, 20_000, "Không nhập hoặc xác nhận được URL Shopee")
    }

    private fun fillName(root: AccessibilityNodeInfo, active: ActiveJob) {
        val inputs = findEditableNodes(root)
        val nameInput = inputs.firstOrNull {
            val label = nodeLabel(it)
            label.contains("Tên liên kết", ignoreCase = true)
                || label.contains("Link name", ignoreCase = true)
        }

        if (nameInput == null) {
            failStepAfter(active, 15_000, "Không tìm thấy đúng ô Tên liên kết")
            return
        }
        if (fieldContainsExpectedValue(nameInput, active.job.linkName)) {
            JobStore.setStep(this, AutomationStep.SAVE)
            scheduleNext(350)
            return
        }
        if (setText(nameInput, active.job.linkName)) {
            scheduleNext(600)
            return
        }
        failStepAfter(active, 15_000, "Không nhập được tên liên kết")
    }

    private fun saveLink(root: AccessibilityNodeInfo, active: ActiveJob) {
        val saveButton = findExactNode(
            root,
            listOf("Lưu", "Save"),
            visibleOnly = true,
        )
        if (saveButton != null) {
            val clicked = click(saveButton)
            val gestureDispatched = if (!clicked) tapNodeByGesture(saveButton) else false
            if (clicked || gestureDispatched) {
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
            visibleOnly = true,
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
        val formStillVisible = exactSaveButtonVisible || findEditableNodes(root).any { node ->
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
            visibleOnly = true,
        ) != null
        val successConfirmationVisible = findBestNode(
            root,
            PRODUCT_LINK_SUCCESS_HINTS,
            visibleOnly = true,
        ) != null
        val productLinkSurfaceVisible = hasProductLinkSurface(root)
        val savedLinkEvidenceVisible = productLinkSurfaceVisible &&
            listOf(active.job.linkName, active.job.shopeeUrl)
            .filter { it.isNotBlank() }
            .let { evidence ->
                evidence.isNotEmpty() && findBestNode(
                    root,
                    evidence,
                    visibleOnly = true,
                ) != null
            }
        val positiveSaveEvidence = returnedToProductPage
            || successConfirmationVisible
            || savedLinkEvidenceVisible

        val verifyFallbackKey = "${active.job.id}:${active.job.attempt}:verify-save"
        if (
            formStillVisible
            && elapsedInStep(active) >= 3_000
            && saveRetryAttempts.add(verifyFallbackKey)
        ) {
            val saveButton = findExactNode(
                root,
                listOf("Lưu", "Save"),
                visibleOnly = true,
            )
            val clicked = saveButton?.let { click(it) } == true
            val gestureDispatched = if (!clicked) {
                saveButton?.let { tapNodeByGesture(it) } == true
            } else {
                false
            }
            if (clicked || gestureDispatched) {
                scheduleNext(2_000)
                return
            }
        }

        if (
            !formStillVisible
            && positiveSaveEvidence
            && elapsedInStep(active) >= VERIFY_FORM_CLOSED_SUCCESS_MS
        ) {
            JobStore.markForReport(
                this,
                success = true,
                message = if (returnedToProductPage) {
                    "Đã gắn link Shopee và quay lại trang quản lý sản phẩm"
                } else if (successConfirmationVisible) {
                    "Facebook xác nhận đã lưu link Shopee"
                } else {
                    "Đã thấy link Shopee vừa lưu trên Facebook"
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
                    "Facebook đã đóng form nhưng không có bằng chứng liên kết được lưu"
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

    private fun fieldContainsExpectedValue(
        node: AccessibilityNodeInfo,
        expected: String,
    ): Boolean = expected.isNotBlank() &&
        node.text?.toString()?.trim() == expected.trim()

    private fun visiblePostHeaderAnchorYFractions(root: AccessibilityNodeInfo): List<Float> {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)

        val width = resources.displayMetrics.widthPixels
        val height = resources.displayMetrics.heightPixels
        if (width <= 0 || height <= 0) return emptyList()

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
            .distinctBy { (it * 1_000).toInt() }
            .sorted()
            .toList()
    }

    private fun findPostHeaderAnchorYFraction(root: AccessibilityNodeInfo): Float? =
        visiblePostHeaderAnchorYFractions(root).firstOrNull()

    private data class ProfilePostAnchor(
        val yFraction: Float,
        val nearbyText: String,
    )

    private fun looksLikeProfileTimeline(root: AccessibilityNodeInfo): Boolean {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        val height = resources.displayMetrics.heightPixels
        if (height <= 0) return false

        fun hasTab(labels: List<String>): Boolean = nodes.any { node ->
            if (!node.isVisibleToUser) return@any false
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            val normalized = nodeLabel(node).trim()
            !bounds.isEmpty
                && bounds.centerY() < height * 0.58f
                && labels.any { label ->
                    normalized.equals(label, ignoreCase = true)
                        || normalized.startsWith("$label ", ignoreCase = true)
                        || normalized.startsWith("$label,", ignoreCase = true)
                }
        }

        return hasTab(PROFILE_ALL_TAB_LABELS)
            && hasTab(PROFILE_PHOTOS_TAB_LABELS)
            && hasTab(PROFILE_REELS_TAB_LABELS)
    }

    private fun findProfileTab(
        root: AccessibilityNodeInfo,
        labels: List<String>,
    ): AccessibilityNodeInfo? {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        val height = resources.displayMetrics.heightPixels
        if (height <= 0) return null
        return nodes.firstOrNull { node ->
            if (!node.isVisibleToUser) return@firstOrNull false
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            val normalized = nodeLabel(node).trim()
            !bounds.isEmpty
                && bounds.centerY() < height * 0.58f
                && labels.any { label ->
                    normalized.equals(label, ignoreCase = true)
                        || normalized.startsWith("$label ", ignoreCase = true)
                        || normalized.startsWith("$label,", ignoreCase = true)
                }
        }
    }

    private fun findProfilePostAnchorY(
        root: AccessibilityNodeInfo,
        postText: String,
    ): Float? {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        val width = resources.displayMetrics.widthPixels
        val height = resources.displayMetrics.heightPixels
        if (width <= 0 || height <= 0) return null

        val ageAnchors = nodes
            .asSequence()
            .filter { it.isVisibleToUser }
            .mapNotNull { node ->
                val label = listOfNotNull(
                    node.text?.toString(),
                    node.contentDescription?.toString(),
                ).joinToString(" ").trim()
                if (label.isBlank() || label.length > 140 || !POST_AGE_PATTERN.containsMatchIn(label)) {
                    return@mapNotNull null
                }

                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                if (
                    bounds.isEmpty
                    || bounds.centerX() > width * 0.78f
                    || bounds.centerY() < height * 0.12f
                    || bounds.centerY() > height * 0.72f
                ) {
                    return@mapNotNull null
                }

                node to bounds.centerY().toFloat()
            }
            .distinctBy { (_, centerY) -> (centerY / height * 100).toInt() }
            .sortedBy { (_, centerY) -> centerY }
            .toList()
        if (ageAnchors.isEmpty()) return null

        val anchors = ageAnchors.mapIndexed { index, (ageNode, centerY) ->
            // A caption rendered above this header belongs to the previous card.
            // The old implementation included 10% of the screen above centerY,
            // which is exactly how it paired one post's caption with the next
            // post's three-dot menu. Only read the isolated accessibility subtree
            // and the band from this header down to the next post header.
            val bandTop = centerY - height * 0.01f
            val nextHeaderY = ageAnchors.getOrNull(index + 1)?.second
            val bandBottom = minOf(
                nextHeaderY?.minus(height * 0.035f) ?: height * 0.98f,
                height * 0.98f,
            )
            val bandText = nodes
                .asSequence()
                .filter { it.isVisibleToUser }
                .mapNotNull { nearby ->
                    val nearbyBounds = Rect()
                    nearby.getBoundsInScreen(nearbyBounds)
                    val nearbyLabel = nodeLabel(nearby).trim()
                    if (
                        nearbyBounds.isEmpty
                        || nearbyBounds.centerY().toFloat() !in bandTop..bandBottom
                        || nearbyBounds.centerX() > width * 0.96f
                        || nearbyLabel.isBlank()
                        || nearbyLabel.length > 500
                    ) {
                        null
                    } else {
                        nearbyLabel
                    }
                }
                .distinct()
                .take(24)
                .joinToString(" ")
            val cardText = isolatedProfileCardText(ageNode, centerY, width, height)

            ProfilePostAnchor(
                yFraction = centerY / height,
                nearbyText = listOf(cardText, bandText)
                    .filter { it.isNotBlank() }
                    .distinct()
                    .joinToString(" "),
            )
        }

        val matchIndex = ReelProfilePolicy.strongCaptionMatchIndex(
            postText,
            anchors.map(ProfilePostAnchor::nearbyText),
        ) ?: return null
        return anchors[matchIndex].yFraction
    }

    /**
     * Finds the largest visible ancestor that still contains one post header.
     * Once an ancestor contains two age labels it spans multiple feed cards and
     * must not be used as identity evidence.
     */
    private fun isolatedProfileCardText(
        ageNode: AccessibilityNodeInfo,
        anchorY: Float,
        width: Int,
        height: Int,
    ): String {
        var current = ageNode.parent
        var bestText = ""
        repeat(PROFILE_CARD_ANCESTOR_LIMIT) {
            val ancestor = current ?: return@repeat
            val bounds = Rect()
            ancestor.getBoundsInScreen(bounds)
            val descendants = mutableListOf<AccessibilityNodeInfo>()
            collectNodes(ancestor, descendants)
            val agePositions = descendants
                .asSequence()
                .filter { it.isVisibleToUser }
                .mapNotNull { node ->
                    val label = nodeLabel(node).trim()
                    if (label.length > 140 || !POST_AGE_PATTERN.containsMatchIn(label)) {
                        return@mapNotNull null
                    }
                    val nodeBounds = Rect()
                    node.getBoundsInScreen(nodeBounds)
                    nodeBounds.centerY().takeUnless { nodeBounds.isEmpty }
                }
                .distinctBy { (it.toFloat() / height * 100).toInt() }
                .toList()
            if (agePositions.size != 1 || kotlin.math.abs(agePositions.first() - anchorY) > height * 0.04f) {
                return@repeat
            }

            if (
                !bounds.isEmpty
                && bounds.width() >= width * 0.65f
                && bounds.height() <= height * 0.85f
            ) {
                bestText = descendants
                    .asSequence()
                    .filter { it.isVisibleToUser }
                    .map { nodeLabel(it).trim() }
                    .filter { it.isNotBlank() && it.length <= 500 }
                    .distinct()
                    .take(40)
                    .joinToString(" ")
            }
            current = ancestor.parent
        }
        return bestText
    }

    private fun findProfilePostMenuButton(
        root: AccessibilityNodeInfo,
        anchorYFraction: Float,
    ): AccessibilityNodeInfo? {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        val width = resources.displayMetrics.widthPixels
        val height = resources.displayMetrics.heightPixels
        if (width <= 0 || height <= 0) return null

        val targetX = width * POST_MENU_X_FRACTION
        val targetY = height * anchorYFraction
        val yTolerance = maxOf(48f, height * 0.075f)
        return nodes
            .asSequence()
            .filter { it.isVisibleToUser }
            .mapNotNull { node ->
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                val label = nodeLabel(node).trim().lowercase()
                val semanticMatch = POST_MENU_LABEL_HINTS.any { hint -> label.contains(hint) }
                    || label == "menu"
                val looksInteractive = node.isClickable
                    || node.parent?.isClickable == true
                    || node.className?.toString()?.contains("Button", ignoreCase = true) == true
                    || node.className?.toString()?.contains("ImageView", ignoreCase = true) == true
                val excluded = POST_MENU_EXCLUDED_LABELS.any { hint -> label.contains(hint) }
                if (
                    bounds.isEmpty
                    || bounds.centerX() < width * 0.75f
                    || kotlin.math.abs(bounds.centerY() - targetY) > yTolerance
                    || bounds.width() > width * 0.24f
                    || bounds.height() > height * 0.12f
                    || !looksInteractive
                    || excluded
                    || (!semanticMatch && (label.isNotBlank() || bounds.centerX() < width * 0.86f))
                ) {
                    null
                } else {
                    val score = kotlin.math.abs(bounds.centerX() - targetX)
                        + kotlin.math.abs(bounds.centerY() - targetY) * 2f
                        + if (semanticMatch) -220f else 0f
                    node to score
                }
            }
            .minByOrNull { it.second }
            ?.first
    }

    private fun isVideoJob(active: ActiveJob): Boolean =
        FacebookPostLauncher.isPageVideoJob(active.job)

    private fun hasProductLinkForm(root: AccessibilityNodeInfo): Boolean {
        val inputs = findEditableNodes(root)
        val hasUrlInput = inputs.any { node ->
            nodeLabel(node).contains("url", ignoreCase = true)
        }
        if (!hasUrlInput) return false

        return findBestNode(
            root,
            listOf(
                "Thêm liên kết sản phẩm",
                "Tên liên kết",
                "Add product link",
                "Link name",
            ),
            visibleOnly = true,
        ) != null
    }

    private fun hasProductLinkSurface(root: AccessibilityNodeInfo): Boolean {
        if (hasProductLinkForm(root)) return true
        return findBestNode(
            root,
            listOf(
                "Quản lý liên kết đến sản phẩm",
                "Quản lý sản phẩm",
                "Thêm sản phẩm liên kết tiếp thị",
                "Manage product links",
                "Manage products",
                "Add affiliate product",
            ),
            visibleOnly = true,
        ) != null
    }

    /** Verifies a dedicated detail screen for non-Reel posts. */
    private fun looksLikeExactPostDetail(
        root: AccessibilityNodeInfo,
        active: ActiveJob,
    ): Boolean {
        if (!looksLikeRegularPostDetail(root) || active.job.postText.isBlank()) return false
        return ReelProfilePolicy.hasStrongCaptionMatch(
            active.job.postText,
            collectVisibleScreenText(root),
        )
    }

    private fun collectVisibleScreenText(root: AccessibilityNodeInfo): String {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        return nodes
            .asSequence()
            .filter { it.isVisibleToUser }
            .map { nodeLabel(it).trim() }
            .filter { it.isNotBlank() && it.length <= 1_000 }
            .distinct()
            .take(120)
            .joinToString(" ")
    }

    private fun looksLikeRegularPostDetail(root: AccessibilityNodeInfo): Boolean {
        if (looksLikeBoostPostScreen(root)) return false

        val hasPostAge = findPostHeaderAnchorYFraction(root) != null
        if (!hasPostAge) return false

        val hasCommentComposer = findBestNode(
            root,
            COMMENT_COMPOSER_HINTS,
            visibleOnly = true,
        ) != null
        val hasPostMenu = findBestNode(
            root,
            POST_MENU_BUTTON_KEYWORDS,
            visibleOnly = true,
        ) != null
        return hasCommentComposer || hasPostMenu
    }

    private fun looksLikeBoostPostScreen(root: AccessibilityNodeInfo): Boolean {
        val title = findBestNode(root, BOOST_POST_SCREEN_TITLES, visibleOnly = true)
        val action = findBestNode(root, BOOST_POST_SCREEN_ACTIONS, visibleOnly = true)
        return title != null && action != null
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
        if (anchorYFraction == null) return emptyList()
        return listOf(-0.025f, 0f, 0.025f)
            .map { offset -> (anchorYFraction + offset).coerceIn(0.12f, 0.48f) }
            .distinctBy { (it * 1000).toInt() }
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

    private fun refreshProfileTimelineByGesture(): Boolean {
        val width = resources.displayMetrics.widthPixels.toFloat()
        val height = resources.displayMetrics.heightPixels.toFloat()
        return swipeScreen(
            startX = width * 0.50f,
            startY = height * 0.30f,
            endX = width * 0.50f,
            endY = height * 0.72f,
            durationMs = 450L,
        )
    }

    private fun revealProfilePostsByGesture(): Boolean {
        val width = resources.displayMetrics.widthPixels.toFloat()
        val height = resources.displayMetrics.heightPixels.toFloat()
        return swipeScreen(
            startX = width * 0.50f,
            startY = height * 0.78f,
            endX = width * 0.50f,
            endY = height * 0.42f,
            durationMs = 360L,
        )
    }

    private fun swipeScreen(
        startX: Float,
        startY: Float,
        endX: Float,
        endY: Float,
        durationMs: Long,
    ): Boolean {
        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    private fun tapScreenPoint(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
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
        private const val PROFILE_MENU_SEMANTIC_TAP_LIMIT = 3
        private const val PROFILE_MENU_FALLBACK_LIMIT = 2
        private const val PROFILE_CARD_ANCESTOR_LIMIT = 8
        private const val PROFILE_ALL_TAB_TAP_LIMIT = 1
        private const val PROFILE_REFRESH_LIMIT = 1
        private const val PROFILE_SEARCH_SCROLL_LIMIT = 2
        private const val PROFILE_REOPEN_LIMIT = 2
        private const val AFFILIATE_PRODUCT_TAP_LIMIT = 3
        private const val EXACT_POST_FIRST_RETRY_MS = 1_200L
        private const val EXACT_POST_REOPEN_SETTLE_MS = 2_000L
        private const val EXACT_POST_FAIL_TIMEOUT_MS = 65_000L
        private const val PROFILE_FIRST_RETRY_MS = 1_200L
        private const val PROFILE_REFRESH_START_MS = 2_500L
        private const val PROFILE_SCROLL_START_MS = 4_500L
        private const val PROFILE_REOPEN_SETTLE_MS = 2_500L
        private const val PROFILE_POST_FAIL_TIMEOUT_MS = 65_000L
        private const val PROFILE_MENU_FAIL_TIMEOUT_MS = 35_000L
        private const val VERIFY_FORM_CLOSED_SUCCESS_MS = 5_000L
        private const val FACEBOOK_PACKAGE = "com.facebook.katana"
        private const val EVENT_SETTLE_MS = 600L
        private const val ROOT_RETRY_MS = 500L
        private const val POST_MENU_X_FRACTION = 0.936f
        private val PROFILE_ALL_TAB_LABELS = listOf("Tất cả", "All")
        private val PROFILE_PHOTOS_TAB_LABELS = listOf("Ảnh", "Photos")
        private val PROFILE_REELS_TAB_LABELS = listOf("Reels")
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
        private val COMMENT_COMPOSER_HINTS = listOf(
            "Bình luận dưới tên",
            "Viết bình luận",
            "Write a comment",
            "Comment as",
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
            "quảng cáo",
            "quảng bá",
            "boost post",
            "promote post",
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
        private val BOOST_POST_SCREEN_TITLES = listOf(
            "Quảng bá bài viết",
            "Boost post",
            "Promote post",
        )
        private val BOOST_POST_SCREEN_ACTIONS = listOf(
            "Quảng cáo bài viết ngay",
            "Bắt đầu xác thực",
            "Boost post now",
            "Start verification",
        )
        private val PRODUCT_LINK_SUCCESS_HINTS = listOf(
            "Đã lưu liên kết",
            "Đã thêm liên kết sản phẩm",
            "Liên kết sản phẩm đã được lưu",
            "Product link saved",
            "Product link added",
            "Link saved",
        )
    }
}
