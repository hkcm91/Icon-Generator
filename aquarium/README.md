# 3D aquarium — particle fish, and asset acquisition

## The prototype

[`prototype.html`](prototype.html) is a working answer to "can the fish be
particles instead of models?". Open it in a browser — one self-contained file,
no build step, no dependencies, **and no assets at all**.

![Particle fish at the frame budget](../docs/screenshots/aquarium-particle-fish.png)

A fish here is a few dozen points sampled from a parametric side profile, bent
by a travelling wave and drawn as additive sprites. There is no mesh and no
rig, so there is nothing to license — the constraint that shapes
[docs/AQUARIUM-ASSETS.md](../docs/AQUARIUM-ASSETS.md) simply does not apply to
a fish that is generated on the device.

```bash
open aquarium/prototype.html                       # or serve the folder
open 'aquarium/prototype.html?pose=1&fish=4'       # look-dev: hold them still
npm run aquarium:shot                              # re-render docs/screenshots
npm run aquarium:clip                              # 12s mp4 into renders/
```

Flags: `fish`, `points`, `motes`, `seed`, `speed`, `hud`, `pose`. `pose=1`
parks one of each species in a column so proportion and fin shape can be judged
without waiting for a fish to swim past — the same reason `--static` exists in
`blender/liquid_shaker.py`.

![Each species held still for look-dev](../docs/screenshots/aquarium-fish-detail.png)

### How they swim

Each fish picks a point in the tank, swims to it, and picks another. Three
things turn that from sliding into swimming:

- **Dorsal up.** The body is modelled with `+y` up while canvas `y` grows
  downward, so the perpendicular offset has to be negated as well as the axial
  one. Until it was, the dorsal fin rendered *beneath* the fish, the anal fin
  above it and the eye low on the head: every fish swam belly-up. Nothing looks
  more wrong while being harder to name.
- **A fish cannot strafe.** Velocity used to be composed per axis, with a
  damping factor on y that the body angle knew nothing about and a crowding
  shove worth up to half the swimming speed applied at right angles to the
  body — so a fish pointed one way and travelled another. Motion is now along
  the body axis and nothing else: with `facing` being the cosine of the yaw,
  the screen projection of a body-length of travel is exactly
  `(facing·cos pitch, sin pitch)`, which is the same transform the renderer
  applies to the body, so nose and velocity agree by construction. Avoidance
  banks the fish away instead of shoving it. Measured misalignment between body
  and travel: **0.9° mean, 3.5° at the 95th percentile** — the residual being
  drift in the current, which is as it should be.
- **The nose leads.** The body is built nose at `x = 0` running back to the
  tail beyond `x = 1`, and travel is toward +x, so the rendered offset has to
  be negated or the tail leads and the fish swims backwards. It did, from the
  first version — invisible until they moved far enough for anyone to tell.
- **Yaw is a signed scale, not a rotation.** A fish turning around rotates
  through edge-on, so `facing` animates between -1 and 1 and the body
  foreshortens on the way through. The first version rotated by 180 instead,
  which swam every leftward fish upside down — dorsal fin underneath.
- **The water is wider than the window, and there are no walls.** Goals are
  drawn from beyond both edges, so fish leave frame and come back — about six
  crossings a minute. Clamping them inside the viewport instead put a fish
  against invisible glass, and because the clamp re-fired every frame it stayed
  there, it re-rolled its destination **134 times a minute** against an
  intended 6 to 12. That is what circling in one spot was: a fish that never
  committed to anywhere to go.
- **Each fish keeps to a depth layer.** A fish crosses the frame horizontally
  in a few seconds but climbs far more slowly, so drawing y goals uniformly
  made every fish a low-pass filter of the same uniform signal and the school
  drifted into one clump — vertical spread collapsing from 259px to about 110.
  Goals now sit near the fish's own band, which drifts slowly; spread holds
  around 210–230 and the mean gap between fish went from ~200px to ~340.
- **Speed is in body lengths per second, not pixels.** `swim: [0.85, 1.20]`
  and `stride` (body lengths per tail beat, which sets the beat rate) are the
  units the animal is described in, so resizing a fish rescales its swimming
  and its beat automatically. Pixels per second is what this had first, and
  enlarging the fish left the speeds behind: the big species ended up at
  0.1–0.2 BL/s, beating hard and going nowhere — swimming in place. A cruising
  fish does roughly 0.5–2.
- **The spine is integrated, so the body cannot stretch.** Displacing each
  point sideways at its own unchanged `x` does not bend a body, it warps one:
  the arc length grows with the bend, so the fish lengthened and shortened as
  it swam. The wave now sets the *tangent angle* and the spine is integrated
  along it, making the body inextensible by construction — measured arc-length
  variation **0%**, against a nose-to-tail span that still varies 4.6% because
  a bent body genuinely is shorter end to end. Sampling the spine coarsely and
  interpolating is also cheaper than the `atan`/`cos`/`sin` per point it
  replaced.
- **A fish is not a rope.** `stiff` sets where bending begins and the amplitude
  grows toward the tail from there — near the nose for the eel, a third of the
  way back for everything else, with `waves` giving each species its own number
  of wavelengths along the body. Bending the whole length evenly is most of
  what read as waving rather than swimming.
- **Pectorals scull.** They row at their own faster rate, hardest when the fish
  is barely moving — which is when a real one uses them instead of its tail.
- **The tail wave is integrated, not evaluated.** `phase = w * t` recomputes
  `w` from a continuously varying effort and multiplies it by a growing `t`, so
  every change in `w` shifts the phase by `t · Δw` — measured at **1.57 radians
  of spurious jump per frame**, which is a quarter cycle. The tail was noise
  wearing the shape of a wave. Accumulating `wave += w · dt` instead leaves
  1.5e-14 rad, which is floating point.
- **Burst and coast.** Fish flick their tails and glide rather than travelling
  at a constant rate, and the tail beat follows effort, so a coasting fish
  beats slowly and a dashing one beats hard. A constant beat is most of what
  read as sliding. Dashes ramp in rather than switching on, and effort is eased
  so the beat rate never steps.
- **Turns start and stop.** The turn rate is a state eased toward the demand,
  so a reversal is an S-curve rather than a constant-rate swing between two
  corners, and a fish is nearly stopped as it passes edge-on — which is exactly
  where its screen-space direction reverses. Heading now changes at 18°/s on
  average, 114 at the 99th percentile, peaking at 409.
- **Paths wander.** A slow per-fish wobble on the pitch, because nothing alive
  travels on a ruled line to a waypoint. Goals are also biased ahead of the
  fish, so it does not turn on the spot the moment it arrives.
- **Journeys are long.** `retarget` picks the farthest of ten candidates rather
  than the first acceptable one — a threshold only guarantees a goal is not
  near, whereas scoring by distance makes crossings the norm. With a tighter
  arrival radius that took journeys from 2–3.5 second hops to **5.2 body
  lengths over about 7 seconds**, and re-targeting from 17–28 a minute to 8.7.
- **No two fish behave alike.** Each gets its own patience (how long it holds a
  journey), restlessness (how readily it changes depth layer), band width (how
  far it strays from that layer), and wobble amplitude and frequency (how
  sinuous its route is). One in a while a fish simply hangs in the water for a
  couple of seconds. Identical parameters across a school is most of what makes
  generated animals read as generated: everything sets off at the same speed,
  wanders on the same curve, and turns at the same moment. Average journey
  length now varies by ±2.1 body lengths between individuals.
- **Personal space.** A light shove between neighbours; overlapping bodies read
  as one confused blob rather than as a school. The flow field's pull on fish
  was also cut by half, because `flowX` depends only on depth and was sliding
  the whole school the same way at once.

`swim` is the rate through the fish's own water; what it covers on screen comes
out about a third lower, deliberately — distant fish are scaled down by depth,
and a fish slows through a turn because there is little to push against
edge-on. Measured across the four species that is 0.46–1.22 BL/s, or five to
eight seconds to cross a 540px frame.

The simulation draws on a seeded generator rather than `Math.random`, so with
the clock hook driving a fixed timestep a recording reproduces frame for frame.
`window.__aquarium.fish` exposes the school, so those numbers can be measured
rather than asserted:

```js
// per fish, over a fixed-step run — key by identity, the school is
// re-sorted by depth every frame
for (const f of window.__aquarium.fish) travelled.get(f)  // ... / f.len
```

`frames`, `dt` and `t` are published on the same hook. A harness that steps the
clock cannot otherwise tell how many frames it drove — waiting on two nested
`requestAnimationFrame`s runs the loop twice, the second with `dt` of zero —
and will cheerfully measure its own stepping instead of the scene.

### What it settled

- **Point count has to follow fish size, not be a constant.** A flat 80 points
  spread across a hero-sized body reads as a scatter of orbs, not an animal.
  `points` is now a budget for a reference length and scales from there.
- **An outline alone reads as a ring.** Sampling only the silhouette made the
  tall species look like jellyfish. A bright lateral line down the body — a
  tenth of the budget — states which end is the head before the eye is even
  legible.
- **One bright eye is worth twenty body points.** It is the strongest "this is
  an animal" cue in the cloud.
- **Light shafts have to be sprites, not polygons.** A polygon edge stays
  visible however low you push the alpha; the first draft read as hard stripes.

### What it costs

At the default 14 fish the HUD (`?hud=1`) reports **~1,480 points and ~1,390
sprite draws per frame**. That is near the top of the ~1,000–1,500 ceiling this
was designed against — the shaker ships ~950 particles — so `?fish=12` is the
setting to back off to if a handset struggles. The frame rate in
that HUD comes from headless Chromium on a desktop container, so treat it as
confirmation that the *draw count* is what was predicted, **not** as a phone
measurement. Only the APK on a handset settles that.

### Seeing it move

Stills cannot show the thing this exists to prove. `npm run aquarium:clip`
records an mp4 into `renders/` (gitignored, like the Blender output), driving
the page on a fixed timestep through `window.__aquarium.now` rather than
recording in real time — capture is much slower than playback, and the clip
comes out smooth and identical on every run regardless. `CLIP_SECONDS`,
`CLIP_FPS`, `CLIP_BURST` and `CLIP_BURST_ALL` tune it.

That clock hook is not only for capture: under a `WallpaperService` the WebView
has no vsync of its own and the host has to drive the frame, which is the same
arrangement the shaker makes through `window.__shaker`.

It needs a system ffmpeg. The one Playwright bundles is a WebM-only build with
no H.264 encoder, so `apt-get install ffmpeg` is a prerequisite for mp4.

### What a bought mesh cannot do

Tapping a fish bursts it into points that the water carries off before they
reassemble — that is the tap in the clip at about seven seconds. The fish live
in the same flow field as the motes, so this is a few lines rather than a
feature.

![A school mid-burst, dissolved into the water](../docs/screenshots/aquarium-burst.png)

## Asset acquisition

Where each remaining piece comes from, what it is licensed under, and a check
that refuses licences our delivery format cannot honour. The sourcing research
and the reasoning behind the policy are in
[`docs/AQUARIUM-ASSETS.md`](../docs/AQUARIUM-ASSETS.md). The prototype above
removes the fish from this list; coral, materials and lighting still need it.

Short version: a live wallpaper ships as an APK, an APK is a zip, and a loose
`.glb` inside one is retrieved by renaming the file. Marketplace royalty-free
licences forbid exactly that, so v1 is sourced entirely from public-domain and
procedural assets — Quaternius for rigged animated fish, Smithsonian scans for
coral, ambientCG and Poly Haven for materials and light, and this project's own
Blender pipeline for the tank, water, plants and caustics.

## Acquiring

Downloaded assets are deliberately **not committed** — they are large, they are
re-acquirable from the manifest, and keeping them out means a paid asset can
never be pushed to a public repo by accident.

```bash
node scripts/aquarium-assets.mjs check     # what is missing, and what its licence permits
# download each listed source into aquarium/assets/<path from the manifest>
node scripts/aquarium-assets.mjs lock      # SHA-256 every acquired file
node scripts/aquarium-assets.mjs attrib    # regenerate THIRD-PARTY-LICENSES.md
```

`check` exits non-zero on a licence violation, an unrecognised licence, or a
manifest entry missing its source — so it belongs in CI ahead of any APK build.
`lock` reports files that changed or disappeared since the last run, which is
how a silently swapped mesh gets noticed.

## Adding an asset

Add an entry to [`assets.manifest.json`](assets.manifest.json) with its `id`,
`role`, `title`, `author`, `license`, source `page` and expected `files`, then
run `check`. An unfamiliar licence string returns `review` rather than passing;
that is the point. Encode a new one in `scripts/aquarium-assets.mjs` only after
reading the actual terms.

## Shipping paid assets later

Set `"distribution": "packed"` in the manifest once meshes are built into a
container a user cannot open by renaming it. That single flag switches
marketplace royalty-free licences from blocked to permitted, and `check` will
then hold you to crediting them. Do not set it before the packing step exists —
it is the only thing standing between a purchase and a licence breach.
