import * as THREE from 'three';
import { buildTerrain } from './terrain.js';
import { buildSky, HAZE_COLOR } from './sky.js';
import { buildWater } from './water.js';
import { buildForest } from './vegetation.js';
import { buildLandmarks } from './landmarks.js';
import { buildControls } from './controls.js';
import { buildTouchControls } from './touch.js';
import { LANDMARKS, START_VIEW, loadHeightmap } from './geo.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = HAZE_COLOR.clone();

const camera = new THREE.PerspectiveCamera(
  58, window.innerWidth / window.innerHeight, 2, 60000);
camera.position.set(...START_VIEW.cam);

buildSky(scene);
const water = buildWater(scene);
let landmarks = null; // built after the DEM loads (labels sample heightAt)
const { update: updateControls, flyTo, controls, virtual } = buildControls(camera, renderer.domElement);
controls.target.set(...START_VIEW.look);
buildTouchControls(virtual);

// ---- landmark buttons -------------------------------------------------------

const places = document.getElementById('places');
function addPlaceButton(label, cam, look) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { flyTo(cam, look); b.blur(); });
  places.appendChild(b);
}
addPlaceButton('⌂  Overview', START_VIEW.cam, START_VIEW.look);
for (const lm of LANDMARKS) addPlaceButton(lm.name, lm.cam, lm.look);

// ---- incremental build with loading bar --------------------------------------

const loadbar = document.getElementById('loadbar');
const loadmsg = document.getElementById('loadmsg');
const loading = document.getElementById('loading');

const jobs = [];
let totalWeight = 1;
let doneWeight = 0;
let building = false;

// The DEM must be decoded before any terrain/forest job samples heightAt, so
// the build is gated on the async heightmap load. The loading overlay stays
// up meanwhile.
(async () => {
  loadmsg.textContent = 'reading elevation data…';
  await loadHeightmap();
  landmarks = buildLandmarks(scene); // elevations come from the loaded DEM

  const terrain = buildTerrain();
  for (const j of terrain.jobs) jobs.push({ run: j, weight: 1, msg: 'carving the gorge…' });
  const forest = buildForest(scene);
  let fi = 0;
  for (const j of forest.jobs) {
    jobs.push({ run: j, weight: 35, msg: ++fi === 1 ? 'planting the forest…' : 'scattering the far ridges…' });
  }
  scene.add(terrain.group);

  totalWeight = jobs.reduce((s, j) => s + j.weight, 0);
  building = true;
})();

function buildStep() {
  const start = performance.now();
  while (jobs.length && performance.now() - start < 28) {
    const j = jobs.shift();
    loadmsg.textContent = j.msg;
    j.run();
    doneWeight += j.weight;
  }
  loadbar.style.width = `${(100 * doneWeight) / totalWeight}%`;
  if (!jobs.length) {
    building = false;
    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 900);
  }
}

// ---- frame loop ---------------------------------------------------------------

const fpsEl = document.getElementById('fps');
let frames = 0, fpsTimer = 0;

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (building) buildStep();

  updateControls(dt);
  water.update(t);
  if (landmarks) landmarks.update(camera);

  renderer.render(scene, camera);

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fpsEl.textContent = `${Math.round(frames / fpsTimer)} fps`;
    frames = 0;
    fpsTimer = 0;
  }
});

window.__lg = { camera, controls, flyTo, virtual }; // console/debug hook

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
