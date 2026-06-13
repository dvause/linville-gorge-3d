// Seeded 2D value noise + fBm. Deterministic so terrain, trees, and
// colors agree across every module that samples it.

function hash2(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  h = (h ^ (h >> 16)) | 0;
  return (h >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  const ux = smooth(fx), uz = smooth(fz);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

// Fractal Brownian motion, `oct` octaves. Returns roughly [-1, 1].
export function fbm(x, z, oct = 4, lac = 2.0, gain = 0.5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise2(x * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

// Ridged noise — sharp crests, good for rocky rims.
export function ridge(x, z, oct = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise2(x * freq, z * freq));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm; // [0, 1]
}

// Cheap deterministic per-index random for placement jitter.
export function rand1(i) {
  return hash2(i | 0, (i * 7919) | 0);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(lo, hi, v) {
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
