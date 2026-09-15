package vn.zenwatch.mobileworker

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.Display
import android.annotation.TargetApi

/** Capture is transient. Copy only the header crop to CPU memory; always release GPU buffers. */
@TargetApi(30)
internal object MenuScreenshotReader {
    fun request(service: AccessibilityService, region: MenuImageRegion, width: Int, height: Int,
                result: (FacebookMenuTarget?, String) -> Unit) {
        service.takeScreenshot(Display.DEFAULT_DISPLAY, service.mainExecutor,
            object : AccessibilityService.TakeScreenshotCallback {
                override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
                    var wrapped: Bitmap? = null
                    var cropped: Bitmap? = null
                    var readable: Bitmap? = null
                    var target: FacebookMenuTarget? = null
                    var status = "Không thấy duy nhất ba chấm trong vùng đầu bài"
                    try {
                        if (SystemClock.uptimeMillis() - screenshot.timestamp !in 0..2_000L) {
                            status = "Ảnh màn hình đã cũ; không bấm"
                        } else {
                            wrapped = Bitmap.wrapHardwareBuffer(screenshot.hardwareBuffer, screenshot.colorSpace)
                            if (wrapped?.width == width && wrapped?.height == height) {
                                cropped = Bitmap.createBitmap(wrapped, region.left, region.top, region.width, region.height)
                                readable = cropped.copy(Bitmap.Config.ARGB_8888, false)
                                readable?.let { image ->
                                    val pixels = IntArray(region.width * region.height)
                                    try {
                                        image.getPixels(pixels, 0, region.width, 0, 0, region.width, region.height)
                                        target = PostMenuVisualPolicy.detect(pixels, region, width)
                                    } finally { pixels.fill(0) }
                                }
                            } else status = "Kích thước màn hình đã đổi; không bấm"
                        }
                    } catch (_: Exception) {
                        status = "Không đọc được vùng ảnh ba chấm; không bấm"
                    } finally {
                        readable?.recycle()
                        if (cropped !== readable && cropped !== wrapped) cropped?.recycle()
                        if (wrapped !== readable) wrapped?.recycle()
                        screenshot.hardwareBuffer.close()
                    }
                    result(target, status)
                }

                override fun onFailure(errorCode: Int) {
                    // Respect secure windows/access denial; do not try to bypass them.
                    result(null, "Android không cho đọc vùng ba chấm (mã $errorCode)")
                }
            })
    }
}
