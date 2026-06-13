# Linville Gorge — 3D

A navigable, stylized 3D rendering of Linville Gorge (Pisgah National Forest,
NC) in Three.js. Procedural topography approximates the real thing: gorge
floor around 400 m (~1,300 ft), rim peaks around 1,200 m (~3,900–4,020 ft),
with the Linville River running from Linville Falls in the north through the
gorge and into Lake James in the south.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
```

## Controls

- **drag** — orbit, **scroll** — zoom
- **W A S D** — fly, **Q / E** — down / up, **shift** — faster
- Landmark buttons (bottom right) fly the camera to each viewpoint

## Landmarks

Linville Falls (north end), Hawksbill and Table Rock on the east rim,
Wiseman's View on the west rim, Shortoff Mountain at the south end, and
Lake James beyond the gorge mouth.

## How it works

- `src/geo.js` — all geography as one analytic height field: river meanders,
  elevation profile, gorge cross-section with domain-warped cliff walls,
  rim-anchored peaks, lake depression.
- `src/terrain.js` — chunked terrain, one `THREE.LOD` per km² with three
  resolutions, skirted edges, analytic normals (no LOD shading seams),
  vertex-colored forest/rock/bank/AO.
- `src/vegetation.js` — ~40k instanced low-poly conifers plus ~300k
  billboard impostors (cylindrical billboarding in the vertex shader),
  placed by rejection-sampling the height field. Two draw calls total.
- `src/water.js` — one procedural water shader drives the river ribbon,
  Lake James, and the two-tier animated Linville Falls; point-sprite mist
  rises from the plunge pool.
- `src/sky.js` — gradient sky dome, low western sun, exponential haze tuned
  so distant ridgelines stack into Blue Ridge layers.

Targets 60 fps on a modern laptop: ~460k terrain vertices across LODs,
forest in two instanced draw calls, no shadow maps, fog does the depth work.
