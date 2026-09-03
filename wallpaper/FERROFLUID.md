# Ferrofluid — interactive wallpaper, black on white

A pool of magnetic liquid at the bottom of the screen and a pair of magnets
you cannot see, drifting behind the glass. The liquid reaches for them, stands
up in spikes, throws beads of itself into the air and falls back. Tilt the
phone and it finds a level; shake it and it sloshes; touch it and you become
one of the magnets.

One self-contained HTML file, no build step, no dependencies — the same shape
as [the liquid shaker](README.md), and it uses the same host interface, so the
[Android service](../android) hosts either page without knowing which it has.

There is no colour in it anywhere. A magnetic liquid is already black, and a
black liquid on white paper is entirely silhouette; if the shape is not right
there is nothing else to look at. That constraint is the point of the piece
and the reason it is worth building the physics properly rather than animating
something that resembles it.

## Try it

Open `ferrofluid.html` in a browser.

- **Drag** — a magnet follows the pointer. This is the interaction the whole
  thing is built around, and the one a tap does on a phone.
- **Shift-drag** — tilts gravity instead, which is what the accelerometer
  gives you for free on a handset and nothing gives you on a desktop.

On a phone it uses the real sensors, and needs to come off an `https://`
origin to get them; the notes in [the shaker's README](README.md#on-a-phone)
about secure contexts, the wake lock, fullscreen and installability apply
here unchanged, because that machinery is the same in both pages.

## What is actually being simulated

A **thin vertical cell**: ferrofluid between two plates a hair apart, magnets
moving in the plane behind it.

That framing is not a stylistic choice, it is forced. The Rosensweig
instability — the spikes, the only reason anyone remembers what ferrofluid
looks like — throws its peaks *along* the field. The textbook photograph is a
magnet under a dish and the field pointing up out of it, which is exactly the
one arrangement whose spikes would be invisible here: they would come at the
camera and the silhouette would show a circle. Put the field in the plane of
the screen and the spikes lie in the plane too, and the silhouette becomes the
whole of the physics. A Hele-Shaw cell is a real piece of apparatus that does
this, so the wallpaper is a picture of something rather than a compromise.

### The magnets

A pole is a point with a standoff out of the plane. The standoff is not a
fudge factor: a true point source has an infinite field at its own position,
and a liquid pulled infinitely hard collapses to a dot in one step. Lifting
the pole off the plane makes the field finite everywhere in it, and makes
strength and reach separately adjustable — which is the real difference
between a magnet pressed against the glass and one held back from it.

In-plane, such a pole has *no* field directly over itself, a maximum on a ring
of radius z/√2, and an inverse square beyond. The ring is worth knowing about,
because it is why a magnet held against the glass grows a crown around itself
instead of one spike in the middle.

On a screen bigger than the reference size each magnet becomes a *pair* of
opposite poles instead — a bar magnet rather than a single pole — whose field
falls off as an inverse cube because the two cancel at a distance. That is the
one thing that has ever made the wallpaper hold together on a tablet, and it
costs the spikes; both halves of that are measured under **Known bad**.

Two of them, on opposite polarities so the pair reads as a bar magnet rather
than two of the same end, working the pool in turn. Each runs the same cycle,
half a period apart, so that while one is carrying liquid upward the other is
already on its way back down for the next handful:

| phase | what the magnet is doing | strength |
| --- | --- | --- |
| 0.00–0.10 | away | 0.08 |
| 0.10–0.18 | comes down out of the paper to the surface | 0.08 → 1 |
| 0.18–0.28 | holds just above it, while the liquid climbs | 1 |
| 0.28–0.44 | lifts, and the column stretches after it | 1 |
| 0.44–0.50 | lets go; the column necks and falls back | 1 → 0.08 |
| 0.50–1.00 | drifts back across for another | 0.08 |

A magnet works for a third of its cycle and is away for the rest, which with
the pair half a period apart leaves two clear seconds in every thirteen when
nothing is pulling at all. **The rest is not padding.** Magnetic force here
runs into a clamp measured in gravities, and two magnets holding it there
without a break give the pressure solver nothing to catch up in: run
continuously, the first version of this took a 600×1000 cell apart into a spray
of beads across the whole screen. It is also better to watch — a lift reads as
a lift because of the stillness before it, and a surface that is never at rest
never shows one.

It holds *above* the surface at the grab, not in it. A magnet that dives below
puts its ring of peak field inside the pool, where the pull tears the interior
apart in every direction at once and the free surface has nothing to do; that
was the other half of the same collapse.

That is the demonstration everyone has actually seen someone do with a bottle
of ferrofluid, and it is the whole reason the choreography is written this way
rather than as a wander. The pull goes as roughly the fifth power of distance:
a magnet a hundred pixels off the surface exerts hundredths of a *g* and is
decoration, and one at the surface exerts ten and picks the liquid up. There is
no middle. So the heights above are in **pixels from the surface of the pool**,
not fractions of the screen — written as fractions they stop working the moment
the fill or the screen size changes, which is exactly what went wrong the first
time. It travels while it is empty-handed and holds its ground while it has
liquid, so a lift reads as a lift rather than as a swipe.

**The lift keeps pace with what it is lifting.** The phase table says only how
high the magnet is *allowed* to be; where it actually goes, while it is
carrying, is a fixed standoff above the crest under it. The first version
climbed against the clock and simply outran the liquid — the same fifth power
that makes the grab work makes sixty pixels of daylight the end of it, and what
you watched was a mound sitting still while a fan of iron filings sailed off up
the screen. Which is exactly the thing that makes a piece look like a picture
of ferrofluid rather than ferrofluid. A hand holding a magnet watches the
liquid and climbs at the speed it can follow; so does this. The column
stretches until it necks, the liquid falls away, and only then is the magnet
free to run up to the ceiling — by which point the schedule is fading it out
anyway.

That standoff is not a taste number: it is z/√2, the radius of the pole's own
ring, which is the height that puts the strongest part of the field on the
crest rather than beside it. Measured over a minute at five phone sizes,
anything from 20 to 50 px produced the same crest statistics to within the
run-to-run scatter, so there was nothing to tune and the physics chose it.

**A broader magnet makes sharper spikes**, which is backwards until you see
why. Held tight and strong, the field is effectively a point: the pool is
hauled bodily up underneath it and what rises is a dome — a geyser. Held
broader, a whole band of surface sits above the instability threshold at once,
and the surface gets to pick its own wavelength across that band, which is what
a crown of spikes *is*. The same logic says the body force has to come down as
the magnet widens, because bulk pull is exactly the thing that lifts the pool
as one mass and drowns the instability; `pull` went from 3.2 to 1.3 for that
reason.

Measured over three seeds, against the version that only choreographed the
magnets:

| | before | after |
| --- | --- | --- |
| peaks on the surface at once | 4.5 | 7.6 |
| how far they stand above their flanks | 30 px | 55 px |
| height ÷ width | 0.60 | 1.15 |
| beads adrift in the air | ~1 | ~1 |

Push it further and it stops being spikes: at a standoff of 0.13 of the
reference size the band is so wide the tips pinch off and it throws beads
instead — confirmed across seeds, so that is the edge and not one unlucky run.
Backing the field off instead of the geometry does not help either; at 0.85 of
full field the aspect falls back to 0.93 and buys nothing.

The crest it follows is where the top *three percent* of the liquid within a
magnet's reach sideways is, not the topmost drop. A spray of beads thrown clear
by a tap is not a column, and a magnet that took one for a column would leave
the pool to chase a speck across the screen. Reading it off eight drops was
enough to do exactly that.

It is measured every fourth step rather than every step, staggered between the
two magnets. The scan is the most expensive thing in the magnet code and the
magnet is speed-limited to about three pixels a step, so the reading is at most
a dozen pixels stale against a thirty-five pixel standoff. All of it together
costs 0.1 ms a frame.

Above the pool is where the interesting behaviour is: a magnet under the liquid
pulls it down into itself and the surface has nothing to do, while the same
magnet held over it lifts and spikes with the same force. Their paths are laid
out in the gravity frame, so tilting the phone takes the magnets with it and
"above the pool" goes on meaning above the pool.

Nothing in the shape of the liquid is keyframed. What is scripted is only where
the magnet goes and how hard it is pulling when it gets there; every crest,
spike and column is the liquid's own answer to a field that is being moved.

### When the phone is flat

The premise is a cell standing on its edge, and most of the time a phone is
anywhere it is lying face up on a desk. Then the cell is horizontal, gravity
leaves the plane entirely, and the liquid is weightless in the only two
directions that are drawn. Nothing opposes the magnets: measured, forty
seconds of that climbed the walls and covered the whole screen in a black
starburst, with the icons somewhere underneath.

It is not even wrong — a horizontal Hele-Shaw cell really does that. What
holds a real one down is friction against the plate, and a two-dimensional
model has no plate to have friction against. So the in-plane weight has a
floor of half a gravity, along whichever way was last down. The pool stays a
pool, and lying flat becomes a livelier version of the same piece rather than a
different one: measured over a minute, the liquid's top averages 50% down the
screen.

The floor was a third until the magnets were widened to make a crown. A broader
magnet's far field grows as the square of its standoff, so it reaches much
further, and flat on the desk it walked the liquid a sixth of the screen higher
than before — enough to fail this check. Upright the constant does nothing at
all: real gravity is a full *g* and the floor never binds, so this is a lever on
the flat case alone.

### The liquid

Clavet, Beaudoin and Poulin's double density relaxation (SCA 2005). Two
densities per drop: the ordinary one, whose pressure is *signed* and so pulls
the liquid together wherever it is thinner than it wants to be, and a
near-density whose pressure is strictly repulsive and stops the first from
collapsing everything to a point.

Cohesion, incompressibility, and two beads merging when they touch all fall
out of those two terms, and there is no special case for a droplet.

**Cohesion is not surface tension, though, and for a long time this had only
the first.** That turns out to be the difference between a liquid and a swarm.
Akinci, Akinci and Teschner make the point exactly ([SIGGRAPH
2013](https://history.siggraph.org/learning/versatile-surface-tension-and-adhesion-for-sph-fluids-by-akinci-akinci-and-teschner/)):
cohesion forces "can trivially balance each other in a form that does not
necessarily correspond to the smallest surface area". A pool held together by
cohesion alone keeps every bump it ever acquires, because nothing in it prefers
a smooth shape to a lumpy one.

So the curvature half of their model is here now. For a pair of drops,

    F = -γ K (n_a - n_b),   K = 2ρ₀/(ρ_a + ρ_b)

with **n the un-normalised colour-field gradient** — that detail is the whole
thing. Normalised, every drop in the bulk would get a unit vector pointing in
whatever direction its rounding errors happened to face, and a surface-area
force would act throughout the liquid. Un-normalised it is essentially zero two
layers in, so the term is a surface force because of what it is made of rather
than because of a flag. It is applied antisymmetrically, so it moves no
momentum and cannot push the pool across the screen.

There is a second thing it buys, which is not decoration. The Rosensweig
instability *has no length scale* without it: nothing in a bare magnetic
traction prefers a spike four drops wide to one drop wide, which is why the
traction has always needed a clamp to stop it peeling the surface off one drop
at a time. In a real ferrofluid what sets the spacing is precisely this balance
— surface tension against gravity and the field — and the peaks come out about
one capillary wavelength apart.

The rest density is not a tuned constant. It is measured at startup by summing
the solver's own kernel over a hexagonal packing at the drop spacing, which
costs one loop and removes the single most fragile number in the method.

### The magnetism

Four separate forces, because they are four separate pieces of physics and
they fail in different ways.

**`pull` moves the liquid.** Magnetophoresis: F = μ₀M∇H, a body force up the
field gradient. Saturating in M is what stops a magnet from becoming a black
hole at close range.

**`spike` shapes the free surface.** The magnetic traction on an interface is
what makes a flat pool of ferrofluid unstable in the first place. It is
applied as an outward stress on surface drops, weighted by how squarely the
surface faces the field, so the surface extrudes along H and is left alone
across it. Integrated over any closed body it is exactly zero, which is why it
changes shape without moving anything.

**`chain` is the microscopic cause of the other two.** Induced dipoles attract
head to tail and repel side by side, with a torque that turns a pair into a
link, so the drops string into chains lying along the field.

**`self` is the field the liquid makes at itself,** and it is the difference
between a pool that lifts and a pool that spikes. A traction from an applied
field alone raises the whole surface evenly and stops; a real ferrofluid runs
away into peaks, because a bump concentrates the field lines through itself
and so magnetises harder, which grows the bump. That is the same sum as the
demagnetising field with the sign kept honest — a neighbour lying along the
field adds to it, one lying across it subtracts — so a drop with neighbours
stacked above and below it sees more field than one in a flat sheet, and the
instability is a consequence rather than a shape someone drew.

### Where the model is knowingly short

The instability has a length scale in reality and does not have one here.

What selects the wavelength of a Rosensweig pattern is surface tension, whose
restoring force grows as the square of the wavenumber and so bites hardest on
the shortest wavelengths. A thousand drops cannot resolve a wavelength short
enough for that to happen, so left alone the traction picks the shortest
wavelength there is, peels the surface off one drop at a time, and boils the
pool away in about a second. Two things stand in for the missing physics:

- **the traction is capped** at a few gravities, below the cohesion the liquid
  actually has, so it can shape a surface but never take one apart; and
- **the drawing kernel is prolate.** Each drop is splatted as an ellipse
  stretched along the local field by a factor that grows with its
  magnetisation and preserves its own area. That is not a cheat to draw a
  spike the physics did not produce — a chain of magnetised particles
  genuinely is a prolate object and a circle would be the wrong picture of it
  — but it is what puts a point on the tip of a peak that a thousand drops
  could never resolve on their own. Only drops with air around them stretch;
  in the bulk there is no interface to be prolate about, and streaking it
  would only show the discretisation.

Set `spike=0&self=0&chain=0` to see the honest floor: a liquid a magnet still
drags about, that never grows a single peak.

## How it is drawn

A thousand discs are not a liquid; one contour around the sum of a thousand
kernels is — but only if the kernels are wide enough, and that single number
decided more of how this reads than any force in the solver. At the original
1.44 drop spacings each drop barely overlapped its neighbours, so the outline
undulated at the drop scale: bead-strings, one-drop-thick worms, a silhouette
visibly made of *things*. A liquid has no such scale. Widened to 2.4 the field
between neighbours is flat and the outline is the shape of the body rather than
of its sampling — measured, the perimeter for a given area falls by a fifth,
with the isolevel raised alongside so the liquid covers the same fraction of
the screen instead of fattening by a tenth. It changes no physics at all; the
solver does not know the drawing exists.

The field is splatted on a grid and the isoline extracted with
marching squares, keyed by grid edge rather than by coordinate — so the
contour is chained by integer identity and never by a tolerance on two floats
that ought to be equal. The grid extends past the screen by the kernel's
longest reach, so the field always falls to zero inside it and every contour
closes; without that margin a pool touching the bottom of the screen produces
an open polyline and the fill goes wherever it likes.

The **sheen** is strokes along that contour, not a shaded image over the body,
and the reason is what the material is. Ferrofluid is a black mirror: nearly
all of what you see on it is one hard reflection of whatever is bright in the
room, riding the edge where the surface turns away. Shading the interior
instead — which this did first — comes out looking like smoke in a jar. So the
silhouette is clipped, and the lit runs of the outline are stroked in tiers by
how squarely they face the light.

Four details in there are load-bearing, and all four were found by watching a
clip rather than a still:

- **The normal is measured across 22 px of surface**, not between neighbouring
  vertices and not across a fixed number of them. The reason is bigger than it
  sounds. The metaball field ripples at the drop spacing: measured, a pool at
  rest undulates 0.6 px RMS with a 9 px period. Six tenths of a pixel is
  invisible as a shape — but over a 9 px period it swings the surface *normal*
  by ±35°, and the highlight boiled along the whole edge of a liquid that was
  barely moving. Averaged over a couple of ripple periods, what is left is the
  shape's own curvature. Counting a fixed number of vertices does not do it:
  vertex spacing varies with the angle the contour crosses the grid at, so
  five along is a different arc length every frame.
- **The bright tiers arrive with curvature**, not merely with facing. A
  mirror-flat surface reflects the whole room rather than a compact highlight;
  it is curvature that squeezes a window into a bright band. So a dim broad
  sheen goes wherever the light falls and the glints are reserved for tips and
  beads. Without that the highlight is a constant-width line all the way round
  every shape, and a pool at rest reads as a black bar someone has outlined.
- **Each band is a stack of narrowing strokes**, not one wide one. A stroke has
  a hard edge, so a 15 px line at a flat alpha paints a grey ledge running
  parallel to the whole outline — the liquid comes out looking like a sticker
  with a bevel on it. Five passes at a fraction of the alpha accumulate into a
  falloff and none of their edges is visible.
- **Every stroke is set in by half its own width.** Centred on the contour,
  half of it falls outside and the clip takes it — and not cleanly: what
  survives sits on the clip's antialiased edge at a fraction of its coverage,
  and the glint that should be white comes out a mid grey.

The **light is fixed in the world, not on the screen.** It comes from above
and a little to one side of wherever "above" currently is, so rolling the
phone rolls the highlight around the liquid, which is what happens when you
roll a real object under a real window.

The **iron filings** are the oldest way of drawing a magnetic field and still
the clearest, and they are the only thing on the page that says where the
magnets are — a magnet behind the glass is not visible and its effect on the
liquid is often a screen away. Their *shape* is referenced to the strongest
pole rather than to an absolute field, so the hatch covers the same patch
however strong the magnets happen to be at that instant; on an absolute
threshold a magnet at full strength puts ticks in every corner and the
wallpaper turns into a diagram.

Their *weight*, though, has to be absolute, or the shape rule lies. Normalised
only against itself, a magnet parked at a fifteenth of its working strength
draws exactly the same hatch as one bearing down on the surface — and the page
ends up with a fan of field lines across it while the liquid lies flat and does
nothing, which is a picture of a magnet that is not there. So the alpha is
scaled by how strong the strongest magnet actually is against its own working
maximum. The hatch comes up as a magnet comes down and is gone while it is
away, which makes it say when something is about to happen rather than merely
where.

They also have to be *wide* and very faint rather than tight and dark. Drawn
tight they are a small asterisk floating in white space, which reads as a
smudge on the screen rather than as a field; given room the arcs curve and it
reads as what it is. `filings=0` removes them, and the piece is perfectly good
without.

## Fixed timestep

The simulation runs at 1/60 s whatever the display is doing, and drops steps
rather than taking longer ones. Position-based relaxation is only
conditionally stable and its stiffness is expressed in dt²: hand it a 40 ms
frame after a stall and the pressure correction overshoots into a spray of
drops that never comes back.

It also means the page can decline to draw. The simulation is fixed at 60 Hz
and a great many phones now refresh at 90 or 120, so on those every second or
third frame arrives with the accumulator short of a step: nothing has moved and
the canvas already holds the right picture. Redrawing it is a third of the
frame's work spent reproducing the previous frame exactly, which on a wallpaper
is battery and nothing else. Measured at 120 Hz, half the renders are skipped
and the median frame drops from 4.3 ms to 3.6 ms.

Four more guards exist for the same reason, and each of them is a failure that
actually happened during development rather than a precaution:

| Guard | What it prevents |
| --- | --- |
| Speed capped at one interaction radius per step | A drop that outruns the neighbour search stops finding the neighbours it is touching, so it loses its pressure and moves further still — and the end state is every drop in one hash cell with the solver quietly gone quadratic |
| Pressure correction capped per neighbour pair | Slam the liquid into a wall and a drop can find three times the neighbours it wants; the correction meant to ease it out is then a shove of tens of drop-widths, and the pool comes apart into a spray that never finds itself again |
| Traction capped, and switched off on lone drops | Written the obvious way — strongest where a drop is most exposed — the traction is strongest on a drop that has already left, which accelerates it further. It is an *interface* stress: it needs liquid on one side and air on the other, so it peaks at half the rest density and falls to nothing at both ends |
| Magnetophoretic pull capped | A body force should move the body: in a real liquid, pressure redistributes it faster than it can pull anything apart. The pressure solver here has a bounded correction per step, so a force varying steeply over a few drop-widths — a strong magnet close to the liquid, which is exactly what a tap is — outruns it, and four taps pull the pool to pieces. The clamp does more than limit the force: inside it every drop gets the *same* pull, so the differential that does the tearing is gone |

## Options

Append as query parameters, e.g. `ferrofluid.html?spike=30&filings=0`.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `mode` | `full` | `full` fills the screen; `pouch` floats a square tile on the paper |
| `fill` | `0.185` | Fraction of the cell's area holding liquid |
| `drops` | `1000` | Drop count. Deliberately not scaled with the screen: the spacing is derived from the fill area and this, so a fixed count means a larger screen shows the same picture larger rather than the same picture made of more and finer drops |
| `ink` | `#0b0b0d` | The liquid |
| `paper` | `#f2f2f3` | Everything else |
| `poles` | `2` | Drifting magnets. `0` leaves a pool that only answers the phone |
| `field` | `1` | Overall magnet strength |
| `pull` | `1.3` | Magnetophoretic force near a pole, in gravities. A *body* force, so raising it lifts the pool as one mass and drowns the spikes — see the geyser-versus-crown note above |
| `spike` | `20` | Surface traction at full magnetisation, in gravities (capped at 3 in flight) |
| `chain` | `0.1` | Dipole force between neighbouring drops |
| `tension` | `0.01` | Surface tension, as surface-area minimisation, in gravities. `0` is the older look: taller spikes, and a visibly more shredded one. Above about `0.02` it starts rounding the crown off into mounds |
| `self` | `1` | How much of its own field the liquid makes — the spike/no-spike dial |
| `hsat` | `0.8` | Saturation field. The applied field is deliberately kept near half of this; saturated, the liquid's response is flat and it has no reason to prefer a peak to a plain |
| `gloss` | `1` | Specular sheen |
| `shadow` | `1` | Drop shadow on the paper |
| `filings` | `1` | Iron-filing hatch. Its ink is weighted by how hard the strongest magnet is actually pulling, so it fades out while they are away |
| `dip` | `0.9` | Spacing of the two poles of a bar magnet, in standoffs. Used only above the reference size; `dip=0` forces a single pole everywhere, which is the spikier look and the one that tears a large pool apart |
| `grid` | from the drop spacing | Simulation grid in CSS pixels — the performance knob; raising it coarsens the contour and the shading together |
| `n` | `4` | Corner squareness: 2 circular, 4 squircle, 8 nearly square |
| `corner` | `10%` of the short edge | Corner radius in pixels |
| `scale` | `0.82` | Tile size against the short edge (`pouch` mode only) |

`drops` is the dial that matters on a slow device: the solver is most of the
cost and it is linear in the drop count. Everything under **Look** above is
close to free.

## Rendering it

```bash
node wallpaper/tools/render-ferrofluid.mjs          # stills
node wallpaper/tools/render-ferrofluid-motion.mjs   # a clip
node wallpaper/tools/verify-ferrofluid.mjs          # the numbers below
```

The first writes a contact sheet to `/tmp/ferrofluid` and rewrites the
thumbnail the Android wallpaper picker shows. The second answers the question
a still cannot — whether it reads as a magnetic liquid when something is
actually happening to it — by driving one motion script through the magnets
working the pool alone, two taps, a roll and a shake, and piping the frames
straight into ffmpeg. It needs an ffmpeg with libx264, which Playwright's
bundled build is not; the header lists four ways to get one.

The third is the one that catches things, and what it catches is under
**Verified** below.

All three hand-turn the clock and seed `Math.random`, so two runs produce the
same picture and a change to the page is visible as a change to the output
rather than as noise. That matters most for the clip: with the real clock the
frame interval is however long a software rasteriser happened to take, so the
playback speed would encode machine load rather than simulated time.

## Verified

Driven headless in Chromium at 420×880 with a seeded PRNG and a hand-driven
clock, so runs are comparable.

| Property | Result |
| --- | --- |
| Runtime errors across 12 configurations and 8 viewports, each resized mid-run and each sent a NaN tap, a NaN motion and a NaN offset | none, and no drop lost or escaped, at any size — tablets included, for the first time |
| Drops leaving the cell — ever, in any of the below | 0 of 1000 |
| A 2 s shake | 92% of drops in a body before, 89% immediately after, 89% ten seconds later; peak speed 929 px/s |
| Four taps in nine seconds, the worst a user can do to it | 98% -> 93% -> 81%. Before the pull was clamped the same sequence left a spray across the whole screen that never recombined |
| Five home-screen swipes arriving in one frame | 92% -> 86% -> 91%. Before the relaxation was bounded, two of these left every drop pinned at the speed limit and still pinned there ten seconds later, with the pool gone |
| 52° of tilt held 12 s | 100% in a body, occupying 83,323–416,876 of 420×880 |
| Face up on a desk for a minute | 82% in a body, and the liquid's top averages 51% down the screen. Before the weight had a floor it covered the screen |
| 45 s idle | 99% in a body, drop count constant |
| 60 fps against 30 fps, 8 s idle | mean 2.5 px apart, max 11 px, against a drop spacing of 8.9 px. The two are not bit-identical: the accumulator loses one step in 480 to floating point, and the sensor filters run per event rather than per simulated second, as they do on a handset |
| JavaScript per frame, 1000 drops | 4.6 ms median, 5.4 ms at the 95th percentile, with a realistic gap between frames — 0.9 ms of that is the wider metaball kernel, A/B'd. `drops=700` takes it to 3.6 / 4.0 ms. Following the crest costs 0.1 ms of that, measured against the same page with it removed |
| Frame-to-frame change with the liquid at rest | 0.13/255 mean, 0.24% of pixels moving more than 12 levels — the residue of drops still very slightly settling. It was a third higher before the surface normal was measured over arc length, and what moved then was the highlight rather than the liquid |

Two of those numbers were themselves wrong before this table was checked
against how the thing runs. The frame cost was quoted as 8.5 ms, which was a
*mean* of frames driven back to back with no gap. Driven that way the canvas
occasionally stalls waiting to flush, and the handful of forty-millisecond
frames that produces pulls the mean past 11 ms while the median never moves
off 3.7 ms. The flat-phone check, meanwhile, asserted on a single final
bounding box, which is meaningless for a chaotic system: it failed on a splash
while the behaviour over the whole minute was fine. Both now measure a
distribution.

Re-run all of it with `node wallpaper/tools/verify-ferrofluid.mjs`, which
exits non-zero if any of it regresses. It exists because two real defects got
through a reading of the code and a look at the stills — a NaN tap silently
turning every magnet off, and the relaxation manufacturing kinetic energy
without bound — and neither is visible in a single frame.

## Known bad

**Large screens are fixed, at a price, and the price is visible.** A single
pole's field falls off as an inverse square; a *pair* of opposite poles a short
way apart cancels to leading order and falls off as an inverse cube. That is
exactly the shape of the problem — the far reach is what took a big pool apart —
and it works completely. Driven 45 s at each size, two seeds each:

| | single pole | bar magnet |
| --- | --- | --- |
| 600×1000 | 86%, 73% | 100%, 100% |
| 820×1180 | 97%, 51% | 100%, 100% |
| 1024×1366 | 56%, 76% | 100%, 100% |
| 1280×800 | 70%, 84% | 100%, 100% |

None escaped, at any size, on any seed. It also removes a performance cliff
nobody had measured: at 820×1180 a frame cost 13.6 ms at the median and 457 ms
at the 95th, because a pool in five hundred pieces is five hundred contours to
trace. It is now 4.3 ms, the same as a phone.

**The price is the crown.** The same cancellation that kills the far field
weakens the near one, and the near field is what grows spikes. Measured on the
surface, three seeds:

| | single pole | bar magnet |
| --- | --- | --- |
| peaks at once | 7.6 | 3.4 |
| how proud they stand | 55 px | 27 px |
| height ÷ width | 1.15 | 0.84 |

There is no setting in between that keeps both. Placing the return pole deeper,
so it cancels less near the glass, slides continuously from one end to the
other: at 3.6 standoffs deep the spikes are nearly back (aspect 1.02) and so is
the tablet collapse (45% at 820×1180); at 1.8 the tablet holds and the spikes
are gone again. Raising the field to compensate throws beads instead. This is
not a failure to tune. The field that lifts the surface a standoff away and the
field that drags liquid a screen away are the same field, and the pool sits only
a couple of standoffs from the magnet, so there is no gap between the two scales
to work in.

**So the magnet type is chosen by the size of the cell**: a single pole below
the reference size, a bar magnet above it. Below it nothing is far away and the
reach costs nothing; above it the reach is the whole problem and a calm pool
beats a scattered one. No real magnet changes type with the size of the glass —
but the magnets here are a fiction chosen to make a picture, and on a big cell
the useful fiction is a bar magnet.

What a tablet gets, then, is a quieter piece: the liquid rises to meet the
magnets in mounds rather than standing up in spikes. That is worth knowing
before installing it on one. Phones are untouched — the switch never fires
below the reference size, and the frame cost there is unchanged at 4.3 ms.

**Every real phone viewport holds.** 320×568 through 448×998, two seeds each,
45 s: 99–100% of drops in one body, none escaped.

The underlying instability was never explained, only avoided, and that is worth
saying plainly. The obvious explanations were all wrong: not the drop spacing on
its own — a tablet at 17 px of spacing was stable while a phone at 10.8 px was
not — nor gravity per spacing, nor the pool depth in drops, nor the hydrostatic
load against the stiffness. Each ordered some of the measurements and was
contradicted by the rest. Two changes moved it a long way without naming it:
capping the physics against a reference size, and now cutting the magnets' reach.
Something at large sizes still makes the solver fragile, and a future change
that restores long-range forcing will find it again.

What made it survive undetected so long is that every viewport the verifier
tested had about a phone's *area*, the landscape one included, that being the
same screen turned over. The four large ones are there now.

**More *coverage* is still blocked, though the reach is no longer the problem.**
Choreographing the magnets took the crest from 29% of the screen's height to
52% at its peak — the liquid now goes most of the way up the page when a magnet
carries it — but the ink on screen averaged over a minute barely moved, 19.6%
against 21%. That is arithmetic, not a failure: it is the same volume of liquid
in a different shape, and a wallpaper that is a fifth black stays a fifth black
however dramatically it moves.

The only way to more coverage is more liquid, and more liquid is what the
solver will not take: raising `fill` from 0.185 to 0.30 measured out at 33%
coverage, and also tore the pool apart under taps and at a fifth of the tested
sizes. Raising the drop count to hold the spacing constant fixes some of that
and not the rest. This is a solver problem rather than a parameter problem, and
the parameters are `fill` with `drops` raised alongside it if you want to try:
they are not independent, and `fill` alone is a trap.

**It has never run on a handset.** There is no device or emulator here. Every
number above is a headless software rasteriser, which is the wrong machine in
both directions — slower than a phone's GPU at the drawing, faster than a
phone's CPU at the arithmetic. The page reports its own frame timing to the
console when a host asks for it (`diag(true)`), and the Android service turns
that on in a debuggable build, so the real figure is one `adb logcat` away
from anyone holding a phone.
