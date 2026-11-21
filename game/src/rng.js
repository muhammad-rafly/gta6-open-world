// rng.js — deterministic seeded random numbers for VELVET CITY.
// The whole city (buildings, roads, traffic, pedestrians) is generated from one
// fixed seed, so every player loads the same Port Meridian.
(function (global) {
  'use strict';

  // mulberry32: small, fast, well-distributed 32-bit PRNG.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A tiny RNG object with the helpers the city generator and gameplay use.
  function makeRng(seed) {
    const next = mulberry32(seed);
    return {
      next: next,
      // float in [min, max)
      range: function (min, max) { return min + next() * (max - min); },
      // integer in [min, max]
      int: function (min, max) { return Math.floor(min + next() * (max - min + 1)); },
      // pick one element of an array
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      // true with probability p
      chance: function (p) { return next() < p; },
      // shuffle a copy of an array (Fisher-Yates)
      shuffled: function (arr) {
        const out = arr.slice();
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
        }
        return out;
      }
    };
  }

  // The city's one fixed seed: Port Meridian is the same city for everyone.
  const CITY_SEED = 20261124;

  global.VCRng = { mulberry32: mulberry32, makeRng: makeRng, CITY_SEED: CITY_SEED };
})(typeof window !== 'undefined' ? window : globalThis);
