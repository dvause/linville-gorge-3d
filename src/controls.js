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
    // keyboard interrupts a tween
    const flying = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].some((k) => keys.has(k));
    if (flying) tween = null;

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
      if (keys.has('KeyW')) move.add(fwd);
      if (keys.has('KeyS')) move.sub(fwd);
      if (keys.has('KeyD')) move.add(right);
      if (keys.has('KeyA')) move.sub(right);
      if (keys.has('KeyE')) move.y += 1;
      if (keys.has('KeyQ')) move.y -= 1;

      if (move.lengthSq() > 0) {
        // speed scales with altitude above terrain so low flight is gentle
        const ground = heightAt(camera.position.x, camera.position.z);
        const alt = Math.max(camera.position.y - ground, 5);
        const speed = THREE.MathUtils.clamp(alt * 1.6, 60, 1900) *
          (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1);
        move.normalize().multiplyScalar(speed * dt);
        camera.position.add(move);
        controls.target.add(move);
      }
    }

    // keep the camera out of the dirt
    const minY = heightAt(camera.position.x, camera.position.z) + 4;
    if (camera.position.y < minY) camera.position.y = minY;

    controls.update();
  }

  return { controls, update, flyTo };
}
