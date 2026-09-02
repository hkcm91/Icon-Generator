package com.hkcm.liquidshaker;

/** Launcher entry that opens Android's preview for the lava lamp. */
public class LavaLauncherActivity extends LauncherActivity {
    @Override
    protected Class<? extends android.service.wallpaper.WallpaperService> getWallpaperService() {
        return LavaWallpaperService.class;
    }

    @Override
    protected int getPickerMissingMessage() {
        return R.string.lava_picker_missing;
    }
}
