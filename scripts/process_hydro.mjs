// Turn the raw NHD GeoJSON (data/nhd/) into src/hydro.js: a stitched, ordered
// Linville River centerline projected to the world grid with DEM-sampled
// elevations, plus the Lake James polygon clipped to the world rectangle.
// Run with: node scripts/process_hydro.mjs  (after scripts/fetch_hydro.mjs)
//
// The lon/lat -> world transform mirrors geo.js heightAt exactly. The DEM's
// metadata horizontal units are degrees (not meters as labeled); the world span
// below is computed from the geographic bounds, centered on the origin.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decode } from 'fast-png';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dir, '..');

const B = { W: -81.97526993629236, S: 35.757311916094906, E: -81.83054770249237, N: 35.971293414694905 };
const WORLD = { minX: -6535, maxX: 6535, minZ: -11871, maxZ: 11871 };
const DEM = { elevMin: 339.386, elevMax: 1305.536 };

// world grid: col 0 = west, row 0 = north (= most-negative Z).
const lonToX = lon => WORLD.minX + ((lon - B.W) / (B.E - B.W)) * (WORLD.maxX - WORLD.minX);
const latToZ = lat => WORLD.minZ + ((B.N - lat) / (B.N - B.S)) * (WORLD.maxZ - WORLD.minZ);

// ---- DEM heightmap sampler (bilinear, meters) — same math as geo.js ----------
const png = decode(new Uint8Array(fs.readFileSync(path.join(ROOT, 'public', 'heightmap_16.png'))));
const { width: W, height: H, channels: CH, data: DATA } = png;
const RANGE = DEM.elevMax - DEM.elevMin;
function heightAt(x, z) {
  let fx = ((x - WORLD.minX) / (WORLD.maxX - WORLD.minX)) * (W - 1);
  let fz = ((z - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ)) * (H - 1);
  fx = Math.max(0, Math.min(W - 1, fx));
  fz = Math.max(0, Math.min(H - 1, fz));
  const x0 = fx | 0, z0 = fz | 0, x1 = Math.min(W - 1, x0 + 1), z1 = Math.min(H - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const px = (r, c) => DEM.elevMin + (DATA[(r * W + c) * CH] / 65535) * RANGE;
  const a = px(z0, x0), b = px(z0, x1), c = px(z1, x0), d = px(z1, x1);
  const top = a + (b - a) * tx, bot = c + (d - c) * tx;
  return top + (bot - top) * tz;
}

// ---- stitch the flowline segments into one ordered N->S polyline -------------
// NHD splits the river at confluences; segments are digitized downstream, so
// each segment's end-point is the next segment's start-point. Snap endpoints to
// a ~1 m grid, find the unique source (a start that is no segment's end), then
// walk start->end until the sink.
const flowline = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'nhd', 'flowline.geojson'), 'utf8')).features;
const key = c => c[0].toFixed(5) + ',' + c[1].toFixed(5);

const byStart = new Map();
flowline.forEach((f, i) => {
  const k = key(f.geometry.coordinates[0]);
  if (!byStart.has(k)) byStart.set(k, []);
  byStart.get(k).push(i);
});
const endKeys = new Set(flowline.map(f => {
  const cs = f.geometry.coordinates;
  return key(cs[cs.length - 1]);
}));
const startIdx = flowline.findIndex(f => !endKeys.has(key(f.geometry.coordinates[0])));

const visited = new Set();
const coords = [];
let cur = startIdx;
while (cur != null && !visited.has(cur)) {
  visited.add(cur);
  const cs = flowline[cur].geometry.coordinates;
  for (const c of cs) {
    if (coords.length && key(c) === key(coords[coords.length - 1])) continue; // dedup join
    coords.push(c);
  }
  const nexts = (byStart.get(key(cs[cs.length - 1])) || []).filter(i => !visited.has(i));
  cur = nexts.length ? nexts[0] : null;
}
if (visited.size !== flowline.length) {
  console.warn(`WARNING: stitched ${visited.size}/${flowline.length} segments — chain is not a single path`);
}

// ---- project + DEM-sampled thalweg elevation --------------------------------
// Raw DEM samples along the centerline are noisy and can rise locally; force the
// water surface to be non-increasing downstream (cumulative minimum) so it reads
// as a real river surface following the valley floor.
const pts = coords.map(c => {
  const x = lonToX(c[0]), z = latToZ(c[1]);
  return { x, z, elev: heightAt(x, z) };
});
let mn = Infinity;
for (const p of pts) { mn = Math.min(mn, p.elev); p.elev = mn; }

const round = (n, d = 1) => +n.toFixed(d);
const CENTERLINE = pts.map(p => [round(p.x), round(p.z), round(p.elev, 2)]);

// ---- Lake James polygon: clip to the world rect, simplify -------------------
const waterbody = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'nhd', 'waterbody.geojson'), 'utf8')).features
  .find(f => (f.properties.GNIS_NAME || f.properties.gnis_name) === 'Lake James');
const outer = waterbody.geometry.coordinates[0].map(c => [lonToX(c[0]), latToZ(c[1])]);

// Sutherland-Hodgman clip against the world rectangle.
function clipToWorld(poly) {
  const R = WORLD;
  const cut = (ax, v, keepGE) => {
    const inside = p => keepGE ? p[ax] >= v : p[ax] <= v;
    const cross = (a, b) => { const t = (v - a[ax]) / (b[ax] - a[ax]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    return out => {
      const res = [];
      for (let i = 0; i < out.length; i++) {
        const a = out[i], b = out[(i + 1) % out.length];
        const ina = inside(a), inb = inside(b);
        if (ina) { res.push(a); if (!inb) res.push(cross(a, b)); }
        else if (inb) res.push(cross(a, b));
      }
      return res;
    };
  };
  let out = poly;
  for (const f of [cut(0, R.minX, true), cut(0, R.maxX, false), cut(1, R.minZ, true), cut(1, R.maxZ, false)]) {
    out = f(out);
    if (!out.length) break;
  }
  return out;
}

// Douglas-Peucker on an open polyline.
function rdp(line, eps) {
  if (line.length < 3) return line;
  const a = line[0], b = line[line.length - 1];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-9;
  let dmax = 0, idx = 0;
  for (let i = 1; i < line.length - 1; i++) {
    const p = line[i];
    const d = Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / L;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) return rdp(line.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(line.slice(idx), eps));
  return [a, b];
}

// Simplify a CLOSED ring: split at the two x-extreme vertices into open arcs
// (RDP's endpoint baseline is degenerate on a closed loop), RDP each, rejoin.
function simplifyRing(ring, eps) {
  if (ring.length < 4) return ring;
  let iMin = 0, iMax = 0;
  ring.forEach((p, i) => { if (p[0] < ring[iMin][0]) iMin = i; if (p[0] > ring[iMax][0]) iMax = i; });
  const [a, b] = iMin < iMax ? [iMin, iMax] : [iMax, iMin];
  const s1 = rdp(ring.slice(a, b + 1), eps);
  const s2 = rdp(ring.slice(b).concat(ring.slice(0, a + 1)), eps);
  return s1.concat(s2.slice(1, -1));
}

const lakeClipped = clipToWorld(outer);
const lakeRing = simplifyRing(lakeClipped, 25).map(p => [round(p[0]), round(p[1])]);
const LAKE = [lakeRing];

// ---- write the module --------------------------------------------------------
const out = `// AUTO-GENERATED by scripts/process_hydro.mjs — do not edit by hand.
// Linville River centerline + Lake James, from USGS NHD High-Res (MapServer
// layers 6/12), projected to the world grid (same transform as geo.js heightAt)
// and elevation-sampled from the DEM heightmap.
//   CENTERLINE: [x, z, elev_m], ordered north(-z) -> south(+z); elevation is
//     made monotonic non-increasing downstream so the water surface tracks the
//     true thalweg instead of DEM noise. Full meander detail retained.
//   LAKE: outer ring(s) as [x, z] polygons, clipped to the world rectangle and
//     simplified (Douglas-Peucker, 25 m). Holes/islands dropped.
export const CENTERLINE = ${JSON.stringify(CENTERLINE)};
export const LAKE = ${JSON.stringify(LAKE)};
`;
fs.writeFileSync(path.join(ROOT, 'src', 'hydro.js'), out);

console.log(`centerline: ${CENTERLINE.length} pts, z ${CENTERLINE[0][1]}..${CENTERLINE.at(-1)[1]}, elev ${CENTERLINE[0][2]}..${CENTERLINE.at(-1)[2]} m`);
console.log(`lake: ${outer.length} raw -> ${lakeClipped.length} clipped -> ${lakeRing.length} simplified vertices`);
console.log('wrote src/hydro.js');
