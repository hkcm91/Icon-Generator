package com.hkcm.liquidshaker;

import android.app.Activity;
import android.app.WallpaperManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

/**
 * Gives the installed APK a normal launcher entry and hands the user directly
 * to Android's live-wallpaper preview/apply flow.
 *
 * <p>A {@link android.service.wallpaper.WallpaperService} is discoverable by
 * the system wallpaper picker, but it is not itself launchable. Without this
 * activity an APK installed from a file appears to do nothing: Android has no
 * activity to open and many launchers never expose their live-wallpaper picker
 * prominently. This activity contains no wallpaper UI; the system preview is
 * still the authority that applies the wallpaper.</p>
 */
public class LauncherActivity extends Activity {

    private static final int REQUEST_SET_WALLPAPER = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openWallpaperPreview();
    }

    private void openWallpaperPreview() {
        ComponentName service = new ComponentName(this, getWallpaperService());
        Intent direct = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
        direct.putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, service);

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
            Toast.makeText(this, getPickerMissingMessage(), Toast.LENGTH_LONG).show();
            finish();
        }
    }

    protected Class<? extends android.service.wallpaper.WallpaperService> getWallpaperService() {
        return ShakerWallpaperService.class;
    }

    protected int getPickerMissingMessage() {
        return R.string.wallpaper_picker_missing;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_SET_WALLPAPER) finish();
    }
}
