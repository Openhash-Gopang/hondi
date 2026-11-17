package kr.naviweb.app

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
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

    private lateinit var status: TextView
    private lateinit var openBtn: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildLaunchScreen()
        if (Prefs.setupDone(this)) proceed() else showSetupDialog()
    }

    // 웹앱(TWA)이 열리지 않아도 빈 화면으로 멈추지 않게, 보이는 안내 화면과 "브라우저로 열기" 버튼을 둔다.
    private fun buildLaunchScreen() {
        val pad = (24 * resources.displayMetrics.density).toInt()
        status = TextView(this).apply { text = "나비웹을 여는 중…"; textSize = 18f; setTextColor(Color.parseColor("#222222")); gravity = Gravity.CENTER }
        openBtn = Button(this).apply {
            text = "브라우저로 열기"; visibility = android.view.View.GONE
            setOnClickListener { openInBrowser() }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#F9B91C")); setPadding(pad, pad, pad, pad)
            addView(status); addView(openBtn)
        })
    }

    private fun showFallback(msg: String) {
        status.text = msg
        openBtn.visibility = android.view.View.VISIBLE
    }

    private fun openInBrowser() {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://naviweb.kr/webapp.html?pwa=1")))
        } catch (e: Exception) {
            showFallback("열 수 있는 브라우저가 없습니다: " + e.javaClass.simpleName)
        }
    }

    override fun onResume() {
        super.onResume()
        // 웹앱이 이미 한 번 열렸다가 이 화면으로 돌아온 경우(열기 실패·닫힘): 빈 화면 대신 안내를 보인다.
        if (launched && ::status.isInitialized) showFallback("웹앱이 열리지 않았습니다.\n아래 버튼으로 브라우저에서 열어 주세요.")
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
        try {
            launchTwa()
            // 4초가 지나도 이 화면이 그대로 보이면 열리지 않은 것 — 안내를 띄운다.
            Handler(Looper.getMainLooper()).postDelayed({
                if (!isFinishing && !isDestroyed) showFallback("웹앱이 열리지 않았습니다.\n아래 버튼으로 브라우저에서 열어 주세요.")
            }, 4000)
        } catch (e: Exception) {
            showFallback("웹앱을 열지 못했습니다: " + e.javaClass.simpleName + " " + (e.message ?: ""))
        }
    }

    companion object {
        private const val REQ_NOTI = 1001
        private const val REQ_BATTERY = 1002
    }
}
