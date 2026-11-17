package kr.naviweb.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

class NaviApp : Application() {
    override fun onCreate() {
        super.onCreate()
        initFirebase()
        createChannels(this)
    }

    // google-services.json 없이 공개 설정값(BuildConfig)으로 직접 초기화한다.
    private fun initFirebase() {
        if (BuildConfig.FIREBASE_API_KEY.isBlank()) {
            Log.w(TAG, "FIREBASE_API_KEY 미설정 — 푸시 토큰을 받을 수 없습니다 (firebase-config.properties)")
        }
        if (FirebaseApp.getApps(this).isNotEmpty()) return
        val opts = FirebaseOptions.Builder()
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .setApplicationId(BuildConfig.FIREBASE_APP_ID)
            .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
            .setApiKey(BuildConfig.FIREBASE_API_KEY.ifBlank { "missing" })
            .build()
        FirebaseApp.initializeApp(this, opts)
    }

    companion object {
        private const val TAG = "NaviApp"
        const val CH_CALLS = "calls"
        const val CH_MESSAGES = "messages"
        const val CH_SYSTEM = "system"

        // 서버(fcm-push.js channelForTag)가 보내는 channel 값과 이름을 맞춘다.
        fun createChannels(app: Application) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = app.getSystemService(NotificationManager::class.java)
            val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()

            nm.createNotificationChannel(NotificationChannel(
                CH_CALLS, app.getString(R.string.channel_calls), NotificationManager.IMPORTANCE_HIGH
            ).apply {
                enableVibration(true)
                setSound(sound, attrs)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            })
            nm.createNotificationChannel(NotificationChannel(
                CH_MESSAGES, app.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_DEFAULT
            ))
            nm.createNotificationChannel(NotificationChannel(
                CH_SYSTEM, app.getString(R.string.channel_system), NotificationManager.IMPORTANCE_LOW
            ))
        }
    }
}
