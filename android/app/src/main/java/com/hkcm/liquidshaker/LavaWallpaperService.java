package com.hkcm.liquidshaker;

/**
 * The lava lamp, hosted the same way: {@code ../../wallpaper/lava.html} speaks
 * the same {@code window.__shaker} interface as the shaker page, so the engine
 * does not know or care which of the pages it is running. Everything that
 * makes it a wallpaper — the surface, the sensors, the lifecycle — is
 * inherited; the only thing this class knows is which page to load.
 */
public class LavaWallpaperService extends ShakerWallpaperService {
    @Override protected String getLogTag() { return "LavaLamp"; }
    @Override protected String getPageUrl() { return "file:///android_asset/lava.html"; }
    @Override protected String getVirtualDisplayName() { return "lava-lamp"; }
    /** The backdrop's near-black indigo, so there is no flash before first paint. */
    @Override protected int getPageBackgroundColor() { return 0xFF06030F; }
}
