import * as THREE from 'three';

// A low-poly fighter jet that screams up the gorge below the rim peaks — the
// kind of training run locals catch on camera and post to Facebook. One mesh,
// one flyby at a time. trigger() launches it; update() flies it and hides it
// when it's gone past.
//
// ---- tunables (dial these in by testing: window.__lg.flyby()) --------------
const JET_SPEED = 600;       // m/s ground speed up the gorge (~Mach 1.7, dramatic)
const LEAD_DIST = 1400;      // m behind the pass-point where the jet starts
const TRAIL_DIST = 6000;     // m past the pass-point before it vanishes
const PASS_CLEARANCE = 180;  // m the jet passes BELOW the point it flies under
//
// v1 flies a STRAIGHT line up the gorge (constant x/y, heading north). Real
// runs follow the river's bends beneath the peaks — the next iteration should
// path the jet along the NHD centerline (riverX/riverElev from geo.js) and let
// it bank into the turns. Kept straight for now so the timing tunes cleanly.

function buildMesh() {
  // Nose points along -z (north) at rest, so lookAt() aims it cleanly.
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x6b7079, metalness: 0.6, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.5, roughness: 0.6 });

  // Fuselage: a cylinder along z with a cone nose. Exaggerated to ~28 m so it
  // reads from the rim-distance camera (a real jet would be a speck).
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.1, 20, 12), body);
  fuse.rotation.x = Math.PI / 2;          // axis y -> z
  g.add(fuse);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.5, 8, 12), body);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -14;                  // -z is forward
  g.add(nose);
  const tailcone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4, 12), dark);
  tailcone.rotation.x = Math.PI / 2;
  tailcone.position.z = 12;
  g.add(tailcone);

  // Swept delta wings: one flattened box, sheared back by skewing the geometry.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(22, 0.5, 7), body);
  const pos = wing.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // sweep: push vertices back (+z) in proportion to |x|
    pos.setZ(i, pos.getZ(i) + Math.abs(pos.getX(i)) * 0.55);
  }
  pos.needsUpdate = true;
  wing.geometry.computeVertexNormals();
  wing.position.z = 2;
  g.add(wing);

  // Vertical tail fin + horizontal stabilizers at the tail.
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 5), dark);
  fin.position.set(0, 2.5, 11);
  g.add(fin);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, 3), body);
  stab.position.z = 11;
  g.add(stab);

  return g;
}

export function buildJet(scene) {
  const jet = buildMesh();
  jet.visible = false;
  scene.add(jet);

  let state = null; // { dir, dist, total } while a flyby is in progress

  // over: the world point [x,y,z] to pass beneath (e.g. the camera's destination).
  // heading: travel direction, defaults to south so the jet approaches head-on
  // from the north (in front of a northward-looking gorgeView camera).
  function trigger({ over, heading = [0, 0, 1] }) {
    const dir = new THREE.Vector3(...heading).normalize();
    const pass = new THREE.Vector3(over[0], over[1] - PASS_CLEARANCE, over[2]);
    const start = pass.clone().addScaledVector(dir, -LEAD_DIST);
    jet.position.copy(start);
    jet.lookAt(start.clone().add(dir));
    jet.visible = true;
    state = { dir, dist: 0, total: LEAD_DIST + TRAIL_DIST };
    console.log('[jet] flyby start', start.toArray().map(v => Math.round(v)), '→ heading', dir.toArray().map(v => v.toFixed(1)));
  }

  function update(dt) {
    if (!state) return;
    const step = JET_SPEED * dt;
    jet.position.addScaledVector(state.dir, step);
    state.dist += step;
    if (state.dist >= state.total) {
      jet.visible = false;
      state = null;
    }
  }

  return { update, trigger };
}
