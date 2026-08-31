# This repo's role in the StickerNest MVP

Scope lock lives in `hkcm91/StickerNestStudio` → `docs/MVP_SCOPE.md`.
The shipping app is `StickerNestStudio/apps/android`. Nothing here ships to a
customer directly.

## Harvest for the MVP

**`android/app/src/main/java/com/hkcm/liquidshaker/ShakerWallpaperService.java`**
— the important one. It hosts a WebView inside the wallpaper surface and feeds
it device sensors, so the wallpaper's physics and look live in HTML rather than
in Kotlin. It is being ported to `StickerNestStudio` as a *generic*
`LiveWallpaperService` that points at HTML inside an installed pack instead of
at a baked-in `android_asset`.

That change is what makes every future live wallpaper a content drop rather
than an APK release.

**`wallpaper/index.html`** (216 KB) — the liquid shaker itself. Becomes the
first live wallpaper *asset* in a pack, not code.

**`wallpaper/tools/render-motion.mjs`, `render-icons.mjs`** — preview and
thumbnail rendering for Etsy and itch.io listings.

## Parked until after launch

The React icon studio — `src/`, `api/`, `server/`, `blender/`, `test/`. This is
creator tooling: your workbench, not the customer's app. Valuable, actively
worked on, and not on the launch path. Nothing here is being deleted.
