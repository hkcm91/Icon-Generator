# Drop exported icon PNGs here

Generate a family in the web app, export it, and unzip the PNGs into this
folder. The build picks them up automatically:

```bash
python build.py --scene aquarium
```

PNGs here are gitignored — they are generated artwork, often hundreds of
files, and they belong to whoever generated them rather than to the repo.

File names become object names in Blender, so `folder.png` arrives as
`Icon_000_folder`. Which icon lands in the hero position is decided by
`HERO_ORDER` in `fa/icons.py`, not by filesystem order.

With this folder empty the build still runs, using procedural aqua placeholder
tiles in exactly the same layout — so framing and lighting can be worked out
before any final artwork exists.
