package vn.zenwatch.mobileworker

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var serverUrlInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var startOnBootCheck: CheckBox
    private lateinit var statusText: TextView
    private val handler = Handler(Looper.getMainLooper())

    private val refreshStatus = object : Runnable {
        override fun run() {
            renderStatus()
            handler.postDelayed(this, 1_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverUrlInput = findViewById(R.id.serverUrlInput)
        tokenInput = findViewById(R.id.tokenInput)
        startOnBootCheck = findViewById(R.id.startOnBootCheck)
        statusText = findViewById(R.id.statusText)

        val settings = WorkerConfig.load(this)
        serverUrlInput.setText(settings.serverUrl)
        tokenInput.setText(settings.token)
        startOnBootCheck.isChecked = settings.startOnBoot

        findViewById<Button>(R.id.saveButton).setOnClickListener {
            saveSettings(showToast = true)
        }
        findViewById<Button>(R.id.testButton).setOnClickListener {
            testConnection()
        }
        findViewById<Button>(R.id.accessibilityButton).setOnClickListener {
            showAccessibilityDisclosure()
        }
        findViewById<Button>(R.id.batteryButton).setOnClickListener {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
        findViewById<Button>(R.id.startButton).setOnClickListener {
            val saved = saveSettings(showToast = false)
            if (!WorkerConfig.isValid(saved)) {
                toast("Hãy nhập URL HTTPS và token tối thiểu 16 ký tự")
                return@setOnClickListener
            }
            if (!WorkerConfig.isAccessibilityEnabled(this)) {
                toast("Hãy bật quyền Trợ năng trước")
                showAccessibilityDisclosure()
                return@setOnClickListener
            }
            requestNotificationPermission()
            MobileWorkerService.start(this)
            toast("Đã bắt đầu Worker")
        }
        findViewById<Button>(R.id.stopButton).setOnClickListener {
            stopService(Intent(this, MobileWorkerService::class.java))
            toast("Đã dừng Worker")
        }
    }

    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(refreshStatus)
        handler.post(refreshStatus)
    }

    override fun onPause() {
        handler.removeCallbacks(refreshStatus)
        super.onPause()
    }

    private fun saveSettings(showToast: Boolean): WorkerSettings {
        val settings = WorkerSettings(
            serverUrl = serverUrlInput.text.toString(),
            token = tokenInput.text.toString(),
            startOnBoot = startOnBootCheck.isChecked,
        )
        WorkerConfig.save(this, settings)
        if (showToast) toast("Đã lưu cấu hình")
        return settings
    }

    private fun testConnection() {
        val settings = saveSettings(showToast = false)
        if (!WorkerConfig.isValid(settings)) {
            toast("URL phải là HTTPS và token tối thiểu 16 ký tự")
            return
        }
        statusText.text = "Đang kiểm tra kết nối…"
        Thread {
            val message = try {
                MobileWorkerApi(settings).health()
            } catch (error: Exception) {
                "Kết nối thất bại: ${error.message}"
            }
            runOnUiThread { statusText.text = message }
        }.start()
    }

    private fun showAccessibilityDisclosure() {
        AlertDialog.Builder(this)
            .setTitle("Quyền Trợ năng được dùng thế nào?")
            .setMessage(
                "App chỉ đọc các nhãn nút đang hiển thị trong ứng dụng Facebook " +
                    "và thực hiện chuỗi thao tác cố định: mở menu bài viết, mở mục " +
                    "quản lý liên kết sản phẩm, nhập URL Shopee và bấm Lưu.\n\n" +
                    "App không đọc tin nhắn, mật khẩu, danh bạ hoặc nội dung của ứng dụng khác. " +
                    "Tác vụ và kết quả chỉ được gửi tới máy chủ bạn cấu hình.",
            )
            .setNegativeButton("Hủy", null)
            .setPositiveButton("Tôi đồng ý và tiếp tục") { _, _ ->
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
            .show()
    }

    private fun renderStatus() {
        val settings = WorkerConfig.load(this)
        val accessibility = WorkerConfig.isAccessibilityEnabled(this)
        val active = JobStore.load(this)
        val lines = mutableListOf<String>()
        lines += if (MobileWorkerService.isRunning) "Worker: đang chạy" else "Worker: đã dừng"
        lines += if (accessibility) "Trợ năng: đã bật" else "Trợ năng: chưa bật"
        lines += if (WorkerConfig.isValid(settings)) "Cấu hình: hợp lệ" else "Cấu hình: chưa hoàn tất"
        lines += "Thiết bị: ${WorkerConfig.deviceId(this)}"
        if (active != null) {
            lines += "Job: ${active.job.id}"
            lines += "Bước: ${active.step.name}"
        }
        if (MobileWorkerService.lastStatus.isNotBlank()) {
            lines += MobileWorkerService.lastStatus
        }
        if (MobileWorkerService.lastJobResult.isNotBlank()) {
            lines += "Kết quả gần nhất: ${MobileWorkerService.lastJobResult}"
        }
        statusText.text = lines.joinToString("\n")
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}
