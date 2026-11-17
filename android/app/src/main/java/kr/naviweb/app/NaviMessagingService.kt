package kr.naviweb.app

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * 서버가 보내는 data 메시지(title/body/tag/url/sound/channel)를 받아 알림을 그린다.
 * 알림 내용은 로그에 남기지 않는다.
 */
class NaviMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        // 웹 쪽 등록(지갑 서명)은 다음 앱 실행 때 MainActivity 가 토큰을 넘겨 처리한다.
        Prefs.saveToken(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        val channel = when (d["channel"]) {
            NaviApp.CH_CALLS, NaviApp.CH_SYSTEM -> d["channel"]!!
            else -> NaviApp.CH_MESSAGES
        }
        val tag = d["tag"].orEmpty()
        val target = resolveUrl(d["url"])

        val open = Intent(Intent.ACTION_VIEW, Uri.parse(target))
            .setClass(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pi = PendingIntent.getActivity(
            this, (tag.ifEmpty { target }).hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val nb = NotificationCompat.Builder(this, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(d["title"] ?: getString(R.string.app_name))
            .setContentText(d["body"].orEmpty())
            .setStyle(NotificationCompat.BigTextStyle().bigText(d["body"].orEmpty()))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(if (channel == NaviApp.CH_CALLS) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .also { if (channel == NaviApp.CH_CALLS) it.setCategory(NotificationCompat.CATEGORY_MESSAGE) }

        val nm = NotificationManagerCompat.from(this)
        if (!nm.areNotificationsEnabled()) {
            Log.w(TAG, "알림 권한이 꺼져 있어 표시하지 못했습니다")
            return
        }
        try {
            // tag 가 같으면 같은 알림을 갱신, 없으면 새로 쌓는다.
            nm.notify(tag.ifEmpty { null }, if (tag.isEmpty()) System.currentTimeMillis().toInt() else 1, nb.build())
        } catch (e: SecurityException) {
            Log.w(TAG, "알림 표시 거부(SecurityException)")
        }
    }

    // 서버 url 은 상대경로이거나 app.naviweb.kr 일 수 있다 → naviweb.kr 로 맞추고, 다른 호스트는 기본 화면으로.
    private fun resolveUrl(raw: String?): String {
        val fallback = BuildConfig.WEB_ORIGIN + "/webapp.html?pwa=1"
        if (raw.isNullOrBlank()) return fallback
        return try {
            val u = Uri.parse(raw)
            when {
                u.host == null && raw.startsWith("/") -> BuildConfig.WEB_ORIGIN + raw
                u.scheme == "https" && (u.host == "naviweb.kr" || u.host == "app.naviweb.kr") ->
                    u.buildUpon().authority("naviweb.kr").build().toString()
                else -> fallback
            }
        } catch (e: Exception) { fallback }
    }

    companion object { private const val TAG = "NaviFcm" }
}
