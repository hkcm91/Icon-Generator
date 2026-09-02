package com.hkcm.liquidshaker;

/**
 * The lava lamp, hosted the same way: {@code ../../wallpaper/lava.html} speaks
 * the same {@code window.__shaker} interface as the shaker page, so the engine
 * does not know or care which of the two it is running. Everything that
 * makes it a wallpaper — the surface, the sensors, the lifecycle — is
 * inherited; the only thing this class knows is which page to load.
 */
public class LavaWallpaperService extends ShakerWallpaperService {

    @Override
    protected String pageUrl() { return "file:///android_asset/lava.html"; }

    /** The backdrop's near-black indigo. */
    @Override
    protected int pageBackground() { return 0xFF06030F; }
}
