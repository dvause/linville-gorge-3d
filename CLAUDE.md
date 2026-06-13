# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install
npm run dev        # Vite dev server, http://localhost:5173
npm run build      # production build -> dist/
npm run preview    # serve the built dist/

npm run hydro:fetch  # query USGS NHD -> data/nhd/*.geojson   (needs network)
npm run hydro:build  # data/nhd/*.geojson -> src/hydro.js      (offline)
```

There is no test suite and no linter configured. To exercise rendering, run the
dev server and verify in the browser (the app is a single client-side page).

`hydro:fetch` uses Node's global `fetch` against the public USGS ArcGIS service;
run `hydro:build` after it to regenerate `src/hydro.js`.

## Architecture

Vanilla ES modules + Three.js, bundled by Vite. No framework, no router, no
server — a single static page (`index.html` -> `src/main.js`) that builds one
WebGL scene. Deployed to Cloudflare Workers as static assets (`wrangler.jsonc`
serves `./dist`); Workers Builds deploys from `main`.

World coordinates are **meters**: `+x` = east, `+z` = south, `y` = up. Image-row
0 of the DEM is north (most-negative `z`).

### `src/geo.js` is the single source of world truth — treat its exports as a contract

Every other module imports the world from here. Its exports —
`WORLD`, `heightAt`, `riverX`, `riverElev`, `riverWidth`, `lakeMask`,
`LANDMARKS`, `START_VIEW` — are consumed by `terrain.js`, `vegetation.js`,
`water.js`, `landmarks.js`, and `main.js`. Changing a signature or semantics
ripples through all of them, so preserve them.

The terrain landform is a **real USGS 3DEP bare-earth DEM**, not procedural:
`heightAt(x, z)` is a bilinear lookup into `public/heightmap_16.png` (1024², 16-bit,
decoded at full precision via `fast-png` in `loadHeightmap()`). Critical gotcha:
the PNG's `heightmap_meta.json` labels its horizontal units as meters, **but they
are degrees** — those fields are ignored. The real world span is derived from the
geographic bounds and centered on the origin, with **non-square pixels** (different
x/z scale). The elevation min/max are correct and used as given.

### Hydrography is generated data, not procedural — don't hand-edit `src/hydro.js`

The river and lake come from the **USGS National Hydrography Dataset (NHD,
High-Res)** through a two-stage pipeline:

```
scripts/fetch_hydro.mjs   -> data/nhd/{flowline,waterbody}.geojson   (raw cache)
scripts/process_hydro.mjs -> src/hydro.js                            (generated)
```

`process_hydro.mjs` stitches the 230 NHD flowline segments into one ordered
north→south polyline, projects lon/lat to the world grid using **the same
transform as `heightAt`** (keep these two in sync), and samples DEM elevation
along the centerline forced monotonic non-increasing downstream (a clean
thalweg). It also clips the Lake James polygon to the world rectangle and
simplifies it. Output is `CENTERLINE` (`[x, z, elev]`) and `LAKE` (`[x, z]` rings).

`geo.js` consumes `hydro.js`: at module load it resamples `CENTERLINE` onto a
uniform z-grid so `riverX`/`riverElev` are O(1) per-vertex lookups (they're
called all over terrain coloring and tree placement). Because these are
functions **of z** (a latitude line), the centerline's brief northward meander
wiggles are dropped to a strictly-increasing-z subsequence. `lakeMask` is a
point-in-polygon ray cast against `LAKE` with a bbox fast-reject.

### Rendering modules

- **`terrain.js`** — chunked LOD heightfield (`THREE.LOD` per 1 km² chunk, three
  resolutions). Samples one cell beyond each chunk so central-difference normals
  match across chunk/LOD borders (no shading seams); the outer ring folds into a
  skirt to hide LOD cracks. `vertexColor()` tints forest/rock/bank/lakebed/AO and
  is where the `geo.js` river/lake functions feed in — they drive **coloring
  only**, not geometry. This file is performance-critical (holds the frame rate);
  avoid restructuring it, but note that changes to `geo.js` flow into its tints.
- **`vegetation.js`** — two instanced draw calls total: ~40k near low-poly
  conifers + ~300k far billboard impostors (cylindrical billboarding in the
  vertex shader). Placement rejection-samples `heightAt` (no trees on cliffs, in
  the river/lake, or above `WORLD.treeline`) using a deterministic mulberry32 RNG.
- **`water.js`** — one procedural shader drives the river ribbon, Lake James, and
  the two-tier Linville Falls, plus a point-sprite mist cloud. The river ribbon is
  built from `riverX/riverElev/riverWidth`, so it tracks the real centerline. **The
  falls meshes and the lake surface are still hardcoded** (fixed z-range falls,
  a rectangular lake plane) and do not yet derive from `hydro.js` — they are
  misaligned with the real data and are the main pending water work.
- **`noise.js`** — seeded value noise / fBm shared by every module so terrain,
  trees, and colors agree deterministically.
- **`sky.js`**, **`controls.js`**, **`landmarks.js`** — gradient sky dome + haze
  fog, fly/orbit camera with `flyTo`, and screen-stable canvas-text label sprites.

### Build flow (`main.js`)

The scene is built incrementally inside the animation loop: work is split into
jobs run under a ~28 ms/frame budget behind a loading bar. The whole build is
gated on the async `loadHeightmap()` because every terrain and tree job needs
`heightAt` to be ready first.

> Note: `README.md`'s "How it works" still describes the older fully-procedural
> geography; the terrain (DEM) and water (NHD) are now data-driven as above.
