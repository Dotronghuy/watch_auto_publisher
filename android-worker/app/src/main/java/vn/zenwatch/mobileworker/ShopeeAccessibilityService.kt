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
    private val tickGate = AutomationTickGate()
    private val processRunnable = Runnable {
        tickGate.reset()
        processCurrentStep()
    }
    private var trackedAttemptKey: String? = null
    private val saveConfirmations = mutableSetOf<String>()
    private val menuSemanticTapAttempts = mutableMapOf<String, Int>()
    private val menuTapDispatched = mutableSetOf<String>()
    private val linkManagerNavigationProof = mutableSetOf<String>()
    private val saveRetryAttempts = mutableSetOf<String>()
    private val exactPostReopenTargets = mutableMapOf<String, Int>()
    private val exactPostLastLaunchAt = mutableMapOf<String, Long>()

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.packageName?.toString() != FACEBOOK_PACKAGE) return
        if (!MobileWorkerService.isRunning) return
        val active = JobStore.load(this) ?: return
        if (active.step == AutomationStep.REPORTING) return
        if (active.step == AutomationStep.VERIFY && MobileWorkerService.canAutomate(active.job)) {
            val labels = event.text.map { it.toString() } + listOfNotNull(event.contentDescription?.toString())
            if (ProductLinkUiPolicy.hasExactLabel(labels, PRODUCT_LINK_SUCCESS_HINTS)) {
                saveConfirmations.add(active.job.attemptKey)
            }
        }
        // Do not push an existing tick back on every animation/content event.
        if (tickGate.request()) handler.postDelayed(processRunnable, EVENT_SETTLE_MS)
    }

    override fun onInterrupt() = Unit

    override fun onServiceConnected() {
        super.onServiceConnected()
        clearAttemptState()
        MobileWorkerService.automationSession.pause()
        JobStore.load(this)?.let { active ->
            if (active.step != AutomationStep.REPORTING) {
                JobStore.restartNavigation(this)
            }
        }
        scheduleNext(EVENT_SETTLE_MS)
    }

    override fun onDestroy() {
        handler.removeCallbacks(processRunnable)
        tickGate.reset()
        MobileWorkerService.automationSession.pause()
        clearAttemptState()
        super.onDestroy()
    }

    private fun clearAttemptState() {
        saveConfirmations.clear()
        menuSemanticTapAttempts.clear()
        menuTapDispatched.clear()
        linkManagerNavigationProof.clear()
        saveRetryAttempts.clear()
        exactPostReopenTargets.clear()
        exactPostLastLaunchAt.clear()
    }

    private fun processCurrentStep() {
        if (!MobileWorkerService.isRunning) {
            clearAttemptState()
            trackedAttemptKey = null
            return
        }
        val active = JobStore.load(this)
        if (active == null || active.step == AutomationStep.REPORTING) {
            clearAttemptState()
            trackedAttemptKey = null
            return
        }
        if (trackedAttemptKey != active.job.attemptKey) {
            clearAttemptState()
            trackedAttemptKey = active.job.attemptKey
        }
        if (!MobileWorkerService.canAutomate(active.job)) {
            clearAttemptState()
            scheduleNext(ROOT_RETRY_MS)
            return
        }
        val root = rootInActiveWindow
        if (root == null || root.packageName?.toString() != FACEBOOK_PACKAGE) {
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

    /** Open the job's direct URL and wait for the post/video menu surface; no caption comparison. */
    private fun openExactPost(root: AccessibilityNodeInfo, active: ActiveJob) {
        val key = active.job.attemptKey
        if (elapsedInStep(active) < DIRECT_OPEN_SETTLE_MS) {
            scheduleNext(DIRECT_OPEN_SETTLE_MS - elapsedInStep(active))
            return
        }
        val staleProductUi = hasProductLinkSurface(root) || isReelOptionsMenuVisible(root)
        val wrongDestination = looksLikeFacebookHomeFeed(root) || looksLikeProfileTimeline(root)
        val boostPostUi = looksLikeBoostPostScreen(root)
        val currentTarget = exactPostReopenTargets[key] ?: 0

        if (!staleProductUi && !wrongDestination && !boostPostUi &&
            findDirectMenuControl(root, active) != null) {
            menuSemanticTapAttempts.remove(key)
            menuTapDispatched.remove(key)
            linkManagerNavigationProof.remove(key)
            saveRetryAttempts.remove("$key:verify-save")
            JobStore.setStep(this, AutomationStep.OPEN_MENU)
            scheduleNext(350)
            return
        }
        if (elapsedInStep(active) < EXACT_POST_FIRST_RETRY_MS) {
            scheduleNext(500)
            return
        }
        val sinceLastLaunch = System.currentTimeMillis() - (exactPostLastLaunchAt[key] ?: 0L)
        if (sinceLastLaunch < EXACT_POST_REOPEN_SETTLE_MS) {
            scheduleNext(EXACT_POST_REOPEN_SETTLE_MS - sinceLastLaunch)
            return
        }
        val nextTarget = currentTarget + 1
        if (nextTarget < FacebookPostLauncher.targetCount(active.job)) {
            exactPostReopenTargets[key] = nextTarget
            menuTapDispatched.remove(key)
            linkManagerNavigationProof.remove(key)
            if (FacebookPostLauncher.launch(this, active.job, nextTarget)) {
                exactPostLastLaunchAt[key] = System.currentTimeMillis()
                scheduleNext(EXACT_POST_REOPEN_SETTLE_MS)
                return
            }
        }
        val reason = when {
            staleProductUi -> "Facebook vẫn hiển thị menu/form của bài cũ"
            wrongDestination -> "Link đích bị Facebook chuyển về Feed/profile"
            boostPostUi -> "Facebook mở nhầm màn Quảng bá bài viết"
            else -> "Đã mở link đích nhưng chưa nhận diện được nút ba chấm của bài/video"
        }
        failStepAfter(active, EXACT_POST_FAIL_TIMEOUT_MS,
            "$reason; chưa mở được quản lý sản phẩm. ${navigationDiagnostics(root, active)}")
    }

    private fun restartDirectNavigation(active: ActiveJob) {
        val key = active.job.attemptKey
        menuTapDispatched.remove(key)
        menuSemanticTapAttempts.remove(key)
        linkManagerNavigationProof.remove(key)
        exactPostReopenTargets.remove(key)
        exactPostLastLaunchAt[key] = System.currentTimeMillis()
        JobStore.restartNavigation(this)
        FacebookPostLauncher.launch(this, active.job)
        scheduleNext(EXACT_POST_REOPEN_SETTLE_MS)
    }

    private fun openPostMenu(root: AccessibilityNodeInfo, active: ActiveJob) {
        val key = active.job.attemptKey
        if (looksLikeBoostPostScreen(root) || hasProductLinkForm(root) ||
            looksLikeFacebookHomeFeed(root) || looksLikeProfileTimeline(root)) {
            restartDirectNavigation(active)
            return
        }
        val linkManagerAlreadyVisible = findExactNode(root, PRODUCT_MANAGER_LABELS, visibleOnly = true)
        if (linkManagerAlreadyVisible != null) {
            if (key !in menuTapDispatched) {
                restartDirectNavigation(active)
                return
            }
            JobStore.setStep(this, AutomationStep.OPEN_LINK_MANAGER)
            scheduleNext(250)
            return
        }
        // A menu opened by THIS attempt is valid, but it may not offer product linking.
        // Never reinterpret its Save/Share controls as the post options button.
        if (isReelOptionsMenuVisible(root)) {
            if (key !in menuTapDispatched) {
                restartDirectNavigation(active)
            } else {
                failStepAfter(active, 35_000,
                    "Menu của video đã mở nhưng chưa có mục quản lý sản phẩm; chưa gắn link")
            }
            return
        }
        val button = findDirectMenuControl(root, active)
        if (button == null) {
            // After a tap, give the menu time to populate; the detail surface may be hidden.
            if (key in menuTapDispatched) {
                failStepAfter(active, 35_000, "Đã mở tùy chọn nhưng không thấy mục quản lý sản phẩm")
            } else {
                restartDirectNavigation(active)
            }
            return
        }
        val attempts = menuSemanticTapAttempts[key] ?: 0
        val limit = FacebookMenuTapPolicy.attemptLimit(button.target.evidence)
        if (attempts < limit) {
            // Only a semantic menu node may receive ACTION_CLICK, never its Page/card
            // ancestor. Unknown header icons go straight to their exact tap location.
            val clicked = FacebookMenuTapPolicy.preferNodeClick(button.target.evidence, attempts) &&
                button.node?.let(::clickMenuNode) == true
            val dispatched = if (!clicked) tapAt(button.target.x, button.target.y) else false
            menuSemanticTapAttempts[key] = attempts + 1
            if (dispatched || clicked) menuTapDispatched.add(key)
            scheduleNext(if (dispatched || clicked) 1_000 else 450)
            return
        }
        failStepAfter(active, 35_000,
            "Không mở được tùy chọn của đúng bài/video. ${navigationDiagnostics(root, active)}")
    }

    private fun openLinkManager(root: AccessibilityNodeInfo, active: ActiveJob) {
        val navigationKey = "${active.job.id}:${active.job.attempt}"
        val urlFormAlreadyVisible = hasProductLinkForm(root)
        if (urlFormAlreadyVisible) {
            // A URL form left open by an older job is not evidence that this job
            // opened its own product manager. Never paste a new SKU into it.
            if (navigationKey !in linkManagerNavigationProof) {
                restartDirectNavigation(active)
                return
            }
            JobStore.setStep(this, AutomationStep.FILL_URL)
            scheduleNext(250)
            return
        }

        // Video/Reels has a second screen. Prefer its affiliate-product row before
        // looking for the first-level menu item, otherwise Facebook can expose the
        // page title as a misleading click candidate and the worker loops here.
        val affiliateProductButton = findExactNode(
            root,
            listOf(
                "Thêm sản phẩm liên kết tiếp thị",
                "Add affiliate product",
            ),
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

        val addProductPageVisible = findExactNode(
            root,
            listOf(
                "Thêm sản phẩm",
                "Add product",
            ),
            visibleOnly = true,
        ) != null
        if (addProductPageVisible) {
            // Do not guess a fixed coordinate when Facebook omits the affiliate row.
            failStepAfter(
                active,
                40_000,
                "Không mở được mục Thêm sản phẩm liên kết tiếp thị",
            )
            return
        }

        val linkManagerButton = findExactNode(
            root,
            listOf(
                "Quản lý liên kết đến sản phẩm",
                "Thêm liên kết sản phẩm",
                "Quản lý sản phẩm",
                "Manage product links",
                "Add product link",
                "Manage products",
            ),
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
        val urlInput = findProductField(inputs, listOf("url"), active.job.shopeeUrl)
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
        val nameInput = findProductField(inputs, listOf("Tên liên kết", "Link name"), active.job.linkName)

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
        val inputs = findEditableNodes(root)
        val urlInput = findProductField(inputs, listOf("url"), active.job.shopeeUrl)
        val nameInput = findProductField(inputs, listOf("Tên liên kết", "Link name"), active.job.linkName)
        if (urlInput == null || nameInput == null || urlInput == nameInput ||
            !fieldContainsExpectedValue(urlInput, active.job.shopeeUrl) ||
            !fieldContainsExpectedValue(nameInput, active.job.linkName)) {
            failStepAfter(active, 25_000, "Nội dung URL/tên liên kết đã thay đổi trước khi Lưu")
            return
        }
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
        val successConfirmationVisible = findBestNode(
            root,
            PRODUCT_LINK_SUCCESS_HINTS,
            visibleOnly = true,
        ) != null
        val productLinkSurfaceVisible = hasProductLinkSurface(root)
        if (successConfirmationVisible) saveConfirmations.add(active.job.attemptKey)
        val savedLinkEvidenceVisible = productLinkSurfaceVisible && findExactNode(
            root, listOf(active.job.shopeeUrl), visibleOnly = true,
        ) != null
        val positiveSaveEvidence = ProductLinkUiPolicy.saved(
            formStillVisible, active.job.attemptKey in saveConfirmations, savedLinkEvidenceVisible,
        )

        val verifyFallbackKey = "${active.job.id}:${active.job.attempt}:verify-save"
        if (
            formStillVisible
            && elapsedInStep(active) >= 3_000
            && saveRetryAttempts.add(verifyFallbackKey)
        ) {
            val inputs = findEditableNodes(root)
            val urlInput = findProductField(inputs, listOf("url"), active.job.shopeeUrl)
            val nameInput = findProductField(inputs, listOf("Tên liên kết", "Link name"), active.job.linkName)
            if (urlInput == null || nameInput == null || urlInput == nameInput ||
                !fieldContainsExpectedValue(urlInput, active.job.shopeeUrl) ||
                !fieldContainsExpectedValue(nameInput, active.job.linkName)) {
                JobStore.markForReport(this, false, "Form không còn đúng URL/tên liên kết khi thử Lưu lại")
                return
            }
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
                message = if (active.job.attemptKey in saveConfirmations) {
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
                    && ProductLinkUiPolicy.hasExactLabel(nodeTextLabels(node), keywords)
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
                && ProductLinkUiPolicy.hasExactLabel(nodeTextLabels(node), keywords)
        }
    }

    private fun findEditableNodes(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        return nodes.filter { node ->
            node.isVisibleToUser && node.isEnabled && (node.isEditable
                || node.className?.toString()?.contains("EditText", ignoreCase = true) == true
                || node.actionList.any { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT })
        }
    }

    private fun findProductField(
        inputs: List<AccessibilityNodeInfo>, keywords: List<String>, expected: String,
    ): AccessibilityNodeInfo? {
        val fields = inputs.map { ProductLinkField(nodeTextLabels(it) + listOfNotNull(it.viewIdResourceName), it.text?.toString().orEmpty()) }
        return ProductLinkUiPolicy.fieldIndex(fields, keywords, expected)?.let(inputs::get)
    }

    private fun fieldContainsExpectedValue(
        node: AccessibilityNodeInfo,
        expected: String,
    ): Boolean = expected.isNotBlank() &&
        node.text?.toString()?.trim() == expected.trim()

    private fun screenNodes(root: AccessibilityNodeInfo): Pair<List<AccessibilityNodeInfo>, List<FacebookScreenNode>> {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        val visible = nodes.filter { it.isVisibleToUser }
        return visible to visible.map { node ->
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            FacebookScreenNode(
                nodeTextLabels(node), bounds.left.toFloat(), bounds.top.toFloat(),
                bounds.right.toFloat(), bounds.bottom.toFloat(),
                node.isEnabled && (node.isClickable || node.parent?.isClickable == true ||
                    node.actionList.any { it.id == AccessibilityNodeInfo.ACTION_CLICK } ||
                    node.className?.toString()?.contains("Tab", true) == true ||
                    node.className?.toString()?.contains("Button", true) == true),
                iconLike = node.isEnabled && node.className?.toString()?.contains("Image", true) == true,
                resourceId = node.viewIdResourceName.orEmpty(),
            )
        }
    }

    private fun profileTabIndices(nodes: List<FacebookScreenNode>): Set<Int> =
        FacebookScreenPolicy.profileTabIndices(nodes,
            resources.displayMetrics.widthPixels.toFloat(), resources.displayMetrics.heightPixels.toFloat())

    private fun looksLikeProfileTimeline(root: AccessibilityNodeInfo): Boolean =
        profileTabIndices(screenNodes(root).second).isNotEmpty()

    private fun navigationDiagnostics(root: AccessibilityNodeInfo, active: ActiveJob): String {
        val snapshot = screenNodes(root).second
        val tabs = profileTabIndices(snapshot).size
        val headers = FacebookScreenPolicy.headerCenters(snapshot,
            resources.displayMetrics.widthPixels.toFloat(), resources.displayMetrics.heightPixels.toFloat()).size
        // No screen content or credentials: enough to distinguish routing from a selector rejection.
        return "job=${active.job.id.takeLast(10)} type=${active.job.contentType} tabs=$tabs headers=$headers"
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

    private data class MenuControl(val target: FacebookMenuTarget, val node: AccessibilityNodeInfo?)

    private fun findDirectMenuControl(root: AccessibilityNodeInfo, active: ActiveJob): MenuControl? {
        if (FacebookPostLauncher.targetCount(active.job) == 0) return null
        val (nodes, snapshot) = screenNodes(root)
        val width = resources.displayMetrics.widthPixels.toFloat()
        val height = resources.displayMetrics.heightPixels.toFloat()
        if (profileTabIndices(snapshot).isNotEmpty()) return null
        val target = if (isVideoJob(active) && FacebookScreenPolicy.hasVideoSurface(snapshot, height)) {
            FacebookScreenPolicy.directReelMenuTarget(snapshot, width, height)
        } else {
            FacebookScreenPolicy.directPostMenuTarget(snapshot, width, height)
        } ?: return null
        return MenuControl(target, target.nodeIndex?.let(nodes::get))
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

    private fun isReelOptionsMenuVisible(root: AccessibilityNodeInfo): Boolean {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        return nodes.any { node ->
            node.isVisibleToUser && REEL_OPTIONS_LABEL_HINTS.any { keyword ->
                nodeLabel(node).contains(keyword, ignoreCase = true)
            }
        }
    }

    private fun tapNodeByGesture(node: AccessibilityNodeInfo): Boolean {
        if (!automationAllowed() || !node.isVisibleToUser || !node.isEnabled) return false
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.isEmpty) return false

        return tapAt(bounds.exactCenterX(), bounds.exactCenterY())
    }

    private fun tapAt(x: Float, y: Float): Boolean {
        if (!automationAllowed() || x !in 0f..resources.displayMetrics.widthPixels.toFloat() ||
            y !in 0f..resources.displayMetrics.heightPixels.toFloat()) return false
        val path = Path().apply { moveTo(x, y) }
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

    private fun nodeTextLabels(node: AccessibilityNodeInfo): List<String> = listOfNotNull(
        node.text?.toString(),
        node.contentDescription?.toString(),
        node.hintText?.toString(),
    ).map(String::trim).filter(String::isNotBlank).distinct()

    private fun nodeLabel(node: AccessibilityNodeInfo): String =
        (nodeTextLabels(node) + listOfNotNull(node.viewIdResourceName)).joinToString(" ")

    private fun automationAllowed(): Boolean {
        val current = JobStore.load(this) ?: return false
        return current.reportStatus == null && MobileWorkerService.canAutomate(current.job)
    }

    private fun clickMenuNode(node: AccessibilityNodeInfo): Boolean {
        if (!automationAllowed() || !node.isVisibleToUser || !node.isEnabled) return false
        if (!node.isClickable &&
            node.actionList.none { it.id == AccessibilityNodeInfo.ACTION_CLICK }) return false
        return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun click(node: AccessibilityNodeInfo): Boolean {
        if (!automationAllowed() || !node.isVisibleToUser || !node.isEnabled) return false
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
        if (!automationAllowed()) return false
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
        tickGate.reset()
        if (tickGate.request()) handler.postDelayed(processRunnable, delayMs)
    }

    companion object {
        private const val DIRECT_OPEN_SETTLE_MS = 2_000L
        private const val EXACT_POST_FIRST_RETRY_MS = 6_000L
        private const val EXACT_POST_REOPEN_SETTLE_MS = 6_000L
        private const val EXACT_POST_FAIL_TIMEOUT_MS = 65_000L
        private const val VERIFY_FORM_CLOSED_SUCCESS_MS = 5_000L
        private const val FACEBOOK_PACKAGE = "com.facebook.katana"
        private const val EVENT_SETTLE_MS = 600L
        private const val ROOT_RETRY_MS = 500L
        private val PRODUCT_MANAGER_LABELS = listOf(
            "Quản lý liên kết đến sản phẩm", "Thêm liên kết sản phẩm", "Quản lý sản phẩm",
            "Thêm sản phẩm liên kết tiếp thị", "Manage product links", "Add product link",
            "Manage products", "Add affiliate product",
        )
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
