// Landmark callouts: a canvas-rendered label (name + elevation) on a leader
// line that drops to a dot on the feature. Billboarded sprites held at constant
// on-screen size, faded at the near/far extremes. Elevations are static
// published values (LANDMARKS[].elevFt); heightAt is used only to rest the
// leader dot on the terrain, so buildLandmarks runs after the heightmap loads.

import * as THREE from 'three';
import { LANDMARKS, heightAt, lakeMask, WORLD } from './geo.js';

// Draw one callout and report the canvas size plus the anchor (the dot at the
// summit) as a sprite-center fraction, so the dot sits exactly on the peak.
function makeCallout(name, elevText) {
  const NAME_F = 40, ELEV_F = 26, PAD = 16, LINE_GAP = 4;
  const LEADER_RUN = 44, LEADER_DROP = 70, TEXT_GAP = 12, RIGHT_PAD = 22;

  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  ctx.font = `${NAME_F}px Georgia, serif`;
  const nameW = ctx.measureText(name).width;
  ctx.font = `${ELEV_F}px Georgia, serif`;
  const elevW = ctx.measureText(elevText).width;

  const textW = Math.ceil(Math.max(nameW, elevW));
  const textLeft = LEADER_RUN + 12;
  const ruleY = PAD + NAME_F + LINE_GAP + ELEV_F + TEXT_GAP;
  const W = textLeft + textW + RIGHT_PAD;
  const H = ruleY + LEADER_DROP + 8;
  const anchorX = 8, anchorY = H - 6;

  c.width = W; c.height = H;
  ctx = c.getContext('2d');

  // dark pill behind the text block for legibility against bright sky
  const BG_PAD = 10;
  ctx.fillStyle = 'rgba(0, 5, 15, 0.52)';
  ctx.beginPath();
  ctx.roundRect(
    textLeft - BG_PAD, PAD - BG_PAD,
    textW + RIGHT_PAD + BG_PAD, (ruleY - PAD) + BG_PAD * 2,
    8
  );
  ctx.fill();

  ctx.shadowColor = 'rgba(0, 10, 25, 0.85)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;

  // text block
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(238, 246, 252, 0.97)';
  ctx.font = `${NAME_F}px Georgia, serif`;
  ctx.fillText(name, textLeft, PAD);
  ctx.fillStyle = 'rgba(206, 225, 242, 0.92)';
  ctx.font = `${ELEV_F}px Georgia, serif`;
  ctx.fillText(elevText, textLeft, PAD + NAME_F + LINE_GAP);

  // rule under the text, then a diagonal leader down to the summit dot
  ctx.strokeStyle = 'rgba(238, 246, 252, 0.9)';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(textLeft + textW, ruleY);
  ctx.lineTo(textLeft, ruleY);
  ctx.lineTo(anchorX, anchorY);
  ctx.stroke();

  ctx.fillStyle = 'rgba(238, 246, 252, 0.95)';
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 4.5, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // sprite center: canvas y is top-down, sprite center y is bottom-up
  return { tex, w: W, h: H, cx: anchorX / W, cy: 1 - anchorY / H };
}

export function buildLandmarks(scene) {
  const sprites = [];
  for (const lm of LANDMARKS) {
    const [x, , z] = lm.label;
    // rest the leader dot on the terrain (lake features sit at the surface)
    const groundM = lakeMask(x, z) > 0 ? WORLD.lakeLevel : heightAt(x, z);
    const elevText = `Elev. ${lm.elevFt.toLocaleString()} ft`;

    const { tex, w, h, cx, cy } = makeCallout(lm.name, elevText);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, fog: false,
    }));
    sprite.center.set(cx, cy);
    sprite.position.set(x, groundM + 2, z);
    sprite.renderOrder = 5;
    sprite.userData = { w, h };
    scene.add(sprite);
    sprites.push(sprite);
  }

  const v = new THREE.Vector3();
  return {
    update(camera) {
      for (const s of sprites) {
        const d = v.copy(s.position).sub(camera.position).length();
        // constant on-screen size: world units per canvas pixel scales with d
        const px = d * 0.0004;
        s.scale.set(s.userData.w * px, s.userData.h * px, 1);
        s.material.opacity = (1 - THREE.MathUtils.smoothstep(d, 9000, 14000)) *
          THREE.MathUtils.smoothstep(d, 120, 420) * 0.95;
      }
    },
  };
}
