package expo.modules.datasaver

import android.content.Context
import android.net.ConnectivityManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Whether clips should autoplay: off while Data Saver is on for this app.
 * Android has no separate video auto-play setting; "Remove animations" is
 * read in JavaScript as Reduce Motion.
 */
class DataSaverModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GrindylocksDataSaver")

    AsyncFunction("getStateAsync") {
      val cm = appContext.reactContext?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
      val restricted = cm?.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
      mapOf("lowData" to restricted, "autoplayVideo" to true)
    }
  }
}
