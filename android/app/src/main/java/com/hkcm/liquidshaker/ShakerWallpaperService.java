package com.hkcm.liquidshaker;

import android.app.Presentation;
import android.content.Context;
import android.graphics.Canvas;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.os.Bundle;
import android.service.wallpaper.WallpaperService;
import android.util.Log;
import android.view.Choreographer;
import android.view.SurfaceHolder;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * A live wallpaper that <em>is</em> the web page, rather than a reimplementation
 * of it.
 *
 * <p>The physics, the optics and the look all live in
 * {@code ../../wallpaper/index.html} and were hard-won; porting them here would
 * mean maintaining two of everything and having them disagree. So this hosts
 * the page, and its whole job is the three things a WallpaperService can do
 * that a browser tab cannot: put a view hierarchy into the wallpaper surface,
 * feed it the sensors directly, and stop it dead when the wallpaper is not on
 * screen.
 */
public class ShakerWallpaperService extends WallpaperService {

    private static final String TAG = "LiquidShaker";
    private static final String PAGE = "file:///android_asset/index.html";

    @Override
    public Engine onCreateEngine() {
        return new ShakerEngine();
    }

    private class ShakerEngine extends Engine implements SensorEventListener {

        private WebView web;
        private FrameLayout root;

        // The hardware path.
        private VirtualDisplay virtualDisplay;
        private Presentation presentation;

        // The software fallback.
        private boolean softDrawing;
        private boolean hostDrivesClock;
        private Choreographer.FrameCallback frameCallback;
        private SurfaceHolder softHolder;

        private boolean pageReady;
        private int surfaceW, surfaceH;

        private SensorManager sensors;
        private float spinZ;   // gyroscope about the viewing axis, deg/s

        @Override
        public void onCreate(SurfaceHolder holder) {
            super.onCreate(holder);
            setOffsetNotificationsEnabled(true);
            sensors = (SensorManager) getSystemService(Context.SENSOR_SERVICE);

            web = new WebView(ShakerWallpaperService.this);
            // The ramp's deep blue, so there is no white flash before first paint.
            web.setBackgroundColor(0xFF0A5FD4);
            web.getSettings().setJavaScriptEnabled(true);
            web.getSettings().setDomStorageEnabled(true);
            web.getSettings().setMediaPlaybackRequiresUserGesture(false);
            /* Forward the page's console to logcat, and switch its frame
             * timing on — but only in a debuggable build. Inside a wallpaper
             * there is no devtools to attach, so this is the only way to see
             * whether it is holding a frame rate on the actual hardware. */
            final boolean debuggable =
                    (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            if (debuggable) {
                web.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public boolean onConsoleMessage(ConsoleMessage m) {
                        Log.i(TAG, m.message());
                        return true;
                    }
                });
            }
            web.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    pageReady = true;
                    if (debuggable) js("window.__shaker&&window.__shaker.diag(true)");
                    if (hostDrivesClock) js("window.__shaker&&window.__shaker.drive()");
                    else if (isVisible()) js("window.__shaker&&window.__shaker.resume()");
                }
            });
            web.loadUrl(PAGE);

            root = new FrameLayout(ShakerWallpaperService.this);
            root.addView(web, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height) {
            super.onSurfaceChanged(holder, format, width, height);
            surfaceW = width;
            surfaceH = height;
            teardownHost();
            startHost(holder, width, height);
        }

        @Override
        public void onSurfaceDestroyed(SurfaceHolder holder) {
            teardownHost();
            super.onSurfaceDestroyed(holder);
        }

        @Override
        public void onDestroy() {
            stopSensors();
            teardownHost();
            if (web != null) { web.destroy(); web = null; }
            super.onDestroy();
        }

        /* ------------------------------------------------------------ hosting
         *
         * A WallpaperService hands out a Surface, not a place to put views, so
         * the view hierarchy has to be got into that surface somehow.
         *
         * The good way is a virtual display backed by the wallpaper surface
         * with a Presentation on it: the WebView is then a normal attached,
         * hardware-accelerated view and the compositor does the work. The catch
         * is that a Presentation is a Dialog, and a Dialog wants a window token
         * that a Service does not have — whether that is refused depends on the
         * platform version and the vendor.
         *
         * So it is attempted, and if the window is refused the engine falls
         * back to drawing the WebView into the surface by hand. That path
         * always works and is slower: a WebView drawn into a canvas it is not
         * attached to renders in software.
         */
        private void startHost(SurfaceHolder holder, int width, int height) {
            if (root == null) return;
            DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
            int density = getResources().getDisplayMetrics().densityDpi;

            VirtualDisplay vd = null;
            try {
                vd = dm.createVirtualDisplay("liquid-shaker", width, height, density,
                        holder.getSurface(),
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION
                                | DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY);
                if (vd == null) throw new IllegalStateException("no virtual display");

                Presentation p = new Presentation(ShakerWallpaperService.this, vd.getDisplay());
                p.setContentView(root);
                p.show();

                virtualDisplay = vd;
                presentation = p;
                softDrawing = false;
                Log.i(TAG, "hosting the page on a virtual display (hardware accelerated)");
            } catch (Throwable t) {
                Log.w(TAG, "presentation refused, drawing the page by hand instead", t);
                /* Released here rather than through the field: if show() threw,
                 * the field was never assigned, and a virtual display left alive
                 * still owns the surface the fallback is about to lock. */
                if (vd != null) vd.release();
                virtualDisplay = null;
                presentation = null;
                startSoftDrawing(holder, width, height);
            }
        }

        private void teardownHost() {
            stopSoftDrawing();
            if (presentation != null) { presentation.dismiss(); presentation = null; }
            if (virtualDisplay != null) { virtualDisplay.release(); virtualDisplay = null; }
            if (root != null && root.getParent() instanceof ViewGroup) {
                ((ViewGroup) root.getParent()).removeView(root);
            }
        }

        private void startSoftDrawing(SurfaceHolder holder, int width, int height) {
            if (root == null || web == null) return;
            softHolder = holder;
            web.setLayerType(View.LAYER_TYPE_SOFTWARE, null);

            /* Hand the page's clock over. An unattached WebView has no vsync to
             * hang requestAnimationFrame off, so its loop either throttles hard
             * or never runs at all; this engine is already waking once a frame
             * to draw, so it steps the simulation itself. */
            hostDrivesClock = true;
            if (pageReady) js("window.__shaker&&window.__shaker.drive()");

            root.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                         View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
            root.layout(0, 0, width, height);
            softDrawing = true;

            final Choreographer choreographer = Choreographer.getInstance();
            frameCallback = new Choreographer.FrameCallback() {
                @Override
                public void doFrame(long frameTimeNanos) {
                    if (!softDrawing) return;
                    if (pageReady) js("window.__shaker&&window.__shaker.tick()");
                    drawOnce();
                    choreographer.postFrameCallback(this);
                }
            };
            choreographer.postFrameCallback(frameCallback);
        }

        private void stopSoftDrawing() {
            softDrawing = false;
            hostDrivesClock = false;
            if (frameCallback != null) {
                Choreographer.getInstance().removeFrameCallback(frameCallback);
                frameCallback = null;
            }
            softHolder = null;
        }

        /* A software canvas rather than lockHardwareCanvas(), which needs API
         * 26. Nothing is lost by it here: a detached WebView renders in
         * software anyway, so this path is software end to end whichever
         * canvas it is handed. */
        private void drawOnce() {
            if (softHolder == null || root == null) return;
            Canvas canvas = null;
            try {
                canvas = softHolder.lockCanvas();
                if (canvas != null) root.draw(canvas);
            } catch (Throwable t) {
                Log.w(TAG, "frame dropped", t);
            } finally {
                if (canvas != null) {
                    try { softHolder.unlockCanvasAndPost(canvas); } catch (Throwable ignored) { }
                }
            }
        }

        /* ------------------------------------------------------------ sensors
         *
         * The page cannot get devicemotion here: there is no browsing context
         * delivering it and no secure origin to gate it on. The service owns
         * the sensors anyway, so it reads them and hands them over in the units
         * and the frame the web event uses — which is the same frame the
         * Android sensor reports in, so the values go straight across.
         */
        private void startSensors() {
            Sensor a = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            if (a != null) sensors.registerListener(this, a, SensorManager.SENSOR_DELAY_GAME);
            Sensor g = sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
            if (g != null) sensors.registerListener(this, g, SensorManager.SENSOR_DELAY_GAME);
        }

        private void stopSensors() {
            if (sensors != null) sensors.unregisterListener(this);
        }

        @Override
        public void onSensorChanged(SensorEvent e) {
            if (!pageReady) return;
            switch (e.sensor.getType()) {
                case Sensor.TYPE_GYROSCOPE:
                    // Radians per second about the viewing axis; the page wants
                    // the web event's degrees per second.
                    spinZ = (float) (e.values[2] * 180.0 / Math.PI);
                    break;
                case Sensor.TYPE_ACCELEROMETER:
                    js("window.__shaker&&window.__shaker.motion("
                            + e.values[0] + "," + e.values[1] + "," + e.values[2]
                            + "," + spinZ + ")");
                    break;
                default:
                    break;
            }
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) { }

        /* --------------------------------------------------------- lifecycle */

        @Override
        public void onVisibilityChanged(boolean visible) {
            super.onVisibilityChanged(visible);
            if (visible) {
                startSensors();
                if (web != null) web.onResume();
                // Only when the page owns its own clock; under the fallback the
                // frame callback is the clock and resuming would double-step.
                if (pageReady && !hostDrivesClock) js("window.__shaker&&window.__shaker.resume()");
                if (softDrawing && frameCallback != null) {
                    Choreographer.getInstance().postFrameCallback(frameCallback);
                }
            } else {
                /* Behind the app drawer or a full-screen app the wallpaper is
                 * not composited at all, and a wallpaper that keeps simulating
                 * there is just a battery leak. */
                stopSensors();
                if (pageReady && !hostDrivesClock) js("window.__shaker&&window.__shaker.pause()");
                if (web != null) web.onPause();
                if (frameCallback != null) {
                    Choreographer.getInstance().removeFrameCallback(frameCallback);
                }
            }
        }

        @Override
        public void onOffsetsChanged(float xOffset, float yOffset, float xStep, float yStep,
                                     int xPixels, int yPixels) {
            if (pageReady) js("window.__shaker&&window.__shaker.offset(" + xOffset + ")");
        }

        @Override
        public Bundle onCommand(String action, int x, int y, int z, Bundle extras,
                                boolean resultRequested) {
            /* A tap on the home screen arrives here, in surface pixels. The page
             * wants it where it landed, not merely that it happened. */
            if ("android.wallpaper.tap".equals(action) && pageReady
                    && surfaceW > 0 && surfaceH > 0) {
                js("window.__shaker&&window.__shaker.tap("
                        + ((float) x / surfaceW) + "," + ((float) y / surfaceH) + ")");
            }
            return null;
        }

        private void js(String code) {
            if (web != null) web.evaluateJavascript(code, null);
        }
    }
}
