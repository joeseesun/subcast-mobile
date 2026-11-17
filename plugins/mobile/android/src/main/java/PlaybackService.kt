package ai.qiaomu.subcast.mobileplugin

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.net.URL
import kotlin.concurrent.thread

/**
 * Keeps SubCast alive while it plays (Android stops background apps otherwise) and shows the media
 * notification. The audio itself plays in the web view; this only mirrors its state and forwards buttons.
 */
class PlaybackService : Service() {
    data class Info(val title: String, val artist: String?, val artwork: String?, val duration: Double, val position: Double, val rate: Double, val playing: Boolean)

    companion object {
        private const val CHANNEL = "subcast-playback"
        private const val ID = 7300
        private const val ACTION = "ai.qiaomu.subcast.ACTION"
        var onRemote: ((String, Double?) -> Unit)? = null
        @Volatile private var info: Info? = null
        @Volatile private var running = false
        private var art: Pair<String, Bitmap>? = null

        fun update(ctx: Context, i: Info) {
            info = i
            val intent = Intent(ctx, PlaybackService::class.java)
            if (!running && i.playing) {
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent) else ctx.startService(intent)
            } else if (running) {
                ctx.startService(intent)
            }
        }

        fun stop(ctx: Context) {
            info = null
            if (running) ctx.stopService(Intent(ctx, PlaybackService::class.java))
        }
    }

    private lateinit var session: MediaSessionCompat
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        if (Build.VERSION.SDK_INT >= 26) {
            val ch = NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW)
            ch.setShowBadge(false)
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
        session = MediaSessionCompat(this, "SubCast")
        session.setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() { onRemote?.invoke("play", null) }
            override fun onPause() { onRemote?.invoke("pause", null) }
            override fun onFastForward() { onRemote?.invoke("forward", null) }
            override fun onRewind() { onRemote?.invoke("back", null) }
            override fun onSkipToNext() { onRemote?.invoke("forward", null) }
            override fun onSkipToPrevious() { onRemote?.invoke("back", null) }
            override fun onSeekTo(pos: Long) { onRemote?.invoke("seek", pos / 1000.0) }
            override fun onStop() { onRemote?.invoke("pause", null) }
        })
        session.isActive = true
        wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SubCast:playback")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.getStringExtra(ACTION)?.let { onRemote?.invoke(it, null) }
        val i = info
        if (i == null) { stopSelf(); return START_NOT_STICKY }
        render(i)
        return START_NOT_STICKY
    }

    private fun button(icon: Int, title: String, action: String): NotificationCompat.Action {
        val pi = PendingIntent.getService(this, action.hashCode(), Intent(this, PlaybackService::class.java).putExtra(ACTION, action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Action(icon, title, pi)
    }

    private fun render(i: Info) {
        val meta = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, i.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, i.artist ?: "")
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (i.duration * 1000).toLong())
        val bitmap = art?.takeIf { it.first == i.artwork }?.second
        if (bitmap != null) meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, bitmap)
        else if (i.artwork != null) loadArt(i.artwork)
        session.setMetadata(meta.build())
        session.setPlaybackState(PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SEEK_TO or PlaybackStateCompat.ACTION_FAST_FORWARD or PlaybackStateCompat.ACTION_REWIND or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
            .setState(if (i.playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED, (i.position * 1000).toLong(), if (i.playing) i.rate.toFloat() else 0f)
            .build())

        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(i.title)
            .setContentText(i.artist ?: "")
            .setLargeIcon(bitmap)
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(i.playing)
            .addAction(button(android.R.drawable.ic_media_rew, "-15s", "back"))
            .addAction(if (i.playing) button(android.R.drawable.ic_media_pause, "Pause", "pause") else button(android.R.drawable.ic_media_play, "Play", "play"))
            .addAction(button(android.R.drawable.ic_media_ff, "+30s", "forward"))
            .setStyle(MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
            .build()
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
        ServiceCompat.startForeground(this, ID, n, type)
        if (i.playing) { if (wake?.isHeld == false) wake?.acquire(6 * 60 * 60 * 1000L) }
        else {
            if (wake?.isHeld == true) wake?.release()
            // Paused: the notification stays (to resume) but can be swiped away.
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
        }
    }

    private fun loadArt(url: String) {
        thread {
            try {
                val bmp = URL(url).openStream().use { BitmapFactory.decodeStream(it) } ?: return@thread
                val scaled = Bitmap.createScaledBitmap(bmp, 256, 256 * bmp.height / maxOf(1, bmp.width), true)
                art = url to scaled
                info?.let { i -> if (i.artwork == url) android.os.Handler(mainLooper).post { if (running) render(i) } }
            } catch (_: Exception) {}
        }
    }

    override fun onDestroy() {
        running = false
        if (wake?.isHeld == true) wake?.release()
        session.isActive = false
        session.release()
        super.onDestroy()
    }
}
