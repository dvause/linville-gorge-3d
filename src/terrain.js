// Chunked LOD terrain. The world is split into a grid of chunks; each chunk
// is a THREE.LOD with three resolutions. Vertices sample geo.heightAt on a
// grid with a one-cell margin so normals are computed identically across
// chunk borders and LOD levels (no shading seams), and the outermost ring is
// folded down into a skirt to hide cracks between adjacent LOD levels.

import * as THREE from 'three';
import { WORLD, heightAt, riverX, riverElev, riverWidth, lakeMask } from './geo.js';
import { fbm, clamp, smoothstep } from './noise.js';

const CHUNK = 1000;            // meters per chunk
const LOD_RES = [48, 20, 8];   // grid segments per LOD level
const LOD_DIST = [0, 2600, 6500];
const SKIRT_DROP = 60;

const COL = {
  forestLow: new THREE.Color(0x31511c),
  forestHigh: new THREE.Color(0x59692c),
  rock: new THREE.Color(0x8d8678),
  rockDark: new THREE.Color(0x5e594f),
  bank: new THREE.Color(0x9a8a64),
  bed: new THREE.Color(0x4a4438),
  lakebed: new THREE.Color(0x57604a),
};

const _c = new THREE.Color();

function vertexColor(x, z, h, ny, out) {
  const rx = riverX(z);
  const ad = Math.abs(x - rx);
  const rE = riverElev(z);
  const steep = 1 - ny;

  // base forest gradient by elevation
  const e = smoothstep(420, 1150, h);
  _c.copy(COL.forestLow).lerp(COL.forestHigh, e);

  // canopy mottle: two scales so distant slopes read as forest texture,
  // not smooth lawn
  const m = fbm(x * 0.006 + 21, z * 0.006, 2) * 0.5 + 0.5;
  const m2 = fbm(x * 0.025 + 4, z * 0.025 + 17, 2) * 0.5 + 0.5;
  _c.offsetHSL(0, (m - 0.5) * 0.05, (m - 0.5) * 0.05 + (m2 - 0.5) * 0.035);

  // exposed quartzite on steep faces and high crags; thresholds tuned to
  // the cliff-band slopes the height field actually produces
  let rockMix = smoothstep(0.16, 0.34, steep) * (0.55 + 0.45 * m);
  rockMix = Math.max(rockMix, smoothstep(1175, 1255, h) * 0.8);
  if (rockMix > 0) {
    const rc = _c.clone().lerp(
      m > 0.5 ? COL.rock : COL.rockDark, clamp(rockMix * (0.75 + m * 0.4), 0, 1));
    _c.copy(rc);
  }

  // river banks and bed
  if (ad < riverWidth(z) * 1.7 && h < rE + 5) {
    const bankMix = (1 - smoothstep(0, riverWidth(z) * 1.7, ad)) * smoothstep(rE + 5, rE + 1, h);
    _c.lerp(h < rE ? COL.bed : COL.bank, clamp(bankMix * 0.65, 0, 1));
  }

  // lake bed / shore
  const lm = lakeMask(x, z);
  if (lm > 0.02 && h < WORLD.lakeLevel + 8) {
    _c.lerp(h < WORLD.lakeLevel ? COL.lakebed : COL.bank,
      smoothstep(WORLD.lakeLevel + 8, WORLD.lakeLevel, h) * 0.8);
  }

  // valley ambient occlusion: darken low terrain inside the gorge
  const ao = 1 - smoothstep(950, 430, h) * 0.30;
  out[0] = _c.r * ao;
  out[1] = _c.g * ao;
  out[2] = _c.b * ao;
}

function buildChunkGeometry(cx, cz, res) {
  // vertex grid: (res+3)^2 — rows/cols 0 and res+2 are the skirt ring,
  // clamped to the chunk edge in xz and dropped in y.
  const n = res + 3;
  const step = CHUNK / res;
  const x0 = cx, z0 = cz;

  // sample heights one cell beyond the chunk for normals
  const hs = new Float32Array((n + 2) * (n + 2));
  for (let j = 0; j < n + 2; j++) {
    for (let i = 0; i < n + 2; i++) {
      const gx = x0 + (i - 2) * step;
      const gz = z0 + (j - 2) * step;
      hs[j * (n + 2) + i] = heightAt(gx, gz);
    }
  }
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const col = [0, 0, 0];

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gi = clamp(i - 1, 0, res); // grid index clamped to chunk for skirt ring
      const gj = clamp(j - 1, 0, res);
      const isSkirt = (i === 0 || j === 0 || i === n - 1 || j === n - 1);
      const x = x0 + gi * step;
      const z = z0 + gj * step;
      const y = hs[(gj + 2) * (n + 2) + (gi + 2)];

      const k = (j * n + i) * 3;
      positions[k] = x;
      positions[k + 1] = isSkirt ? y - SKIRT_DROP : y;
      positions[k + 2] = z;

      // central-difference normal from the sample grid (same for skirt ring)
      const hl = hs[(gj + 2) * (n + 2) + (gi + 1)];
      const hr = hs[(gj + 2) * (n + 2) + (gi + 3)];
      const hd = hs[(gj + 1) * (n + 2) + (gi + 2)];
      const hu = hs[(gj + 3) * (n + 2) + (gi + 2)];
      let nx = (hl - hr) / (2 * step);
      let nz = (hd - hu) / (2 * step);
      const inv = 1 / Math.hypot(nx, 1, nz);
      normals[k] = nx * inv;
      normals[k + 1] = inv;
      normals[k + 2] = nz * inv;

      vertexColor(x, z, y, inv, col);
      colors[k] = col[0];
      colors[k + 1] = col[1];
      colors[k + 2] = col[2];
    }
  }

  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

export function buildTerrain(onProgress) {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });

  const nx = Math.round((WORLD.maxX - WORLD.minX) / CHUNK);
  const nz = Math.round((WORLD.maxZ - WORLD.minZ) / CHUNK);
  const total = nx * nz;
  let done = 0;
  const jobs = [];

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      jobs.push(() => {
        const cx = WORLD.minX + i * CHUNK;
        const cz = WORLD.minZ + j * CHUNK;
        const lod = new THREE.LOD();
        for (let l = 0; l < LOD_RES.length; l++) {
          const mesh = new THREE.Mesh(buildChunkGeometry(cx, cz, LOD_RES[l]), material);
          mesh.matrixAutoUpdate = false;
          lod.addLevel(mesh, LOD_DIST[l]);
        }
        // LOD distance is measured from its position; center it on the chunk
        lod.position.set(cx + CHUNK / 2, 0, cz + CHUNK / 2);
        // geometry is in world coords, so undo the offset on each level
        for (const lvl of lod.levels) {
          lvl.object.position.set(-cx - CHUNK / 2, 0, -cz - CHUNK / 2);
          lvl.object.updateMatrix();
        }
        group.add(lod);
        done++;
        if (onProgress) onProgress(done / total);
      });
    }
  }

  return { group, jobs };
}
