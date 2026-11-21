// world.js — Port Meridian, the city of VELVET CITY.
// Builds the whole open world from one fixed seed: roads, ~176 buildings,
// sidewalks, lamps, palms, traffic lights, the Central Bank, a park and a
// beach strip. Everything is procedural (canvas textures, no external art).
// Exposes window.VCCity.buildCity(scene) -> city data for main.js.
(function (global) {
  'use strict';

  var CITY_W = 3200; // x extent
  var CITY_D = 2400; // z extent
  var ROAD_W = 24;
  // Avenues run north-south, streets east-west.
  var AVENUES = [-1400, -1050, -700, -350, 0, 350, 700, 1050, 1400];
  var STREETS = [-1000, -750, -500, -250, 0, 250, 500, 750, 1000];

  function canvasTexture(w, h, draw) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // A building facade: window grid, some lit warm, some dark, 2x resolution.
  // 16 x 24 small windows so the grid reads at any building size.
  function facadeTexture(base, litRatio, rng) {
    return canvasTexture(256, 512, function (g, w, h) {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      var cols = 16, rows = 24;
      var cw = w / cols, ch = h / rows;
      for (var r = 0; r < rows; r++) {
        // faint floor band
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, r * ch, w, 2);
        for (var c = 0; c < cols; c++) {
          var lit = rng.next() < litRatio;
          g.fillStyle = lit ? (rng.next() < 0.5 ? '#ffd98a' : '#ffe9b0') : '#1c2436';
          g.fillRect(c * cw + 3, r * ch + 4, cw - 6, ch - 7);
        }
      }
      // ground-floor shopfront band
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, h - 34, w, 34);
      g.fillStyle = '#9fd8ff'; g.fillRect(8, h - 28, w - 16, 20);
      // darker vertical edges for depth
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h);
    });
  }

  function roadTexture() {
    return canvasTexture(256, 256, function (g, w, h) {
      g.fillStyle = '#23262e'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2c303a';
      for (var i = 0; i < 400; i++) g.fillRect((i * 37) % w, (i * 91) % h, 2, 2);
      g.fillStyle = '#e8c33a'; // centre dashes
      g.fillRect(w / 2 - 3, 0, 6, 64); g.fillRect(w / 2 - 3, 128, 6, 64);
      g.fillStyle = '#c8ccd4'; // edge lines
      g.fillRect(4, 0, 3, h); g.fillRect(w - 7, 0, 3, h);
    });
  }

  function sidewalkTexture() {
    return canvasTexture(128, 128, function (g, w, h) {
      g.fillStyle = '#8d8578'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#6f675c'; g.lineWidth = 2;
      for (var i = 0; i <= 4; i++) {
        g.beginPath(); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke();
        g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, h); g.stroke();
      }
    });
  }

  function bankSignTexture() {
    return canvasTexture(512, 128, function (g, w, h) {
      g.fillStyle = '#20242e'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e8c33a'; g.font = 'bold 64px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('CENTRAL BANK', w / 2, h / 2);
    });
  }

  function skyTexture() {
    return canvasTexture(16, 512, function (g, w, h) {
      var grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, '#1b2350'); // dusk zenith
      grad.addColorStop(0.45, '#7a4a7e');
      grad.addColorStop(0.62, '#e8705a'); // sunset band
      grad.addColorStop(0.72, '#f7a54a');
      grad.addColorStop(1.0, '#2c2440');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    });
  }

  function buildCity(scene) {
    var rng = VCRng.makeRng(VCRng.CITY_SEED);
    var city = {
      bounds: { minX: -CITY_W / 2, maxX: CITY_W / 2, minZ: -CITY_D / 2, maxZ: CITY_D / 2 },
      colliders: [], buildings: [], trafficPaths: [], pedSpots: [],
      lamps: [], trafficLights: [], bankPos: { x: 0, z: -250 }, parkPos: { x: 525, z: 375 },
      spawn: { x: 60, z: 620, heading: Math.PI }
    };

    // ---- sky dome, fog, lights ----
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(4200, 24, 12),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false })
    );
    scene.add(sky);
    scene.fog = new THREE.Fog(0x3a2f4a, 500, 2600);
    scene.add(new THREE.HemisphereLight(0x8a7fd0, 0x2c2418, 0.85));
    var moon = new THREE.DirectionalLight(0xcfd8ff, 1.6);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -160; moon.shadow.camera.right = 160;
    moon.shadow.camera.top = 160; moon.shadow.camera.bottom = -160;
    moon.shadow.camera.near = 10; moon.shadow.camera.far = 900;
    moon.shadow.bias = -0.0006;
    scene.add(moon); scene.add(moon.target);
    city.moon = moon;
    var sunGlow = new THREE.Mesh(
      new THREE.CircleGeometry(120, 24),
      new THREE.MeshBasicMaterial({ color: 0xffb36b, fog: false })
    );
    sunGlow.position.set(-2600, 420, -2600); sunGlow.lookAt(0, 420, 0);
    scene.add(sunGlow);

    // ---- ground, roads, sidewalks, beach, water ----
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_W, CITY_D + 400),
      new THREE.MeshLambertMaterial({ color: 0x5c5648 })
    );
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.1, 100);
    ground.receiveShadow = true;
    scene.add(ground);

    var roadTex = roadTexture();
    roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
    var roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
    AVENUES.forEach(function (x) {
      var t = roadTex.clone(); t.needsUpdate = true;
      t.repeat.set(1, Math.ceil((CITY_D + 400) / 256));
      var m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, CITY_D + 400),
        new THREE.MeshLambertMaterial({ map: t }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0, 100);
      m.receiveShadow = true; scene.add(m);
    });
    STREETS.forEach(function (z) {
      var t = roadTex.clone(); t.needsUpdate = true;
      // repeat along the street's length (east-west), one tile across its
      // width: the centre dashes must run along the street, not across it.
      // (An earlier rotation.z = PI/2 here turned the streets into
      // north-south strips over the avenues, painting gold dash fans
      // across avenue 0 — visible in the drive screenshot.)
      t.repeat.set(Math.ceil(CITY_W / 256), 1);
      var m = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W, ROAD_W),
        new THREE.MeshLambertMaterial({ map: t }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.02, z);
      m.receiveShadow = true; scene.add(m);
    });

    var walkTex = sidewalkTexture();
    walkTex.wrapS = walkTex.wrapT = THREE.RepeatWrapping;
    var walkMat = new THREE.MeshLambertMaterial({ map: walkTex });
    // sidewalk strips along every avenue and street
    AVENUES.forEach(function (x) {
      [-1, 1].forEach(function (s) {
        var t = walkTex.clone(); t.needsUpdate = true;
        t.repeat.set(1, Math.ceil((CITY_D + 400) / 64));
        var m = new THREE.Mesh(new THREE.PlaneGeometry(10, CITY_D + 400),
          new THREE.MeshLambertMaterial({ map: t }));
        m.rotation.x = -Math.PI / 2; m.position.set(x + s * (ROAD_W / 2 + 5), 0.05, 100);
        m.receiveShadow = true; scene.add(m);
      });
    });

    // beach + water on the south edge
    var sand = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W, 130),
      new THREE.MeshLambertMaterial({ color: 0xc9a86a }));
    sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.06, CITY_D / 2 + 65);
    sand.receiveShadow = true; scene.add(sand);
    var water = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W, 420),
      new THREE.MeshLambertMaterial({ color: 0x1d4e6b, emissive: 0x0a2438 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, 0.02, CITY_D / 2 + 130 + 210);
    scene.add(water);

    // ---- buildings ----
    var facadeBases = ['#6b5a49', '#4a5568', '#5d4a63', '#3f4a3a', '#71563d', '#54455e', '#46586b', '#6e4a4a'];
    var facadeMats = facadeBases.map(function (base) {
      return new THREE.MeshLambertMaterial({ map: facadeTexture(base, 0.42, rng) });
    });
    var roofMat = new THREE.MeshLambertMaterial({ color: 0x2a2d34 });
    var boxGeo = new THREE.BoxGeometry(1, 1, 1);
    var buildingCount = 0;

    function addBuilding(x, z, w, d, h, matIdx) {
      var mesh = new THREE.Mesh(boxGeo, facadeMats[matIdx % facadeMats.length]);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
      // flat roof cap
      var roof = new THREE.Mesh(boxGeo, roofMat);
      roof.scale.set(w + 0.6, 1.2, d + 0.6);
      roof.position.set(x, h + 0.6, z);
      roof.castShadow = true; scene.add(roof);
      city.buildings.push({ x: x, z: z, w: w, d: d, h: h, mesh: mesh });
      city.colliders.push({ x: x, z: z, hw: w / 2 + 1, hd: d / 2 + 1 });
      buildingCount++;
    }

    // blocks: between consecutive avenues and streets
    for (var ai = 0; ai < AVENUES.length - 1; ai++) {
      for (var si = 0; si < STREETS.length - 1; si++) {
        var x0 = AVENUES[ai] + ROAD_W / 2 + 8, x1 = AVENUES[ai + 1] - ROAD_W / 2 - 8;
        var z0 = STREETS[si] + ROAD_W / 2 + 8, z1 = STREETS[si + 1] - ROAD_W / 2 - 8;
        var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        var bw = x1 - x0, bd = z1 - z0;
        // special blocks: bank, park, parking lot
        if (Math.abs(cx - city.bankPos.x) < 1 && Math.abs(cz - city.bankPos.z) < 1) continue;
        if (Math.abs(cx - city.parkPos.x) < 1 && Math.abs(cz - city.parkPos.z) < 1) {
          // park: lawn + palms + pond
          var lawn = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd),
            new THREE.MeshLambertMaterial({ color: 0x3d6b35 }));
          lawn.rotation.x = -Math.PI / 2; lawn.position.set(cx, 0.07, cz);
          lawn.receiveShadow = true; scene.add(lawn);
          for (var p = 0; p < 10; p++) {
            addPalm(cx + rng.range(-bw / 2 + 15, bw / 2 - 15),
              cz + rng.range(-bd / 2 + 15, bd / 2 - 15));
          }
          continue;
        }
        if (rng.chance(0.06)) continue; // empty lot / parking
        var distC = Math.hypot(cx / 1600, cz / 1200); // 0 centre, ~1 edge
        // 2x2 plots per block: up to 4 buildings, each sized to its plot
        for (var px = 0; px < 2; px++) {
          for (var pz = 0; pz < 2; pz++) {
            if (!rng.chance(0.72)) continue;
            var pw = bw / 2, pd = bd / 2;
            var w = rng.range(pw * 0.45, pw * 0.8);
            var d = rng.range(pd * 0.45, pd * 0.8);
            var bx = x0 + px * pw + pw / 2 + rng.range(-4, 4);
            var bz = z0 + pz * pd + pd / 2 + rng.range(-4, 4);
            var h = Math.max(12, rng.range(14, 95) * (1.35 - distC * 0.8));
            addBuilding(bx, bz, w, d, h, rng.int(0, facadeMats.length - 1));
          }
        }
      }
    }

    // Central Bank: big marble block with columns and a lit sign.
    // Dark windowed facade: a plain light slab blew out white at close
    // range under the moon light.
    (function addBank() {
      var bx = city.bankPos.x, bz = city.bankPos.z;
      var base = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({
        map: facadeTexture('#4a5a74', 0.4, rng)
      }));
      base.scale.set(180, 42, 120); base.position.set(bx, 21, bz);
      base.castShadow = true; base.receiveShadow = true; scene.add(base);
      var colGeo = new THREE.CylinderGeometry(4, 4, 34, 10);
      var colMat = new THREE.MeshLambertMaterial({ color: 0x9a9382 });
      for (var i = -3; i <= 3; i++) {
        var col = new THREE.Mesh(colGeo, colMat);
        col.position.set(bx + i * 24, 17, bz + 62);
        col.castShadow = true; scene.add(col);
      }
      var sign = new THREE.Mesh(new THREE.PlaneGeometry(150, 38),
        new THREE.MeshBasicMaterial({ map: bankSignTexture() }));
      sign.position.set(bx, 46, bz + 61); scene.add(sign);
      city.colliders.push({ x: bx, z: bz, hw: 92, hd: 62 });
      city.buildings.push({ x: bx, z: bz, w: 180, d: 120, h: 42, mesh: base });
      buildingCount++;
    })();

    // ---- street props: lamps, palms, traffic lights ----
    var lampPoleMat = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
    var lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    var poleGeo = new THREE.CylinderGeometry(0.5, 0.7, 11, 6);
    var headGeo = new THREE.SphereGeometry(1.4, 8, 6);
    AVENUES.forEach(function (x) {
      STREETS.forEach(function (z) {
        if (rng.chance(0.5)) {
          var pole = new THREE.Mesh(poleGeo, lampPoleMat);
          pole.position.set(x + 16, 5.5, z + 16); pole.castShadow = true; scene.add(pole);
          var head = new THREE.Mesh(headGeo, lampHeadMat);
          head.position.set(x + 16, 11.4, z + 16); scene.add(head);
          city.lamps.push({ x: x + 16, z: z + 16 });
        }
      });
    });

    function addPalm(x, z) {
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 12, 6),
        new THREE.MeshLambertMaterial({ color: 0x6b4a2a }));
      trunk.position.set(x, 6, z); trunk.castShadow = true; scene.add(trunk);
      var top = new THREE.Mesh(new THREE.SphereGeometry(4.5, 8, 6),
        new THREE.MeshLambertMaterial({ color: 0x2f6b2f }));
      top.position.set(x, 13.5, z); top.castShadow = true; scene.add(top);
    }
    for (var pi = 0; pi < 26; pi++) {
      addPalm(rng.pick(AVENUES) + rng.range(18, 30), rng.range(-1050, 1150));
    }

    // traffic lights at a few big intersections
    var lightGeo = new THREE.BoxGeometry(2, 7, 2);
    var bulbGeo = new THREE.SphereGeometry(0.9, 8, 6);
    [[0, 0], [350, -250], [-350, 250], [700, 500], [-700, -500]].forEach(function (pt) {
      var pole = new THREE.Mesh(lightGeo, lampPoleMat);
      pole.position.set(pt[0] + 15, 3.5, pt[1] + 15); scene.add(pole);
      var red = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xff2a22 }));
      red.position.set(pt[0] + 15, 6.4, pt[1] + 15); scene.add(red);
      var green = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0x22ff66 }));
      green.position.set(pt[0] + 15, 4.6, pt[1] + 15); scene.add(green);
      city.trafficLights.push({ x: pt[0], z: pt[1], red: red, green: green, timer: rng.range(0, 6) });
    });

    // ---- traffic loops (rectangles along the road grid) ----
    function loop(cx, cz, hw, hd) {
      var pts = [
        { x: cx - hw, z: cz - hd }, { x: cx + hw, z: cz - hd },
        { x: cx + hw, z: cz + hd }, { x: cx - hw, z: cz + hd }
      ];
      city.trafficPaths.push({ points: pts, length: 2 * (2 * hw + 2 * hd) });
    }
    loop(0, 0, 700, 500); loop(-525, -375, 350, 250); loop(525, 375, 350, 250);
    loop(0, 750, 1050, 250); loop(0, -750, 1050, 250); loop(-1050, 0, 350, 750);

    // ---- pedestrian spawn spots on sidewalks ----
    for (var s = 0; s < 72; s++) {
      var ax = rng.pick(AVENUES), sz = rng.range(-1050, 1150);
      city.pedSpots.push({ x: ax + (rng.chance(0.5) ? 17 : -17), z: sz, alongX: rng.chance(0.5) });
    }

    city.buildingCount = buildingCount;
    return city;
  }

  global.VCCity = { buildCity: buildCity, CITY_W: CITY_W, CITY_D: CITY_D, AVENUES: AVENUES, STREETS: STREETS };
})(typeof window !== 'undefined' ? window : globalThis);
