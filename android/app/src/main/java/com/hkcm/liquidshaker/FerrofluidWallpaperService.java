package com.hkcm.liquidshaker;

/**
 * Ferrofluid: {@code ../../wallpaper/ferrofluid.html}, hosted.
 *
 * <p>The second wallpaper, and the reason {@link WebWallpaperService} exists
 * as a base class at all. The two pages share a host interface and share
 * nothing else; a subclass is a page, a colour and a log tag.
 */
public class FerrofluidWallpaperService extends WebWallpaperService {

    @Override
    protected String page() { return "file:///android_asset/ferrofluid.html"; }

    /** The paper, so the surface is never darker than the wallpaper it is
     *  about to become — a black flash in front of a white page is the one
     *  thing a viewer would actually notice. */
    @Override
    protected int loadingColour() { return 0xFFF2F2F3; }

    @Override
    protected String tag() { return "Ferrofluid"; }
}
