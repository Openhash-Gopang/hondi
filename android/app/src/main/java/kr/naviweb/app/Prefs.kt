package kr.naviweb.app

import android.content.Context

object Prefs {
    private const val FILE = "navi"
    private fun p(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    fun saveToken(c: Context, t: String) = p(c).edit().putString("fcm_token", t).apply()
    fun token(c: Context): String? = p(c).getString("fcm_token", null)
    fun setupDone(c: Context) = p(c).getBoolean("setup_done", false)
    fun markSetupDone(c: Context) = p(c).edit().putBoolean("setup_done", true).apply()
}
