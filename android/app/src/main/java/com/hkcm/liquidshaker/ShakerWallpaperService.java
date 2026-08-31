package com.hkcm.liquidshaker;

/**
 * Liquid Shaker: {@code ../../wallpaper/index.html}, hosted.
 *
 * <p>Everything a live wallpaper actually has to do is in
 * {@link WebWallpaperService}. All that is left here is which page, and what
 * colour the surface should be while it loads.
 */
public class ShakerWallpaperService extends WebWallpaperService {

    @Override
    protected String page() { return "file:///android_asset/index.html"; }

    /** The ramp's deep blue, so there is no white flash before first paint. */
    @Override
    protected int loadingColour() { return 0xFF0A5FD4; }

    @Override
    protected String tag() { return "LiquidShaker"; }
}
