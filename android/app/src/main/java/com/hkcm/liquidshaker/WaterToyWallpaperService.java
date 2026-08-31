package com.hkcm.liquidshaker;

/** Hosts the interactive water ring toy as a second live-wallpaper choice. */
public class WaterToyWallpaperService extends ShakerWallpaperService {
    @Override protected String getLogTag() { return "WaterRingToy"; }
    @Override protected String getPageUrl() { return "file:///android_asset/water_toy.html"; }
    @Override protected String getVirtualDisplayName() { return "water-ring-toy"; }
    @Override protected int getPageBackgroundColor() { return 0xFF287BA8; }
}
