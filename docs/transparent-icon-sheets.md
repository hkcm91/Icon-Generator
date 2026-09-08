# Transparent icon sheets

Open **Generate an icon sheet** underneath Family name in Simple Studio. Enter 10–20 subjects (one per line), a shared style, and quality. Optionally use the selected family subjects, family style, or master reference. The entire sheet uses one Replicate output, not one output per icon. All icons share the output resolution.

The feature calls `openai/gpt-image-2` through the existing authenticated proxy with `background: "transparent"`, `output_format: "png"`, and `number_of_images: 1`. Replicate's live schema exposes transparency, although its README currently says otherwise. If the host rejects alpha, the error is surfaced without an opaque fallback or an automatic replacement generation.

Before accepting a result, the app checks the PNG signature, fully transparent pixels, foreground in each requested cell, clear crop boundaries, and empty spare cells. These checks do not identify subjects, count multiple objects within one cell, or certify halo-free edge colors. Inspect the preview on black, white, pink, and checkerboard before using a sheet.

Download the original PNG unchanged, or a ZIP with original-resolution integer crops, the original sheet, and a manifest. Cropping does not delete colors or resize artwork. The generated grid has five columns; 11–14 and 16–19 subjects leave spare cells at the end.

The latest accepted sheet is stored in IndexedDB under a separate key. A pending prediction ID is retained across refreshes so **Retrieve existing result** polls the same prediction without starting another paid generation. Download promptly: expired Replicate delivery files cannot be retrieved indefinitely. Starting a new generation is always an explicit button click. Existing icon project storage and the older generation pipeline are unchanged.

Source: https://replicate.com/openai/gpt-image-2/api/schema (checked September 8, 2026).
