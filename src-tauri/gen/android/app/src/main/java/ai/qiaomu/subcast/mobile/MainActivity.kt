package ai.qiaomu.subcast.mobile

import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  private var appWebView: WebView? = null
  private var videoFullscreen = false

  // App handles in-page back navigation (sheets, dialogs, episode/show history) instead of WebView history.
  override val handleBackNavigation: Boolean = false

  private inner class AndroidBridge {
    @JavascriptInterface
    fun setFullscreen(on: Boolean) {
      runOnUiThread { setVideoFullscreen(on) }
    }
  }

  /** Switches between immersive landscape video full screen (with SubCast bilingual subtitles) and normal portrait. */
  fun setVideoFullscreen(on: Boolean) {
    if (videoFullscreen == on) return
    videoFullscreen = on
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    if (on) {
      window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      controller.hide(WindowInsetsCompat.Type.systemBars())
    } else {
      window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      controller.show(WindowInsetsCompat.Type.systemBars())
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT)
    )
    super.onCreate(savedInstanceState)

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (videoFullscreen) {
          setVideoFullscreen(false)
          appWebView?.evaluateJavascript("window.__subcastTheater && window.__subcastTheater(false)", null)
          return
        }
        val wv = appWebView
        if (wv == null) {
          moveTaskToBack(true)
          return
        }
        wv.evaluateJavascript("window.__subcastBack ? window.__subcastBack() : false") { result ->
          if (result != "true") {
            // Keep background podcast playback alive instead of finishing the activity.
            moveTaskToBack(true)
          }
        }
      }
    })
  }

  override fun onWebViewCreate(webView: WebView) {
    appWebView = webView
    webView.addJavascriptInterface(AndroidBridge(), "SubcastAndroid")
    // Intercept YouTube's built-in fullscreen button (onShowCustomView) and route it to SubCast's landscape theater
    // mode so bilingual subtitles remain rendered on top of the full-screen video.
    val delegate = webView.webChromeClient
    webView.webChromeClient = object : WebChromeClient() {
      override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
        // Release YouTube's opaque custom view and expand SubCast's own theater container in landscape instead.
        callback?.onCustomViewHidden()
        runOnUiThread {
          val next = !videoFullscreen
          setVideoFullscreen(next)
          webView.evaluateJavascript("window.__subcastTheater && window.__subcastTheater($next)", null)
        }
      }

      override fun onHideCustomView() {
        runOnUiThread {
          if (videoFullscreen) {
            setVideoFullscreen(false)
            webView.evaluateJavascript("window.__subcastTheater && window.__subcastTheater(false)", null)
          }
        }
      }

      override fun getDefaultVideoPoster(): Bitmap? = delegate?.defaultVideoPoster ?: super.getDefaultVideoPoster()
      override fun onPermissionRequest(request: PermissionRequest?) { if (delegate != null) delegate.onPermissionRequest(request) else super.onPermissionRequest(request) }
      override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) { if (delegate != null) delegate.onGeolocationPermissionsShowPrompt(origin, callback) else super.onGeolocationPermissionsShowPrompt(origin, callback) }
      override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean = delegate?.onJsAlert(view, url, message, result) ?: super.onJsAlert(view, url, message, result)
      override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean = delegate?.onJsConfirm(view, url, message, result) ?: super.onJsConfirm(view, url, message, result)
      override fun onJsPrompt(view: WebView?, url: String?, message: String?, defaultValue: String?, result: JsPromptResult?): Boolean = delegate?.onJsPrompt(view, url, message, defaultValue, result) ?: super.onJsPrompt(view, url, message, defaultValue, result)
      override fun onShowFileChooser(wv: WebView?, filePathCallback: ValueCallback<Array<Uri>>?, fileChooserParams: FileChooserParams?): Boolean = delegate?.onShowFileChooser(wv, filePathCallback, fileChooserParams) ?: super.onShowFileChooser(wv, filePathCallback, fileChooserParams)
      override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean = delegate?.onConsoleMessage(consoleMessage) ?: super.onConsoleMessage(consoleMessage)
      override fun onReceivedTitle(view: WebView?, title: String?) { if (delegate != null) delegate.onReceivedTitle(view, title) else super.onReceivedTitle(view, title) }
    }
  }
}
