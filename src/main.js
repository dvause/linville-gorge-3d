import * as THREE from 'three';
import { buildTerrain } from './terrain.js';
import { buildSky, HAZE_COLOR } from './sky.js';
import { buildWater } from './water.js';
import { buildJet } from './jet.js';
import { buildForest } from './vegetation.js';
import { buildLandmarks } from './landmarks.js';
import { buildControls } from './controls.js';
import { buildTouchControls } from './touch.js';
import { LANDMARKS, START_VIEW, loadHeightmap, riverX, riverElev } from './geo.js';

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

const sky = buildSky(scene);
const water = buildWater(scene);
const jet = buildJet(scene);
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
  return b;
}
addPlaceButton('⌂  Overview', START_VIEW.cam, START_VIEW.look);

// A landmark flagged jetFlyby rolls the dice on click: on a hit, a fighter jet
// is launched immediately so it streaks up the gorge and passes under the
// camera's destination mid-flight, before the ~2.6s fly-to lands.
const JET_CHANCE = 1; // TEMP: forced on for path tuning (real value is 0.1, 1 in 10)
// Pass the jet through the gorge at the landmark's latitude, 350 m above the
// river — PASS_CLEARANCE (180 m) below that is the jet's actual flight path.
const fireFlyby = (lm) => {
  const [ox, , oz] = lm.look; // landmark x keeps the jet on the camera's line of sight
  // heading [0,0,1] = south: jet approaches from the north, visible head-on
  // to a gorgeView camera that looks north at the rim.
  jet.trigger({ over: [ox, riverElev(oz) + 350, oz], heading: [0, 0, 1] });
};
let flybyLm = null;
for (const lm of LANDMARKS) {
  const b = addPlaceButton(lm.name, lm.cam, lm.look);
  if (lm.jetFlyby) {
    flybyLm = lm;
    b.addEventListener('click', () => { if (Math.random() < JET_CHANCE) fireFlyby(lm); });
  }
}

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
  sky.update(t);
  jet.update(dt);
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

// console/debug hook — __lg.flyby() force-fires the jet for path tuning
window.__lg = { camera, controls, flyTo, virtual, jet, flyby: () => flybyLm && fireFlyby(flybyLm) };

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
