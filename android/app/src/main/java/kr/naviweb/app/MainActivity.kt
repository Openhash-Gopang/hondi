package kr.naviweb.app

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import com.google.androidbrowserhelper.trusted.LauncherActivity
import com.google.firebase.messaging.FirebaseMessaging

/**
 * 나비웹 웹앱을 TWA(주소창 없는 전체 화면)로 연다.
 * - 첫 실행: 알림 권한 → 배터리 최적화 예외 안내(사용자 동의 후)
 * - 실행 시 FCM 토큰을 가져와 시작 주소에 ?fcm=<토큰> 으로 붙인다(웹이 지갑 서명으로 서버에 등록하고 주소에서 지운다).
 */
class MainActivity : LauncherActivity() {

    private var launched = false

    // 토큰을 기다린 뒤 직접 launchTwa() 를 부른다.
    override fun shouldLaunchImmediately(): Boolean = false

    override fun getLaunchingUrl(): Uri {
        val base = super.getLaunchingUrl()
        val t = Prefs.token(this) ?: return base
        return base.buildUpon().appendQueryParameter("fcm", t).build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Prefs.setupDone(this)) proceed() else showSetupDialog()
    }

    private fun showSetupDialog() {
        AlertDialog.Builder(this)
            .setTitle(R.string.setup_title)
            .setMessage(R.string.setup_body)
            .setCancelable(false)
            .setPositiveButton(R.string.setup_ok) { _, _ -> Prefs.markSetupDone(this); askNotificationPermission() }
            .setNegativeButton(R.string.setup_later) { _, _ -> proceed() }
            .show()
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTI)
        } else {
            askBatteryExemption()
        }
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        super.onRequestPermissionsResult(code, perms, res)
        if (code == REQ_NOTI) askBatteryExemption()
    }

    private fun askBatteryExemption() {
        val pm = getSystemService(PowerManager::class.java)
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            try {
                startActivityForResult(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")),
                    REQ_BATTERY
                )
                return
            } catch (e: Exception) { /* 일부 제조사는 막혀 있다 — 그냥 진행 */ }
        }
        proceed()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_BATTERY) proceed()
    }

    private fun proceed() {
        if (launched) return
        // 토큰 조회가 늦어도 3초 뒤에는 열린다(저장된 토큰이 있으면 그것을 쓴다).
        val handler = Handler(Looper.getMainLooper())
        val go = Runnable { launchOnce() }
        handler.postDelayed(go, 3000)
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (task.isSuccessful) task.result?.let { Prefs.saveToken(this, it) }
                handler.removeCallbacks(go)
                launchOnce()
            }
        } catch (e: Exception) {
            handler.removeCallbacks(go)
            launchOnce()
        }
    }

    private fun launchOnce() {
        if (launched || isFinishing) return
        launched = true
        launchTwa()
    }

    companion object {
        private const val REQ_NOTI = 1001
        private const val REQ_BATTERY = 1002
    }
}
