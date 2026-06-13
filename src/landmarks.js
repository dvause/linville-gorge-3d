// Floating landmark labels: canvas-rendered text sprites that hold constant
// screen size and fade out when very close or very far.

import * as THREE from 'three';
import { LANDMARKS } from './geo.js';

function makeLabelTexture(text) {
  const pad = 28, fontSize = 44;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `${fontSize}px Georgia, serif`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fontSize + pad * 1.6;
  c.width = w; c.height = h;

  const ctx2 = c.getContext('2d');
  ctx2.font = `${fontSize}px Georgia, serif`;
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  ctx2.shadowColor = 'rgba(0, 10, 25, 0.9)';
  ctx2.shadowBlur = 10;
  ctx2.shadowOffsetY = 2;
  ctx2.fillStyle = 'rgba(238, 246, 252, 0.96)';
  ctx2.fillText(text, w / 2, h / 2);
  // small tick below the name
  ctx2.fillRect(w / 2 - 1.5, h - 12, 3, 10);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / h };
}

export function buildLandmarks(scene) {
  const sprites = [];
  for (const lm of LANDMARKS) {
    const { tex, aspect } = makeLabelTexture(lm.name);
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(lm.label[0], lm.label[1] + 60, lm.label[2]);
    sprite.renderOrder = 5;
    sprite.userData.aspect = aspect;
    scene.add(sprite);
    sprites.push(sprite);
  }

  const v = new THREE.Vector3();
  return {
    update(camera) {
      for (const s of sprites) {
        const d = v.copy(s.position).sub(camera.position).length();
        // constant on-screen size, fade at the extremes
        const scale = d * 0.035;
        s.scale.set(scale * s.userData.aspect, scale, 1);
        s.material.opacity = (1 - THREE.MathUtils.smoothstep(d, 9000, 14000)) *
          THREE.MathUtils.smoothstep(d, 120, 420) * 0.95;
      }
    },
  };
}
