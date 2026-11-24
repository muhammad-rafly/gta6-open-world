// world.js — Port Meridian: the city of VELVET CITY.
// Builds the whole city from one seed (1337) with a seeded RNG, so the same
// seed always builds the same city. Exports buildCity(THREE, seed) which
// returns { data, group, hash }: the gameplay data, the THREE.Group holding
// every mesh, and a deterministic hash of the layout (stable across reloads).
//
// VISIBILITY PRIORITIES (the player must SEE these, not just have them in code):
//  - zebra crossings: THICK bright-white bars (MeshBasicMaterial 0xffffff),
//    2.2u wide x 14u long, 10 bars per crossing, raised y=0.16, 6 crossings.
//  - bus stops: big shelters (roof + 2 posts + bench + back panel) with a
//    LARGE high-contrast "BUS" sign, on the main avenues.
//  - road shoulders: a clear medium-grey strip 2.5u wide on BOTH sides of
//    every road, between the dark asphalt and the light sidewalk, edged by a
//    bright low curb, so every road visibly has shoulders.
(function (global) {
  'use strict';

  var CITY_W = 3200, CITY_H = 2400;      // city bounds in world units
  var ROAD_ASPHALT = 14;                 // asphalt width
  var SHOULDER_W = 2.5;                  // shoulder strip width, each side
  var SIDEWALK_W = 4;                    // sidewalk width, each side
  var ROAD_CORRIDOR = ROAD_ASPHALT + 2 * SHOULDER_W + 2 * SIDEWALK_W; // 27

  // Avenue x positions (roads running north-south) and street z positions.
  var AVENUES = [-1400, -1000, -600, -200, 200, 600, 1000, 1400];
  var STREETS = [-1000, -600, -200, 200, 600, 1000];

  // Facade palette: vivid, sun-soaked modern city colours (no more pale beige).
  var FACADE_COLORS = [0xd86a4a, 0x3a9a8a, 0xe8b830, 0x5a9ad0, 0xd87090,
    0xc8b49a, 0x9aa5b0, 0x6ab890, 0xe07850, 0x9a7ac0];
  var SHOP_COLORS = [0xd84a30, 0x2a7ab8, 0xe8a020, 0x3a9a5a, 0x8a4ab8, 0x20a0a0];

  function cityHashOf(parts) {
    var h = 0x811c9dc5;
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i];
      for (var j = 0; j < s.length; j++) {
        h ^= s.charCodeAt(j);
        h = Math.imul(h, 0x01000193);
      }
      h ^= 0x2e; h = Math.imul(h, 0x01000193); // separator
    }
    return (h >>> 0).toString(16);
  }

  // ---- layout ------------------------------------------------------------
  // Computes every placed object from the seed. Pure data, no THREE calls,
  // so the hash is a pure function of the seed.
  function layoutCity(seed) {
    var rng = VCRng.makeRng(seed);
    var hashParts = ['seed:' + seed];

    // Buildings: 4-6 per block, in the blocks between roads.
    var buildings = [];
    var blockXs = [], blockZs = [];
    for (var a = 0; a < AVENUES.length - 1; a++) blockXs.push((AVENUES[a] + AVENUES[a + 1]) / 2);
    for (var s = 0; s < STREETS.length - 1; s++) blockZs.push((STREETS[s] + STREETS[s + 1]) / 2);
    var blockW = 400 - ROAD_CORRIDOR, blockH = 400 - ROAD_CORRIDOR;
    for (var bi = 0; bi < blockXs.length; bi++) {
      for (var bj = 0; bj < blockZs.length; bj++) {
        var cx = blockXs[bi], cz = blockZs[bj];
        var n = rng.int(4, 6);
        // Buildings line the block in two rows (north row + south row).
        for (var k = 0; k < n; k++) {
          var row = k % 2 === 0 ? -1 : 1;
          var col = Math.floor(k / 2);
          var w = rng.range(42, 88), d = rng.range(30, 58);
          var h = rng.range(24, 110);
          // Taller towers near the city centre.
          var distC = Math.sqrt(cx * cx + cz * cz) / 1600;
          if (distC < 0.45 && rng.chance(0.35)) h = rng.range(110, 165);
          var x = cx + (col - 1) * (blockW / 3.2) + rng.range(-8, 8);
          var z = cz + row * (blockH / 4) + rng.range(-6, 6);
          var rotY = rng.chance(0.12) ? Math.PI / 2 : 0;
          var color = rng.pick(FACADE_COLORS);
          var shop = rng.pick(SHOP_COLORS);
          var winKind = rng.int(0, 2); // 0 dark, 1 blue glass, 2 lit
          buildings.push({ x: x, z: z, w: w, d: d, h: h, rotY: rotY, color: color, shop: shop, winKind: winKind });
          hashParts.push('b' + x.toFixed(2) + ',' + z.toFixed(2) + ',' + w.toFixed(1) + ',' + d.toFixed(1) + ',' + h.toFixed(1) + ',' + color);
        }
      }
    }

    // Trees along sidewalks, hydrants near corners, street lamps along roads.
    var trees = [], hydrants = [], lamps = [];
    for (var ai = 0; ai < AVENUES.length; ai++) {
      var ax = AVENUES[ai];
      for (var tz = -1150; tz <= 1150; tz += 100) {
        if (rng.chance(0.4)) trees.push({ x: ax + ROAD_CORRIDOR / 2 - 1.2, z: tz + rng.range(-20, 20), s: rng.range(0.8, 1.4) });
        if (rng.chance(0.4)) trees.push({ x: ax - ROAD_CORRIDOR / 2 + 1.2, z: tz + 40 + rng.range(-20, 20), s: rng.range(0.8, 1.4) });
      }
      for (var lz = -1150; lz <= 1150; lz += 200) {
        lamps.push({ x: ax + ROAD_ASPHALT / 2 + SHOULDER_W + SIDEWALK_W - 0.6, z: lz, side: 1 });
        lamps.push({ x: ax - ROAD_ASPHALT / 2 - SHOULDER_W - SIDEWALK_W + 0.6, z: lz + 65, side: -1 });
      }
    }
    for (var si = 0; si < STREETS.length; si++) {
      var sz = STREETS[si];
      for (var tx = -1550; tx <= 1550; tx += 100) {
        if (rng.chance(0.3)) trees.push({ x: tx + rng.range(-20, 20), z: sz + ROAD_CORRIDOR / 2 - 1.2, s: rng.range(0.8, 1.4) });
        if (rng.chance(0.3)) trees.push({ x: tx + 40 + rng.range(-20, 20), z: sz - ROAD_CORRIDOR / 2 + 1.2, s: rng.range(0.8, 1.4) });
      }
      for (var lx = -1550; lx <= 1550; lx += 200) {
        lamps.push({ x: lx, z: sz + ROAD_ASPHALT / 2 + SHOULDER_W + SIDEWALK_W - 0.6, side: 1 });
        lamps.push({ x: lx + 65, z: sz - ROAD_ASPHALT / 2 - SHOULDER_W - SIDEWALK_W + 0.6, side: -1 });
      }
    }
    for (var hi = 0; hi < AVENUES.length; hi++) {
      for (var hj = 0; hj < STREETS.length; hj++) {
        hydrants.push({ x: AVENUES[hi] + ROAD_CORRIDOR / 2 + 1.5, z: STREETS[hj] + ROAD_CORRIDOR / 2 + 1.5 });
      }
    }

    // Traffic lights: one per intersection (8 avenues x 6 streets = 48).
    // axis 'NS' = avenue traffic, 'EW' = street traffic; the cycle alternates.
    var trafficLights = [];
    for (var li = 0; li < AVENUES.length; li++) {
      for (var lj = 0; lj < STREETS.length; lj++) {
        trafficLights.push({ x: AVENUES[li] + ROAD_ASPHALT / 2 + 1, z: STREETS[lj] + ROAD_ASPHALT / 2 + 1, axis: 'NS' });
        trafficLights.push({ x: AVENUES[li] - ROAD_ASPHALT / 2 - 1, z: STREETS[lj] - ROAD_ASPHALT / 2 - 1, axis: 'EW' });
      }
    }
    // Keep exactly 48 light poles (one per intersection corner pair is 96
    // meshes; we keep the count at 48 by using one pole per intersection).
    trafficLights = trafficLights.filter(function (l, idx) { return idx % 2 === 0; });

    // Zebra crossings: 6, at central intersections, spanning the avenue.
    // Bars run across the road (long axis X) and are spaced along the road (Z).
    var crossings = [
      { x: -200, z: -200, axis: 'NS' }, { x: 200, z: -200, axis: 'NS' },
      { x: -200, z: 200, axis: 'NS' }, { x: 200, z: 200, axis: 'NS' },
      { x: 0, z: 0, axis: 'NS' }, { x: 600, z: 200, axis: 'NS' }
    ];
    // Move the (0,0) crossing onto the nearest real avenue/street crossing.
    crossings[4] = { x: 200, z: 0, axis: 'NS' };
    crossings.forEach(function (c) { hashParts.push('x' + c.x + ',' + c.z); });

    // Bus stops: 4 big shelters on the main avenues, near central crossings.
    var busStops = [
      { x: 200 + ROAD_CORRIDOR / 2 + 2, z: -160, face: -1 },
      { x: -200 - ROAD_CORRIDOR / 2 - 2, z: 160, face: 1 },
      { x: 600 + ROAD_CORRIDOR / 2 + 2, z: 240, face: -1 },
      { x: -600 - ROAD_CORRIDOR / 2 - 2, z: -240, face: 1 }
    ];
    busStops.forEach(function (b) { hashParts.push('s' + b.x + ',' + b.z); });

    // Park benches: 8, in the central plaza and along sidewalks.
    // Fix-2 (Round 4): two benches used to sit ON avenue 200's centreline
    // (x=200; asphalt spans 193-207) — a bench plus a seated citizen in a
    // traffic lane. They now sit on the east sidewalk (x=211.5, sidewalk
    // spans 209.5-213.5), clearly off the road.
    var benches = [
      { x: 150, z: -80, rotY: 0 }, { x: 211.5, z: -80, rotY: 0 },
      { x: 150, z: -130, rotY: Math.PI }, { x: 211.5, z: -130, rotY: Math.PI },
      { x: -180, z: 220, rotY: 0.4 }, { x: 620, z: 180, rotY: -0.4 },
      { x: 220, z: -220, rotY: 1.2 }, { x: -220, z: -220, rotY: -1.2 }
    ];

    // Food stalls: 3, big and colourful, near the plaza and the crossings.
    var stalls = [
      { x: 175, z: -60, rotY: 0, color: 0xd84a30 },
      { x: -175, z: 175, rotY: Math.PI / 2, color: 0xe8a020 },
      { x: 625, z: 225, rotY: -Math.PI / 2, color: 0x2a7ab8 }
    ];

    // Neon signs on central buildings.
    var neonTexts = ['BAR', '24H', 'HOTEL', 'PIZZA', 'CLUB', 'CAFE'];
    var neonColors = [0xff4a6a, 0x30e0ff, 0xffc030, 0xff7a30, 0xc060ff, 0x40ff90];
    var neons = [];
    for (var ni = 0; ni < 6; ni++) {
      var nb = buildings[Math.floor(buildings.length * (0.12 + ni * 0.13))];
      neons.push({ x: nb.x, z: nb.z + nb.d / 2 + 0.6, y: Math.min(nb.h * 0.55, 42), text: neonTexts[ni], color: neonColors[ni] });
    }

    // Flags: 6, waving, around the plaza and main avenues.
    // Fix-2 (Round 4): two flags stood ON road centrelines (200,180 on
    // avenue 200; 600,-180 on avenue 600). Moved onto the east sidewalks
    // (x=210 / 610) so no flag pole stands in a traffic lane.
    var flags = [
      { x: 140, z: -100 }, { x: 210, z: -100 }, { x: 175, z: -140 },
      { x: -150, z: -180 }, { x: 210, z: 180 }, { x: 610, z: -180 }
    ];

    // Pay 'n Spray at the plaza (175,-100).
    var paynspray = { x: 175, z: -100 };

    // Palm trees: along avenue 200 (main shot road), avenue 1400 (beachfront)
    // and on the east beach itself.
    var palms = [];
    for (var pz = -1000; pz <= 1000; pz += 160) {
      if (rng.chance(0.7)) palms.push({ x: 200 + ROAD_CORRIDOR / 2 + 1, z: pz + rng.range(-30, 30), h: rng.range(7, 10), lean: rng.range(-0.1, 0.1), rot: rng.range(0, 6.28) });
      if (rng.chance(0.7)) palms.push({ x: 200 - ROAD_CORRIDOR / 2 - 1, z: pz + 80 + rng.range(-30, 30), h: rng.range(7, 10), lean: rng.range(-0.1, 0.1), rot: rng.range(0, 6.28) });
    }
    for (var qz = -1000; qz <= 1000; qz += 200) {
      if (rng.chance(0.8)) palms.push({ x: 1400 - ROAD_CORRIDOR / 2 - 1, z: qz + rng.range(-30, 30), h: rng.range(7, 10), lean: rng.range(-0.1, 0.1), rot: rng.range(0, 6.28) });
    }
    for (var bz = -1100; bz <= 1100; bz += 220) {
      if (rng.chance(0.85)) palms.push({ x: 1500 + rng.range(-40, 60), z: bz + rng.range(-40, 40), h: rng.range(8, 11), lean: rng.range(-0.1, 0.1), rot: rng.range(0, 6.28) });
    }
    palms.forEach(function (p) { hashParts.push('p' + p.x.toFixed(1) + ',' + p.z.toFixed(1) + ',' + p.h.toFixed(1)); });

    // East beach: a sand strip with umbrellas beyond the last avenue
    // (x 1430..1600 is open grass — no buildings or roads there).
    var beach = { x0: 1430, x1: 1600, z0: -1200, z1: 1200 };
    var umbrellas = [];
    var umbrellaColors = [0xff5a5a, 0xffc030, 0x30c0ff, 0xff7ad0, 0x60e090, 0xff8a30];
    for (var ui = 0; ui < 6; ui++) {
      umbrellas.push({ x: 1520 + rng.range(-30, 50), z: -900 + ui * 360 + rng.range(-60, 60), color: umbrellaColors[ui] });
    }
    umbrellas.forEach(function (u) { hashParts.push('u' + u.x.toFixed(1) + ',' + u.z.toFixed(1) + ',' + u.color); });
    hashParts.push('beach' + beach.x0 + ',' + beach.x1);

    // Colliders: building AABBs (rotated 90 deg handled by swapping w/d).
    var colliders = buildings.map(function (b) {
      var w = b.rotY !== 0 ? b.d : b.w, d = b.rotY !== 0 ? b.w : b.d;
      return { x0: b.x - w / 2 - 1, x1: b.x + w / 2 + 1, z0: b.z - d / 2 - 1, z1: b.z + d / 2 + 1 };
    });

    var hash = cityHashOf(hashParts);
    return {
      seed: seed, hash: hash, buildings: buildings, trees: trees, hydrants: hydrants,
      lamps: lamps, trafficLights: trafficLights, crossings: crossings,
      busStops: busStops, benches: benches, stalls: stalls, neons: neons,
      flags: flags, paynspray: paynspray, colliders: colliders,
      palms: palms, umbrellas: umbrellas, beach: beach,
      avenues: AVENUES.slice(), streets: STREETS.slice(),
      bounds: { x0: -CITY_W / 2, x1: CITY_W / 2, z0: -CITY_H / 2, z1: CITY_H / 2 }
    };
  }

  // ---- procedural canvas textures ---------------------------------------
  function canvasTexture(w, h, draw) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function hexCss(c) {
    return '#' + ('000000' + c.toString(16)).slice(-6);
  }

  // Facade texture: brick speckle, floor bands, 3 window kinds, shopfront.
  function facadeTexture(baseColor, shopColor, winKind, rng) {
    return canvasTexture(256, 512, function (ctx, w, h) {
      ctx.fillStyle = hexCss(baseColor);
      ctx.fillRect(0, 0, w, h);
      // brick speckle
      for (var i = 0; i < 900; i++) {
        ctx.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(2, 6), rng.range(2, 4));
      }
      // floor bands
      var floors = 8;
      for (var f = 0; f < floors; f++) {
        var y = 40 + f * ((h - 60) / floors);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(0, y, w, 3);
        // windows: 4 per floor
        for (var k = 0; k < 4; k++) {
          var x = 18 + k * 58, wy = y + 10;
          if (winKind === 0) ctx.fillStyle = '#1c2026';           // dark
          else if (winKind === 1) ctx.fillStyle = '#5a7a9a';       // blue glass
          else ctx.fillStyle = rng.chance(0.6) ? '#ffd98a' : '#2a2e36'; // lit / dark
          ctx.fillRect(x, wy, 34, 30);
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(x, wy, 34, 4);
        }
      }
      // ground-floor shopfront band
      ctx.fillStyle = hexCss(shopColor);
      ctx.fillRect(0, h - 46, w, 46);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (var s2 = 0; s2 < 4; s2++) ctx.fillRect(14 + s2 * 60, h - 38, 44, 26);
    });
  }

  // Asphalt texture: dark with noise + faint patches.
  function asphaltTexture(rng) {
    return canvasTexture(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#26292e';
      ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 1600; i++) {
        ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.12)';
        ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 4), rng.range(1, 4));
      }
      for (var p = 0; p < 8; p++) {
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.beginPath();
        ctx.ellipse(rng.range(0, w), rng.range(0, h), rng.range(20, 60), rng.range(12, 30), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // Sidewalk texture: light paving tiles.
  function sidewalkTexture() {
    return canvasTexture(128, 128, function (ctx, w, h) {
      ctx.fillStyle = '#a8adb5';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 2;
      for (var i = 0; i <= 4; i++) {
        ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(w, i * 32); ctx.stroke();
      }
    });
  }

  // Shoulder texture: medium grey with a worn centre line feel.
  function shoulderTexture(rng) {
    return canvasTexture(128, 128, function (ctx, w, h) {
      ctx.fillStyle = '#6f757e';
      ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 500; i++) {
        ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)';
        ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 3), rng.range(1, 3));
      }
    });
  }

  // Grass texture: calm sage green with soft blotches (never near-white).
  function grassTexture(rng) {
    return canvasTexture(512, 512, function (ctx, w, h) {
      ctx.fillStyle = '#7d8f6a';
      ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 60; i++) {
        ctx.fillStyle = rng.chance(0.5) ? 'rgba(90,110,70,0.25)' : 'rgba(140,155,115,0.22)';
        ctx.beginPath();
        ctx.ellipse(rng.range(0, w), rng.range(0, h), rng.range(20, 80), rng.range(14, 50), rng.range(0, 3), 0, Math.PI * 2);
        ctx.fill();
      }
      for (var j = 0; j < 2500; j++) {
        ctx.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
        ctx.fillRect(rng.range(0, w), rng.range(0, h), 2, 2);
      }
    });
  }

  // Sand texture: warm pale sand with speckles (east beach).
  function sandTexture(rng) {
    return canvasTexture(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#e8d49a';
      ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 1200; i++) {
        ctx.fillStyle = rng.chance(0.5) ? 'rgba(180,150,90,0.25)' : 'rgba(255,245,210,0.25)';
        ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 3), rng.range(1, 3));
      }
      for (var p = 0; p < 6; p++) {
        ctx.fillStyle = 'rgba(200,170,110,0.18)';
        ctx.beginPath();
        ctx.ellipse(rng.range(0, w), rng.range(0, h), rng.range(20, 50), rng.range(12, 26), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // Striped awning texture for food stalls.
  function awningTexture(color) {
    return canvasTexture(128, 64, function (ctx, w, h) {
      for (var i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 === 0 ? hexCss(color) : '#f5f0e6';
        ctx.fillRect(i * 16, 0, 16, h);
      }
    });
  }

  // Neon sign texture: glowing word on dark glass.
  function neonTexture(text, color) {
    return canvasTexture(256, 96, function (ctx, w, h) {
      ctx.fillStyle = '#101018';
      ctx.fillRect(0, 0, w, h);
      ctx.font = 'bold 58px Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = hexCss(color); ctx.shadowBlur = 22;
      ctx.fillStyle = hexCss(color);
      ctx.fillText(text, w / 2, h / 2 + 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, w / 2, h / 2 + 2);
    });
  }

  // BIG bus-stop sign texture: huge letters, maximum contrast.
  function busSignTexture() {
    return canvasTexture(256, 128, function (ctx, w, h) {
      ctx.fillStyle = '#ffcc00';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#111111'; ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.font = 'bold 84px Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#111111';
      ctx.fillText('BUS', w / 2, h / 2 + 4);
    });
  }

  global.VCWorld = {
    buildCity: buildCity, layoutCity: layoutCity,
    CITY_W: CITY_W, CITY_H: CITY_H, ROAD_ASPHALT: ROAD_ASPHALT,
    SHOULDER_W: SHOULDER_W, SIDEWALK_W: SIDEWALK_W, ROAD_CORRIDOR: ROAD_CORRIDOR
  };

  // ---- mesh building -----------------------------------------------------
  function buildCity(THREE, seed) {
    var rng = VCRng.makeRng(seed + 77);
    var data = layoutCity(seed);
    var group = new THREE.Group();
    group.name = 'PortMeridian';

    // Ground: sage-green grass plane (calm, never near-white).
    var grassTex = grassTexture(rng);
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(8, 6);
    var groundMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, metalness: 0 });
    groundMat.envMapIntensity = 0.35;
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W, CITY_H), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    // East beach: sand strip + umbrellas (coastal east edge, beyond avenue 1400).
    var sandTex = sandTexture(rng);
    sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
    sandTex.repeat.set(2, 24);
    var sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, metalness: 0 });
    sandMat.envMapIntensity = 0.35;
    var sand = new THREE.Mesh(new THREE.PlaneGeometry(data.beach.x1 - data.beach.x0, data.beach.z1 - data.beach.z0), sandMat);
    sand.rotation.x = -Math.PI / 2;
    sand.position.set((data.beach.x0 + data.beach.x1) / 2, 0.10, 0);
    sand.receiveShadow = true;
    group.add(sand);
    data.umbrellas.forEach(function (u) {
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6),
        new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1 }));
      pole.position.set(u.x, 1.3, u.z);
      pole.castShadow = true;
      group.add(pole);
      var top = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.1, 8),
        new THREE.MeshStandardMaterial({ color: u.color, roughness: 0.8 }));
      top.position.set(u.x, 3.1, u.z);
      top.castShadow = true;
      group.add(top);
    });

    var asphaltTex = asphaltTexture(rng);
    asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
    var asphaltMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95, metalness: 0 });
    asphaltMat.envMapIntensity = 0.2;
    var sidewalkTex = sidewalkTexture();
    sidewalkTex.wrapS = sidewalkTex.wrapT = THREE.RepeatWrapping;
    var sidewalkMat = new THREE.MeshStandardMaterial({ map: sidewalkTex, roughness: 1, metalness: 0 });
    sidewalkMat.envMapIntensity = 0.35;
    var shoulderTex = shoulderTexture(rng);
    shoulderTex.wrapS = shoulderTex.wrapT = THREE.RepeatWrapping;
    var shoulderMat = new THREE.MeshStandardMaterial({ map: shoulderTex, roughness: 1, metalness: 0 });
    shoulderMat.envMapIntensity = 0.35;
    var curbMat = new THREE.MeshStandardMaterial({ color: 0xdcdcdc, roughness: 0.9, metalness: 0 });
    curbMat.envMapIntensity = 0.35;

    // Roads: asphalt + SHOULDERS (medium grey, both sides) + sidewalks +
    // bright low curbs, so every road visibly has shoulders.
    // Fix-2 (Round 4) — Z-FIGHTING: the road stack used to sit 0.01-0.03
    // above the ground plane, which is inside the depth-buffer precision at
    // road distances, so the grass flickered through the asphalt frame to
    // frame (half the drive shot read as green grass with dashes on it).
    // The whole stack is lifted +0.08 (asphalt now 0.09) with the same
    // relative gaps, so the asphalt always wins the depth test.
    function buildRoad(cx, cz, len, alongX) {
      var mk = function (w, mat, y, x, z) {
        var m = new THREE.Mesh(new THREE.PlaneGeometry(alongX ? len : w, alongX ? w : len), mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, y, z);
        m.receiveShadow = true;
        group.add(m);
        return m;
      };
      var half = ROAD_ASPHALT / 2;
      // asphalt
      mk(ROAD_ASPHALT, asphaltMat, 0.09, cx, cz);
      // shoulders, both sides (clearly different tone from asphalt + sidewalk)
      var shOff = half + SHOULDER_W / 2;
      if (alongX) {
        mk(SHOULDER_W, shoulderMat, 0.10, cx, cz - shOff);
        mk(SHOULDER_W, shoulderMat, 0.10, cx, cz + shOff);
        mk(SIDEWALK_W, sidewalkMat, 0.11, cx, cz - (half + SHOULDER_W + SIDEWALK_W / 2));
        mk(SIDEWALK_W, sidewalkMat, 0.11, cx, cz + (half + SHOULDER_W + SIDEWALK_W / 2));
      } else {
        mk(SHOULDER_W, shoulderMat, 0.10, cx - shOff, cz);
        mk(SHOULDER_W, shoulderMat, 0.10, cx + shOff, cz);
        mk(SIDEWALK_W, sidewalkMat, 0.11, cx - (half + SHOULDER_W + SIDEWALK_W / 2), cz);
        mk(SIDEWALK_W, sidewalkMat, 0.11, cx + (half + SHOULDER_W + SIDEWALK_W / 2), cz);
      }
      // bright low curbs along the shoulder/sidewalk edge
      var curbOff = half + SHOULDER_W;
      var curbGeo = alongX ? new THREE.BoxGeometry(len, 0.18, 0.5) : new THREE.BoxGeometry(0.5, 0.18, len);
      [-1, 1].forEach(function (s) {
        var c = new THREE.Mesh(curbGeo, curbMat);
        c.position.set(alongX ? cx : cx + s * curbOff, 0.17, alongX ? cz + s * curbOff : cz);
        c.castShadow = false; c.receiveShadow = true;
        group.add(c);
      });
    }
    AVENUES.forEach(function (x) { buildRoad(x, 0, CITY_H, false); });
    STREETS.forEach(function (z) { buildRoad(0, z, CITY_W, true); });

    // Lane dashes: one InstancedMesh for the whole city (~5,244 dashes).
    var dashGeo = new THREE.PlaneGeometry(0.35, 3.2);
    var dashMat = new THREE.MeshBasicMaterial({ color: 0xf2f2e8 });
    var dashSpots = [];
    AVENUES.forEach(function (x) {
      for (var z = -1180; z <= 1180; z += 7.2) dashSpots.push({ x: x, z: z, rot: 0 });
    });
    STREETS.forEach(function (z) {
      for (var x = -1580; x <= 1580; x += 7.2) dashSpots.push({ x: x, z: z, rot: Math.PI / 2 });
    });
    var dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashSpots.length);
    var dummy = new THREE.Object3D();
    dashSpots.forEach(function (d, i) {
      dummy.position.set(d.x, 0.12, d.z);
      dummy.rotation.set(-Math.PI / 2, 0, d.rot);
      dummy.updateMatrix();
      dashes.setMatrixAt(i, dummy.matrix);
    });
    dashes.instanceMatrix.needsUpdate = true;
    group.add(dashes);
    data.dashCount = dashSpots.length;

    // ZEBRA CROSSINGS: thick bright-white bars, raised, unmissable.
    // Each bar 2.2u wide (along the road) x 14u long (across the road),
    // 10 bars per crossing, 6 crossings.
    var stripeGeo = new THREE.BoxGeometry(14, 0.1, 2.2);
    var stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    var stripeSpots = [];
    data.crossings.forEach(function (c) {
      for (var i = 0; i < 10; i++) {
        stripeSpots.push({ x: c.x, z: c.z - 13.5 + i * 3.0 });
      }
    });
    var stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, stripeSpots.length);
    stripeSpots.forEach(function (s, i) {
      dummy.position.set(s.x, 0.16, s.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      stripes.setMatrixAt(i, dummy.matrix);
    });
    stripes.instanceMatrix.needsUpdate = true;
    group.add(stripes);
    data.stripeCount = stripeSpots.length;

    // Buildings with procedural facades.
    var facadeCache = {};
    function facadeMat(color, shop, winKind) {
      var key = color + '_' + shop + '_' + winKind;
      if (!facadeCache[key]) {
        var tex = facadeTexture(color, shop, winKind, VCRng.makeRng(VCRng.hashString(key)));
        facadeCache[key] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 });
        facadeCache[key].envMapIntensity = 0.35;
      }
      return facadeCache[key];
    }
    var roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 1, metalness: 0 });
    roofMat.envMapIntensity = 0.35;
    data.buildings.forEach(function (b) {
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), facadeMat(b.color, b.shop, b.winKind));
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.rotation.y = b.rotY;
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      var roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 1, 1.2, b.d + 1), roofMat);
      roof.position.set(b.x, b.h + 0.6, b.z);
      roof.rotation.y = b.rotY;
      group.add(roof);
      // lit windows glow at dusk for a few towers
      if (b.winKind === 2 && b.h > 70) {
        var glow = new THREE.Mesh(new THREE.PlaneGeometry(b.w * 0.5, b.h * 0.4),
          new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.35 }));
        glow.position.set(b.x, b.h * 0.55, b.z + b.d / 2 + 0.3);
        group.add(glow);
      }
    });

    // Trees (instanced): trunk + cone canopy.
    var trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 3, 6);
    var trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 1 });
    var coneGeo = new THREE.SphereGeometry(3.1, 8, 6);
    var coneMat = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1 });
    var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, data.trees.length);
    var cones = new THREE.InstancedMesh(coneGeo, coneMat, data.trees.length);
    data.trees.forEach(function (t, i) {
      dummy.position.set(t.x, 1.5 * t.s, t.z);
      dummy.scale.setScalar(t.s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.x, (3 + 4) * t.s, t.z);
      dummy.updateMatrix();
      cones.setMatrixAt(i, dummy.matrix);
    });
    trunks.instanceMatrix.needsUpdate = true;
    cones.instanceMatrix.needsUpdate = true;
    cones.castShadow = true;
    group.add(trunks); group.add(cones);

    // Palm trees (instanced): trunk + 7 drooping fronds each.
    var palmTrunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 1, 6);
    var palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 1 });
    var palmTrunks = new THREE.InstancedMesh(palmTrunkGeo, palmTrunkMat, data.palms.length);
    var frondGeo = new THREE.BoxGeometry(0.7, 0.1, 4.6);
    frondGeo.translate(0, 0, 1.7);
    var frondMat = new THREE.MeshStandardMaterial({ color: 0x2fae4e, roughness: 1 });
    var palmFronds = new THREE.InstancedMesh(frondGeo, frondMat, data.palms.length * 7);
    data.palms.forEach(function (p, i) {
      dummy.position.set(p.x, p.h / 2, p.z);
      dummy.scale.set(1, p.h, 1);
      dummy.rotation.set(0, 0, p.lean);
      dummy.updateMatrix();
      palmTrunks.setMatrixAt(i, dummy.matrix);
      for (var f = 0; f < 7; f++) {
        dummy.position.set(p.x, p.h, p.z);
        dummy.scale.setScalar(1);
        dummy.rotation.order = 'YXZ';
        dummy.rotation.set(0.55, p.rot + f * (Math.PI * 2 / 7), 0);
        dummy.updateMatrix();
        palmFronds.setMatrixAt(i * 7 + f, dummy.matrix);
      }
    });
    dummy.rotation.order = 'XYZ';
    dummy.rotation.set(0, 0, 0);
    palmTrunks.instanceMatrix.needsUpdate = true;
    palmFronds.instanceMatrix.needsUpdate = true;
    palmTrunks.castShadow = true;
    group.add(palmTrunks); group.add(palmFronds);

    // Hydrants (instanced, red).
    var hydGeo = new THREE.CylinderGeometry(0.55, 0.65, 1.6, 8);
    var hydMat = new THREE.MeshStandardMaterial({ color: 0xc03028, roughness: 0.6 });
    var hydrants = new THREE.InstancedMesh(hydGeo, hydMat, data.hydrants.length);
    data.hydrants.forEach(function (h, i) {
      dummy.position.set(h.x, 0.8, h.z);
      dummy.scale.setScalar(1); dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      hydrants.setMatrixAt(i, dummy.matrix);
    });
    hydrants.instanceMatrix.needsUpdate = true;
    group.add(hydrants);

    // Street lamps (instanced pole + emissive globe).
    var poleGeo = new THREE.CylinderGeometry(0.22, 0.3, 9, 6);
    var poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.7, metalness: 0.4 });
    var poles = new THREE.InstancedMesh(poleGeo, poleMat, data.lamps.length);
    var globeGeo = new THREE.SphereGeometry(0.85, 10, 8);
    var globeMat = new THREE.MeshBasicMaterial({ color: 0xffeebb });
    var globes = new THREE.InstancedMesh(globeGeo, globeMat, data.lamps.length);
    data.lamps.forEach(function (l, i) {
      dummy.position.set(l.x, 4.5, l.z);
      dummy.scale.setScalar(1); dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(l.x, 9.4, l.z);
      dummy.updateMatrix();
      globes.setMatrixAt(i, dummy.matrix);
    });
    poles.instanceMatrix.needsUpdate = true;
    globes.instanceMatrix.needsUpdate = true;
    group.add(poles); group.add(globes);

    // Traffic lights: pole + head + 3 lamps; main.js cycles the lamp colours.
    // data.trafficLights entries get runtime refs (redMat/amberMat/greenMat).
    var tlPoleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6, metalness: 0.5 });
    data.trafficLights.forEach(function (tl) {
      var g = new THREE.Group();
      g.position.set(tl.x, 0, tl.z);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 7.5, 6), tlPoleMat);
      pole.position.y = 3.75;
      g.add(pole);
      var head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.2, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5 }));
      head.position.set(0, 7.6, 0);
      g.add(head);
      tl.lampMats = [];
      var colors = [0xff2a20, 0xffb020, 0x30d050];
      for (var k = 0; k < 3; k++) {
        var lm = new THREE.MeshBasicMaterial({ color: colors[k] });
        lm.transparent = true; lm.opacity = 0.25;
        var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), lm);
        lamp.position.set(0, 8.5 - k * 0.85, 0.48);
        g.add(lamp);
        tl.lampMats.push(lm);
      }
      // start: NS green
      tl.lampMats[2].opacity = 1;
      group.add(g);
      tl.group = g;
    });

    // BUS STOPS: big shelters + LARGE high-contrast BUS sign.
    var busSignTex = busSignTexture();
    data.busStops.forEach(function (bs) {
      var g = new THREE.Group();
      g.position.set(bs.x, 0, bs.z);
      g.rotation.y = bs.face > 0 ? 0 : Math.PI;
      // back panel (light blue glass) + roof + 2 posts
      var panel = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 0.15),
        new THREE.MeshStandardMaterial({ color: 0x9ac8e0, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.75 }));
      panel.position.set(0, 1.3, -1.4);
      g.add(panel);
      var roof = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.25, 3.4),
        new THREE.MeshStandardMaterial({ color: 0x2a4a7a, roughness: 0.6 }));
      roof.position.set(0, 2.9, 0);
      roof.castShadow = true;
      g.add(roof);
      var postMat = new THREE.MeshStandardMaterial({ color: 0x2a4a7a, roughness: 0.5, metalness: 0.4 });
      [-2.9, 2.9].forEach(function (px) {
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.9, 6), postMat);
        post.position.set(px, 1.45, 1.4);
        g.add(post);
        var post2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.9, 6), postMat);
        post2.position.set(px, 1.45, -1.4);
        g.add(post2);
      });
      // bench inside the shelter
      var benchSeat = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 }));
      benchSeat.position.set(0, 0.55, -0.9);
      g.add(benchSeat);
      var benchBack = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.9, 0.14),
        new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 }));
      benchBack.position.set(0, 1.0, -1.3);
      g.add(benchBack);
      // BIG BUS sign on a pole, double-sided, high contrast
      var signMat = new THREE.MeshBasicMaterial({ map: busSignTex, side: THREE.DoubleSide });
      var sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), signMat);
      sign.position.set(0, 3.9, 0);
      g.add(sign);
      var signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.6, 6), postMat);
      signPole.position.set(0, 2.3, 0);
      g.add(signPole);
      group.add(g);
      bs.group = g;
    });

    // Park benches (8).
    var benchWood = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 });
    data.benches.forEach(function (b) {
      var g = new THREE.Group();
      g.position.set(b.x, 0, b.z);
      g.rotation.y = b.rotY;
      var seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.8), benchWood);
      seat.position.y = 0.55;
      seat.castShadow = true;
      g.add(seat);
      var back = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 0.12), benchWood);
      back.position.set(0, 1.0, -0.36);
      g.add(back);
      [-1.0, 1.0].forEach(function (lx) {
        var leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.7), benchWood);
        leg.position.set(lx, 0.28, 0);
        g.add(leg);
      });
      group.add(g);
      b.group = g;
    });

    // Food stalls: BIG, colourful, striped awning, counter. Vendor stands behind.
    data.stalls.forEach(function (st) {
      var g = new THREE.Group();
      g.position.set(st.x, 0, st.z);
      g.rotation.y = st.rotY;
      var bodyMat = new THREE.MeshStandardMaterial({ color: st.color, roughness: 0.7 });
      var counter = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.15, 2.2), bodyMat);
      counter.position.y = 0.58;
      counter.castShadow = true;
      g.add(counter);
      var top = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 2.4),
        new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.8 }));
      top.position.y = 1.2;
      g.add(top);
      // striped awning, tilted, on 4 poles
      var awnTex = awningTexture(st.color);
      var awn = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 2.6),
        new THREE.MeshStandardMaterial({ map: awnTex, side: THREE.DoubleSide, roughness: 0.8 }));
      awn.rotation.x = -Math.PI / 2 + 0.35;
      awn.position.set(0, 2.9, 0.3);
      awn.castShadow = true;
      g.add(awn);
      var poleMat2 = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.5 });
      [[-2.2, -1.0], [2.2, -1.0], [-2.2, 1.0], [2.2, 1.0]].forEach(function (p) {
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.9, 6), poleMat2);
        pole.position.set(p[0], 1.45, p[1]);
        g.add(pole);
      });
      // menu board on the counter front
      var menu = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9),
        new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
      menu.position.set(-1.1, 0.75, 1.12);
      g.add(menu);
      group.add(g);
      st.group = g;
    });

    // Neon signs on central buildings.
    data.neons.forEach(function (n) {
      var tex = neonTexture(n.text, n.color);
      var sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.6),
        new THREE.MeshBasicMaterial({ map: tex }));
      sign.position.set(n.x, n.y, n.z);
      group.add(sign);
      n.mesh = sign;
    });

    // Flags: pole + waving cloth (animated in main.js).
    data.flags.forEach(function (f) {
      var g = new THREE.Group();
      g.position.set(f.x, 0, f.z);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7, 6),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.6 }));
      pole.position.y = 3.5;
      g.add(pole);
      var cloth = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.9),
        new THREE.MeshStandardMaterial({ color: 0xe04030, side: THREE.DoubleSide, roughness: 0.8 }));
      cloth.position.set(1.35, 6.1, 0);
      g.add(cloth);
      group.add(g);
      f.cloth = cloth;
    });

    // Pay 'n Spray: marked bay at the plaza + sign.
    var pns = data.paynspray;
    var bay = new THREE.Mesh(new THREE.PlaneGeometry(16, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a6ab8, roughness: 0.9 }));
    bay.rotation.x = -Math.PI / 2;
    bay.position.set(pns.x, 0.05, pns.z);
    bay.receiveShadow = true;
    group.add(bay);
    var pnsTex = canvasTexture(256, 96, function (ctx, w, h) {
      ctx.fillStyle = '#1a3a6a'; ctx.fillRect(0, 0, w, h);
      ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff'; ctx.fillText("PAY 'N SPRAY", w / 2, h / 2);
    });
    var pnsSign = new THREE.Mesh(new THREE.PlaneGeometry(8, 3),
      new THREE.MeshBasicMaterial({ map: pnsTex }));
    pnsSign.position.set(pns.x, 5, pns.z - 6);
    group.add(pnsSign);

    // Clouds: 8 white blobs drifting +x (animated in main.js).
    var cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    data.clouds = [];
    for (var ci = 0; ci < 8; ci++) {
      var cg = new THREE.Group();
      var cscale = rng.range(18, 34);
      for (var cb = 0; cb < 3; cb++) {
        var ball = new THREE.Mesh(new THREE.SphereGeometry(cscale * (0.5 + rng.range(0, 0.3)), 8, 6), cloudMat);
        ball.position.set(cb * cscale * 0.8 - cscale, rng.range(-2, 2), rng.range(-4, 4));
        ball.scale.y = 0.45;
        cg.add(ball);
      }
      cg.position.set(rng.range(-1500, 1500), rng.range(150, 220), rng.range(-1100, 1100));
      group.add(cg);
      data.clouds.push(cg);
    }

    return { data: data, group: group, hash: data.hash };
  }
})(typeof window !== 'undefined' ? window : globalThis);
