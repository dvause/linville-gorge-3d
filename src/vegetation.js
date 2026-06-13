// Forest cover. Two tiers:
//  - near tier: one InstancedMesh of low-poly conifers (real 3D, ~54 verts)
//  - far tier: one instanced billboard cloud (2 tris each, cylindrical
//    billboarding in the vertex shader, canvas-painted spruce silhouette)
// Both are single draw calls. Placement rejection-samples the height field:
// no trees on cliffs, in the river, in the lake, or above the treeline.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, heightAt, riverX, riverWidth, riverElev } from './geo.js';
import { fbm, clamp } from './noise.js';

const NEAR_COUNT = 40000;
const FAR_COUNT = 300000;

// Forest corridor: keep placement inside the scenic envelope so density
// concentrates where the camera goes.
const FOREST_X = { min: -3100, max: 3100 };

// ---- placement -------------------------------------------------------------

function placeTrees(count, rng) {
  const out = new Float32Array(count * 4); // x, y, z, scale
  let placed = 0, guard = 0;
  while (placed < count && guard < count * 20) {
    guard++;
    const x = FOREST_X.min + rng() * (FOREST_X.max - FOREST_X.min);
    const z = WORLD.minZ + rng() * (WORLD.maxZ - WORLD.minZ);

    const h = heightAt(x, z);
    if (h > WORLD.treeline) continue;

    // clearings, with extra cover down in the gorge where the camera flies
    let density = fbm(x * 0.0016 + 31, z * 0.0016, 3) * 0.5 + 0.62;
    density += 0.3 * (1 - clamp((h - 450) / 400, 0, 1));
    if (rng() > density) continue;
    if (h < WORLD.lakeLevel + 3 && z > 4800) continue; // lake shallows

    const ad = Math.abs(x - riverX(z));
    if (ad < riverWidth(z) * 1.8 && h < riverElev(z) + 8) continue;

    // slope check
    const e = 7;
    const sx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const sz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    if (sx * sx + sz * sz > 0.72) continue; // too steep — bare rock

    const k = placed * 4;
    out[k] = x;
    out[k + 1] = h;
    out[k + 2] = z;
    out[k + 3] = 0.85 + rng() * 0.75;
    placed++;
  }
  return { data: out, count: placed };
}

// mulberry32 — deterministic placement
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- near tier: low-poly conifer mesh --------------------------------------

function makeTreeGeometry() {
  const trunkCol = new THREE.Color(0x5a4633);
  const lowCol = new THREE.Color(0x2c4a1c);
  const topCol = new THREE.Color(0x3c5c22);

  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 2.4, 5, 1);
  trunk.translate(0, 1.2, 0);
  const cone1 = new THREE.ConeGeometry(2.6, 6.0, 6, 1);
  cone1.translate(0, 4.6, 0);
  const cone2 = new THREE.ConeGeometry(1.8, 4.6, 6, 1);
  cone2.translate(0, 8.0, 0);

  for (const [g, c] of [[trunk, trunkCol], [cone1, lowCol], [cone2, topCol]]) {
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv'); // not needed; lets merge succeed cleanly
  }

  const merged = mergeGeometries([trunk, cone1, cone2]);
  trunk.dispose(); cone1.dispose(); cone2.dispose();
  return merged;
}

function buildNearTrees(trees) {
  const geo = makeTreeGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, mat, trees.count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();

  for (let i = 0; i < trees.count; i++) {
    const k = i * 4;
    const s = trees.data[k + 3];
    q.setFromAxisAngle(up, (i * 2.39996) % (Math.PI * 2));
    m.compose(
      new THREE.Vector3(trees.data[k], trees.data[k + 1] - 0.3, trees.data[k + 2]),
      q,
      new THREE.Vector3(s * (0.85 + ((i * 7) % 10) * 0.03), s, s * (0.85 + ((i * 13) % 10) * 0.03))
    );
    mesh.setMatrixAt(i, m);
    const v = 0.8 + ((i * 31) % 100) / 250; // 0.8 .. 1.2 brightness
    const warm = ((i * 17) % 100) / 100;
    col.setRGB(v * (0.9 + warm * 0.25), v, v * 0.9);
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- far tier: billboard impostors -----------------------------------------

function makeBillboardTexture() {
  const w = 64, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // trunk
  ctx.fillStyle = '#4a3a2a';
  ctx.fillRect(w / 2 - 2, h - 18, 4, 18);

  // stacked, jittered triangle tiers
  const tiers = 6;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);            // 0 bottom .. 1 top
    const yBot = h - 14 - f * (h - 36);
    const half = (1 - f * 0.78) * (w * 0.42);
    const yTop = yBot - (h - 30) / tiers * 1.65;
    const g = ctx.createLinearGradient(0, yTop, 0, yBot);
    g.addColorStop(0, `rgb(${52 + t * 6}, ${82 + t * 7}, ${34 + t * 4})`);
    g.addColorStop(1, `rgb(${30 + t * 4}, ${56 + t * 6}, ${22 + t * 3})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w / 2, yTop);
    // jagged edges
    for (let s = 0; s <= 6; s++) {
      const u = s / 6;
      const jx = Math.sin(s * 12.9 + t * 7.7) * 2.5;
      ctx.lineTo(w / 2 + half * u + jx, yTop + (yBot - yTop) * u);
    }
    for (let s = 6; s >= 0; s--) {
      const u = s / 6;
      const jx = Math.sin(s * 9.1 + t * 3.3) * 2.5;
      ctx.lineTo(w / 2 - half * u + jx, yTop + (yBot - yTop) * u);
    }
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  return tex;
}

const billboardVert = /* glsl */ `
  attribute vec3 offset;
  attribute float scale;
  attribute vec3 tint;
  varying vec2 vUv;
  varying vec3 vTint;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vTint = tint;
    vec3 toCam = cameraPosition - offset;
    toCam.y = 0.0;
    vec3 right = normalize(vec3(-toCam.z, 0.0, toCam.x));
    float w = 8.5 * scale;
    float h = 15.0 * scale;
    vec3 world = offset + right * position.x * w + vec3(0.0, position.y * h + 0.0, 0.0);
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const billboardFrag = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vTint;
  #include <fog_pars_fragment>
  void main() {
    vec4 tex = texture2D(map, vUv);
    if (tex.a < 0.5) discard;
    gl_FragColor = vec4(tex.rgb * vTint, 1.0);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function buildFarTrees(trees) {
  // unit quad: x in [-0.5, 0.5], y in [0, 1]
  const plane = new THREE.PlaneGeometry(1, 1);
  plane.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.attributes.position = plane.attributes.position;
  geo.attributes.uv = plane.attributes.uv;
  geo.instanceCount = trees.count;

  const offsets = new Float32Array(trees.count * 3);
  const scales = new Float32Array(trees.count);
  const tints = new Float32Array(trees.count * 3);
  for (let i = 0; i < trees.count; i++) {
    const k = i * 4;
    offsets[i * 3] = trees.data[k];
    offsets[i * 3 + 1] = trees.data[k + 1] - 0.5;
    offsets[i * 3 + 2] = trees.data[k + 2];
    scales[i] = trees.data[k + 3];
    const v = 0.8 + ((i * 37) % 100) / 240;
    tints[i * 3] = v * (0.92 + ((i * 11) % 50) / 250);
    tints[i * 3 + 1] = v;
    tints[i * 3 + 2] = v * 0.92;
  }
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
  geo.setAttribute('scale', new THREE.InstancedBufferAttribute(scales, 1));
  geo.setAttribute('tint', new THREE.InstancedBufferAttribute(tints, 3));

  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { map: { value: null } },
    ]),
    vertexShader: billboardVert,
    fragmentShader: billboardFrag,
  });
  mat.uniforms.map.value = makeBillboardTexture();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ---- public ----------------------------------------------------------------

export function buildForest(scene, onProgress) {
  const jobs = [
    () => {
      const near = placeTrees(NEAR_COUNT, makeRng(1337));
      scene.add(buildNearTrees(near));
      if (onProgress) onProgress(0.5);
    },
    () => {
      const far = placeTrees(FAR_COUNT, makeRng(9001));
      scene.add(buildFarTrees(far));
      if (onProgress) onProgress(1);
    },
  ];
  return { jobs };
}
