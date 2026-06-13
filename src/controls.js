// OrbitControls for mouse orbit/zoom, layered with WASD/QE fly-through that
// translates camera and orbit target together, plus smooth fly-to tweens for
// the landmark buttons.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heightAt } from './geo.js';

export function buildControls(camera, dom) {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxDistance = 16000;
  controls.minDistance = 10;
  controls.maxPolarAngle = Math.PI * 0.495;

  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // Analog input from the on-screen touch controls (touch.js). Each axis is
  // -1..1 and is summed with the keyboard before movement is applied.
  const virtual = { forward: 0, strafe: 0, vertical: 0 };

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  // fly-to tween state
  let tween = null;

  function flyTo(camPos, lookPos, duration = 2.6) {
    tween = {
      t: 0, duration,
      fromCam: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toCam: new THREE.Vector3(...camPos),
      toTarget: new THREE.Vector3(...lookPos),
    };
  }

  function update(dt) {
    // combine keyboard (on/off) with the analog touch axes, clamped to -1..1
    const k = (a, b) => (keys.has(a) ? 1 : 0) - (keys.has(b) ? 1 : 0);
    const forward = THREE.MathUtils.clamp(k('KeyW', 'KeyS') + virtual.forward, -1, 1);
    const strafe = THREE.MathUtils.clamp(k('KeyD', 'KeyA') + virtual.strafe, -1, 1);
    const vertical = THREE.MathUtils.clamp(k('KeyE', 'KeyQ') + virtual.vertical, -1, 1);
    const flying = forward !== 0 || strafe !== 0 || vertical !== 0;
    if (flying) tween = null; // any movement input interrupts a tween

    if (tween) {
      tween.t += dt;
      const u = Math.min(tween.t / tween.duration, 1);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; // easeInOutCubic
      camera.position.lerpVectors(tween.fromCam, tween.toCam, e);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
      if (u >= 1) tween = null;
    } else if (flying) {
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      right.crossVectors(fwd, UP);

      move.set(0, 0, 0);
      move.addScaledVector(fwd, forward);
      move.addScaledVector(right, strafe);
      // cap horizontal magnitude at 1 so diagonals (and W+D) aren't faster,
      // while still allowing analog deflection below full speed
      const hLen = Math.hypot(move.x, move.z);
      if (hLen > 1) { move.x /= hLen; move.z /= hLen; }
      move.y = vertical;

      // speed scales with altitude above terrain so low flight is gentle
      const ground = heightAt(camera.position.x, camera.position.z);
      const alt = Math.max(camera.position.y - ground, 5);
      const speed = THREE.MathUtils.clamp(alt * 1.6, 60, 1900) *
        (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1);
      move.multiplyScalar(speed * dt);
      camera.position.add(move);
      controls.target.add(move);
    }

    // keep the camera out of the dirt
    const minY = heightAt(camera.position.x, camera.position.z) + 4;
    if (camera.position.y < minY) camera.position.y = minY;

    controls.update();
  }

  return { controls, update, flyTo, virtual };
}
