// Seeded RNG (mulberry32): same seed, same city, so screenshots repeat.
function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function range(random, lo, hi) {
  return lo + random() * (hi - lo);
}

// Roughly-normal value (Box-Muller, clamped to [-1, 1]): heights and sizes cluster
// around the middle, so the generated city looks grown instead of rolled.
function gauss(random) {
  const u = Math.max(1e-9, random());
  const v = random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  return Math.max(-1, Math.min(1, z / 2.5));
}
