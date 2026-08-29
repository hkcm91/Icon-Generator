# Liquid shaker — interactive wallpaper

A full-screen liquid shaker that actually responds to the phone: tilt it and
the liquid finds level, shake it and the whole thing sloshes and throws the
glitter around. One self-contained HTML file, no build step, no dependencies.

This is the half that reacts. The [Blender pipeline](../blender) bakes the
hero loop at full render quality, but a baked loop plays back identically no
matter how hard you shake the phone — the two are complementary.

## Try it

Open `index.html` in a browser. On a phone it uses the real sensors; on a
desktop, drag to tilt and flick to shake.

### On a phone

It needs to come off an `https://` origin. Chrome gates the motion sensors
behind a secure context, so a file copied onto the handset will render but
never move — which looks like a bug in the physics and is not one. Serving
the folder over HTTPS is the whole of the setup.

Three things then make it behave like a wallpaper rather than a web page,
and none of them are about the drawing:

- **It takes a screen wake lock**, because a wallpaper does not dim after
  fifteen seconds and a web page does. The lock is dropped whenever the page
  is hidden, so it is taken again on the way back.
- **The first touch asks for fullscreen**, which is where the browser chrome
  goes. Only a touch — otherwise dragging to tilt on a desktop would throw
  the window into fullscreen on the first click.
- **It is installable.** Add to Home Screen is as close as a web page gets
  to being a wallpaper: launched from the home screen it opens fullscreen,
  with no address bar and no tab. The manifest is built at runtime rather
  than shipped as a second file, so this stays one self-contained page, and
  the icon is drawn from the same palette and the same flake shapes as the
  wallpaper itself.

A *true* Android live wallpaper — one you set from the wallpaper picker,
that runs behind the home screen — needs an APK wrapping this page in a
`WallpaperService`. That lives in [`../android`](../android), which builds
this exact file into an app rather than reimplementing it.

Under that host the page cannot get `devicemotion` — there is no browsing
context delivering it — so the service reads the sensors itself and hands
them in through `window.__shaker`, in the same units and the same device
frame the web event uses. Both paths then land on the same code and there is
only one motion model to keep honest. The same object carries the things
only a wallpaper has: home-screen scroll, a tap on the glass, and a way for
the host to take over the clock when the WebView has no vsync of its own.

## How it moves

Three coupled pieces.

**A fluid velocity field** — coarse stable-fluids on roughly 1500 cells:
body force, vorticity confinement, semi-Lagrangian advection, Jacobi
pressure projection. This is what carries the glitter. It is driven by the
container's own acceleration, because in the non-inertial frame of a shaken
vessel the liquid feels a body force of −a, and that is the actual physical
cause of sloshing. Incompressibility turns a shove into a swirl for free:
the fluid cannot pile up against a wall, so it has to roll. The walls are
no-slip — a viscous glitter gel grips the glass, and that boundary layer is
what sheds the vortices that make a shake swirl rather than merely slosh
back and forth.

**A free surface** — a one-dimensional height field in the gravity frame,
so arbitrary tilt costs only a change of basis. Waves are gravity-capillary:
`omega^2 = gk + (sigma/rho)k^3`, so wave speed scales with the in-plane
component of gravity (which is what provides the restoring force) while
surface tension stiffens the short wavelengths. It is coupled to the fluid
beneath it, which is what gives the waterline structure; driven by the tilt
term alone it can only ever be a straight line.

The surface is bounded by the vessel that holds it. The drawn meniscus is
bisected to its true contact point on the glass and given a capillary climb
there, rather than being stroked across the full tangent span — near the top
the container has already curved inward, and a surface drawn past that got
chopped off by the glass, reading as a clipping artefact across the frame.

Because the shaker is nearly full, the interface is split into segments: the
crest may press against the ceiling, and where it does there is no
air-liquid boundary at all, so the waterline genuinely breaks around the
trapped air and the pocket migrates to whichever corner is highest. The
crest bound is asymmetric for the same reason — upward it stops at the
ceiling, downward there is a whole body of liquid to draw from.

It is drawn as a band rather than a line. The pouch has depth, so the
surface is seen almost edge-on and presents a band lit along its lower edge
by light piping through the wedge of liquid beneath it. A hairline read as a
stroke drawn on top of the picture.

**The surface pushes the liquid under it downhill.** With a free surface at
atmospheric pressure, the pressure at any depth is set by how much liquid is
stacked above it, so a sloping surface leaves a horizontal pressure gradient
and the whole body accelerates down the slope. That was missing entirely:
the solver had no gravity in it and no idea where the surface was, so the
only thing that could ever move the liquid was the container being shoved.
Water finding its own level is now something the liquid does rather than
something the waterline does on its own, and the coupling runs both ways —
the slope drives the flow, the flow drives the waterline. A level surface
has no gradient and exerts nothing, so holding the phone at a steady angle
is still quiet.

That term did almost nothing until the solver was told where the air is. A
closed domain is where a pressure projection is at its most ruthless: any
force that is nearly uniform is divergence-free, so the pressure field
cancels it completely. The surface slope was being annihilated that way, and
bought six per cent of the flow during a flip, because the liquid had
nowhere to accelerate *into*. Air is at atmospheric pressure, which is the
zero of this solver's pressure, so an air cell is a Dirichlet boundary
rather than part of the domain, and a liquid cell touching one is free to
accelerate toward it. With the headspace marked, a tilted surface drives
43.8px/s of downhill flow through the body of the liquid, against 0.4px/s
without the term — and the headspace is only 64 cells of 2304, because a
95%-full vessel genuinely has very little room to slosh in.

**Turning the container tilts the water in it.** The height field is a graph
over an axis derived from gravity, so when the phone turns, the axes the
surface is measured against turn with it. Left alone that means the surface
arrives already perpendicular to the new gravity: roll the phone through 180
degrees and the water swaps ends without ever sloshing, because the only
forcing in the wave field is the container's acceleration and a pure
rotation has none. But the surface does not turn with the container.
Expressed in the new basis it is tilted by exactly the angle the basis
moved, and putting that back is two lines — the wave dynamics then run the
tilt back and forth across the vessel until it damps out. Measured through a
180-degree roll, the peak surface deflection goes from 95px to 219px, and
the level returns to within 0.02% of where it started.

**Two-way coupling** — particles push back on the liquid, not just the other
way around. One-way advection is the usual shortcut and it misses the most
characteristic thing a glitter shaker does: drifting flakes drag liquid with
them, the liquid they displace has to go the other way, and the suspension
organises into convection plumes. With no input at all the flow field
sustains real structural motion; before the coupling it was exactly zero.

It has to be strong enough to go unstable. A dense suspension sitting over
clear liquid is the most unstable arrangement there is — flip the shaker and
that is exactly what you have — and it should overturn in plumes rather than
settle one flake at a time. At the strength it was set to it could not:
measured through a flip, the flow decayed from 357px/s to 29 within five
seconds and then sat there while the glitter drifted down. Tripled, it holds
at 51px/s indefinitely and carries the glitter twice as far in the same time.

It could not have been raised before, because raising it drove a bulk drift
that swept the glitter into one end — which is also worth knowing about the
old behaviour, because some of the drama of a flip was that artefact rather
than the physics.

**A sealed vessel cannot drift, though it can slosh.** The net force is
stripped out of the particle reaction before it is applied, but that only
constrains the forcing. At any real coupling strength the *flow* acquires a
bulk drift of its own through advection and the asymmetry of the walls, and
being a translation of everything at once it is invisible to the pressure
projection, which only ever sees divergence. Measured at rest with the
coupling raised: 29px/s of steady drift, which swept the glitter into one
end and held it there — the same failure the force-side fix was written for,
arriving by another route. Zeroing the bulk momentum would be wrong, since
sloshing *is* bulk momentum and a vessel tipped over genuinely has its
contents moving one way, so only the part that persists is removed: a
running mean over a second and a half, which a half-second slosh barely
registers in and a steady drift saturates. It takes the drift to 2.7px/s.

**Fizz appears where the liquid is being worked, and nowhere else.** A
liquid holds dissolved gas, and gas comes out of solution where the pressure
drops — and in a stirred liquid the lowest pressure is the core of a vortex.
That is why a propeller trails a line of bubbles, and why fizz in a shaken
vessel shows up in the curls rather than evenly through the volume. So it is
seeded by vorticity: sample eight points, take the one sitting in the
strongest swirl, and only while there is agitation to produce it. Measured:
none at all when the shaker is still, 300 while it is being shaken, and back
to a handful within three seconds of stopping.

It is emitted in puffs rather than one particle at a time, because
cavitation follows a vortex line and the gas comes out along it — spawning
singly gave an even dust that read as more glitter rather than as bubbles
being torn out of the liquid.

It is a separate population from the ordinary bubbles, not more of them. A
bubble in the main pool is a persistent object with a size, a film and a
life cycle; fizz is a puff that lasts a second or two and is gone. Being
small enough to follow the flow almost exactly, what it draws is the shape
of the eddy that made it.

**Bubbles make the liquid lighter where they gather.** A bubbly liquid
weighs less than the same liquid without bubbles, and where that mixture
collects it rises while the liquid it displaces comes down somewhere else —
it is why a glass of beer visibly circulates and why an airlift pump works
with no moving parts. The bubbles only ever pushed back through drag, which
is a local wake and nothing more; the buoyancy they carry, a hundred per
cent density deficit each against the few per cent the dense phase carries,
never reached the fluid at all. Measured, a cell in the top few per cent of
gas fraction gets 114px/s^2 of lift, against 75px/s^2 for the densest cell
of the heavy phase. It is a smaller effect than it sounds, because 70
bubbles across 2240 cells is a sparse field rather than a plume.

**A second, denser liquid** — carried as a passive scalar on the same grid
and advected by the same velocity field. The reference has a teal ribbon
curling through the blue, and it is not a painted gradient: it is a second
liquid that has not fully mixed. Giving it a density difference is what
makes it behave — it sinks, stratifying into a green-teal layer low down,
and a shake tears that layer into Rayleigh-Taylor fingers. The colour
gradient stops being decoration and becomes a consequence of stratification.
Measured: settled it separates to 0.01/0.96, a shake mixes it back to 0.68,
and the mean is conserved across both.

**Caustics** — the free surface is a lens. Where it curves concave it
converges the light passing through into a bright shaft in the body below;
where convex it spreads it thin. It is the strongest depth cue a real liquid
container has, and without it the body is evenly lit everywhere, which is
what made it read flat. Drawn in the gravity frame so the shafts hang
straight down however the phone is held, and added rather than blended,
because this is light arriving rather than a surface.

They are deliberately irregular: evenly spaced shafts of equal width read as
corduroy, so two incommensurate frequencies and a per-shaft width give them
the uneven spacing real caustics have.

**The wall has thickness.** Near the silhouette you are looking through a
lot of glass at a glancing angle, and a ray reaching the eye from there has
been bent inward on its way out — so what you see at the rim is not the
liquid immediately behind it, but liquid from further in, brought out to the
edge. A wide radial swath of the interior is squeezed into a narrow band,
and the squeeze grows toward the edge because the angle does. That
compression is what makes a thick glass object read as an object rather than
as a picture with a border drawn round it, and there had only ever been a
hairline where the wall should be.

It is done by drawing the frame back onto itself in six bands, each taking a
source deeper and wider than the band it fills. Two things fall out of that
mapping and both are the point: the band pulls in more depth than it
occupies, so what it shows is compressed by the ratio; and the order
reverses, the outermost sliver showing the deepest liquid, which is the
inversion you see in the rim of any thick glass.

The first attempt had it backwards. Sampling through a magnification about
the centre displaces the content inward, which sounds right, but the source
rectangle ends up *narrower* than the destination — that is a stretch, not a
squeeze, and it read as a ghosted copy of the interior rather than as a
wall.

Rectangular strips rather than a clipped annulus, because a per-frame clip
against this outline is the most expensive thing in the renderer; the corners
spill past the squircle and the glass layer's knockout trims them a moment
later.

**Read from a copy, not from the canvas being drawn to.** Two dozen
drawImage calls that take the destination canvas as their own source cost
20ms a frame — each one makes the browser snapshot the whole backing store,
because it cannot know the regions do not overlap. Copying what the bezel
needs into a scratch canvas first turns them into ordinary blits: a quarter
of the screen copied once, rather than the whole of it two dozen times. It
takes the bezel from 20ms to under 1ms.

**Dispersion.** Glass bends the short wavelengths harder than the long ones,
so at the steep angles the wall presents near its silhouette the colours
separate — the pair of faint warm and cool hairlines you get along the edge
of anything thick and transparent. Approximated as two offset strokes rather
than by splitting channels, which canvas has no cheap way to do, and baked
into the static glass layer rather than drawn per frame, because it belongs
to the glass and the glass does not move.

**The container edge is crisp.** It used to carry a 58px dark band blurred
over 43px, which had two things wrong with it. It turned the whole border
into a haze the liquid faded away into rather than filling up to; and it was
backwards — a pouch is a pillow, deepest through the middle and tapering to
nothing where the walls close, so absorption is strongest at the centre and
the rim is the *clearest* part. It is now a narrow bright band, barely
blurred: liquid thinning against a glass wall that refracts.

**Depth of field.** A camera focused on the front glass cannot also hold
the back wall sharp through this much liquid, and until now every flake and
bubble was rendered at identical sharpness whatever depth it sat at — which
is most of why the scene read as a picture of a shaker rather than a volume
with things suspended at different distances inside it. The back pass now
draws from a defocused copy of every sprite. Baked, not filtered per frame:
a blur over the whole back pass is one of the most expensive things canvas
can be asked to do, and costs nothing at build time. They are drawn inset so
the blur has somewhere to bleed, because defocus spreads a highlight outward
rather than growing the object.

**Aerial perspective.** Against a coloured background, dropping a particle's
alpha *is* the loss of contrast with distance — what shows through is the
liquid, which is exactly what absorption and scattering along a longer path
leave you with. The ramp used to run 0.68 to 1.0 for flakes, barely a fifth
of the range, and the fine glitter did not get it at all: every small flake
was drawn at full strength however deep it sat. It now runs 0.34 to 1.0 and
covers the fast path, the glow, and the specular.

Both together came out slightly *cheaper* than before, 24.5ms to 23.6ms,
because the far half of the population now composites at lower alpha and
there are no extra draw calls — only different sprites.

**Bubbles cast.** A bubble is a diverging lens, so it spreads the light
passing through it and the liquid directly behind it receives less. Nothing
in the scene occluded anything before, and a shadow is the one thing that
makes an object look like it is *in* a medium rather than painted on top of
it. Offset directly away from the source, and only for bubbles big enough to
have taken the detailed draw path anyway, so it costs 1.2ms.

**Depth** — the simulation is 2-D but the pouch is not, so every particle
carries a position through its thickness. Particles behind the mid-plane are
drawn before the liquid tint and read as immersed; those in front are drawn
over it and read as pressed against the glass. Light from the back wall
crosses the full thickness of liquid before it reaches the eye, and putting
those flakes under the tint layer is that absorption, for free. Tilting also
shifts the layers against each other, since the viewing angle changes.

**Bubbles are diverging lenses**, and that one fact sets their whole
appearance. Light crossing from water into air bends away from the normal,
so past an incidence of about 49 degrees none of it gets through at all — it
is totally internally reflected. On a sphere that angle falls at an impact
parameter of n_air/n_water = 0.75 of the radius, which cuts the disc into
two quite different objects:

- **inside 0.75R** you see the liquid behind, minified and turned upside
  down. A bubble therefore shows the far reaches of the pour rather than its
  own surroundings, and its interior gradient runs *opposite* to the liquid
  around it — pale where the liquid is deep, deep where the liquid is pale.
  That inversion is the strongest single cue that there is a hole in the
  water rather than a decal on it.
- **outside 0.75R** nothing is transmitted; the annulus is a mirror. But
  reflectance only climbs steeply in the last few percent of the radius, and
  over the rest of that band a bubble is reflecting liquid back at liquid of
  nearly the same brightness. So it is barely visible there, and the bright
  ring is thin and at the very edge.

Rendered as a size ladder at large scale over the real liquid — the only
test that has ever caught these — three earlier attempts each failed
differently. A rim with nothing inside it is a drawn circle. A lit-sphere
fill is an opaque milky marble, brightest exactly where a bubble is
clearest. A uniform white outline is a soap bubble floating in air. And
painting the whole quarter-radius annulus as opaque pale ring turns every
bubble into a rubber grommet: a fat raised collar around a flat dark disc.
Almost all of a bubble's contrast belongs in two thin rings and a hard
specular; the rest of it is a hole you can see through.

Two things orient a bubble and they are not the same thing. What it
**refracts** is fixed to gravity, because the liquid it is looking through
is graded along that axis. What it **reflects** is fixed to the light, which
does not move when the phone turns. Baking both into one sprite is what made
every bubble a stamp, so they are two layers now: the body turns with
gravity, the glint never turns at all. Verified by drawing one bubble at
four gravity angles — the specular held the same clock position in all four
while the interior inversion rotated.

They rise, weave, merge and burst. A bubble climbing through liquid is
flattened perpendicular to its motion, but only by a few percent at these
speeds — rendering that at the earlier strength turned every one into an
egg. New bubbles nucleate small and grow only by merging, which is the loop
that keeps the population in balance: respawning small with a fast rise
drained the shaker to a median radius of 3px, and respawning large ran it
away the other way to a median of 21px and 194 interpenetrating pairs.
Bubbles that touch merge with gas volume conserved, drawn together on the
way up by wake attraction — a bubble in another's wake meets less resistance
and catches it, which is why bubbles form chains in a real liquid and why
the large ones exist at all. Without wake attraction two bubbles have to
collide by chance: measured at zero merges in thirty seconds.

Rise speed follows r-squared only while Stokes drag holds, then plateaus —
and where that plateau sits used to be set for the wrong reason. It was at
34px/s, which is forty seconds to cross the screen: a bubble hanging in the
liquid rather than rising through it. It sat there because bubbles that rose
at any speed reached the surface and were lost, and slowing them down was
the answer to hand — a fudge standing in for a mechanism. What actually
holds the population up is where new bubbles come from and how long they
last once they arrive, and both of those exist now, so the plateau sits at
110px/s and a large bubble crosses in about ten seconds.

**Foam coarsens, and that is where the big bubbles come from.** Film
drainage was 1.4 seconds plus a tenth of a second per pixel of radius, and
almost the whole size distribution turns out to hang off that one number.
Bubbles at the surface are packed against each other, so the surface is
where coalescence actually happens — and bursting them after a second and a
half meant nothing ever got the chance to grow. Measured across a hundred
seconds of stillness, every bubble above 12px died and none replaced it,
with the largest in the vessel collapsing from 31px to 7: a shaker of
nothing but fizz. In a gel this viscous, laden with whatever holds the
glitter in suspension, a film takes tens of seconds to drain rather than
one. At ten seconds plus 1.4 per pixel the population holds 3-8 bubbles
above 12px indefinitely, with 11-17 of them resting in the surface layer at
any moment.

Two bubbles too large to merge push apart instead. A big bubble's film takes
far longer to drain, so they touch and stay separate — but they are still
solid objects, and without the separation a bubble at the size cap sat
permanently inside a neighbour it could never absorb, rendering as rings
drawn over each other.

**Air gets into a sealed vessel one way: the surface folds over and drags it
under.** Bubbles used to reappear at a uniformly random point deep in the
liquid, which is nucleation out of nowhere. A bubble born while the shaker
is being agitated now starts just beneath the waterline and is driven *down*
into the body by the plunging surface before climbing back, so a shake
produces a plume of fizz instead of a fixed population quietly recycling.
At rest the trickle comes off the glass, where a real vessel has its
nucleation sites. Measured: 17% of births are entrained at the surface when
the shaker is still, 87% while it is being shaken.

**The free surface is a lid.** Nothing stopped a bubble there before — it
kept climbing into the headspace for the two seconds its drain timer took,
so bubbles were visibly floating in the air above the waterline. A bubble
that reaches the surface now breaks through and stays, riding proud of the
line by a fraction of its radius, until the film drains and it bursts. It
bursts rather than fades: the sphere springs outward as the tension holding
it lets go. And it leaves a dimple that rings — an impulse into the wave
field at the point where it broke. That is the only thing the bubbles give
back to the water; without it the coupling runs one way, the fluid shoving
bubbles around and the bubbles never touching the surface they break
through.

**Path instability.** Below a critical size a bubble rises dead straight;
above it the wake sheds vortices alternately and the bubble zigzags across
its own rise. That threshold is real and was simply absent — every bubble
down to the finest fizz wove from side to side at a rate drawn at random
when it was born, which is why the fizz shimmered. The shedding frequency
now follows speed over diameter, in the Strouhal form, so a bubble that
stalls in the flow stops weaving and a fast one weaves quickly. Measured in
still liquid: fizz generates 0.0px/s of lateral motion, large bubbles
25.8px/s at 2.9Hz — and when the rise speed fell by a factor of three in a
later run, the frequency fell with it, to 0.9Hz.

**Response time is not a free parameter.** A bubble reaches terminal speed
when buoyancy balances drag, so tau = v_t / 3g, the 3 being the added-mass
result that a body of negligible density accelerates at three times the
fluid around it. Deriving tau from the rise instead of tuning it separately
— as it was — describes a bubble whose sluggishness and whose rise belong to
the same object rather than to two different ones. It also carries the
plateau over: past the point where rise speed stops growing with radius, the
response time stops growing too. Measured across the population, v_t/(3g·tau)
= 1.000.

**A bubble leads the flow; everything heavier lags it.** This is the one
thing relaxing toward the local flow can never reproduce, because relaxation
only ever lags. A bubble has no inertia of its own — all it carries is the
liquid it must shove aside — and the pressure gradient driving that liquid
drives the bubble harder still, so it accelerates at three times the fluid
around it and arrives at the far wall before the glitter does. Added
explicitly, and driven by the fluid's own local acceleration rather than by
the container's: what the liquid actually did is what the bubble responds
to, and because the sample follows the bubble it is a material derivative,
so eddies count too. Measured by switching the term off: bubbles lag the
accelerating fluid at 90px/s without it and 17px/s with it, a difference of
72px/s, against flakes lagging at 84px/s.

The mirror image of that was a bug. Feeding the container's acceleration
into the *flakes* as an effective gravity double-counts it, because the
relaxation toward the flow already makes a heavy flake lag a fluid that is
being thrown about, and lagging is precisely the dense-particle response to
acceleration. With both terms in, flakes drifted up the effective body force
during a shake — the wrong way for anything denser than the liquid.

**Glitter is foil, not confetti.** Each flake was a flat pastel silhouette
— one colour edge to edge, no material, no light — which read as a sticker
cutout. A real glitter flake is a tiny mirror: it carries a specular streak
where it catches the source, an iridescent shift from the pale end of its
hue to the saturated end (that is what iridescent means — the hue depends on
the angle, and a flake spans a range of angles), and a bright edge where the
cut catches light. The shards are angular offcuts with sharp corners rather
than the rounded lozenges they were.

**The light does not spin with the flake.** The specular streak was baked
into each flake sprite, so rotating the sprite carried the highlight around
with it — every flake read as having its own private light source orbiting
it. The streak is now a separate atlas of 16 orientations per shape, and the
draw picks the entry that cancels the flake's own rotation, so the highlight
stays in the same screen direction no matter how the flake tumbles. What
still varies with rotation is its *brightness*: a flake edge-on to the light
catches nothing, and face-on it flares. Verified by rendering the same flake
at eight rotations — the bright band held its screen orientation while the
star turned underneath it.

**Particles with Stokes drag** — response time and terminal velocity both
scale with radius squared, so fine glitter traces the flow almost exactly
while big flakes lag, overshoot on a turn and climb faster. That spread is
what makes the drift look like a real suspension rather than one moving
sheet. Flakes flutter as they travel; bubbles rise against drag.

**Flakes tumble because the water turns them.** Each flake used to spin at a
fixed rate assigned at birth, which meant a flake in dead-still water spun
exactly as fast as one caught in a shake. A flake is small enough to follow
the local rotation of the fluid, so it now spins at half the vorticity it
sits in — measured 0.68 rad/s at rest against 2.19 rad/s under a shake. The
flutter as it travels follows from that: rather than a free sine wave, the
sideways force is `sin(2 * (spin - gravity angle))`, which is zero when the
flake is edge-on or face-on to its travel and largest at 45 degrees. A flake
that stops turning stops fluttering, which is what a real one does.

**A flake is a plate, not a sphere.** Broadside to its travel it presents
its whole area to the liquid and creeps; edge-on it presents almost none and
slips. Its speed therefore depends on which way it happens to be pointing —
and since the spin now comes from the local vorticity, the liquid is what
decides. That is the stop-start quality of real glitter drifting: it stalls
as it turns broadside and slips as it comes round, where a constant terminal
speed gives an even glide. Normalised so the population's average rate is
unchanged, so this adds spread rather than emptying the body faster:
measured mean factor 1.035, with an edge-on flake moving 1.8x faster than a
face-on one.

**The glitter is buoyant, and that is the whole toy.** These flakes are
lighter than the gel they are suspended in — which is how a liquid-motion
shaker is actually built, the liquid loaded until it outweighs the film — so
they do not sink, they climb, and they gather in a drift under the
waterline. Turning the shaker over puts that drift at the bottom and you
watch it float back up. Modelled the other way round it was a sedimentation
tank: everything ended on the floor, and a flip only gave you the same thing
upside down. Measured upright from a mixed start, the glitter's centre of
mass climbs the screen from 0.423 to 0.299 over a minute, with 316 flakes of
620 ending in the top fifth; inverted it turns round and goes the other way,
0.344 to 0.544.

**It starts where it ends up.** The shaker used to open with everything
scattered uniformly through the container — measured, glitter and bubbles
alike sat at 0.47 of the screen, dead centre — and took a minute or two to
sort itself out, which is a minute or two of a wallpaper looking like it has
not settled yet. Both populations are now seeded in the resting state,
pressed up under the waterline and thinning downward, so the first frame is
the one you would have got by waiting.

**A flake must not hinder itself.** The concentration field is built by
dropping each flake's whole area into the cell it sits in, and a big flake
covers several cells' worth on its own: 35px of radius against a 14px cell
is a solid fraction of nineteen, against a maximum of one. It pinned every
large flake to a dead stop in liquid that was otherwise empty. Measured, the
big flakes were the *slowest* thing in the shaker, moving 0.518 to 0.460
over a minute while the fine glitter that is supposed to trail them went
0.473 to 0.336. Hindrance is what the other particles do to you.

**Rise speed is linear in radius, not quadratic.** The r-squared law is for
spheres. These are flakes cut from one sheet of film, so they all share a
thickness: buoyancy goes as the area, r-squared, while the drag on a disc
moving broadside goes as its radius — so the speed goes as r, and the spread
between the finest glitter and the largest flake is a factor of three rather
than twenty-five.

That is the difference between a suspension and two separate things. Under
the square law the big flakes outran the convection and packed into a hard
line at the surface while the fine glitter, too slow to beat it, stayed
evenly mixed: 519 flakes of 620 in the top quarter and 39 in the next, and
the lateral balance drifting to 0.80 as a single convection cell parked
everything on one side. With the spread narrowed the whole population
competes with the same convection on the same terms, and what settles out is
a gradient held in place by the balance between buoyancy and dispersion —
concentrated under the waterline, thinning down through the body, and stable
there. Measured over a minute of stillness it holds its shape: 318/137/86/79
flakes by quarter at load, 321/129/91/79 a minute later, with the lateral
balance at 0.97.

**How fast it resolves is a separate knob from where it settles** — up to a
point. The equilibrium is set by the *ratio* of the buoyant flux to the
dispersive one, so scaling both together mostly leaves the resting gradient
where it is and shortens the time taken to reach it. Scaled a little over
twice up, a flip resolves in about half a minute rather than a full one.

Past that the two stop being independent. A stronger climb sharpens the
gradient, a sharper gradient strengthens the dispersion pushing back down
it, and beyond a threshold the pair start trading pushes: measured, going
from 2.2 to 3.5 took the median flake from 8px/s to 149px/s and the
ninetieth percentile to 332. That is not settling faster, it is vibrating,
and it looks exactly like it sounds. There is now a ceiling on the
dispersive velocity, set well clear of anything the term does in normal
operation so it changes nothing there, and low enough to stop the runaway.

Capping it proportionally to each flake's own rise looked more principled
and was much worse. At equilibrium the dispersion has to *match* the rise,
so a cap in the same units is a cap on the balance itself: it took the tail
out of the gradient and packed 471 flakes of 620 into the top quarter. A
plain absolute ceiling leaves the balance alone and only catches the
pathology.

That scaling only worked once the dispersion term was normalised properly.
It is a flux down the *relative* gradient — what matters is how much more
crowded it is over there than here, not the absolute difference — so the
denominator has to be on the same scale as the field. It was a bare
constant, chosen back when that field counted flakes, and the field now
carries an areal fraction on a completely different scale. In the dilute
regions the constant dominated and the term stopped being relative at all.
Doubling the dispersion then drove the whole population *down* the container
and piled it on the floor, which is a strange thing for buoyant glitter to
do. Normalised against the field's own mean, it scales cleanly.

Flip it and the same gradient rebuilds at the other end within about five
seconds: 319/136/86/79 by quarter becomes 63/115/221/221.

**A drift has to end somewhere.** A flake climbing through a crowd of other
flakes has to drag the liquid they displace down past itself, so a dense
suspension moves far slower than a dilute one — Richardson and Zaki's
(1 - phi) to the 4.65. That is the reason a separating suspension forms a
sharp front, with clearing liquid behind it and a packing drift ahead,
instead of thinning out evenly everywhere. Without it there is nowhere the
glitter is going: measured from a well-mixed start, its centre of mass sat
at 0.49 of the container and was still at 0.53 a hundred seconds later, with
a flat profile top to bottom.

Hindered rise is also self-limiting, which matters because it takes over
a job that was being done by hand. Flakes disperse down their own
concentration gradient too — collisions and the disturbance flow around each
flake drive a flux from crowded regions to empty ones — and that term was
carrying all the weight, at a strength that stopped anything separating at
all. Wherever the convection cells concentrate the glitter it now slows
down, which is the same defence by a real mechanism, so the dispersion could
drop to a seventh of what it was.

It cannot go to zero. With no dispersion the glitter packs completely into
one end — 480 flakes of 620 in a single tenth after seventy seconds, which
is not something anyone wants to look at. What is left keeps the body
of the shaker populated while a bed still builds: the profile ends up
running 31 flakes in the top tenth to 229 in the bottom, rather than flat at
one end or empty at the other.

The rate went up threefold along with it. It had been slowed twice, the
second time because the body emptied — but that was the dispersion and the
missing hindrance fighting each other rather than a rate that was too fast.
With a drift that slows its own arrivals, the rate can be what the toy
actually does: a big flake crosses the container in seconds, the fine
glitter still hangs there for minutes.

Gravity is deliberately **not** normalised: the in-plane component genuinely
shrinks as the phone lies flatter, and normalising it makes a 5-degree tilt
pull as hard as an 85-degree one. It comes from a low-pass of the
accelerometer; the residual is the shake, which is a measured quantity
rather than a jerk heuristic.

The container is sealed, so it absorbs whatever net force its contents
exert and the total momentum stays zero. Both the particle reaction and the
buoyancy of the dense phase have their mean subtracted before they are
applied. This is not bookkeeping: a spatially uniform force is
divergence-free, so the pressure projection cannot remove the drift it
causes and it accumulates without bound. Measured upside down, the settling
flakes' own reaction had spun up a 28 px/s bulk flow against a 4.8 px/s
settling speed, sweeping every flake to the surface and pinning it there
permanently.

`level` is defined as the mean of the surface and `h` as the deviation from
it, with any bulk offset moved across each step. The two together describe
the surface, so the split between them is otherwise free — and left free it
drifts: rolling through 180 degrees sent `level` from 513 to -22 while the
wave grew to compensate. Volume stayed conserved to 0.1% the whole way, but
the crest bound is derived from `level`, so a sinking `level` licensed an
ever larger wave.

Volume is conserved by feedback rather than by solving the tilted squircle's
area: each frame clips the liquid polygon against the container, measures the
area, and nudges the surface level toward the target. It settles in a few
frames and costs one shoelace sum.

### Fixed timestep

The simulation runs on a fixed 1/60s tick with an accumulator. This is not
tidiness. Scaling every force by `dt` is not sufficient: semi-Lagrangian
advection smears a fixed amount per *step* and the pressure solve does a
fixed number of iterations per *step*, so both get twice the treatment at
twice the frame rate. Measured before the fix, the same two seconds of
shaking left the flow energy 21.6% apart between 30fps and 60fps; after,
0.0%.

## Options

Append as query parameters, e.g. `index.html?fill=0.7&stars=320`.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `mode` | `full` | `full` fills the screen; `pouch` floats a discrete squircle on a backdrop |
| `fill` | `0.965` | Fraction of the container holding liquid. The ullage is what sloshes — at `1` nothing moves |
| `n` | `4` | Corner squareness: 2 circular, 4 squircle, 8 nearly square |
| `corner` | `12%` of the short edge | Corner radius in pixels (`full` mode) |
| `stars` | `620` | Glitter flake count |
| `bubbles` | `110` | Bubble count |
| `fizz` | `300` | Ceiling on the fine fizz, which is spawned by the flow rather than seeded |
| `scale` | `0.78` | Container size against the short edge (`pouch` mode only) |

Drop `stars` to about 300 and `bubbles` to 30 on a low-end device; the
fluid solver's cost is fixed, so the particle count is the dial that matters.

## Getting it onto an Android home screen

Android has no built-in way to set a web page or a video as a live wallpaper,
so all three routes below need a host of some kind. Worth knowing before you
pick one.

**Interactive, via a WebView wallpaper host.** Several apps on the Play Store
host a local HTML file as a live wallpaper. Copy `index.html` to the device
and point the app at it. This is the only route that keeps the shake
response. Check that the app grants the page motion-sensor access — some
WebView hosts do not, and the wallpaper falls back to a static tilt.

**Interactive, via your own `WallpaperService`.** The robust version: a small
Android app with a `WallpaperService` hosting a `WebView` pointed at this
file in `assets/`. Roughly a hundred lines of Kotlin and it behaves exactly
like a first-class live wallpaper. This repo ships the render layer, not an
APK.

**Pre-rendered, via a video wallpaper app.** Render `shaker_loop.mp4` from
the Blender pipeline and set it with a video-live-wallpaper app. Highest
visual quality by a wide margin, and completely inert — shaking does nothing.

The page already stops its animation loop whenever the document is hidden,
which is what keeps it from draining the battery while the launcher is not
showing.

## iOS

`DeviceMotionEvent.requestPermission` is gated behind a user gesture, so an
"Enable motion" button appears automatically when that API is present. iOS
does not support custom live wallpapers at all — the video loop from the
Blender pipeline, saved as a Live Photo, is the only route to the lock
screen.

## Verified

Driven headless in Chromium at a 390×844 viewport, no runtime errors, with
rest, tilt, shake and settle confirmed visually. Volume stays conserved
through a violent shake.

Measured, with a seeded PRNG and a hand-driven clock so runs are comparable:

| Property | Result |
| --- | --- |
| Frame-rate independence (2s of shaking, 30 vs 60fps) | flow energy 0.0% apart, particles 0.1px |
| Settling over 20s of stillness | mean flake moves 112px with gravity |
| Flow decay after the drive stops | RMS 570 → 26 px/s in 3s |
| Peak wave under a 3.4g shake | 44% of the amplitude cap |
| Capillary term stability | no non-finite values in surface or flow after a 2.3g shake |
| Settling convection with zero input | 19 px/s flow, ~100% of it spatial structure rather than drift |
| Dense-phase stratification | separates to 0.01/0.96 settled, mixes to 0.68 shaken, mean conserved |
| Inversion (roll 180°) | `level` matches its expected value at 0°, 90° and 180°; volume conserved to 0.1% |
| Net fluid drift | 12.7 px/s before the momentum fix, 0.99 after |
| Bubble population at rest | median 4.3px, max 31px, 3-8 above 12px, stable over 100s |
| Convection after a flip | decayed 357 -> 29px/s at the old coupling, holds at 51 now |
| Sealed vessel holds no drift | 29px/s of bulk drift at that coupling, 2.7px/s with the high-pass |
| Gas lift on a bubble-rich cell | 114px/s^2, against 75 for the densest cell of the heavy phase |
| Film drainage sets the size range | largest bubble 7px at 1.4s drainage, 31px at 10s |
| Flake distribution at rest | emptiest fifth 0.47 of the fullest after 80s of stillness |
| The resting gradient holds | 394/92/63/71 flakes by quarter, median apparent speed 11px/s |
| Laterally even | left/right balance 0.97 after a minute, against 0.80 under the square law |
| A flake does not hinder itself | big flakes went from the slowest thing in the shaker to the fastest |
| It floats back after a flip | resolves in about 30 seconds, against a minute before |
| Rate is mostly independent of the resting shape | scaling rise and dispersion together shortens the approach — until they couple |
| Where that stops being true | 2.2x: median flake 8px/s. 3.5x: 149px/s, and 332 at the ninetieth |
| A proportional cap is the wrong cap | it packs 471 flakes of 620 into the top quarter; an absolute one does not bind |
| Dispersion cannot go to zero | without it 480 flakes of 620 pack into a single tenth |
| A tilted surface drives the liquid downhill | 43.8px/s with the slope term, 0.4px/s without |
| A pure rotation sloshes | peak surface deflection 95px before the basis tilt, 219px after |
| A 180-degree roll conserves the fill | level returns to 0.02% of where it started |
| Orientation changes how fast a flake falls | 1.8x between edge-on and face-on, population mean unchanged |
| Flake tumbling tracks the flow | 0.68 rad/s mean spin at rest, 2.19 under a shake |
| Specular stays with the light | bright band holds screen orientation across 8 flake rotations |
| Frame cost held still | median 31.5ms, and no fizz on screen at all |
| Frame cost under continuous shake | median 37ms (software rasteriser, no GPU) |
| What the fizz costs | about 5ms, and only while the shaker is being shaken |
| What the bezel costs | 20ms reading from the live canvas, 0.3-0.7ms reading from a copy |
| What 40 more bubbles cost | about 1ms, inside the run-to-run noise |
| Depth of field and aerial perspective | cost nothing: 24.5ms before, 23.6ms after |
| Bubble shadows | 1.2ms, for the 15 or so bubbles large enough to get one |
| Bubble rise and response time agree | v_t/(3g·tau) = 1.000 across the population |
| Buoyancy separates the phases, held still | bubbles climb 19.4px/s, flakes settle 4.8px/s |
| Added mass makes bubbles lead the flow | lag 90px/s without the term, 17px/s with it; flakes lag 84px/s |
| Weave is gated on size | fizz 0.0px/s lateral, large bubbles 25.8px/s at 2.9Hz |
| Air is entrained at the surface | 17% of births at the waterline when still, 87% while shaken |
| Bubbles stay out of the headspace | 0 above the waterline over 90s, at rest and shaken |

Frame rate measured here is misleading and worth explaining. Profiled
in-page, the whole simulation step costs ~3ms and issuing the draw calls
~2ms — but a frame takes far longer. The missing ~21ms is not in this code at all:
it is the browser rasterising a full-screen canvas in software, because the
container has no GPU. On a device with an accelerated canvas that cost is a
fraction of this. Treat the ~41fps seen here as a software-rasteriser
number, not a device one; `stars` is still the dial if a real device needs
it.

The world-fixed specular costs a second sprite blit per flake and did not
move that number, because the blit is small and the cost is dominated by
compositing area, not by call count. Splitting the bubbles into a
gravity-fixed body and a light-fixed glint costs 2.2ms, and that one is
visible in the profile: only 15 of the 70 bubbles are large enough to take
the two-blit path, but between them they cover about a tenth of a
full-screen fill and each blit goes through a rotation. A combined sprite
for the middle of the size range would save a twentieth of that, which is
not worth the branch.
