package com.hkcm.liquidshaker;

/** Launcher entry that opens Android's preview for the water ring toy. */
public class WaterToyLauncherActivity extends LauncherActivity {
    @Override
    protected Class<? extends android.service.wallpaper.WallpaperService> getWallpaperService() {
        return WaterToyWallpaperService.class;
    }

    @Override
    protected int getPickerMissingMessage() {
        return R.string.water_toy_picker_missing;
    }
}
