package sh.paseo.scroll

import android.graphics.Rect
import android.view.MotionEvent
import com.facebook.react.ReactPackage
import com.facebook.react.ViewManagerOnDemandReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.views.scroll.ReactScrollView
import com.facebook.react.views.scroll.ReactScrollViewManager

/** Keeps RN's scroll props, commands, events, and Fabric component unchanged. */
class PaseoScrollPackage : ReactPackage, ViewManagerOnDemandReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = emptyList()
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(PaseoScrollViewManager())
  override fun getViewManagerNames(context: ReactApplicationContext): Collection<String> =
    listOf(ReactScrollViewManager.REACT_CLASS)
  override fun createViewManager(context: ReactApplicationContext, name: String): ViewManager<*, *>? =
    if (name == ReactScrollViewManager.REACT_CLASS) PaseoScrollViewManager() else null
}

private class PaseoScrollViewManager : ReactScrollViewManager() {
  override fun createViewInstance(context: ThemedReactContext): ReactScrollView =
    PaseoScrollView(context)
}

private class PaseoScrollView(context: ThemedReactContext) : ReactScrollView(context) {
  // Both RN focus handling and Android selection visibility requests use this calculation.
  // Its coordinates ignore inversion. Keep focus/selection bookkeeping, but leave timeline
  // movement to user gestures and explicit scroll commands.
  override fun computeScrollDeltaToGetChildRectOnScreen(rect: Rect): Int =
    if (scaleY < 0) 0 else super.computeScrollDeltaToGetChildRectOnScreen(rect)

  // A `display: none` ancestor lays this view out at zero size but keeps its scroll offset.
  // Gesture Handler can still deliver a cancel here, and ScrollView answers it with a
  // springBack into the collapsed range: an animation to the top that plays once the view
  // is drawn again, such as while a retained mobile panel is dragged back into view.
  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean =
    isShown && super.onInterceptTouchEvent(ev)

  override fun onTouchEvent(ev: MotionEvent): Boolean = isShown && super.onTouchEvent(ev)
}
