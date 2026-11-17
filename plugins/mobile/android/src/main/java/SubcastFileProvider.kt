package ai.qiaomu.subcast.mobileplugin

import androidx.core.content.FileProvider

/** Its own class, so it doesn't collide with the app's FileProvider entry when the manifests merge. */
class SubcastFileProvider : FileProvider()
