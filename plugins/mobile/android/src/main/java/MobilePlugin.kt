package ai.qiaomu.subcast.mobileplugin

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.view.HapticFeedbackConstants
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class ShareArgs {
    var text: String? = null
    var path: String? = null
    var mime: String? = null
    var title: String? = null
}

@InvokeArg
class NowPlayingArgs {
    var title: String = ""
    var artist: String? = null
    var artwork: String? = null
    var duration: Double? = null
    var position: Double? = null
    var rate: Double? = null
    var playing: Boolean = false
}

/** Background audio (a media-playback foreground service), the media notification and the share sheet. */
@TauriPlugin
class MobilePlugin(private val activity: Activity) : Plugin(activity) {
    private var askedNotifications = false
    private var pluginWebView: WebView? = null

    override fun load(webView: WebView) {
        pluginWebView = webView
        // Media buttons in the notification / on a headset come back to the page as the `remote` event.
        PlaybackService.onRemote = { action, position ->
            val data = JSObject()
            data.put("action", action)
            if (position != null) data.put("position", position)
            trigger("remote", data)
        }
        // A web view keeps playing in the background only if its timers and media are not paused with the activity.
        webView.settings.mediaPlaybackRequiresUserGesture = false
        // Edge-to-edge: Android's web view reports no env(safe-area-inset-*), so the page gets the status bar and
        // gesture bar heights as CSS variables (in CSS pixels).
        ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val d = v.resources.displayMetrics.density
            safeTop = bars.top / d
            safeBottom = bars.bottom / d
            v.post { webView.evaluateJavascript("document.documentElement.style.setProperty('--safe-top','${safeTop}px');document.documentElement.style.setProperty('--safe-bottom','${safeBottom}px');", null) }
            insets
        }
        webView.requestApplyInsets()
    }

    private var safeTop = 0f
    private var safeBottom = 0f

    /** The bar heights, for a page that loaded after the insets arrived. */
    @Command
    fun insets(invoke: Invoke) {
        val r = JSObject()
        r.put("top", safeTop.toDouble())
        r.put("bottom", safeBottom.toDouble())
        invoke.resolve(r)
    }

    @Command
    fun nowPlaying(invoke: Invoke) {
        val args = invoke.parseArgs(NowPlayingArgs::class.java)
        if (args.playing && !askedNotifications && Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askedNotifications = true
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7301)
        }
        PlaybackService.update(activity, PlaybackService.Info(args.title, args.artist, args.artwork, args.duration ?: 0.0, args.position ?: 0.0, args.rate ?: 1.0, args.playing))
        invoke.resolve()
    }

    @Command
    fun clearNowPlaying(invoke: Invoke) {
        PlaybackService.stop(activity)
        invoke.resolve()
    }

    @Command
    fun selectionFeedback(invoke: Invoke) {
        val target = pluginWebView ?: activity.window?.decorView
        target?.post { target.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
        invoke.resolve()
    }

    @Command
    fun share(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        val intent = Intent(Intent.ACTION_SEND)
        var file: File? = args.path?.let { File(it) }
        val text = args.text
        if (file == null && text != null && text.length > 2000 && args.title != null) {
            // Long text (an OPML export) goes as a file.
            file = File(activity.cacheDir, args.title!!).apply { writeText(text) }
        }
        if (file != null) {
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".subcast.files", file)
            intent.type = args.mime ?: if (file.name.endsWith(".png")) "image/png" else "text/plain"
            intent.putExtra(Intent.EXTRA_STREAM, uri)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } else if (text != null) {
            intent.type = "text/plain"
            intent.putExtra(Intent.EXTRA_TEXT, text)
        } else {
            invoke.reject("nothing to share"); return
        }
        args.title?.let { intent.putExtra(Intent.EXTRA_SUBJECT, it) }
        activity.startActivity(Intent.createChooser(intent, args.title))
        invoke.resolve()
    }
}
