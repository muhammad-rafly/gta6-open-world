// world.js — Procedural Port Meridian: the city of VELVET CITY.
// Deterministic: buildCity(seed) returns the same city on every load.
// Grid: avenues run east-west every 200 units, streets north-south every 200.
// Buildings fill the blocks between roads; parks and a central plaza break it up.
'use strict';

var CITY_W = 3200;
var CITY_H = 2400;
var ROAD_W = 24;
var BLOCK = 200;
var SEED_DEFAULT = 1337;

function avenueZs() {
  var zs = [];
  for (var z = -1000; z <= 1000; z += BLOCK) zs.push(z);
  return zs;
}

function streetXs() {
  var xs = [];
  for (var x = -1500; x <= 1500; x += BLOCK) xs.push(x);
  return xs;
}

// Palette of sun-soaked modern facades (tints multiply the window texture).
// POLISH: two extra tints — brick red and glass blue — for more variety.
var PALETTE = [0xd8cfc0, 0xc9b8a3, 0xb08d6a, 0x9fb4c0, 0xcfd6d2, 0xa89a8c, 0x8fa3b0, 0xd9c9a8, 0xb0705a, 0x7a9bb0];

function buildCity(seed) {
  var rng = makeRng(seed);
  var buildings = [];
  var xs = streetXs();
  var zs = avenueZs();
  for (var ci = 0; ci < xs.length - 1; ci++) {
    for (var ri = 0; ri < zs.length - 1; ri++) {
      var x0 = xs[ci] + ROAD_W / 2 + 10;
      var x1 = xs[ci + 1] - ROAD_W / 2 - 10;
      var z0 = zs[ri] + ROAD_W / 2 + 10;
      var z1 = zs[ri + 1] - ROAD_W / 2 - 10;
      var cx = (x0 + x1) / 2;
      var cz = (z0 + z1) / 2;
      // Central plaza (2 blocks) and a few parks stay open.
      var central = Math.abs(cx) < 220 && Math.abs(cz) < 220;
      var park = !central && rng.chance(0.07);
      if (central || park) continue;
      var downtown = Math.abs(cx) < 700 && Math.abs(cz) < 500;
      var count = rng.chance(0.35) ? 2 : 1;
      for (var b = 0; b < count; b++) {
        var w = rng.range(60, 130);
        var d = rng.range(60, 130);
        var h = downtown ? rng.range(80, 220) : rng.range(25, 90);
        var bx = count === 1 ? cx + rng.range(-8, 8) : cx + (b === 0 ? -38 : 38) + rng.range(-6, 6);
        var bz = count === 1 ? cz + rng.range(-8, 8) : cz + (b === 0 ? -30 : 30) + rng.range(-6, 6);
        buildings.push({
          x: bx, z: bz, w: w, d: d, h: h,
          color: rng.pick(PALETTE),
          billboard: downtown && h > 150 && rng.chance(0.25),
        });
      }
    }
  }
  // Street lamps along every avenue, both sides, every 200 units.
  var lamps = [];
  for (var ai = 0; ai < zs.length; ai++) {
    for (var x = -1500; x <= 1500; x += 200) {
      lamps.push({ x: x, z: zs[ai] - ROAD_W / 2 - 4 });
      lamps.push({ x: x + 100, z: zs[ai] + ROAD_W / 2 + 4 });
    }
  }
  // Trees along the sidewalks (deterministic, after buildings so the hash is unchanged).
  var trees = [];
  for (var ti = 0; ti < zs.length; ti++) {
    for (var x = -1450; x <= 1450; x += 150) {
      if (rng.chance(0.55)) trees.push({ x: x + rng.range(-20, 20), z: zs[ti] + ROAD_W / 2 + 8, s: rng.range(0.8, 1.3) });
      if (rng.chance(0.55)) trees.push({ x: x + 75 + rng.range(-20, 20), z: zs[ti] - ROAD_W / 2 - 8, s: rng.range(0.8, 1.3) });
    }
  }
  // Fire hydrants near intersections.
  var hydrants = [];
  for (var hi = 0; hi < xs.length; hi += 2) {
    for (var hj = 0; hj < zs.length; hj += 2) {
      hydrants.push({ x: xs[hi] + ROAD_W / 2 + 4, z: zs[hj] + ROAD_W / 2 + 4 });
    }
  }
  // Traffic lights at every second intersection.
  // POLISH (city alive): each light controls ONE axis — axes alternate in a
  // checkerboard ((li/2 + lj/2) parity) so neighbouring intersections show
  // opposite signals; updateWorldFx colours them from the global phase and
  // traffic cars stop at a red light that controls their own axis.
  var trafficLights = [];
  for (var li = 0; li < xs.length; li += 2) {
    for (var lj = 0; lj < zs.length; lj += 2) {
      trafficLights.push({ x: xs[li] + ROAD_W / 2 + 2, z: zs[lj] - ROAD_W / 2 - 2, axis: ((li / 2 + lj / 2) % 2 === 0) ? 'x' : 'z' });
    }
  }
  // Bus stops (bench + shelter + BUS sign) along the central avenues.
  var busStops = [
    { x: 200, z: -14, face: Math.PI },
    { x: -300, z: 14, face: 0 },
    { x: 100, z: -214, face: Math.PI },
    { x: -100, z: 214, face: 0 },
  ];
  // Park benches in the central plaza (building-free) and a park block.
  var benches = [
    { x: -40, z: 60, face: Math.PI / 2 }, { x: 40, z: 60, face: -Math.PI / 2 },
    { x: -40, z: -60, face: Math.PI / 2 }, { x: 40, z: -60, face: -Math.PI / 2 },
    { x: 0, z: 120, face: Math.PI }, { x: -120, z: 0, face: 0 },
    { x: 120, z: 0, face: Math.PI }, { x: 0, z: -120, face: 0 },
  ];
  // Food stalls (street vendors) in the central plaza.
  var stalls = [
    { x: -80, z: 20, face: Math.PI / 2 },
    { x: 80, z: -20, face: -Math.PI / 2 },
    { x: 20, z: 80, face: Math.PI },
  ];
  // Zebra crossings at central intersections (pedestrians cross here).
  var crossings = [
    { x: 0, z: 0, axis: 'x' }, { x: 200, z: 0, axis: 'x' },
    { x: -200, z: 0, axis: 'x' }, { x: 0, z: 200, axis: 'z' },
    { x: 0, z: -200, axis: 'z' }, { x: 200, z: 200, axis: 'x' },
  ];
  // Pay 'n Spray garage in the central plaza (building-free, driveable pad).
  var paynspray = { x: 120, z: -100, gx: 175, gz: -100 };
  var colliders = [{ x: paynspray.gx, z: paynspray.gz, w: 44, d: 26 }];
  var city = { seed: seed, buildings: buildings, lamps: lamps, trees: trees, hydrants: hydrants, trafficLights: trafficLights, busStops: busStops, benches: benches, stalls: stalls, crossings: crossings, paynspray: paynspray, colliders: colliders };
  city.hash = cityHash(city);
  return city;
}

function cityHash(city) {
  var parts = [];
  for (var i = 0; i < city.buildings.length; i++) {
    var b = city.buildings[i];
    parts.push(b.x.toFixed(2) + ',' + b.z.toFixed(2) + ',' + b.w.toFixed(2) + ',' + b.d.toFixed(2) + ',' + b.h.toFixed(2) + ',' + b.color);
  }
  return hashString(parts.join('|'));
}

// A point on a random road centreline (for traffic / mission targets).
function randomRoadPoint(rng) {
  var xs = streetXs();
  var zs = avenueZs();
  if (rng.chance(0.5)) {
    return { x: rng.range(-1500, 1500), z: rng.pick(zs), axis: 'x' };
  }
  return { x: rng.pick(xs), z: rng.range(-1000, 1000), axis: 'z' };
}

// A point on a sidewalk edge beside a road (for pedestrians).
function sidewalkPoint(rng) {
  var p = randomRoadPoint(rng);
  var off = ROAD_W / 2 + 5;
  if (p.axis === 'x') return { x: p.x, z: p.z + (rng.chance(0.5) ? off : -off), axis: 'x' };
  return { x: p.x + (rng.chance(0.5) ? off : -off), z: p.z, axis: 'z' };
}

// 512x512 window texture (2x resolution): brick + floor bands + varied windows
// (dark, glass-blue, warm-lit) on a light base, plus a matching emissive map
// where only the lit windows glow. One texture pair is shared by every
// building; the material colour tints it.
// POLISH (graphics): richer facades — brick speckle, floor bands, a darker
// ground-floor shopfront band, and three window states instead of two.
function makeWindowTexture() {
  var cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 512;
  var ctx = cv.getContext('2d');
  ctx.fillStyle = '#e8e2d4';
  ctx.fillRect(0, 0, 512, 512);
  var em = document.createElement('canvas');
  em.width = 512;
  em.height = 512;
  var ex = em.getContext('2d');
  ex.fillStyle = '#000000';
  ex.fillRect(0, 0, 512, 512);
  var trng = makeRng(99);
  // Brick speckle on the base (subtle, deterministic).
  for (var s = 0; s < 900; s++) {
    ctx.fillStyle = trng.chance(0.5) ? 'rgba(120,100,80,0.10)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(trng.range(0, 512), trng.range(0, 512), 3, 2);
  }
  for (var y = 16; y < 512 - 24; y += 32) {
    // Floor band: a darker line under each row of windows.
    ctx.fillStyle = 'rgba(90,75,60,0.35)';
    ctx.fillRect(0, y + 24, 512, 3);
    for (var x = 16; x < 512 - 24; x += 32) {
      var r = trng.next();
      var lit = r < 0.18;
      var glass = !lit && r < 0.42;
      ctx.fillStyle = lit ? '#ffd98a' : (glass ? '#7fb2d9' : (trng.chance(0.5) ? '#2b3540' : '#3a4a58'));
      ctx.fillRect(x, y, 20, 22);
      // Window frame highlight.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, y, 20, 2);
      if (lit) { ex.fillStyle = '#ffca6a'; ex.fillRect(x, y, 20, 22); }
    }
  }
  // Ground-floor shopfront band (darker, with wide glass panes).
  ctx.fillStyle = '#4a3f35';
  ctx.fillRect(0, 512 - 64, 512, 64);
  for (var gx = 16; gx < 512 - 24; gx += 64) {
    ctx.fillStyle = '#8fb8dd';
    ctx.fillRect(gx, 512 - 56, 48, 40);
  }
  var tex = new THREE.CanvasTexture(cv);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = 4;
  var etex = new THREE.CanvasTexture(em);
  etex.encoding = THREE.sRGBEncoding;
  return { map: tex, emissive: etex };
}

// Procedural asphalt texture: dark base + speckles + faint cracks.
function makeAsphaltTexture() {
  var cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  var ctx = cv.getContext('2d');
  ctx.fillStyle = '#23262b';
  ctx.fillRect(0, 0, 256, 256);
  var trng = makeRng(7);
  for (var i = 0; i < 2600; i++) {
    var g = trng.range(20, 70) | 0;
    ctx.fillStyle = 'rgba(' + g + ',' + g + ',' + (g + 6) + ',0.5)';
    ctx.fillRect(trng.range(0, 256), trng.range(0, 256), 2, 2);
  }
  // A few faint cracks.
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  for (var c = 0; c < 6; c++) {
    ctx.beginPath();
    var cx = trng.range(0, 256), cy = trng.range(0, 256);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + trng.range(-40, 40), cy + trng.range(-40, 40));
    ctx.stroke();
  }
  var tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// Procedural sidewalk texture: light tiles with dark grout lines.
function makeSidewalkTexture() {
  var cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  var ctx = cv.getContext('2d');
  ctx.fillStyle = '#6b6f66';
  ctx.fillRect(0, 0, 256, 256);
  var trng = makeRng(11);
  for (var y = 0; y < 4; y++) {
    for (var x = 0; x < 4; x++) {
      var v = trng.range(100, 122) | 0;
      ctx.fillStyle = 'rgb(' + v + ',' + (v + 3) + ',' + (v - 4) + ')';
      ctx.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    }
  }
  var tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function createWorldMeshes(scene, city) {
  var winTex = makeWindowTexture();
  // Ground.
  // POLISH (graphics): slightly darker ground albedo so the blocks read as
  // earth/grass instead of washing pale under the golden-hour light.
  // envMapIntensity 0.35: the PMREM sky env otherwise over-lights this huge
  // flat plane ~3.7x (albedo 0x3d453a rendered near-white); the road/sidewalk
  // textures are dark enough not to need it.
  var ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_W + 400, CITY_H + 400),
    new THREE.MeshStandardMaterial({ color: 0x3d453a, roughness: 1, envMapIntensity: 0.35 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // Roads: dark asphalt strips (procedural asphalt + sidewalk tile textures).
  // POLISH (graphics): textured asphalt and tiled sidewalks instead of flat colours.
  var asphaltTex = makeAsphaltTexture();
  asphaltTex.repeat.set(450, 3);
  var asphaltTexZ = asphaltTex.clone();
  asphaltTexZ.repeat.set(3, 350);
  asphaltTexZ.needsUpdate = true;
  var sideTex = makeSidewalkTexture();
  sideTex.repeat.set(450, 5);
  var roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95 });
  var roadMatZ = new THREE.MeshStandardMaterial({ map: asphaltTexZ, roughness: 0.95 });
  var sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 1 });
  var zs = avenueZs();
  var xs = streetXs();
  var i, mesh;
  for (i = 0; i < zs.length; i++) {
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W + 400, ROAD_W), roadMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.02, zs[i]);
    mesh.receiveShadow = true;
    scene.add(mesh);
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W + 400, ROAD_W + 14), sideMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.01, zs[i]);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (i = 0; i < xs.length; i++) {
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, CITY_H + 400), roadMatZ);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(xs[i], 0.03, 0);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  // Road markings: dashed white centrelines (one InstancedMesh per direction).
  // REVISER FIX (dash overflow): the placement loops below iterate
  // ceil(W/14) times per road (first dash at -W/2+7, last < W/2), but the
  // budget used Math.floor — 11 fewer slots than placed. The GPU then drew
  // 11 out-of-bounds instance matrices as giant white triangles ("wedge"
  // across the ground in screenshots). Budget with ceil so the allocation
  // always covers every placed instance.
  var dashGeo = new THREE.BoxGeometry(0.5, 0.06, 6);
  var dashMat = new THREE.MeshBasicMaterial({ color: 0xd8d8c8 });
  var dashCount = 0;
  for (i = 0; i < zs.length; i++) dashCount += Math.ceil(CITY_W / 14);
  for (i = 0; i < xs.length; i++) dashCount += Math.ceil(CITY_H / 14);
  var dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
  var mtx = new THREE.Matrix4();
  var di = 0;
  var rotY = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  for (i = 0; i < zs.length; i++) {
    for (var x = -CITY_W / 2 + 7; x < CITY_W / 2; x += 14) {
      mtx.makeTranslation(x, 0.06, zs[i]);
      mtx.multiply(rotY);
      dashes.setMatrixAt(di++, mtx);
    }
  }
  for (i = 0; i < xs.length; i++) {
    for (var z = -CITY_H / 2 + 7; z < CITY_H / 2; z += 14) {
      mtx.makeTranslation(xs[i], 0.06, z);
      dashes.setMatrixAt(di++, mtx);
    }
  }
  dashes.count = di;
  dashes.instanceMatrix.needsUpdate = true;
  scene.add(dashes);
  // Buildings: one shared unit box, scaled per building; 8 tinted materials.
  // Facades use the window texture + a glowing emissive map for lit windows.
  var boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  var mats = PALETTE.map(function (c) {
    return new THREE.MeshStandardMaterial({ map: winTex.map, emissiveMap: winTex.emissive, emissive: 0xffc46b, emissiveIntensity: 0.55, color: c, roughness: 0.85, metalness: 0.05 });
  });
  var billboardMat = new THREE.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0x992033, emissiveIntensity: 0.7, roughness: 0.6 });
  for (i = 0; i < city.buildings.length; i++) {
    var b = city.buildings[i];
    var mat = mats[PALETTE.indexOf(b.color)];
    var m = new THREE.Mesh(boxGeo, mat);
    m.position.set(b.x, 0, b.z);
    m.scale.set(b.w, b.h, b.d);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    if (b.billboard) {
      var bb = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(b.w * 0.8, 60), 14), billboardMat);
      bb.position.set(b.x, b.h - 10, b.z + b.d / 2 + 0.6);
      scene.add(bb);
    }
  }
  // Street lamps as two InstancedMeshes (poles + heads).
  var poleGeo = new THREE.CylinderGeometry(0.25, 0.35, 7, 6);
  poleGeo.translate(0, 3.5, 0);
  var headGeo = new THREE.SphereGeometry(0.7, 8, 6);
  headGeo.translate(0, 7.2, 0);
  var poleMat = new THREE.MeshStandardMaterial({ color: 0x2e3134, roughness: 0.7, metalness: 0.4 });
  var headMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffdf80, emissiveIntensity: 1.4 });
  var poles = new THREE.InstancedMesh(poleGeo, poleMat, city.lamps.length);
  var heads = new THREE.InstancedMesh(headGeo, headMat, city.lamps.length);
  var mtx = new THREE.Matrix4();
  for (i = 0; i < city.lamps.length; i++) {
    mtx.makeTranslation(city.lamps[i].x, 0, city.lamps[i].z);
    poles.setMatrixAt(i, mtx);
    heads.setMatrixAt(i, mtx);
  }
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  scene.add(poles);
  scene.add(heads);
  // Trees: trunk + foliage cones, two InstancedMeshes.
  if (city.trees.length) {
    var trunkGeo = new THREE.CylinderGeometry(0.3, 0.45, 2.4, 6);
    trunkGeo.translate(0, 1.2, 0);
    var folGeo = new THREE.ConeGeometry(2.2, 5.5, 8);
    folGeo.translate(0, 5.0, 0);
    var trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 1 });
    var folMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 1 });
    var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, city.trees.length);
    var fols = new THREE.InstancedMesh(folGeo, folMat, city.trees.length);
    for (i = 0; i < city.trees.length; i++) {
      var t = city.trees[i];
      mtx.makeScale(t.s, t.s, t.s);
      mtx.setPosition(t.x, 0, t.z);
      trunks.setMatrixAt(i, mtx);
      fols.setMatrixAt(i, mtx);
    }
    trunks.instanceMatrix.needsUpdate = true;
    fols.instanceMatrix.needsUpdate = true;
    scene.add(trunks);
    scene.add(fols);
  }
  // Fire hydrants: small red cylinders.
  if (city.hydrants.length) {
    var hydGeo = new THREE.CylinderGeometry(0.35, 0.4, 1.1, 8);
    hydGeo.translate(0, 0.55, 0);
    var hydMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 });
    var hyds = new THREE.InstancedMesh(hydGeo, hydMat, city.hydrants.length);
    for (i = 0; i < city.hydrants.length; i++) {
      mtx.makeTranslation(city.hydrants[i].x, 0, city.hydrants[i].z);
      hyds.setMatrixAt(i, mtx);
    }
    hyds.instanceMatrix.needsUpdate = true;
    scene.add(hyds);
  }
  // Traffic lights: pole + head; the head colour cycles red/green (see updateWorldFx).
  if (city.trafficLights.length) {
    var tlPoleGeo = new THREE.CylinderGeometry(0.18, 0.22, 5.5, 6);
    tlPoleGeo.translate(0, 2.75, 0);
    var tlHeadGeo = new THREE.BoxGeometry(0.7, 1.6, 0.7);
    tlHeadGeo.translate(0, 5.6, 0);
    var tlPoleMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
    var tlHeadMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.8 });
    var tlPoles = new THREE.InstancedMesh(tlPoleGeo, tlPoleMat, city.trafficLights.length);
    var tlHeads = new THREE.InstancedMesh(tlHeadGeo, tlHeadMat, city.trafficLights.length);
    for (i = 0; i < city.trafficLights.length; i++) {
      mtx.makeTranslation(city.trafficLights[i].x, 0, city.trafficLights[i].z);
      tlPoles.setMatrixAt(i, mtx);
      tlHeads.setMatrixAt(i, mtx);
      tlHeads.setColorAt(i, new THREE.Color(0xff2222));
    }
    tlPoles.instanceMatrix.needsUpdate = true;
    tlHeads.instanceMatrix.needsUpdate = true;
    if (tlHeads.instanceColor) tlHeads.instanceColor.needsUpdate = true;
    scene.add(tlPoles);
    scene.add(tlHeads);
    WORLD_FX.tlHeads = tlHeads;
    WORLD_FX.tlCount = city.trafficLights.length;
    WORLD_FX.lights = city.trafficLights;
  }
  // Pay 'n Spray garage in the central plaza: teal building + big sign + green pad.
  var pns = city.paynspray;
  var garage = new THREE.Mesh(new THREE.BoxGeometry(44, 10, 26), new THREE.MeshStandardMaterial({ color: 0x0e7d74, roughness: 0.7, metalness: 0.2 }));
  garage.position.set(pns.gx, 5, pns.gz);
  garage.castShadow = true;
  garage.receiveShadow = true;
  scene.add(garage);
  var signCv = document.createElement('canvas');
  signCv.width = 512; signCv.height = 96;
  var sctx = signCv.getContext('2d');
  sctx.fillStyle = '#0b3d39'; sctx.fillRect(0, 0, 512, 96);
  sctx.fillStyle = '#ffd23f'; sctx.font = 'bold 52px sans-serif';
  sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
  sctx.fillText("PAY 'N SPRAY", 256, 50);
  var signTex = new THREE.CanvasTexture(signCv);
  signTex.encoding = THREE.sRGBEncoding;
  var sign = new THREE.Mesh(new THREE.PlaneGeometry(40, 7.5), new THREE.MeshBasicMaterial({ map: signTex }));
  sign.position.set(pns.gx, 11.5, pns.gz + 13.2);
  scene.add(sign);
  var pad = new THREE.Mesh(new THREE.PlaneGeometry(24, 18), new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.35 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(pns.x, 0.08, pns.z);
  scene.add(pad);
  // Zebra crossings: white bars across the road at the listed intersections.
  // POLISH (city alive): one InstancedMesh for all bars (cheap).
  if (city.crossings.length) {
    var stripeGeo = new THREE.BoxGeometry(1.4, 0.05, 3.2);
    var stripeMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e0 });
    var stripesPer = 8;
    var stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, city.crossings.length * stripesPer);
    var si = 0;
    var sRot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    for (var ci = 0; ci < city.crossings.length; ci++) {
      var cr = city.crossings[ci];
      for (var sb = 0; sb < stripesPer; sb++) {
        var off = (sb - (stripesPer - 1) / 2) * 2.6;
        if (cr.axis === 'x') {
          // E-W road: pedestrians walk along z; bars run along x, spaced in z.
          mtx.makeTranslation(cr.x, 0.06, cr.z + off);
          mtx.multiply(sRot);
        } else {
          // N-S road: pedestrians walk along x; bars run along z, spaced in x.
          mtx.makeTranslation(cr.x + off, 0.06, cr.z);
        }
        stripes.setMatrixAt(si++, mtx);
      }
    }
    stripes.count = si;
    stripes.instanceMatrix.needsUpdate = true;
    scene.add(stripes);
  }
  // Bus stops: shelter roof + bench + BUS sign pole.
  var busSignCv = document.createElement('canvas');
  busSignCv.width = 128; busSignCv.height = 64;
  var bctx = busSignCv.getContext('2d');
  bctx.fillStyle = '#1a5fb4'; bctx.fillRect(0, 0, 128, 64);
  bctx.fillStyle = '#ffffff'; bctx.font = 'bold 36px sans-serif';
  bctx.textAlign = 'center'; bctx.textBaseline = 'middle';
  bctx.fillText('BUS', 64, 34);
  var busSignTex = new THREE.CanvasTexture(busSignCv);
  busSignTex.encoding = THREE.sRGBEncoding;
  var shelterMat = new THREE.MeshStandardMaterial({ color: 0x2c6e9b, roughness: 0.6, metalness: 0.3 });
  var benchMat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.9 });
  for (var bi = 0; bi < city.busStops.length; bi++) {
    var bs = city.busStops[bi];
    var stop = new THREE.Group();
    stop.position.set(bs.x, 0, bs.z);
    stop.rotation.y = bs.face;
    var roof = new THREE.Mesh(new THREE.BoxGeometry(5, 0.15, 2.2), shelterMat);
    roof.position.set(0, 2.6, 0);
    roof.castShadow = true;
    stop.add(roof);
    var post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6), shelterMat);
    post1.position.set(-2.2, 1.3, 0.9);
    stop.add(post1);
    var post2 = post1.clone();
    post2.position.x = 2.2;
    stop.add(post2);
    var seat = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.15, 0.6), benchMat);
    seat.position.set(0, 0.5, 0.6);
    seat.castShadow = true;
    stop.add(seat);
    var back = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.7, 0.12), benchMat);
    back.position.set(0, 0.95, 0.95);
    stop.add(back);
    var signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    signPole.position.set(2.8, 1.5, 0);
    stop.add(signPole);
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: busSignTex }));
    sign.position.set(2.8, 3.1, 0);
    stop.add(sign);
    scene.add(stop);
  }
  // Park benches (also the sitting spots for resident peds).
  for (var bj = 0; bj < city.benches.length; bj++) {
    var bn = city.benches[bj];
    var bench = new THREE.Group();
    bench.position.set(bn.x, 0, bn.z);
    bench.rotation.y = bn.face;
    var bSeat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.6), benchMat);
    bSeat.position.y = 0.45;
    bSeat.castShadow = true;
    bench.add(bSeat);
    var bBack = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.1), benchMat);
    bBack.position.set(0, 0.85, 0.28);
    bench.add(bBack);
    var legA = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    legA.position.set(-0.9, 0.22, 0);
    bench.add(legA);
    var legB = legA.clone();
    legB.position.x = 0.9;
    bench.add(legB);
    scene.add(bench);
  }
  // Food stalls (street vendors): counter + striped awning + goods.
  var stallCv = document.createElement('canvas');
  stallCv.width = 128; stallCv.height = 64;
  var stx = stallCv.getContext('2d');
  for (var st = 0; st < 8; st++) {
    stx.fillStyle = st % 2 === 0 ? '#e74c3c' : '#f5f5f0';
    stx.fillRect(st * 16, 0, 16, 64);
  }
  var stallTex = new THREE.CanvasTexture(stallCv);
  stallTex.encoding = THREE.sRGBEncoding;
  for (var sk = 0; sk < city.stalls.length; sk++) {
    var sl = city.stalls[sk];
    var stall = new THREE.Group();
    stall.position.set(sl.x, 0, sl.z);
    stall.rotation.y = sl.face;
    var counter = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1.4), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 }));
    counter.position.y = 0.5;
    counter.castShadow = true;
    stall.add(counter);
    var awn = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.6), new THREE.MeshBasicMaterial({ map: stallTex, side: THREE.DoubleSide }));
    awn.position.set(0, 2.3, 0.3);
    awn.rotation.x = -0.5;
    stall.add(awn);
    var poleA = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x555555 }));
    poleA.position.set(-1.6, 1.1, 0.6);
    stall.add(poleA);
    var poleB = poleA.clone();
    poleB.position.x = 1.6;
    stall.add(poleB);
    var goods = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 0.9), new THREE.MeshStandardMaterial({ color: 0xf39c12, roughness: 0.7 }));
    goods.position.set(0, 1.2, 0);
    stall.add(goods);
    scene.add(stall);
  }
  // Neon signs on tall downtown buildings (emissive canvas text).
  // POLISH (city alive): glowing signs make the skyline feel lived-in.
  var neonWords = ['BAR', '24H', 'HOTEL', 'PIZZA', 'CLUB', 'CAFE'];
  var neonColors = ['#ff2e88', '#00e5ff', '#ffd23f', '#ff6b35', '#b967ff', '#39ff88'];
  var neonCount = 0;
  for (var ni = 0; ni < city.buildings.length && neonCount < 6; ni++) {
    var nb = city.buildings[ni];
    if (nb.h < 120 || Math.abs(nb.x) > 700 || Math.abs(nb.z) > 500) continue;
    var ncv = document.createElement('canvas');
    ncv.width = 256; ncv.height = 64;
    var nctx = ncv.getContext('2d');
    nctx.fillStyle = '#0a0a12'; nctx.fillRect(0, 0, 256, 64);
    nctx.fillStyle = neonColors[neonCount];
    nctx.font = 'bold 44px sans-serif';
    nctx.textAlign = 'center'; nctx.textBaseline = 'middle';
    nctx.fillText(neonWords[neonCount], 128, 34);
    var ntex = new THREE.CanvasTexture(ncv);
    ntex.encoding = THREE.sRGBEncoding;
    var nsign = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshBasicMaterial({ map: ntex }));
    nsign.position.set(nb.x, nb.h - 14, nb.z + nb.d / 2 + 0.6);
    scene.add(nsign);
    neonCount++;
  }
  WORLD_FX.neonCount = neonCount;
  // Flags / banners on poles around the plaza (wave in updateWorldFx).
  WORLD_FX.flags = [];
  var flagColors = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xe67e22];
  var flagSpots = [[-60, 100], [60, 100], [-60, -100], [60, -100], [-160, 0], [160, 0]];
  for (var fi = 0; fi < flagSpots.length; fi++) {
    var fp = new THREE.Group();
    fp.position.set(flagSpots[fi][0], 0, flagSpots[fi][1]);
    var fPole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 7, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5, metalness: 0.5 }));
    fPole.position.y = 3.5;
    fp.add(fPole);
    var flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshStandardMaterial({ color: flagColors[fi], roughness: 0.8, side: THREE.DoubleSide }));
    flag.position.set(1.25, 6.1, 0);
    fp.add(flag);
    scene.add(fp);
    WORLD_FX.flags.push(flag);
  }
}

// Animated world bits (traffic-light cycling + waving flags).
// Called from the game loop. Phase: 8 s per axis — phase 0 = x-axis (east-west)
// green, z-axis red; phase 1 = the reverse. Each light's head shows the
// signal for the axis it controls, and traffic cars obey the same phase.
var WORLD_FX = { tlHeads: null, tlCount: 0, lights: null, phase: 0, phaseOverride: null, flags: [], neonCount: 0 };
function updateWorldFx(time) {
  var phase = WORLD_FX.phaseOverride != null ? WORLD_FX.phaseOverride : Math.floor(time / 8) % 2;
  WORLD_FX.phase = phase;
  if (WORLD_FX.tlHeads && WORLD_FX.lights) {
    var red = new THREE.Color(0xff2222), green = new THREE.Color(0x22ff44);
    for (var i = 0; i < WORLD_FX.tlCount; i++) {
      var ax = WORLD_FX.lights[i].axis;
      var isGreen = (phase === 0 && ax === 'x') || (phase === 1 && ax === 'z');
      WORLD_FX.tlHeads.setColorAt(i, isGreen ? green : red);
    }
    if (WORLD_FX.tlHeads.instanceColor) WORLD_FX.tlHeads.instanceColor.needsUpdate = true;
  }
  for (var f = 0; f < WORLD_FX.flags.length; f++) {
    WORLD_FX.flags[f].rotation.y = Math.sin(time * 1.6 + f * 1.3) * 0.35;
  }
}

// Circle vs building AABB: push a circle (x,z,r) out of every building it hits.
// Returns true when a push happened. Used for the player, cars and police.
function collideBuildings(city, x, z, r) {
  var hit = false;
  for (var i = 0; i < city.buildings.length; i++) {
    var b = city.buildings[i];
    var nx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2));
    var nz = Math.max(b.z - b.d / 2, Math.min(z, b.z + b.d / 2));
    var dx = x - nx;
    var dz = z - nz;
    var d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      var d = Math.sqrt(d2) || 0.001;
      var push = (r - d) / d;
      x += dx * push;
      z += dz * push;
      hit = true;
    }
  }
  // Extra colliders (Pay 'n Spray garage etc.) — same AABB push-out.
  if (city.colliders) {
    for (var j = 0; j < city.colliders.length; j++) {
      var c = city.colliders[j];
      var cx2 = Math.max(c.x - c.w / 2, Math.min(x, c.x + c.w / 2));
      var cz2 = Math.max(c.z - c.d / 2, Math.min(z, c.z + c.d / 2));
      var ex = x - cx2, ez = z - cz2;
      var e2 = ex * ex + ez * ez;
      if (e2 < r * r) {
        var ed = Math.sqrt(e2) || 0.001;
        var ep = (r - ed) / ed;
        x += ex * ep;
        z += ez * ep;
        hit = true;
      }
    }
  }
  return { x: x, z: z, hit: hit };
}

function clampToCity(x, z) {
  return {
    x: Math.max(-CITY_W / 2 + 20, Math.min(CITY_W / 2 - 20, x)),
    z: Math.max(-CITY_H / 2 + 20, Math.min(CITY_H / 2 - 20, z)),
  };
}
