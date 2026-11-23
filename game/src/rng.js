// rng.js — Seeded deterministic random numbers for VELVET CITY.
// Everything generated from a seed (city layout, spawns, traffic) is identical
// on every load. No Math.random() is used for world generation.
'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A small RNG object with helpers, all driven by one mulberry32 stream.
function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next: next,
    range: function (a, b) { return a + (b - a) * next(); },
    int: function (a, b) { return Math.floor(a + (b - a + 1) * next()); },
    pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
    chance: function (p) { return next() < p; },
    sign: function () { return next() < 0.5 ? -1 : 1; },
  };
}

// FNV-1a 32-bit hash of a string, returned as an 8-hex-digit string.
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}
