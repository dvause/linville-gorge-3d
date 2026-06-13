// The Linville River, Linville Falls, and Lake James.
// One procedural water shader drives river, lake, and falls with different
// flow parameters; mist at the falls base is an animated point cloud.

import * as THREE from 'three';
import { riverX, riverElev, riverWidth, WORLD } from './geo.js';

const waterNoise = /* glsl */ `
  float whash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float wnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(whash(i), whash(i + vec2(1, 0)), u.x),
               mix(whash(i + vec2(0, 1)), whash(i + vec2(1, 1)), u.x), u.y);
  }
  float wfbm(vec2 p) {
    return wnoise(p) * 0.55 + wnoise(p * 2.3 + 5.0) * 0.3 + wnoise(p * 5.1 + 9.0) * 0.15;
  }
`;

const waterVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const waterFrag = /* glsl */ `
  uniform float time;
  uniform vec3 deepColor;
  uniform vec3 shallowColor;
  uniform vec3 foamColor;
  uniform vec2 flow;       // uv scroll per second
  uniform vec2 noiseScale;
  uniform float foamAmt;
  uniform float alpha;
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  ${waterNoise}
  void main() {
    vec2 p = vUv * noiseScale - flow * time;
    float n1 = wfbm(p);
    float n2 = wfbm(p * 1.7 + vec2(3.1, -7.7) - flow * time * 0.6);
    float ripple = n1 * 0.6 + n2 * 0.4;

    vec3 col = mix(deepColor, shallowColor, smoothstep(0.35, 0.75, ripple));
    float foam = smoothstep(0.78 - foamAmt * 0.25, 0.95 - foamAmt * 0.2, ripple) * (0.35 + foamAmt);
    col = mix(col, foamColor, clamp(foam, 0.0, 1.0));

    // cheap sun glint
    float glint = pow(clamp(ripple * 1.4 - 0.45, 0.0, 1.0), 6.0);
    col += vec3(1.0, 0.97, 0.9) * glint * 0.18;

    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function makeWaterMaterial(opts) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        time: { value: 0 },
        deepColor: { value: new THREE.Color(opts.deep) },
        shallowColor: { value: new THREE.Color(opts.shallow) },
        foamColor: { value: new THREE.Color(0xeef6f8) },
        flow: { value: new THREE.Vector2(...opts.flow) },
        noiseScale: { value: new THREE.Vector2(...opts.noiseScale) },
        foamAmt: { value: opts.foam },
        alpha: { value: opts.alpha },
      },
    ]),
    vertexShader: waterVert,
    fragmentShader: waterFrag,
  });
}

function buildRiverGeometry() {
  const pts = [];
  for (let z = -7900; z <= 5750; ) {
    pts.push(z);
    z += (z > -7280 && z < -7140) ? 4 : 30; // fine sampling over the falls
  }
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  let vdist = 0, prevZ = pts[0];
  for (let i = 0; i < n; i++) {
    const z = pts[i];
    const cx = riverX(z);
    const y = riverElev(z) - 0.8;
    const hw = riverWidth(z) * 1.25;
    vdist += Math.abs(z - prevZ);
    prevZ = z;
    const k = i * 6;
    pos[k] = cx - hw; pos[k + 1] = y; pos[k + 2] = z;
    pos[k + 3] = cx + hw; pos[k + 4] = y; pos[k + 5] = z;
    const ku = i * 4;
    uv[ku] = 0; uv[ku + 1] = vdist / 60;
    uv[ku + 2] = 1; uv[ku + 3] = vdist / 60;
  }
  const idx = new Uint32Array((n - 1) * 6);
  let p = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx[p++] = a; idx[p++] = b; idx[p++] = c;
    idx[p++] = b; idx[p++] = d; idx[p++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

function makeMistTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function buildWater(scene) {
  const updaters = [];

  // --- River ---
  const river = new THREE.Mesh(
    buildRiverGeometry(),
    makeWaterMaterial({
      deep: 0x174a48, shallow: 0x3d8579, flow: [0, 1.1],
      noiseScale: [8, 40], foam: 0.12, alpha: 0.96,
    })
  );
  scene.add(river);
  updaters.push((t) => (river.material.uniforms.time.value = t));

  // --- Lake James ---
  const lake = new THREE.Mesh(
    new THREE.PlaneGeometry(4700, 2900),
    makeWaterMaterial({
      deep: 0x1f4a5e, shallow: 0x36708a, flow: [0.015, 0.02],
      noiseScale: [60, 36], foam: 0.0, alpha: 0.94,
    })
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(600, WORLD.lakeLevel, 6900);
  scene.add(lake);
  updaters.push((t) => (lake.material.uniforms.time.value = t));

  // --- Linville Falls: two drops ---
  const fallsMat = makeWaterMaterial({
    deep: 0xcfe4ea, shallow: 0xf2fafc, flow: [0, 2.6],
    noiseScale: [7, 4], foam: 0.65, alpha: 0.9,
  });

  function addFall(zTop, zBot, yTop, yBot, widen) {
    const cxT = riverX(zTop), cxB = riverX(zBot);
    const hwT = riverWidth(zTop) * 0.95, hwB = riverWidth(zBot) * (0.95 + widen);
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array([
      cxT - hwT, yTop, zTop, cxT + hwT, yTop, zTop,
      cxB - hwB, yBot, zBot, cxB + hwB, yBot, zBot,
    ]);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, fallsMat);
    scene.add(m);
    return m;
  }

  addFall(-7246, -7216, 975.5, 965.5, 0.0); // upper cascade (sloped)
  addFall(-7186, -7162, 966.5, 926.5, 0.3); // main plunge
  updaters.push((t) => (fallsMat.uniforms.time.value = t));

  // --- Mist at the plunge pool ---
  const MIST = 90;
  const mistGeo = new THREE.BufferGeometry();
  const mp = new Float32Array(MIST * 3);
  const seeds = new Float32Array(MIST);
  const baseX = riverX(-7160), baseY = 929, baseZ = -7158;
  for (let i = 0; i < MIST; i++) seeds[i] = Math.random();
  mistGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const mist = new THREE.Points(
    mistGeo,
    new THREE.PointsMaterial({
      map: makeMistTexture(), size: 26, transparent: true, opacity: 0.32,
      depthWrite: false, color: 0xeaf4f8, sizeAttenuation: true,
    })
  );
  mist.frustumCulled = false;
  scene.add(mist);
  updaters.push((t) => {
    for (let i = 0; i < MIST; i++) {
      const ph = (t * (0.10 + seeds[i] * 0.12) + seeds[i]) % 1; // 0..1 life
      const ang = seeds[i] * Math.PI * 2;
      const r = 6 + ph * 26;
      mp[i * 3] = baseX + Math.cos(ang + ph * 2.0) * r * 0.7;
      mp[i * 3 + 1] = baseY + ph * 34 - 3;
      mp[i * 3 + 2] = baseZ + Math.sin(ang) * r * 0.5 + ph * 10;
    }
    mistGeo.attributes.position.needsUpdate = true;
    mist.material.opacity = 0.32;
  });

  return {
    update(t) {
      for (const u of updaters) u(t);
    },
  };
}
