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
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.05, 1.0);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
    col = mix(col, zenith, smoothstep(0.18, 0.65, h));
    float s = clamp(dot(d, normalize(sunDir)), 0.0, 1.0);
    col += sunTint * (pow(s, 350.0) * 0.9 + pow(s, 24.0) * 0.18 + pow(s, 3.0) * 0.07);
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
        zenith: { value: new THREE.Color(0x3a6db5) },
        mid: { value: new THREE.Color(0x7fa8d4) },
        horizon: { value: HAZE_COLOR.clone() },
        sunDir: { value: sunDir },
        sunTint: { value: new THREE.Color(0xfff2d8) },
      },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
    })
  );
  sky.frustumCulled = false;
  scene.add(sky);

  // Haze. Exp2 keeps near detail crisp and stacks far ridges into layers.
  scene.fog = new THREE.FogExp2(HAZE_COLOR.clone(), 0.000155);

  const sun = new THREE.DirectionalLight(0xffe8c8, 3.1);
  sun.position.copy(sunDir).multiplyScalar(10000);
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0xa8c4e0, 0x3d4a33, 0.6);
  scene.add(hemi);

  return { sky, sunDir };
}
