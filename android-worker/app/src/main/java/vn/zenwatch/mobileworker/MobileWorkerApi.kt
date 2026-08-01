package vn.zenwatch.mobileworker

import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class MobileWorkerApi(private val settings: WorkerSettings) {
    private data class Response(val code: Int, val body: String)

    fun health(): String {
        val response = request("GET", "/api/mobile-worker/health")
        if (response.code !in 200..299) throw apiError(response)
        val json = JSONObject(response.body)
        return "Kết nối thành công • server ${json.optString("serverTime")}"
    }

    fun claimNext(deviceId: String): MobileLinkJob? {
        val encodedDeviceId = URLEncoder.encode(deviceId, StandardCharsets.UTF_8.name())
        val response = request(
            "GET",
            "/api/mobile-worker/jobs/next?deviceId=$encodedDeviceId",
        )
        if (response.code == HttpURLConnection.HTTP_NO_CONTENT) return null
        if (response.code !in 200..299) throw apiError(response)
        return MobileLinkJob.fromJson(JSONObject(response.body).getJSONObject("job"))
    }

    fun heartbeat(jobId: String, deviceId: String) {
        val body = JSONObject().put("deviceId", deviceId)
        val response = request(
            "POST",
            "/api/mobile-worker/jobs/${encodePath(jobId)}/heartbeat",
            body,
        )
        if (response.code !in 200..299) throw apiError(response)
    }

    fun report(jobId: String, deviceId: String, status: String, message: String) {
        val body = JSONObject()
            .put("deviceId", deviceId)
            .put("status", status)
            .put("message", message)
        val response = request(
            "POST",
            "/api/mobile-worker/jobs/${encodePath(jobId)}/result",
            body,
        )
        if (response.code !in 200..299) throw apiError(response)
    }

    private fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
    ): Response {
        val baseUri = URI(settings.serverUrl.trimEnd('/'))
        require(baseUri.scheme.equals("https", ignoreCase = true)) {
            "Máy chủ phải dùng HTTPS"
        }

        val connection = baseUri.resolve(path).toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Authorization", "Bearer ${settings.token}")
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "ZenWatch-Mobile-Worker/$WORKER_VERSION")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { output ->
                    output.write(body.toString().toByteArray(StandardCharsets.UTF_8))
                }
            }

            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            return Response(code, responseBody)
        } finally {
            connection.disconnect()
        }
    }

    private fun apiError(response: Response): IllegalStateException {
        val detail = try {
            val json = JSONObject(response.body)
            json.optString("error", json.optString("message", response.body))
        } catch (_: Exception) {
            response.body
        }
        return IllegalStateException("HTTP ${response.code}: ${detail.take(240)}")
    }

    private fun encodePath(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")

    companion object {
        private const val WORKER_VERSION = "0.2.3"
    }
}
