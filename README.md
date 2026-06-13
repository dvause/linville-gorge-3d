# Linville Gorge — 3D

A navigable, stylized 3D rendering of Linville Gorge (Pisgah National Forest,
NC) in Three.js. The landform is real USGS 3DEP elevation data: gorge floor
around 400 m (~1,300 ft), rim peaks around 1,200 m (~3,900–4,020 ft), with the
Linville River running from Linville Falls in the north through the gorge and
into Lake James in the south.

This project started as a quick Fable 5 exploration about an hour before the
government forced Anthropic to take it offline. It has since continued in Opus
4.8, focusing on getting terrain and hydrography correct using real USGS data.
The renderer works on both desktop (mouse + keyboard) and mobile (joystick +
buttons).

It's an evolving project. I want to add the gorge's major trails, Old 105 on the west rim 
and Table Rock Rd to the east, additional landmarks, and maybe an easter egg or two.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
```

## Controls

**Desktop:**
- **drag** — orbit, **scroll** — zoom
- **W A S D** — fly, **Q / E** — down / up, **shift** — faster

**Mobile:**
- **drag** — look around
- **joystick** (bottom center) — fly forward/strafe
- **▲ / ▼ buttons** (bottom right) — fly up / down

Both platforms:
- Landmark buttons fly the camera to each viewpoint

## Landmarks

Linville Falls (north end), Hawksbill and Table Rock on the east rim,
Wiseman's View on the west rim, Shortoff Mountain at the south end, and
Lake James beyond the gorge mouth.

## How it works

- `src/geo.js` — the single source of world truth. Terrain height is a bilinear
  lookup into a real USGS 3DEP DEM (`public/heightmap_16.png`, 16-bit); the
  river and lake come from `src/hydro.js`. Exposes `heightAt`, `riverX`,
  `riverElev`, `riverWidth`, `lakeMask`, and the landmarks every module reads.
- `src/hydro.js` — generated, not hand-written. The `scripts/` pipeline
  (`hydro:fetch` → `hydro:build`) pulls the Linville River centerline and Lake
  James polygon from the USGS National Hydrography Dataset and projects them to
  the world grid with DEM-sampled elevations.
- `src/terrain.js` — chunked terrain, one `THREE.LOD` per km² with three
  resolutions, skirted edges, analytic normals (no LOD shading seams),
  vertex-colored forest/rock/bank/AO.
- `src/vegetation.js` — ~40k instanced low-poly conifers plus ~300k
  billboard impostors (cylindrical billboarding in the vertex shader),
  placed by rejection-sampling the height field. Two draw calls total.
- `src/water.js` — one procedural water shader drives the river ribbon
  (following the real centerline, finely tessellated over Linville Falls so it
  hugs the slope), Lake James (triangulated from the real NHD polygon), and
  animated Linville Falls with point-sprite mist. The river ribbon sits above
  the bare-earth DEM so it remains visible instead of being occluded by terrain.
- `src/sky.js` — gradient sky dome with procedurally generated cumulus clouds
  drifting on a gentle wind; low western sun; exponential haze tuned so distant
  ridgelines stack into Blue Ridge layers.
- `src/landmarks.js` — billboard sprite callouts (name + elevation) with leader
  lines anchored to peaks/overlooks on the terrain. Mobile-optimized layout.

Targets 60 fps on a modern laptop: ~460k terrain vertices across LODs,
forest in two instanced draw calls, no shadow maps, fog does the depth work.
