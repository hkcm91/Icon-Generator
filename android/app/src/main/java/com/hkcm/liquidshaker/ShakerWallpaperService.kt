package com.hkcm.liquidshaker

import android.app.Presentation
import android.content.Context
import android.graphics.Canvas
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.Bundle
import android.service.wallpaper.WallpaperService
import android.util.Log
import android.view.Choreographer
import android.view.SurfaceHolder
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout

private const val TAG = "LiquidShaker"
private const val PAGE = "file:///android_asset/index.html"

/* A live wallpaper that is the web page, rather than a reimplementation of it.
 *
 * The physics, the optics and the look all live in ../../wallpaper/index.html
 * and are hard-won; porting them to Kotlin would mean maintaining two of
 * everything and having them disagree. So this hosts the page instead, and
 * its whole job is the three things a WallpaperService can do that a browser
 * tab cannot: put a view hierarchy into the wallpaper surface, feed it the
 * sensors directly, and stop it dead when the wallpaper is not on screen.
 */
class ShakerWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = ShakerEngine()

    private inner class ShakerEngine : Engine(), SensorEventListener {

        private var web: WebView? = null
        private var root: FrameLayout? = null

        // The hardware path.
        private var virtualDisplay: VirtualDisplay? = null
        private var presentation: Presentation? = null

        // The software fallback.
        private var softDrawing = false
        private var frameCallback: Choreographer.FrameCallback? = null

        private var pageReady = false
        private var hostDrivesClock = false
        private var surfaceW = 0
        private var surfaceH = 0

        private val sensors by lazy { getSystemService(Context.SENSOR_SERVICE) as SensorManager }
        private var spinZ = 0f      // gyroscope about the viewing axis, deg/s

        override fun onCreate(holder: SurfaceHolder) {
            super.onCreate(holder)
            setOffsetNotificationsEnabled(true)

            val w = WebView(this@ShakerWallpaperService)
            w.setBackgroundColor(0xFF0A5FD4.toInt())   // the ramp's deep blue, so
            w.settings.javaScriptEnabled = true         // no white flash on load
            w.settings.domStorageEnabled = true
            w.settings.mediaPlaybackRequiresUserGesture = false
            w.webViewClient = object : android.webkit.WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    pageReady = true
                    if (hostDrivesClock) js("window.__shaker&&window.__shaker.drive()")
                    else if (isVisible) js("window.__shaker&&window.__shaker.resume()")
                }
            }
            w.loadUrl(PAGE)
            web = w

            root = FrameLayout(this@ShakerWallpaperService).apply {
                addView(w, ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT))
            }
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            surfaceW = width
            surfaceH = height
            teardownHost()
            startHost(holder, width, height)
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            teardownHost()
            super.onSurfaceDestroyed(holder)
        }

        override fun onDestroy() {
            stopSensors()
            teardownHost()
            web?.destroy()
            web = null
            super.onDestroy()
        }

        /* ------------------------------------------------------------ hosting
         *
         * A WallpaperService hands out a Surface, not a place to put views, so
         * the view hierarchy has to be got into that surface somehow.
         *
         * The good way is a virtual display backed by the wallpaper surface
         * with a Presentation on it: the WebView is then a normal attached,
         * hardware-accelerated view and the compositor does the work. The
         * catch is that a Presentation is a Dialog, and a Dialog wants a
         * window token that a Service does not have — whether that is refused
         * depends on the platform version and the vendor.
         *
         * So it is attempted, and if the window is refused the engine falls
         * back to drawing the WebView into the surface by hand each frame.
         * That path always works and is slower, because a WebView drawn into
         * a canvas it is not attached to renders in software.
         */
        private fun startHost(holder: SurfaceHolder, width: Int, height: Int) {
            val content = root ?: return
            val dm = getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
            val density = resources.displayMetrics.densityDpi

            var vd: VirtualDisplay? = null
            try {
                vd = dm.createVirtualDisplay(
                    "liquid-shaker", width, height, density, holder.surface,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION or
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY)
                    ?: throw IllegalStateException("no virtual display")

                val p = Presentation(this@ShakerWallpaperService, vd.display)
                p.setContentView(content)
                p.show()

                virtualDisplay = vd
                presentation = p
                softDrawing = false
                Log.i(TAG, "hosting the page on a virtual display (hardware accelerated)")
            } catch (t: Throwable) {
                Log.w(TAG, "presentation refused, drawing the page by hand instead", t)
                /* Release it here rather than through the field: if show() threw,
                 * the field was never assigned, and a virtual display left alive
                 * still owns the surface the fallback is about to lock. */
                vd?.release()
                virtualDisplay = null
                presentation = null
                startSoftDrawing(holder, width, height)
            }
        }

        private fun teardownHost() {
            stopSoftDrawing()
            presentation?.dismiss()
            presentation = null
            virtualDisplay?.release()
            virtualDisplay = null
            (root?.parent as? ViewGroup)?.removeView(root)
        }

        private fun startSoftDrawing(holder: SurfaceHolder, width: Int, height: Int) {
            val content = root ?: return
            val w = web ?: return
            w.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
            /* Hand the page's clock over. An unattached WebView has no vsync
             * to hang requestAnimationFrame off, so its loop either throttles
             * hard or never runs at all; this engine is already waking once a
             * frame to draw, so it steps the simulation itself. */
            if (pageReady) js("window.__shaker&&window.__shaker.drive()")
            hostDrivesClock = true
            content.measure(
                View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
            content.layout(0, 0, width, height)
            softDrawing = true

            val choreographer = Choreographer.getInstance()
            val cb = object : Choreographer.FrameCallback {
                override fun doFrame(frameTimeNanos: Long) {
                    if (!softDrawing) return
                    if (pageReady) js("window.__shaker&&window.__shaker.tick()")
                    drawOnce(holder, content)
                    choreographer.postFrameCallback(this)
                }
            }
            frameCallback = cb
            choreographer.postFrameCallback(cb)
        }

        private fun stopSoftDrawing() {
            softDrawing = false
            hostDrivesClock = false
            frameCallback?.let { Choreographer.getInstance().removeFrameCallback(it) }
            frameCallback = null
        }

        private fun drawOnce(holder: SurfaceHolder, content: View) {
            var canvas: Canvas? = null
            try {
                canvas = holder.lockHardwareCanvas()
                if (canvas != null) content.draw(canvas)
            } catch (t: Throwable) {
                Log.w(TAG, "frame dropped", t)
            } finally {
                if (canvas != null) {
                    try { holder.unlockCanvasAndPost(canvas) } catch (_: Throwable) { }
                }
            }
        }

        /* ------------------------------------------------------------ sensors
         *
         * The page cannot get devicemotion here: there is no browsing context
         * delivering it and no secure origin to gate it on. The service owns
         * the sensors anyway, so it reads them and hands them over in the
         * units and the frame the web event uses — which is the same frame the
         * Android sensor reports in, so the values go straight across.
         */
        private fun startSensors() {
            val accel = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            if (accel != null) {
                sensors.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME)
            }
            sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let {
                sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
            }
        }

        private fun stopSensors() = sensors.unregisterListener(this)

        override fun onSensorChanged(e: SensorEvent) {
            when (e.sensor.type) {
                Sensor.TYPE_GYROSCOPE ->
                    // Radians per second about the viewing axis; the page wants
                    // the web event's degrees per second.
                    spinZ = (e.values[2] * 180f / Math.PI.toFloat())
                Sensor.TYPE_ACCELEROMETER ->
                    js("window.__shaker&&window.__shaker.motion(" +
                        "${e.values[0]},${e.values[1]},${e.values[2]},$spinZ)")
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) { }

        /* --------------------------------------------------------- lifecycle */

        override fun onVisibilityChanged(visible: Boolean) {
            super.onVisibilityChanged(visible)
            if (visible) {
                startSensors()
                web?.onResume()
                // Only when the page owns its own clock; under the fallback the
                // frame callback is the clock and resuming would double-step.
                if (pageReady && !hostDrivesClock) js("window.__shaker&&window.__shaker.resume()")
                if (softDrawing) frameCallback?.let {
                    Choreographer.getInstance().postFrameCallback(it)
                }
            } else {
                /* Behind the app drawer or a full-screen app the wallpaper is
                 * not composited at all, and a wallpaper that keeps simulating
                 * there is just a battery leak. */
                stopSensors()
                if (pageReady && !hostDrivesClock) js("window.__shaker&&window.__shaker.pause()")
                web?.onPause()
                frameCallback?.let { Choreographer.getInstance().removeFrameCallback(it) }
            }
        }

        override fun onOffsetsChanged(
            xOffset: Float, yOffset: Float, xStep: Float, yStep: Float,
            xPixels: Int, yPixels: Int
        ) {
            if (pageReady) js("window.__shaker&&window.__shaker.offset($xOffset)")
        }

        override fun onCommand(
            action: String?, x: Int, y: Int, z: Int, extras: Bundle?, resultRequested: Boolean
        ): Bundle? {
            /* A tap on the home screen arrives here, in surface pixels. The
             * page wants it where it landed, not that it happened. */
            if (action == "android.wallpaper.tap" && pageReady && surfaceW > 0 && surfaceH > 0) {
                val nx = x.toFloat() / surfaceW
                val ny = y.toFloat() / surfaceH
                js("window.__shaker&&window.__shaker.tap($nx,$ny)")
            }
            return null
        }

        private fun js(code: String) {
            web?.evaluateJavascript(code, null)
        }
    }
}
