package io.openfront.android

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.Activity
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ScrollView
import android.widget.Toast

/**
 * OpenFront Android skeleton.
 *
 * Loads the official OpenFront web client from the chosen game server inside a
 * fullscreen WebView. The client already handles mobile touch controls, so the
 * shell only needs to: pick a server, host the WebView, and wire Android back
 * navigation to the game UI.
 *
 * Design notes:
 * - Zero AndroidX dependencies on purpose (skeleton builds anywhere).
 * - The game server itself serves index.html with the correct
 *   window.BOOTSTRAP_CONFIG for its environment, so no config is duplicated
 *   here: whichever server you pick serves a matching client+config pair.
 * - BOOTSTRAP_CONFIG.serverHost (used by the desktop shell) is only needed
 *   when loading the client from somewhere other than the game server; that
 *   is a later phase (bundled client build).
 */
class MainActivity : Activity() {

    private lateinit var webview: WebView
    private lateinit var picker: ScrollView
    private lateinit var root: FrameLayout

    private var currentHost: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        root = findViewById(R.id.root)
        picker = findViewById(R.id.picker)
        webview = findViewById(R.id.webview)

        webview.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        }
        webview.webChromeClient = WebChromeClient()
        webview.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                // Keep the game in-process; open foreign links externally.
                val url = request.url.toString()
                val host = request.url.host ?: return false
                val sameHost = host == currentHost
                return if (sameHost || host.endsWith("openfront.io") ||
                    host.endsWith("openfront.dev")
                ) {
                    false
                } else {
                    openExternally(url)
                    true
                }
            }
        }

        findViewById<Button>(R.id.btn_official).setOnClickListener {
            connect("https://openfront.io")
        }
        findViewById<Button>(R.id.btn_staging).setOnClickListener {
            connect("https://main.openfront.dev")
        }
        findViewById<Button>(R.id.btn_custom).setOnClickListener { promptCustom() }

        if (savedInstanceState != null) {
            // Process death: WebView restores its own back/forward history.
            picker.visibility = View.GONE
            webview.visibility = View.VISIBLE
            webview.restoreState(savedInstanceState)
        }
    }

    private fun promptCustom() {
        val input = EditText(this)
        input.hint = getString(R.string.custom_hint)
        input.setSingleLine()
        AlertDialog.Builder(this)
            .setTitle(R.string.server_picker_title)
            .setView(input)
            .setPositiveButton(R.string.connect) { _, _ ->
                var raw = input.text.toString().trim()
                if (raw.isEmpty()) return@setPositiveButton
                if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
                    raw = "http://$raw"
                }
                connect(raw)
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun connect(url: String) {
        currentHost = runCatching { java.net.URI(url).host }.getOrNull()
        picker.visibility = View.GONE
        webview.visibility = View.VISIBLE
        webview.loadUrl(url)
        Toast.makeText(this, url, Toast.LENGTH_SHORT).show()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (webview.visibility == View.VISIBLE) {
            webview.saveState(outState)
        }
    }

    private fun openExternally(url: String) {
        runCatching {
            startActivity(
                android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)),
            )
        }
    }

    private fun showPicker() {
        webview.visibility = View.GONE
        picker.visibility = View.VISIBLE
    }

    override fun onBackPressed() {
        when {
            webview.visibility == View.VISIBLE && webview.canGoBack() -> webview.goBack()
            webview.visibility == View.VISIBLE -> showPicker()
            else -> super.onBackPressed()
        }
    }

    override fun onPause() {
        super.onPause()
        webview.onPause()
    }

    override fun onResume() {
        super.onResume()
        webview.onResume()
    }

    override fun onDestroy() {
        webview.destroy()
        super.onDestroy()
    }
}
