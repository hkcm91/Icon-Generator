package com.hkcm.liquidshaker;

import android.app.Activity;
import android.app.WallpaperManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.widget.Toast;

/**
 * Gives each wallpaper in the APK a normal launcher entry, and hands the user
 * straight to Android's live-wallpaper preview/apply flow for the one they
 * tapped.
 *
 * <p>A {@link android.service.wallpaper.WallpaperService} is discoverable by
 * the system wallpaper picker, but it is not itself launchable. Without an
 * activity an APK installed from a file appears to do nothing: Android has no
 * activity to open and many launchers never expose their live-wallpaper picker
 * prominently. This activity contains no wallpaper UI; the system preview is
 * still the authority that applies the wallpaper.</p>
 *
 * <p>There are two wallpapers and one of these, reached through an
 * activity-alias per wallpaper. Which one was launched is read back from the
 * alias's own manifest metadata rather than passed in an extra, because the
 * launcher starts these with a bare MAIN intent and there is nowhere for an
 * extra to come from.</p>
 */
public class LauncherActivity extends Activity {

    private static final int REQUEST_SET_WALLPAPER = 1;
    private static final String META_WALLPAPER = "com.hkcm.liquidshaker.wallpaper";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openWallpaperPreview();
    }

    /** The service named by the launched alias, defaulting to the shaker. */
    private ComponentName wallpaperComponent() {
        String name = null;
        try {
            ActivityInfo info = getPackageManager().getActivityInfo(
                    getIntent().getComponent(), PackageManager.GET_META_DATA);
            if (info.metaData != null) name = info.metaData.getString(META_WALLPAPER);
        } catch (Throwable ignored) {
            // A launcher that started this some other way; fall through.
        }
        if (name == null) return new ComponentName(this, ShakerWallpaperService.class);
        if (name.startsWith(".")) name = getPackageName() + name;
        return new ComponentName(this, name);
    }

    private void openWallpaperPreview() {
        Intent direct = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
        direct.putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, wallpaperComponent());

        try {
            startActivityForResult(direct, REQUEST_SET_WALLPAPER);
            return;
        } catch (ActivityNotFoundException directPickerMissing) {
            // Some vendor builds omit the component-specific preview but still
            // provide the standard live-wallpaper chooser.
        }

        try {
            startActivityForResult(
                    new Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER),
                    REQUEST_SET_WALLPAPER);
        } catch (ActivityNotFoundException chooserMissing) {
            Toast.makeText(this, R.string.wallpaper_picker_missing, Toast.LENGTH_LONG).show();
            finish();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_SET_WALLPAPER) finish();
    }
}
