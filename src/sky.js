// Sky dome, sun, hemisphere light, and atmospheric haze. The fog color is
// matched to the dome's horizon band so distant ridgelines dissolve into the
// sky in layered silhouettes — the signature Blue Ridge look.

import * as THREE from 'three';

export const HAZE_COLOR = new THREE.Color(0xbcd2e8);

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // pin to far plane
  }
`;

const skyFrag = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 mid;
  uniform vec3 horizon;
  uniform vec3 sunDir;
  uniform vec3 sunTint;
  uniform vec3 cloudColor;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.0; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.05, 1.0);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
    col = mix(col, zenith, smoothstep(0.18, 0.65, h));

    float s = clamp(dot(d, normalize(sunDir)), 0.0, 1.0);
    col += sunTint * (pow(s, 350.0) * 0.9 + pow(s, 24.0) * 0.18 + pow(s, 3.0) * 0.07);

    // soft cumulus: project the dome onto an overhead plane, domain-warped fbm
    if (d.y > 0.015) {
      vec2 cp = d.xz / d.y * 1.4;
      float warp = fbm(cp * 0.6 + 11.0);
      float n = fbm(cp * 1.15 + warp);
      float cover = smoothstep(0.52, 0.92, n);
      // fade out at the horizon (where the projection stretches) and overhead
      float band = smoothstep(0.06, 0.28, d.y) * (1.0 - 0.35 * smoothstep(0.75, 1.0, d.y));
      cover *= band;
      vec3 cc = mix(cloudColor, sunTint, pow(s, 5.0) * 0.6); // sun-side warmth
      col = mix(col, cc, cover * 0.85);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function buildSky(scene) {
  // Low western sun rakes across the N-S gorge: west wall in shade, east
  // wall lit, so the trench reads from every angle.
  const sunDir = new THREE.Vector3(-0.78, 0.36, 0.34).normalize();

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(30000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: new THREE.Color(0x2f63ad) },
        mid: { value: new THREE.Color(0x7fa8d4) },
        horizon: { value: HAZE_COLOR.clone() },
        sunDir: { value: sunDir },
        sunTint: { value: new THREE.Color(0xfff2d8) },
        cloudColor: { value: new THREE.Color(0xf6f9fc) },
      },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
    })
  );
  sky.frustumCulled = false;
  scene.add(sky);

  // Haze. Exp2 keeps near detail crisp and stacks far ridges into layers.
  // Lightened from 0.000155 so distant ridges read without washing out.
  scene.fog = new THREE.FogExp2(HAZE_COLOR.clone(), 0.00008);

  const sun = new THREE.DirectionalLight(0xffe8c8, 3.1);
  sun.position.copy(sunDir).multiplyScalar(10000);
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0xa8c4e0, 0x3d4a33, 0.6);
  scene.add(hemi);

  return { sky, sunDir };
}
