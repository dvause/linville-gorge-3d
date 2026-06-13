// Geography of Linville Gorge sampled from a real bare-earth DEM.
// World units are meters. +x = east, +z = south, y = elevation. The
// landform comes from heightmap_16.png (1024x1024, 16-bit grayscale);
// heightAt() is a bilinear lookup into it. The river and lake helpers
// below are still procedural for now (water is fitted to the real terrain
// in a later pass).

import { smoothstep, clamp, lerp } from './noise.js';
import { CENTERLINE, LAKE } from './hydro.js';

// ---- DEM heightmap ---------------------------------------------------------
//
// The PNG's metadata (pixel_size_m, world_extent_m) was generated assuming
// UTM meters, but the DEM is actually in lat/long DEGREES — those fields are
// wrong and are IGNORED. The real-world horizontal span below is computed
// from the geographic bounds, centered on the origin. Pixels are NON-SQUARE:
// the sampler maps X and Z with different scales so the terrain isn't
// stretched. The elevation min/max ARE correct and used as given.

const DEM = {
  size: 1024,
  elevMin: 339.386,   // meters, from heightmap_meta.json (correct)
  elevMax: 1305.536,  // meters
};

// world -> pixel: col 0 = west (minX), row 0 = north (minZ); row0_is "north".
export const WORLD = {
  minX: -6535, maxX: 6535,   // 13,071 m east-west
  minZ: -11871, maxZ: 11871, // 23,743 m north-south
  lakeLevel: 368,
  treeline: 1190,
};

// Filled by loadHeightmap(): { w, h, elev: Float32Array of meters }.
let HM = null;
let hmPromise = null;

// Load the DEM once, decoding the PNG at full 16-bit precision (a normal 2D
// canvas would collapse it to 8 bits and terrace the terrain). fast-png
// returns a Uint16Array for 16-bit grayscale, which we convert to meters.
export function loadHeightmap(url = '/heightmap_16.png') {
  if (hmPromise) return hmPromise;
  hmPromise = (async () => {
    const { decode } = await import('fast-png');
    const buf = await (await fetch(url)).arrayBuffer();
    const png = decode(new Uint8Array(buf));
    const { width, height, data, channels } = png; // data: Uint16Array, 0..65535
    const elev = new Float32Array(width * height);
    const range = DEM.elevMax - DEM.elevMin;
    for (let i = 0; i < width * height; i++) {
      elev[i] = DEM.elevMin + (data[i * channels] / 65535) * range;
    }
    HM = { w: width, h: height, elev };
    return HM;
  })();
  return hmPromise;
}

// ---- River (data-driven from the NHD centerline) ---------------------------
//
// riverX/riverElev are the real Linville River, sampled at module load into a
// uniform z-grid so terrain coloring, vegetation masking, and the water mesh
// can look them up in O(1) (they're called per-vertex). The source centerline
// (src/hydro.js) is ordered north->south but meanders briefly back north at a
// few bends; since these are functions OF z, we first reduce it to a strictly
// increasing-z monotonic list (dropping the backward wiggles), then resample.

const RIVER_STEP = 20; // meters between grid samples
const _zMin = CENTERLINE[0][1];
const _zMax = CENTERLINE[CENTERLINE.length - 1][1];

const { _RX, _RE, _zLake } = (() => {
  // strictly-increasing-z subsequence
  const mono = [];
  let lastZ = -Infinity;
  for (const p of CENTERLINE) {
    if (p[1] > lastZ) { mono.push(p); lastZ = p[1]; }
  }
  const n = Math.max(2, Math.ceil((_zMax - _zMin) / RIVER_STEP) + 1);
  const rx = new Float32Array(n);
  const re = new Float32Array(n);
  let j = 0; // advancing pointer into mono
  for (let i = 0; i < n; i++) {
    const zq = _zMin + i * RIVER_STEP;
    while (j < mono.length - 2 && mono[j + 1][1] < zq) j++;
    const a = mono[j], b = mono[j + 1];
    const t = b[1] > a[1] ? (zq - a[1]) / (b[1] - a[1]) : 0;
    rx[i] = a[0] + (b[0] - a[0]) * t;
    re[i] = a[2] + (b[2] - a[2]) * t;
  }
  // z where the river reaches the lake's northern edge
  let zLake = _zMax;
  for (const ring of LAKE) for (const pt of ring) if (pt[1] < zLake) zLake = pt[1];
  return { _RX: rx, _RE: re, _zLake: zLake };
})();

function _sample(arr, z) {
  let f = (z - _zMin) / RIVER_STEP;
  if (f <= 0) return arr[0];
  if (f >= arr.length - 1) return arr[arr.length - 1];
  const i = f | 0;
  return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
}

// Channel center x at latitude-line z.
export function riverX(z) { return _sample(_RX, z); }

// Water-surface elevation, following the true thalweg sampled from the DEM.
export function riverElev(z) { return _sample(_RE, z); }

// NHD flowlines carry no width; keep a heuristic that widens downstream as the
// river approaches the Lake James backwater.
export function riverWidth(z) {
  return lerp(11, 46, smoothstep(_zMin, _zLake, z));
}

// ---- Lake James (real NHD waterbody polygon, clipped to the world) ---------
//
// LAKE holds the in-scene north arm as [x, z] rings. lakeMask is a point-in-
// polygon test (ray cast) with a bounding-box fast-reject; terrain.js gates
// shore coloring on lakeMask > 0.02 and does its own height-based feathering.

const _lakeBBox = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const ring of LAKE) for (const [x, z] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
})();

export function lakeMask(x, z) {
  const bb = _lakeBBox;
  if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) return 0;
  let inside = false;
  for (const ring of LAKE) {
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const xi = ring[i][0], zi = ring[i][1], xj = ring[k][0], zj = ring[k][1];
      if (((zi > z) !== (zj > z)) &&
          (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)) inside = !inside;
    }
  }
  return inside ? 1 : 0;
}

// ---- Rim & peaks ----------------------------------------------------------

// Summit positions from real-world coordinates, projected to the world grid
// with the same transform as the DEM, so each label sits on the true peak.
const GEO_BOUNDS = { W: -81.97526993629236, E: -81.83054770249237, S: 35.757311916094906, N: 35.971293414694905 };
const lonToX = (lon) => WORLD.minX + ((lon - GEO_BOUNDS.W) / (GEO_BOUNDS.E - GEO_BOUNDS.W)) * (WORLD.maxX - WORLD.minX);
const latToZ = (lat) => WORLD.minZ + ((GEO_BOUNDS.N - lat) / (GEO_BOUNDS.N - GEO_BOUNDS.S)) * (WORLD.maxZ - WORLD.minZ);
const peak = (lat, lon) => ({ x: lonToX(lon), z: latToZ(lat) });

const SPOT = {
  // Hawksbill and Table Rock: published coordinates don't line up with our DEM
  // (and earlier put both on the same dome), so anchor each to its actual DEM
  // summit pixel — Hawksbill is the northern peak (~4007 ft), Table Rock the
  // distinctive dome ~2.5 km to its south (~3928 ft).
  hawksbill: { x: 1510, z: -5440 },
  tableRock: { x: 1810, z: -2980 },
  shortoff: peak(35.8330, -81.8989),
  // Wiseman's View is a west-rim overlook (not a summit); real coordinates.
  wisemans: peak(35.9037382, -81.9053873),
};

// Consistent fly-to framing for rim landmarks: hover over the gorge centerline
// (lowest terrain, so the camera never lands inside a rim) at the landmark's
// latitude, a bit south and above the feature, looking back across the gorge at
// it. yLook comes from the static elevation since heightAt isn't ready at module
// load. Returns { cam, look } to spread into a landmark.
const FT_TO_M = 0.3048;
function gorgeView(x, z, elevFt) {
  const yLook = elevFt * FT_TO_M;
  return { cam: [riverX(z), yLook + 220, z + 750], look: [x, yLook, z] };
}

// ---- Height field (DEM bilinear sample) ------------------------------------

// Bilinear lookup into the loaded DEM. World (x, z) -> fractional pixel
// (col = west->east, row = north->south), interpolate the 4 neighbors, return
// meters. Out-of-bounds clamps to the edge. Cheap and allocation-free so the
// terrain builder and per-frame camera collision stay fast.
export function heightAt(x, z) {
  if (!HM) return WORLD.lakeLevel; // sampled before the DEM finished loading
  const { w, h, elev } = HM;

  let fx = ((x - WORLD.minX) / (WORLD.maxX - WORLD.minX)) * (w - 1);
  let fz = ((z - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ)) * (h - 1);
  if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
  if (fz < 0) fz = 0; else if (fz > h - 1) fz = h - 1;

  const x0 = fx | 0, z0 = fz | 0;
  const x1 = x0 < w - 1 ? x0 + 1 : x0;
  const z1 = z0 < h - 1 ? z0 + 1 : z0;
  const tx = fx - x0, tz = fz - z0;

  const r0 = z0 * w, r1 = z1 * w;
  const a = elev[r0 + x0], b = elev[r0 + x1];
  const c = elev[r1 + x0], d = elev[r1 + x1];
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * tz;
}

// ---- Landmarks ------------------------------------------------------------
// label: where the floating name hangs. cam/look: fly-to viewpoints.

export const LANDMARKS = [
  {
    name: "Linville Falls",
    elevFt: 3250,
    label: [riverX(-9530), riverElev(-9530) + 55, -9530],
    // elevated, downstream and east, looking down at the cascade on the slope
    cam: [riverX(-9485) + 480, riverElev(-9485) + 340, -9040],
    look: [riverX(-9485), riverElev(-9485), -9490],
  },
  {
    name: "Hawksbill",
    elevFt: 4009,
    label: [SPOT.hawksbill.x, 1330, SPOT.hawksbill.z],
    ...gorgeView(SPOT.hawksbill.x, SPOT.hawksbill.z, 4009),
  },
  {
    name: "Table Rock",
    elevFt: 3909,
    label: [SPOT.tableRock.x, 1300, SPOT.tableRock.z],
    ...gorgeView(SPOT.tableRock.x, SPOT.tableRock.z, 3909),
  },
  {
    name: "Wiseman's View",
    elevFt: 3400,
    label: [SPOT.wisemans.x, 1240, SPOT.wisemans.z],
    ...gorgeView(SPOT.wisemans.x, SPOT.wisemans.z, 3400),
  },
  {
    name: "Shortoff Mountain",
    elevFt: 2883,
    label: [SPOT.shortoff.x, 1060, SPOT.shortoff.z],
    ...gorgeView(SPOT.shortoff.x, SPOT.shortoff.z, 2883),
  },
  {
    name: "Lake James",
    elevFt: 1200,
    label: [2870, 480, 8412],
    cam: [2300, 1020, 5900], look: [2870, 368, 8412],
  },
];

export const START_VIEW = {
  // High over the south gorge, looking north up the river toward the falls:
  // both rims, the winding floor, and the layered haze in one frame.
  cam: [-150, 2100, 3200],
  look: [50, 650, -1900],
};
