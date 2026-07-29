package vn.zenwatch.mobileworker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        val settings = WorkerConfig.load(context)
        if (settings.startOnBoot && WorkerConfig.isValid(settings)) {
            MobileWorkerService.start(context)
        }
    }
}
