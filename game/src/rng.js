// rng.js — deterministic seeded random numbers for VELVET CITY.
// Everything in the city is derived from one seed, so the same seed always
// builds the same city. No Math.random() anywhere in world generation.
// Fix pass (Round 4): documented — the city hash is computed from these
// seeded draws, so any change here changes the hash; behaviour untouched.
// Fix-2 (Round 4): no change here — benches/flags are layout data, not RNG
// draws, so the city hash is unaffected by moving them off the roads.
(function (global) {
  'use strict';

  // FNV-1a 32-bit hash of a string. Used for the city hash and for seeding.
  function hashString(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // mulberry32: small fast seeded PRNG with good distribution.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A seeded RNG object with the helpers the city builder needs.
  function makeRng(seed) {
    var next = mulberry32(seed);
    return {
      next: next,
      // float in [min, max)
      range: function (min, max) { return min + next() * (max - min); },
      // integer in [min, max]
      int: function (min, max) { return min + Math.floor(next() * (max - min + 1)); },
      // pick one element of an array
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      // true with probability p
      chance: function (p) { return next() < p; },
      // deterministic shuffle (Fisher-Yates)
      shuffle: function (arr) {
        for (var i = arr.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        return arr;
      }
    };
  }

  global.VCRng = { hashString: hashString, mulberry32: mulberry32, makeRng: makeRng };
})(typeof window !== 'undefined' ? window : globalThis);
