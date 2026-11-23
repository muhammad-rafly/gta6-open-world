// main.js — VELVET CITY gameplay: Port Meridian, an original open-world crime game.
// Walk and drive, steal cars, dodge the law, run 5 missions, survive the city.
// All city data is deterministic (seeded); see rng.js and world.js.
'use strict';

/* ============================== setup ============================== */

var SEED = 1337;
var SAVE_KEY = 'velvet-city-save-v1';
var RAM_DMG = 14;          // ramming damage (hard rule)
var RAM_COOLDOWN = 2.5;    // per police car, seconds (hard rule)

var S = {
  started: false, over: false, overKind: '', cash: 0, health: 100, wanted: 0, mission: 0,
  inCar: null, carHealth: 100, time: 0, lastCrime: -100, lastHurt: -100,
  radio: 0, radioOn: false, speedKmh: 0, missionStep: 0, missionWait: 0,
  missionDone: false, allMissionsDone: false, searching: false, hiddenTimer: 0,
  sirenOn: false, weapon: 'Pistol', ammo: '∞',
};

var city = buildCity(SEED);
var rngSpawn = makeRng(SEED + 7);

var scene, camera, renderer, canvas, clock;
var sunLight, hemiLight, headlight, headTarget;
var camYaw = 0, camPitch = 0.32, camDist = 11;
var keys = {};
var mouseDown = false, lastMX = 0, lastMY = 0;

// Particles (blood red + smoke grey) in one THREE.Points pool.
var PMAX = 300;
var pGeo, pPts, pPos, pCol, pVel, pLife, pMaxLife, pSize;
var splats = [];   // ground blood decals {mesh, life}
var bloodSpawned = 0, smokeSpawned = 0;
var lastShotPos = null, lastCrashPos = null;
var cops = [];     // foot police (BUSTED)
var bustedTimer = 0;
var pnsCooldown = 0;
var sirenOsc = null, sirenGain = null, sirenTimer = null, sirenHigh = false;

var player = { x: 0, z: 30, angle: 0, speed: 0, mesh: null, group: null, run: false };
var cars = [];       // traffic + parked + police + player car
var peds = [];
var police = [];     // subset of cars with kind 'police'
var heli = null;
var markers = [];    // mission marker meshes
var markerLight = null;
var clouds = [];     // drifting sky clouds {group, speed}

var MISSIONS = [
  { name: 'First Wheels', payout: 200,
    text: 'Steal any car and drive to the yellow marker.',
    steps: [{ kind: 'drive', text: 'Get in a car, then drive to the marker.' }] },
  { name: 'The Package', payout: 400,
    text: 'Pick up the package, then deliver it across town.',
    steps: [{ kind: 'goto', text: 'Drive to the package pickup.' },
            { kind: 'goto', text: 'Deliver the package to the drop-off.' }] },
  { name: 'Getaway', payout: 600,
    text: 'The cops are on you. Lose the heat, then reach the safehouse.',
    steps: [{ kind: 'heat', text: 'You have 2 stars. Lose the wanted level!' },
            { kind: 'goto', text: 'Reach the safehouse.' }] },
  { name: 'The Heist', payout: 800,
    text: 'Hit the Meridian Bank. Hold the spot, then escape.',
    steps: [{ kind: 'goto', text: 'Drive to the Meridian Bank.' },
            { kind: 'hold', text: 'Hold the bank for 10 seconds...', hold: 10 },
            { kind: 'goto', text: 'Escape to the hideout!' }] },
  { name: 'The Kingpin', payout: 1500,
    text: 'The big one. Reach the penthouse while the whole city hunts you.',
    steps: [{ kind: 'goto', text: 'Drive to the penthouse tower.' },
            { kind: 'goto', text: 'Final drop: the marina.' }] },
];

/* ============================== helpers ============================== */

function $(id) { return document.getElementById(id); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
function angleLerp(a, b, t) {
  var d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/* ============================== meshes ============================== */

var CAR_COLORS = [0xc0392b, 0x2980b9, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xe67e22, 0xecf0f1, 0x2c3e50, 0x16a085, 0xd35400];
var PED_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xfd79a8, 0x6c5ce7];

// Vehicle types: different speed / handling / look (GTA variety).
var VTYPES = {
  sedan: { maxSpeed: 38, accel: 26, turn: 1.9, len: 4.4, h: 0.62 },
  taxi:  { maxSpeed: 40, accel: 30, turn: 2.1, len: 4.4, h: 0.62 },
  truck: { maxSpeed: 30, accel: 18, turn: 1.35, len: 5.8, h: 0.95 },
  police:{ maxSpeed: 34, accel: 30, turn: 2.0, len: 4.4, h: 0.62 },
};

function makeCarMesh(color, isPolice, vtype) {
  vtype = vtype || 'sedan';
  var vt = VTYPES[vtype] || VTYPES.sedan;
  var g = new THREE.Group();
  var bodyMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.35, metalness: 0.5 });
  var body = new THREE.Mesh(new THREE.BoxGeometry(2.0, vt.h, vt.len), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  var cabinMat = new THREE.MeshStandardMaterial({ color: isPolice ? 0xf5f5f0 : 0x1a2530, roughness: 0.2, metalness: 0.6 });
  var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, vtype === 'truck' ? 1.4 : 2.2), cabinMat);
  cabin.position.set(0, 1.08, vtype === 'truck' ? 1.4 : -0.25);
  cabin.castShadow = true;
  g.add(cabin);
  if (vtype === 'truck') {
    // Cargo box behind the cab.
    var cargo = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.5, 2.6), new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.7, metalness: 0.3 }));
    cargo.position.set(0, 1.15, -1.3);
    cargo.castShadow = true;
    g.add(cargo);
  }
  var skirt = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.3, vt.len + 0.02), new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.9 }));
  skirt.position.y = 0.22;
  g.add(skirt);
  // Headlights (front, +z) and taillights (rear, -z): emissive, always on.
  var hlMat = new THREE.MeshStandardMaterial({ color: 0xfff6cc, emissive: 0xfff2b0, emissiveIntensity: 2.2 });
  var tlMat = new THREE.MeshStandardMaterial({ color: 0xcc0000, emissive: 0xff2222, emissiveIntensity: 1.6 });
  var hz = vt.len / 2;
  var hl1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.08), hlMat);
  hl1.position.set(-0.62, 0.55, hz + 0.01);
  g.add(hl1);
  var hl2 = hl1.clone();
  hl2.position.x = 0.62;
  g.add(hl2);
  var t1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), tlMat);
  t1.position.set(-0.62, 0.55, -hz - 0.01);
  g.add(t1);
  var t2 = t1.clone();
  t2.position.x = 0.62;
  g.add(t2);
  // POLISH (graphics): front grille + bumpers for a more finished car.
  var grilleMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.6, metalness: 0.4 });
  var grille = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.08), grilleMat);
  grille.position.set(0, 0.42, hz + 0.01);
  g.add(grille);
  var bumperMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.7 });
  var bumperF = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.16, 0.12), bumperMat);
  bumperF.position.set(0, 0.28, hz + 0.02);
  g.add(bumperF);
  var bumperR = bumperF.clone();
  bumperR.position.z = -hz - 0.02;
  g.add(bumperR);
  // Wheels: steerable front groups, spinning cylinders.
  var wheels = [];
  var wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  var wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
  var hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8);
  hubGeo.rotateZ(Math.PI / 2);
  var hubMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.4, metalness: 0.6 });
  var wpos = [
    { x: -0.95, z: hz - 0.9, front: true }, { x: 0.95, z: hz - 0.9, front: true },
    { x: -0.95, z: -hz + 0.9, front: false }, { x: 0.95, z: -hz + 0.9, front: false },
  ];
  for (var wi = 0; wi < 4; wi++) {
    var wg = new THREE.Group();
    wg.position.set(wpos[wi].x, 0.36, wpos[wi].z);
    var tire = new THREE.Mesh(wheelGeo, wheelMat);
    tire.castShadow = true;
    var hub = new THREE.Mesh(hubGeo, hubMat);
    wg.add(tire);
    wg.add(hub);
    g.add(wg);
    wheels.push({ group: wg, spin: tire, front: wpos[wi].front, angle: 0 });
  }
  g.userData.wheels = wheels;
  if (vtype === 'taxi') {
    // Roof TAXI sign.
    var scv = document.createElement('canvas');
    scv.width = 128; scv.height = 32;
    var sx = scv.getContext('2d');
    sx.fillStyle = '#111111'; sx.fillRect(0, 0, 128, 32);
    sx.fillStyle = '#ffd23f'; sx.font = 'bold 22px sans-serif';
    sx.textAlign = 'center'; sx.textBaseline = 'middle';
    sx.fillText('TAXI', 64, 17);
    var stex = new THREE.CanvasTexture(scv);
    stex.encoding = THREE.sRGBEncoding;
    var sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.4), new THREE.MeshBasicMaterial({ map: stex }));
    sign.position.set(0, 1.5, -0.25);
    g.add(sign);
  }
  if (isPolice) {
    // Full-width red/blue light bar.
    var barBase = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.4), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    barBase.position.set(0, 1.42, -0.25);
    g.add(barBase);
    var red = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.14, 0.42), new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2 }));
    red.position.set(-0.38, 1.44, -0.25);
    red.name = 'lightRed';
    g.add(red);
    var blue = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.14, 0.42), new THREE.MeshStandardMaterial({ color: 0x0044ff, emissive: 0x0044ff, emissiveIntensity: 2 }));
    blue.position.set(0.38, 1.44, -0.25);
    blue.name = 'lightBlue';
    g.add(blue);
    // POLICE door decals (canvas texture planes on both doors).
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    var cx = cv.getContext('2d');
    cx.fillStyle = '#f5f5f0'; cx.fillRect(0, 0, 256, 64);
    cx.fillStyle = '#0a0a0a'; cx.font = 'bold 44px sans-serif';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText('POLICE', 128, 34);
    var dtex = new THREE.CanvasTexture(cv);
    dtex.encoding = THREE.sRGBEncoding;
    var dmat = new THREE.MeshBasicMaterial({ map: dtex });
    var d1 = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.32), dmat);
    d1.position.set(-1.01, 0.62, 0.3); d1.rotation.y = -Math.PI / 2;
    g.add(d1);
    var d2 = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.32), dmat);
    d2.position.set(1.01, 0.62, 0.3); d2.rotation.y = Math.PI / 2;
    g.add(d2);
    // Siren ground glow (red/blue flash reflected on the road).
    var glow = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20), new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.18, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.07;
    glow.name = 'sirenGlow';
    g.add(glow);
  }
  return g;
}

var SKIN_TONES = [0xe8b98a, 0xc98d5f, 0x8a5a3b, 0xf0c8a0];
var HAIR_COLORS = [0x1a1a1a, 0x4a2f1a, 0x8a8a8a, 0xc9a227, 0x6b3a1a];
var PANTS_COLORS = [0x2c3e50, 0x5d4037, 0x37474f, 0x4a4a4a, 0x1a237e];

function makePedMesh(color, opts) {
  opts = opts || {};
  var g = new THREE.Group();
  var pants = opts.pants != null ? opts.pants : 0x2c3e50;
  var skin = opts.skin != null ? opts.skin : 0xe8b98a;
  // Legs (swing when walking).
  var legGeo = new THREE.BoxGeometry(0.16, 0.62, 0.18);
  legGeo.translate(0, -0.31, 0);
  var legMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.95 });
  var legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.12, 0.62, 0);
  legL.name = 'legL';
  g.add(legL);
  var legR = new THREE.Mesh(legGeo, legMat);
  legR.position.set(0.12, 0.62, 0);
  legR.name = 'legR';
  g.add(legR);
  var body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.38, 1.05, 8),
    new THREE.MeshStandardMaterial({ color: color, roughness: 0.9 })
  );
  body.position.y = 1.12;
  body.castShadow = true;
  g.add(body);
  // Arms (swing when walking; raised for phone / pointing variants).
  var armGeo = new THREE.BoxGeometry(0.13, 0.62, 0.14);
  armGeo.translate(0, -0.31, 0);
  var armMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.9 });
  var armL = new THREE.Mesh(armGeo, armMat);
  armL.position.set(-0.42, 1.55, 0);
  armL.name = 'armL';
  g.add(armL);
  var armR = new THREE.Mesh(armGeo, armMat);
  armR.position.set(0.42, 1.55, 0);
  armR.name = 'armR';
  g.add(armR);
  var head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 10, 8),
    new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 })
  );
  head.position.y = 1.88;
  head.name = 'head';
  head.castShadow = true;
  g.add(head);
  // POLISH (graphics): hair cap (varied colours) so heads read as people.
  if (opts.hair != null) {
    var hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: opts.hair, roughness: 0.9 })
    );
    hair.position.y = 1.92;
    hair.name = 'hair';
    g.add(hair);
  }
  if (opts.hat) {
    var hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.12, 10),
      new THREE.MeshStandardMaterial({ color: opts.hat, roughness: 0.8 })
    );
    hat.position.y = 2.08;
    g.add(hat);
  }
  if (opts.variant === 'phone') {
    // Phone at the ear: right arm raised, small dark box in hand.
    armR.rotation.x = -2.2;
    var phone = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.03), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    phone.position.set(0.42, 1.85, 0.12);
    g.add(phone);
  }
  return g;
}

// POLISH (resident activities): a simple dog that follows its owner.
function makeDogMesh(color) {
  var g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.9 });
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.24), mat);
  body.position.y = 0.32;
  body.castShadow = true;
  g.add(body);
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), mat);
  head.position.set(0.35, 0.42, 0);
  g.add(head);
  var ear = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.06), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  ear.position.set(0.3, 0.55, 0.08);
  g.add(ear);
  var tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), mat);
  tail.position.set(-0.35, 0.45, 0);
  tail.rotation.z = 0.6;
  tail.name = 'tail';
  g.add(tail);
  var legGeo = new THREE.BoxGeometry(0.08, 0.2, 0.08);
  var legMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  var lx = [0.2, 0.2, -0.2, -0.2], lz = [0.08, -0.08, 0.08, -0.08];
  for (var i = 0; i < 4; i++) {
    var leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(lx[i], 0.1, lz[i]);
    leg.name = 'dogLeg' + i;
    g.add(leg);
  }
  return g;
}

function makePlayerMesh() {
  var g = new THREE.Group();
  var legGeo = new THREE.BoxGeometry(0.16, 0.62, 0.18);
  legGeo.translate(0, -0.31, 0);
  var legMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.95 });
  var legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.12, 0.62, 0);
  legL.name = 'legL';
  g.add(legL);
  var legR = new THREE.Mesh(legGeo, legMat);
  legR.position.set(0.12, 0.62, 0);
  legR.name = 'legR';
  g.add(legR);
  var body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.4, 1.1, 8),
    new THREE.MeshStandardMaterial({ color: 0x1f6f8b, roughness: 0.85 })
  );
  body.position.y = 1.15;
  body.castShadow = true;
  g.add(body);
  var armGeo = new THREE.BoxGeometry(0.13, 0.62, 0.14);
  armGeo.translate(0, -0.31, 0);
  var armMat = new THREE.MeshStandardMaterial({ color: 0x1f6f8b, roughness: 0.85 });
  var armL = new THREE.Mesh(armGeo, armMat);
  armL.position.set(-0.44, 1.6, 0);
  armL.name = 'armL';
  g.add(armL);
  var armR = new THREE.Mesh(armGeo, armMat);
  armR.position.set(0.44, 1.6, 0);
  armR.name = 'armR';
  g.add(armR);
  var head = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8b98a, roughness: 0.8 })
  );
  head.position.y = 1.92;
  head.castShadow = true;
  g.add(head);
  var cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.29, 0.29, 0.12, 10),
    new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 })
  );
  cap.position.y = 2.12;
  g.add(cap);
  return g;
}

function makeHeliMesh() {
  var g = new THREE.Group();
  var body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 4.6), new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.4, metalness: 0.4 }));
  body.castShadow = true;
  g.add(body);
  var tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 3.4), new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.4 }));
  tail.position.set(0, 0.2, -3.8);
  g.add(tail);
  var rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  rotor.position.y = 1.0;
  rotor.name = 'rotor';
  g.add(rotor);
  var glass = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 1.4), new THREE.MeshStandardMaterial({ color: 0x88bbdd, roughness: 0.1, metalness: 0.7 }));
  glass.position.set(0, 0.25, 1.6);
  g.add(glass);
  return g;
}

/* ============================== input ============================== */

function bindInput() {
  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code === 'Enter' && !S.started) { startGame(false); return; }
    if (e.code === 'KeyE') tryEnterExitCar();
    if (e.code === 'KeyF') shoot();
    if (e.code === 'Space') { punch(); e.preventDefault(); }
    if (e.code === 'KeyM') switchRadio();
    if (e.code === 'KeyR') switchRadio();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  canvas.addEventListener('pointerdown', function (e) {
    mouseDown = true; lastMX = e.clientX; lastMY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!mouseDown) return;
    camYaw -= (e.clientX - lastMX) * 0.005;
    camPitch = clamp(camPitch + (e.clientY - lastMY) * 0.004, 0.08, 1.1);
    lastMX = e.clientX; lastMY = e.clientY;
  });
  canvas.addEventListener('pointerup', function () { mouseDown = false; });
  canvas.addEventListener('wheel', function (e) {
    camDist = clamp(camDist + e.deltaY * 0.01, 6, 22);
    e.preventDefault();
  }, { passive: false });
}

/* ============================== boot ============================== */

function buildEnvironment() {
  // Small gradient environment scene for PMREM: golden-hour sky, warm horizon.
  var env = new THREE.Scene();
  var top = new THREE.Mesh(new THREE.SphereGeometry(50, 8, 8), new THREE.MeshBasicMaterial({ color: 0x5a7ba8, side: THREE.BackSide }));
  env.add(top);
  var sunBall = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe9b0 }));
  sunBall.position.set(30, 18, -20);
  env.add(sunBall);
  var groundGlow = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ color: 0x6b543a }));
  groundGlow.rotation.x = -Math.PI / 2;
  groundGlow.position.y = -8;
  env.add(groundGlow);
  var pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
}

// Gradient sky texture (warm horizon, blue zenith) + a low golden sun disc.
function buildSky() {
  var cv = document.createElement('canvas');
  cv.width = 16; cv.height = 512;
  var cx = cv.getContext('2d');
  var gr = cx.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#5f9bd8');
  gr.addColorStop(0.45, '#8fb8dd');
  gr.addColorStop(0.62, '#ffd9a0');
  gr.addColorStop(0.75, '#ffbe78');
  gr.addColorStop(1, '#e8a06a');
  cx.fillStyle = gr;
  cx.fillRect(0, 0, 16, 512);
  var tex = new THREE.CanvasTexture(cv);
  tex.encoding = THREE.sRGBEncoding;
  scene.background = tex;
  // Sun disc low on the horizon (golden hour).
  var sun = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: 0xffe9b0, fog: false }));
  sun.position.set(1400, 260, -900);
  sun.lookAt(camera.position);
  scene.add(sun);
  // POLISH (graphics): drifting clouds — flattened white puffs, low near the
  // horizon so they read in the chase camera (which looks slightly down):
  // at ~2-3 deg above horizontal they sit just over the skyline.
  var crng = makeRng(42);
  var cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false });
  for (var ci = 0; ci < 8; ci++) {
    var cg = new THREE.Group();
    var puffs = 3 + Math.floor(crng.next() * 3);
    for (var pi = 0; pi < puffs; pi++) {
      var pr = crng.range(30, 50);
      var puff = new THREE.Mesh(new THREE.SphereGeometry(pr, 8, 6), cloudMat);
      puff.position.set((pi - puffs / 2) * pr * 1.1 + crng.range(-8, 8), crng.range(-5, 5), crng.range(-10, 10));
      puff.scale.y = 0.4;
      cg.add(puff);
    }
    var cAng = crng.range(0, Math.PI * 2);
    var cDist = crng.range(1200, 1800);
    cg.position.set(Math.cos(cAng) * cDist, crng.range(55, 85), Math.sin(cAng) * cDist);
    scene.add(cg);
    clouds.push({ group: cg, speed: crng.range(1.5, 3.5) });
  }
}

// Drift the clouds across the sky (wrap around the city).
function updateClouds(dt) {
  for (var i = 0; i < clouds.length; i++) {
    var c = clouds[i];
    c.group.position.x += c.speed * dt;
    if (c.group.position.x > 1800) c.group.position.x = -1800;
  }
}

// One THREE.Points pool for blood (red) and smoke (grey) particles.
function initParticles() {
  pGeo = new THREE.BufferGeometry();
  pPos = new Float32Array(PMAX * 3);
  pCol = new Float32Array(PMAX * 3);
  pVel = new Float32Array(PMAX * 3);
  pLife = new Float32Array(PMAX);
  pMaxLife = new Float32Array(PMAX);
  pSize = new Float32Array(PMAX);
  for (var i = 0; i < PMAX; i++) { pPos[i * 3 + 1] = -100; pLife[i] = 0; }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  var pMat = new THREE.PointsMaterial({ size: 0.7, vertexColors: true, transparent: true, opacity: 0.9, sizeAttenuation: true, depthWrite: false });
  pPts = new THREE.Points(pGeo, pMat);
  pPts.frustumCulled = false;
  scene.add(pPts);
}

function spawnParticle(x, y, z, vx, vy, vz, life, r, g, b) {
  var idx = -1;
  for (var i = 0; i < PMAX; i++) if (pLife[i] <= 0) { idx = i; break; }
  if (idx < 0) return;
  pPos[idx * 3] = x; pPos[idx * 3 + 1] = y; pPos[idx * 3 + 2] = z;
  pVel[idx * 3] = vx; pVel[idx * 3 + 1] = vy; pVel[idx * 3 + 2] = vz;
  pCol[idx * 3] = r; pCol[idx * 3 + 1] = g; pCol[idx * 3 + 2] = b;
  pLife[idx] = life; pMaxLife[idx] = life;
}

function spawnBlood(x, y, z, n) {
  for (var i = 0; i < n; i++) {
    spawnParticle(x, y, z,
      (Math.random() - 0.5) * 4, Math.random() * 3 + 1, (Math.random() - 0.5) * 4,
      0.5 + Math.random() * 0.4, 0.75, 0.05, 0.05);
  }
  bloodSpawned += n;
  // Ground splat that fades over ~12 s.
  var splat = new THREE.Mesh(new THREE.CircleGeometry(0.9, 12), new THREE.MeshBasicMaterial({ color: 0x8a0a0a, transparent: true, opacity: 0.75, depthWrite: false }));
  splat.rotation.x = -Math.PI / 2;
  splat.position.set(x, 0.07, z);
  scene.add(splat);
  splats.push({ mesh: splat, life: 12 });
  if (splats.length > 20) {
    var old = splats.shift();
    scene.remove(old.mesh);
  }
}

function spawnSmoke(x, y, z) {
  spawnParticle(x, y, z,
    (Math.random() - 0.5) * 1.2, 1.5 + Math.random(), (Math.random() - 0.5) * 1.2,
    1.2 + Math.random() * 0.8, 0.45, 0.45, 0.45);
  smokeSpawned++;
}

function updateParticles(dt) {
  var any = false;
  for (var i = 0; i < PMAX; i++) {
    if (pLife[i] <= 0) continue;
    any = true;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -100; continue; }
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    pVel[i * 3 + 1] -= 4 * dt; // gravity for blood; smoke rises slowly anyway
  }
  if (any) {
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }
  for (var j = splats.length - 1; j >= 0; j--) {
    splats[j].life -= dt;
    splats[j].mesh.material.opacity = Math.max(0, splats[j].life / 12 * 0.75);
    if (splats[j].life <= 0) { scene.remove(splats[j].mesh); splats.splice(j, 1); }
  }
}

function init() {
  canvas = $('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  // POLISH (graphics): ACES filmic tone mapping — softer highlights, richer
  // contrast (the golden-hour look), instead of the default linear output.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd8c9a8, 400, 2000); // distance haze
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);
  clock = new THREE.Clock();

  // Golden-hour lighting: warm low sun + bright hemisphere.
  // REVISER FIX (lighting rebalance): the original hemi 0.9 + sun 1.5 +
  // bright PMREM env overexposed every surface ~3x (dark asphalt 0x23262b
  // rendered as RGB 109,117,124; ground 0x4a5244 as 222,236,219), washing
  // the whole city pale. Hemi 0.5 + sun 1.15 + dimmer env restore contrast.
  hemiLight = new THREE.HemisphereLight(0xbfd9ff, 0x9a7a52, 0.5);
  scene.add(hemiLight);
  sunLight = new THREE.DirectionalLight(0xffd9a0, 1.15);
  sunLight.position.set(300, 350, 150);
  sunLight.castShadow = true;
  // POLISH (graphics): sharper shadows — 4096 map over a tighter ±220 box
  // around the player (texel ~0.11 vs 0.25 before).
  sunLight.shadow.mapSize.set(4096, 4096);
  sunLight.shadow.camera.left = -220;
  sunLight.shadow.camera.right = 220;
  sunLight.shadow.camera.top = 220;
  sunLight.shadow.camera.bottom = -220;
  sunLight.shadow.camera.far = 1800;
  sunLight.shadow.bias = -0.0006;
  scene.add(sunLight);
  scene.add(sunLight.target);

  buildEnvironment();
  buildSky();
  initParticles();
  createWorldMeshes(scene, city);
  // Headlight spotlight for the player's car (positioned in syncMeshes).
  headlight = new THREE.SpotLight(0xfff2cc, 1.6, 70, 0.5, 0.5, 1);
  headTarget = new THREE.Object3D();
  headlight.visible = false;
  scene.add(headlight);
  scene.add(headTarget);
  headlight.target = headTarget;

  // Player.
  player.group = makePlayerMesh();
  scene.add(player.group);

  // Mission marker: glowing beacon cylinder + light.
  var markerGeo = new THREE.CylinderGeometry(3, 3, 30, 20, 1, true);
  var markerMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  markerLight = new THREE.PointLight(0xffd23f, 1.2, 60);
  scene.add(markerLight);
  for (var mi = 0; mi < 3; mi++) {
    var mk = new THREE.Mesh(markerGeo, markerMat.clone());
    mk.visible = false;
    scene.add(mk);
    markers.push(mk);
  }

  spawnParkedCars();
  spawnTraffic();
  spawnPedestrians();
  placeMissionTarget();

  bindInput();
  loadSaveIntoHud();
  updateHud();
  window.addEventListener('resize', onResize);

  window.VC = {
    cityHash: city.hash,
    state: S,
    player: player,
    cars: cars,
    peds: peds,
    police: police,
    missions: MISSIONS,
    debug: {
      teleport: teleportPlayer,
      setWanted: setWanted,
      startMission: startMission,
      completeStep: completeStep,
      damagePlayer: damagePlayer,
      setCash: function (v) { S.cash = v; updateCashHud(); },
      setHealth: function (v) { S.health = v; updateHealthHud(); },
      getPoliceSpeed: function () { return police.length ? police[0].speed : -1; },
      nearestPoliceDist: function () {
        if (!police.length) return -1;
        var best = 1e9;
        for (var i = 0; i < police.length; i++) best = Math.min(best, dist2(police[i].x, police[i].z, player.x, player.z));
        return best;
      },
      save: writeSave,
      load: loadSave,
      setShadows: function (on) {
        renderer.shadowMap.enabled = !!on;
        scene.traverse(function (o) { if (o.material) o.material.needsUpdate = true; });
      },
      heliActive: function () { return !!heli; },
      missionTarget: function () { return currentTarget(); },
      paynspray: function () { return city.paynspray; },
      setCarHealth: function (v) { if (S.inCar) { S.inCar.health = v; S.carHealth = v; updateCarHud(); } },
      vtypes: function () { var s = {}; for (var i = 0; i < cars.length; i++) s[cars[i].vtype || 'sedan'] = true; return Object.keys(s); },
      setCamYaw: function (y) { camYaw = y; },
      cityProps: function () { return { trees: city.trees.length, hydrants: city.hydrants.length, trafficLights: city.trafficLights.length, lamps: city.lamps.length, buildings: city.buildings.length }; },
      buildings: function () { return city.buildings; },
      graphicsCheck: function () { return { fog: !!scene.fog, sky: !!scene.background, hemi: hemiLight.intensity, sunColor: sunLight.color.getHex(), sunIntensity: sunLight.intensity }; },
      spawnCopNear: function () { spawnCop(player.x + 1.5, player.z); return cops.length; },
      clearCops: function () { for (var i = cops.length - 1; i >= 0; i--) { scene.remove(cops[i].mesh); cops.splice(i, 1); } bustedTimer = 0; },
      nearestCopDist: function () { var b = 1e9; for (var i = 0; i < cops.length; i++) b = Math.min(b, dist2(cops[i].x, cops[i].z, player.x, player.z)); return cops.length ? b : -1; },
      bustedTimer: function () { return bustedTimer; },
      cops: function () { return cops.length; },
      triggerBusted: busted,
      bloodCount: function () { return bloodSpawned; },
      smokeCount: function () { return smokeSpawned; },
      splatCount: function () { return splats.length; },
      sirenOn: function () { return S.sirenOn; },
      searching: function () { return S.searching; },
      panicNear: function (x, z) { lastShotPos = { x: x, z: z, t: S.time }; scarePeds(x, z, 30); },
      wheelSpin: function () { if (!S.inCar) return -1; var w = S.inCar.mesh.userData.wheels; return w ? w[0].spin.rotation.x : -1; },
      minimapN: function () { return !!window.__mapN; },
      // POLISH (verification helpers for the new city-life features).
      pedActivities: function () {
        var c = {};
        for (var i = 0; i < peds.length; i++) c[peds[i].act || 'walk'] = (c[peds[i].act || 'walk'] || 0) + 1;
        return { total: peds.length, byAct: c, dogs: peds.filter(function (p) { return !!p.dog; }).length };
      },
      trafficPhase: function () { return WORLD_FX.phase; },
      setTrafficPhase: function (p) { WORLD_FX.phaseOverride = (p == null ? null : p); },
      trafficLights: function () {
        return WORLD_FX.lights.map(function (L) {
          var green = (WORLD_FX.phase === 0 && L.axis === 'x') || (WORLD_FX.phase === 1 && L.axis === 'z');
          return { x: L.x, z: L.z, axis: L.axis, state: green ? 'green' : 'red' };
        });
      },
      trafficStoppedAtRed: function () {
        var n = 0;
        for (var i = 0; i < cars.length; i++) {
          var c = cars[i];
          if (c.kind !== 'traffic' || Math.abs(c.speed) > 0.5) continue;
          for (var li = 0; li < WORLD_FX.lights.length; li++) {
            var L = WORLD_FX.lights[li];
            if (L.axis !== c.routeAxis) continue;
            var along = c.routeAxis === 'x' ? (L.x - 14 - c.x) * c.routeDir : (L.z + 14 - c.z) * c.routeDir;
            var cross = c.routeAxis === 'x' ? Math.abs(c.z - (L.z + 14)) : Math.abs(c.x - (L.x - 14));
            var red = (WORLD_FX.phase === 1 && c.routeAxis === 'x') || (WORLD_FX.phase === 0 && c.routeAxis === 'z');
            if (red && cross < 3 && along > 0 && along < 26) { n++; break; }
          }
        }
        return n;
      },
      worldProps: function () {
        return {
          neon: WORLD_FX.neonCount, flags: WORLD_FX.flags.length, clouds: clouds.length,
          busStops: city.busStops.length, benches: city.benches.length, stalls: city.stalls.length,
          crossings: city.crossings.length, toneMapping: renderer.toneMapping,
          toneMappingExposure: renderer.toneMappingExposure,
          shadowMapSize: sunLight.shadow.mapSize.x,
        };
      },
      crossPeds: function () {
        return peds.filter(function (p) { return p.act === 'cross'; }).map(function (p) {
          return { x: Math.round(p.x), z: Math.round(p.z), side: p.cross.side, waitT: +p.waitT.toFixed(1), moving: p.moving };
        });
      },
    },
  };
  window.VC_READY = true;
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ============================== spawning ============================== */

function addCar(kind, x, z, angle, color, vtype) {
  var isPolice = kind === 'police';
  vtype = isPolice ? 'police' : (vtype || 'sedan');
  var vt = VTYPES[vtype];
  var mesh = makeCarMesh(isPolice ? 0x111111 : color, isPolice, vtype);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = angle;
  scene.add(mesh);
  var car = {
    kind: kind, vtype: vtype, mesh: mesh, x: x, z: z, angle: angle, speed: 0,
    maxSpeed: kind === 'police' ? 34 : vt.maxSpeed,
    accel: vt.accel, turn: vt.turn,
    health: kind === 'police' ? 50 : 100,
    cooldown: 0, routeAxis: 'x', routeDir: 1, targetSpeed: 12,
    stolen: false, wrecked: false, steer: 0, smokeTimer: 0,
  };
  cars.push(car);
  if (isPolice) police.push(car);
  return car;
}

function pickVtype() {
  var r = rngSpawn.next();
  if (r < 0.45) return 'sedan';
  if (r < 0.75) return 'taxi';
  return 'truck';
}

function spawnParkedCars() {
  for (var i = 0; i < 10; i++) {
    var p = randomRoadPoint(rngSpawn);
    var off = ROAD_W / 2 - 2.5;
    var x = p.axis === 'x' ? p.x : p.x + (rngSpawn.chance(0.5) ? off : -off);
    var z = p.axis === 'x' ? p.z + (rngSpawn.chance(0.5) ? off : -off) : p.z;
    var vt = pickVtype();
    var col = vt === 'taxi' ? 0xf1c40f : rngSpawn.pick(CAR_COLORS);
    addCar('parked', x, z, p.axis === 'x' ? (rngSpawn.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (rngSpawn.chance(0.5) ? 0 : Math.PI), col, vt);
  }
}

function spawnTraffic() {
  for (var i = 0; i < 14; i++) {
    var p = randomRoadPoint(rngSpawn);
    var dir = rngSpawn.chance(0.5) ? 1 : -1;
    var vt = pickVtype();
    var col = vt === 'taxi' ? 0xf1c40f : rngSpawn.pick(CAR_COLORS);
    var c = addCar('traffic', p.x, p.z, p.axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI), col, vt);
    c.routeAxis = p.axis;
    c.routeDir = dir;
    c.targetSpeed = rngSpawn.range(9, 13) * (vt === 'truck' ? 0.75 : 1);
    c.speed = c.targetSpeed;
  }
}

function spawnPedestrians() {
  // POLISH (resident activities): the 72 pedestrians are not just walking —
  // they chat in pairs, sit on benches, wait at bus stops, jog, walk dogs,
  // cross at zebra crossings, and run the food stalls.
  // Split: walk 28, chat 10 (5 pairs), sit 7, wait 6, jog 7, dog 5, cross 6, vendor 3.
  var acts = [];
  var pushAct = function (act, n) { for (var k = 0; k < n; k++) acts.push(act); };
  pushAct('walk', 28); pushAct('chat', 10); pushAct('sit', 7); pushAct('wait', 6);
  pushAct('jog', 7); pushAct('dog', 5); pushAct('cross', 6); pushAct('vendor', 3);
  // Deterministic shuffle so activities spread through the city.
  for (var s = acts.length - 1; s > 0; s--) {
    var j = Math.floor(rngSpawn.next() * (s + 1));
    var tmp = acts[s]; acts[s] = acts[j]; acts[j] = tmp;
  }
  // Chat pairs gather in the central plaza (visible from the start camera).
  var chatSpots = [];
  for (var c = 0; c < 5; c++) chatSpots.push({ x: (c - 2) * 45, z: 90 + (c % 2) * 40 });
  var chatIdx = 0, sitIdx = 0, waitIdx = 0, crossIdx = 0, vendorIdx = 0;
  for (var i = 0; i < 72; i++) {
    var act = acts[i];
    var p = sidewalkPoint(rngSpawn);
    var roll = rngSpawn.next();
    var variant = roll < 0.12 ? 'phone' : (roll < 0.24 ? 'pointer' : 'walker');
    if (act !== 'walk' && act !== 'jog' && act !== 'dog') variant = 'walker';
    var mesh = makePedMesh(rngSpawn.pick(PED_COLORS), {
      pants: rngSpawn.pick(PANTS_COLORS),
      skin: rngSpawn.pick(SKIN_TONES),
      hair: rngSpawn.pick(HAIR_COLORS),
      hat: rngSpawn.chance(0.2) ? rngSpawn.pick([0xc0392b, 0x2c3e50, 0xf1c40f]) : null,
      variant: variant,
    });
    mesh.position.set(p.x, 0, p.z);
    var sc = rngSpawn.range(0.9, 1.1);
    mesh.scale.set(sc, sc, sc);
    scene.add(mesh);
    var ped = {
      mesh: mesh, x: p.x, z: p.z, angle: p.axis === 'x' ? (rngSpawn.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (rngSpawn.chance(0.5) ? 0 : Math.PI),
      speed: rngSpawn.range(1.1, 2.4), axis: p.axis, dir: rngSpawn.chance(0.5) ? 1 : -1,
      alive: true, flee: false, walkPhase: rngSpawn.range(0, 6), variant: variant, scale: sc,
      act: act, anchorX: p.x, anchorZ: p.z, partner: null, dog: null,
      cross: null, waitT: 0, returning: false, moving: false,
    };
    if (act === 'chat') {
      var spot = chatSpots[Math.floor(chatIdx / 2)];
      var side = chatIdx % 2 === 0 ? -1 : 1;
      ped.anchorX = spot.x + side * 0.9;
      ped.anchorZ = spot.z;
      ped.x = ped.anchorX; ped.z = ped.anchorZ;
      ped.angle = side === -1 ? Math.PI / 2 : -Math.PI / 2; // face each other
      chatIdx++;
    } else if (act === 'sit') {
      var bn = city.benches[sitIdx % city.benches.length];
      ped.anchorX = bn.x; ped.anchorZ = bn.z;
      ped.x = bn.x; ped.z = bn.z;
      ped.angle = bn.face + Math.PI; // face outward from the bench back
      sitIdx++;
    } else if (act === 'wait') {
      var bs = city.busStops[waitIdx % city.busStops.length];
      ped.anchorX = bs.x; ped.anchorZ = bs.z + 1.5;
      ped.x = ped.anchorX; ped.z = ped.anchorZ;
      var av = Math.round(bs.z / 200) * 200;
      ped.angle = bs.z < av ? 0 : Math.PI; // face the road
      waitIdx++;
    } else if (act === 'vendor') {
      var sl = city.stalls[vendorIdx % city.stalls.length];
      ped.anchorX = sl.x; ped.anchorZ = sl.z;
      ped.x = sl.x; ped.z = sl.z;
      ped.angle = sl.face; // face the customers
      vendorIdx++;
    } else if (act === 'cross') {
      var cr = city.crossings[crossIdx % city.crossings.length];
      ped.cross = { x: cr.x, z: cr.z, axis: cr.axis, side: 1 };
      if (cr.axis === 'x') { ped.x = cr.x; ped.z = cr.z + 15; }
      else { ped.x = cr.x + 15; ped.z = cr.z; }
      ped.anchorX = ped.x; ped.anchorZ = ped.z;
      ped.waitT = rngSpawn.range(0, 4);
      crossIdx++;
    } else if (act === 'jog') {
      ped.speed = rngSpawn.range(3.2, 4.2);
    } else if (act === 'dog') {
      var dog = makeDogMesh(rngSpawn.pick([0x8a5a3b, 0x222222, 0xc9a227, 0x6b6f66]));
      scene.add(dog);
      ped.dog = dog;
    }
    mesh.position.set(ped.x, 0, ped.z);
    mesh.rotation.y = ped.angle;
    peds.push(ped);
  }
  // Link chat partners (pairs face each other).
  var chats = [];
  for (var ci = 0; ci < peds.length; ci++) if (peds[ci].act === 'chat') chats.push(peds[ci]);
  for (var cp = 0; cp + 1 < chats.length; cp += 2) {
    chats[cp].partner = chats[cp + 1];
    chats[cp + 1].partner = chats[cp];
  }
}

// Make nearby pedestrians panic and run away from (x, z).
function scarePeds(x, z, radius) {
  for (var i = 0; i < peds.length; i++) {
    var p = peds[i];
    if (!p.alive || p.variant === 'cop') continue;
    if (dist2(p.x, p.z, x, z) < radius) p.flee = true;
  }
}

/* ============================== player ============================== */

function teleportPlayer(x, z) {
  player.x = x; player.z = z;
  if (S.inCar) { S.inCar.x = x; S.inCar.z = z; }
}

function tryEnterExitCar() {
  if (!S.started || S.over) return;
  if (S.inCar) {
    // Exit: step out beside the car.
    var c = S.inCar;
    player.x = c.x + Math.cos(c.angle + Math.PI / 2) * 3;
    player.z = c.z + Math.sin(c.angle + Math.PI / 2) * 3;
    player.angle = c.angle;
    c.speed = 0;
    S.inCar = null;
    S.carHealth = 100;
    setStatus('On foot.');
    return;
  }
  var best = null, bestD = 7;
  for (var i = 0; i < cars.length; i++) {
    var car = cars[i];
    if (car.wrecked || car.kind === 'police') continue;
    var d = dist2(car.x, car.z, player.x, player.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  if (best) {
    S.inCar = best;
    S.carHealth = best.health;
    if (best.kind === 'traffic' || best.kind === 'parked') {
      best.kind = 'player';
      best.stolen = true;
      addWanted(1);
      setStatus('You stole a car! Wanted +1.');
    }
    player.x = best.x; player.z = best.z;
    setStatus('Driving. W/S to accelerate, A/D to steer.');
  }
}

function updatePlayer(dt) {
  var fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
  var rightX = -fwdZ, rightZ = fwdX;
  if (S.inCar) {
    var car = S.inCar;
    var accel = 0;
    if (keys['KeyW'] || keys['ArrowUp']) accel += car.accel;
    if (keys['KeyS'] || keys['ArrowDown']) accel -= car.accel * 0.75;
    var steer = 0;
    if (keys['KeyA'] || keys['ArrowLeft']) steer += 1;
    if (keys['KeyD'] || keys['ArrowRight']) steer -= 1;
    car.steer = steer;
    car.speed += accel * dt;
    if (accel === 0) car.speed *= Math.pow(0.4, dt);
    car.speed = clamp(car.speed, -12, car.maxSpeed);
    if (Math.abs(car.speed) > 0.2) {
      car.angle += steer * clamp(car.speed / 12, -1, 1) * car.turn * dt * (car.speed < 0 ? -1 : 1);
    }
    var nx = car.x + Math.sin(car.angle) * car.speed * dt;
    var nz = car.z + Math.cos(car.angle) * car.speed * dt;
    var res = collideBuildings(city, nx, nz, 2.4);
    if (res.hit && Math.abs(car.speed) > 8) {
      damageCar(car, (Math.abs(car.speed) - 8) * 0.6, false);
      car.speed *= 0.4;
      lastCrashPos = { x: car.x, z: car.z, t: S.time };
      scarePeds(car.x, car.z, 18);
    }
    var cl = clampToCity(res.x, res.z);
    car.x = cl.x; car.z = cl.z;
    player.x = car.x; player.z = car.z; player.angle = car.angle;
    S.speedKmh = Math.abs(car.speed) * 3.6;
    // Smoke from a badly damaged car.
    if (car.health < 40 && !car.wrecked) {
      car.smokeTimer -= dt;
      if (car.smokeTimer <= 0) {
        car.smokeTimer = 0.15;
        spawnSmoke(car.x + Math.sin(car.angle) * 1.5, 1.2, car.z + Math.cos(car.angle) * 1.5);
      }
    }
    // Pay 'n Spray: drive onto the pad with a wanted level (or a beat-up car)
    // to repair the car and lose the heat for $100.
    if (pnsCooldown > 0) pnsCooldown -= dt;
    var pns = city.paynspray;
    if (pnsCooldown <= 0 && S.cash >= 100 && (S.wanted > 0 || car.health < 100) &&
        dist2(car.x, car.z, pns.x, pns.z) < 12) {
      S.cash -= 100;
      car.health = 100;
      S.carHealth = 100;
      S.wanted = 0;
      pnsCooldown = 5;
      updateCashHud();
      updateWantedHud();
      updateCarHud();
      setStatus("Pay 'n Spray: car repaired, heat gone. -$100.");
    }
    return;
  }
  var mx = 0, mz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) { mx += fwdX; mz += fwdZ; }
  if (keys['KeyS'] || keys['ArrowDown']) { mx -= fwdX; mz -= fwdZ; }
  if (keys['KeyA'] || keys['ArrowLeft']) { mx -= rightX; mz -= rightZ; }
  if (keys['KeyD'] || keys['ArrowRight']) { mx += rightX; mz += rightZ; }
  var len = Math.sqrt(mx * mx + mz * mz);
  var run = keys['ShiftLeft'] || keys['ShiftRight'];
  var spd = run ? 8.5 : 4.6;
  if (len > 0) {
    mx /= len; mz /= len;
    player.x += mx * spd * dt;
    player.z += mz * spd * dt;
    player.angle = Math.atan2(mx, mz);
    player.speed = spd;
  } else {
    player.speed = 0;
  }
  var r2 = collideBuildings(city, player.x, player.z, 0.6);
  var c2 = clampToCity(r2.x, r2.z);
  player.x = c2.x; player.z = c2.z;
  player.walkPhase = (player.walkPhase || 0) + dt * (len > 0 ? 8 : 0);
  S.speedKmh = player.speed * 3.6;
}

function damageCar(car, amount, byPlayer) {
  if (car.wrecked) return;
  car.health -= amount;
  if (car.kind === 'player' || car === S.inCar) {
    S.carHealth = car.health;
    updateCarHud();
  }
  if (car.health <= 0) {
    car.wrecked = true;
    car.speed = 0;
    car.mesh.children[0].material = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
    setStatus('Your car is wrecked!');
    if (car === S.inCar) {
      S.inCar = null;
      S.carHealth = 100;
      player.x = car.x + 3; player.z = car.z + 3;
    }
  }
}

function damagePlayer(amount) {
  if (S.over || S.time - S.lastHurt < 0.15) return;
  S.lastHurt = S.time;
  S.health -= amount;
  // GTA-style red flash + blood at the player's feet.
  spawnBlood(player.x, 1.0, player.z, 10);
  var bf = $('blood-flash');
  if (bf) {
    bf.style.opacity = '1';
    setTimeout(function () { bf.style.opacity = '0'; }, 220);
  }
  updateHealthHud();
  if (S.health <= 0) {
    S.health = 0;
    wasted();
  }
}

/* ============================== camera ============================== */

function updateCamera(dt) {
  var tx = player.x, tz = player.z;
  var back = S.inCar ? 13 : 9;
  var height = S.inCar ? 5.5 : 4.2;
  var cx = tx + Math.sin(camYaw) * camDist * (back / 11);
  var cz = tz + Math.cos(camYaw) * camDist * (back / 11);
  var cy = height + camPitch * 6;
  camera.position.x += (cx - camera.position.x) * Math.min(1, dt * 6);
  camera.position.y += (cy - camera.position.y) * Math.min(1, dt * 6);
  camera.position.z += (cz - camera.position.z) * Math.min(1, dt * 6);
  camera.lookAt(tx, 1.6, tz);
  // Sun shadow frustum follows the player.
  sunLight.position.set(player.x + 400, 600, player.z + 200);
  sunLight.target.position.set(player.x, 0, player.z);
}

/* ============================== traffic & peds ============================== */

function updateTraffic(dt) {
  for (var i = 0; i < cars.length; i++) {
    var c = cars[i];
    if (c.kind !== 'traffic' || c.wrecked) continue;
    // U-turn at the city edge so traffic never jams against the boundary.
    if ((c.routeAxis === 'x' && ((c.routeDir > 0 && c.x > CITY_W / 2 - 50) || (c.routeDir < 0 && c.x < -CITY_W / 2 + 50))) ||
        (c.routeAxis === 'z' && ((c.routeDir > 0 && c.z > CITY_H / 2 - 50) || (c.routeDir < 0 && c.z < -CITY_H / 2 + 50)))) {
      c.routeDir *= -1;
      c.angle = c.routeAxis === 'x' ? (c.routeDir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.routeDir > 0 ? 0 : Math.PI);
    }
    // Slow down for a MOVING car ahead on the same road. (Stopped cars are
    // passed through: this world has no car-car collision, and waiting
    // behind a parked car would deadlock traffic forever.)
    var slow = false;
    for (var j = 0; j < cars.length; j++) {
      var o = cars[j];
      if (o === c || o.wrecked || Math.abs(o.speed) < 1) continue;
      var dx = o.x - c.x, dz = o.z - c.z;
      var ahead = c.routeAxis === 'x' ? dx * c.routeDir : dz * c.routeDir;
      var side = c.routeAxis === 'x' ? Math.abs(dz) : Math.abs(dx);
      if (ahead > 0 && ahead < 9 && side < 3) { slow = true; break; }
    }
    var target = slow ? 0 : c.targetSpeed;
    // POLISH (city alive): stop at a red traffic light that controls this
    // car's axis. The light ahead is the one at the next intersection on the
    // car's route; phase 0 = x-axis green, phase 1 = z-axis green.
    var redStop = false, redAlong = 0;
    if (typeof WORLD_FX !== 'undefined' && WORLD_FX.lights) {
      for (var li = 0; li < WORLD_FX.lights.length; li++) {
        var L = WORLD_FX.lights[li];
        if (L.axis !== c.routeAxis) continue;
        var alongL, crossL;
        if (c.routeAxis === 'x') {
          alongL = (L.x - 14 - c.x) * c.routeDir;
          crossL = Math.abs(c.z - (L.z + 14));
        } else {
          alongL = (L.z + 14 - c.z) * c.routeDir;
          crossL = Math.abs(c.x - (L.x - 14));
        }
        if (crossL < 3 && alongL > 0 && alongL < 26) {
          var isRed = (WORLD_FX.phase === 1 && c.routeAxis === 'x') || (WORLD_FX.phase === 0 && c.routeAxis === 'z');
          if (isRed) { redStop = true; redAlong = alongL; break; }
        }
      }
    }
    if (redStop) target = 0;
    c.speed += (target - c.speed) * Math.min(1, dt * 1.5);
    var nx = c.x + Math.sin(c.angle) * c.speed * dt;
    var nz = c.z + Math.cos(c.angle) * c.speed * dt;
    if (redStop) {
      // Don't creep past the stop line (12 units before the intersection).
      var adv = c.routeAxis === 'x' ? (nx - c.x) * c.routeDir : (nz - c.z) * c.routeDir;
      if (redAlong - adv < 12) {
        if (c.routeAxis === 'x') nx = c.x + c.routeDir * Math.max(0, redAlong - 12);
        else nz = c.z + c.routeDir * Math.max(0, redAlong - 12);
      }
    }
    var res = collideBuildings(city, nx, nz, 2.4);
    c.x = clampToCity(res.x, res.z).x;
    c.z = clampToCity(res.x, res.z).z;
    // At an intersection (near a cross road), sometimes turn.
    var nearX = false, nearZ = false;
    var xs = streetXs(), zs = avenueZs();
    for (var k = 0; k < xs.length; k++) if (Math.abs(c.x - xs[k]) < 3) nearX = true;
    for (k = 0; k < zs.length; k++) if (Math.abs(c.z - zs[k]) < 3) nearZ = true;
    if (c.routeAxis === 'x' && nearX && Math.abs(c.speed) > 1 && rngSpawn.chance(dt * 0.25)) {
      c.routeAxis = 'z';
      c.routeDir = rngSpawn.chance(0.5) ? 1 : -1;
      c.angle = c.routeDir > 0 ? 0 : Math.PI;
    } else if (c.routeAxis === 'z' && nearZ && Math.abs(c.speed) > 1 && rngSpawn.chance(dt * 0.25)) {
      c.routeAxis = 'x';
      c.routeDir = rngSpawn.chance(0.5) ? 1 : -1;
      c.angle = c.routeDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    // Keep traffic on the road: if it drifted off-axis, nudge back.
    if (c.routeAxis === 'x') {
      var zRoad = zs[0];
      for (k = 0; k < zs.length; k++) if (Math.abs(c.z - zs[k]) < Math.abs(c.z - zRoad)) zRoad = zs[k];
      c.z += (zRoad - c.z) * Math.min(1, dt * 0.5);
    } else {
      var xRoad = xs[0];
      for (k = 0; k < xs.length; k++) if (Math.abs(c.x - xs[k]) < Math.abs(c.x - xRoad)) xRoad = xs[k];
      c.x += (xRoad - c.x) * Math.min(1, dt * 0.5);
    }
  }
  // Top traffic back up to 14 (far from the player).
  var trafficCount = 0;
  for (i = 0; i < cars.length; i++) if (cars[i].kind === 'traffic') trafficCount++;
  if (trafficCount < 14 && S.time % 1 < dt) {
    var p = randomRoadPoint(rngSpawn);
    if (dist2(p.x, p.z, player.x, player.z) > 120) {
      var dir = rngSpawn.chance(0.5) ? 1 : -1;
      var vt2 = pickVtype();
      var col2 = vt2 === 'taxi' ? 0xf1c40f : rngSpawn.pick(CAR_COLORS);
      var nc = addCar('traffic', p.x, p.z, p.axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI), col2, vt2);
      nc.routeAxis = p.axis; nc.routeDir = dir;
      nc.targetSpeed = rngSpawn.range(9, 13) * (vt2 === 'truck' ? 0.75 : 1); nc.speed = nc.targetSpeed;
    }
  }
}

function updatePeds(dt) {
  for (var i = 0; i < peds.length; i++) {
    var p = peds[i];
    if (!p.alive) continue;
    var px = player.x, pz = player.z;
    var d = dist2(p.x, p.z, px, pz);
    // Panic: wanted 3+, a recent crime nearby, a gunshot, or a car crash.
    if (S.wanted >= 3 || (S.time - S.lastCrime < 3 && d < 25) ||
        (lastShotPos && S.time - lastShotPos.t < 3 && dist2(p.x, p.z, lastShotPos.x, lastShotPos.z) < 30) ||
        (lastCrashPos && S.time - lastCrashPos.t < 3 && dist2(p.x, p.z, lastCrashPos.x, lastCrashPos.z) < 18)) {
      p.flee = true;
    } else if (d > 60) p.flee = false;
    var stationary = p.act === 'chat' || p.act === 'sit' || p.act === 'wait' || p.act === 'vendor';
    var spd = p.flee ? 5.5 : p.speed;
    var mx = 0, mz = 0;
    if (p.flee) {
      var dx = p.x - px, dz = p.z - pz;
      var dl = Math.sqrt(dx * dx + dz * dz) || 1;
      mx = dx / dl; mz = dz / dl;
      p.returning = true;
    } else if (p.returning) {
      // Walk back to the activity anchor, then resume the activity.
      var rx = p.anchorX - p.x, rz = p.anchorZ - p.z;
      var rl = Math.sqrt(rx * rx + rz * rz);
      if (rl < 1.5) { p.returning = false; p.x = p.anchorX; p.z = p.anchorZ; }
      else { mx = rx / rl; mz = rz / rl; spd = p.speed; }
    } else if (p.act === 'cross') {
      // Zebra crossing: cross when the cars on this road have red (pedestrian
      // green), wait at the curb when cars have green. Mid-crossing, finish.
      var cr = p.cross;
      var carRed = (WORLD_FX.phase === 1 && cr.axis === 'x') || (WORLD_FX.phase === 0 && cr.axis === 'z');
      var fromC, toC;
      if (cr.axis === 'x') { fromC = cr.z + 15 * cr.side; toC = cr.z - 15 * cr.side; }
      else { fromC = cr.x + 15 * cr.side; toC = cr.x - 15 * cr.side; }
      var posC = cr.axis === 'x' ? p.z : p.x;
      var atCurb = Math.abs(posC - fromC) < 1;
      if (p.waitT > 0) {
        p.waitT -= dt;
      } else if (atCurb && !carRed) {
        p.waitT = 0.5; // cars have green: wait at the curb
      } else if (atCurb && carRed) {
        if (cr.axis === 'x') { mz = -cr.side; mx = 0; }
        else { mx = -cr.side; mz = 0; }
        spd = 1.6;
      } else {
        if (cr.axis === 'x') { mz = (toC > p.z) ? 1 : -1; mx = 0; }
        else { mx = (toC > p.x) ? 1 : -1; mz = 0; }
        spd = 1.6;
      }
    } else if (stationary) {
      // Chat / sit / wait / vendor: stay at the anchor.
      mx = 0; mz = 0; spd = 0;
    } else if (p.variant === 'phone' && !p.flee) {
      // Stands still, on the phone.
      mx = 0; mz = 0; spd = 0;
    } else {
      if (p.axis === 'x') { mx = p.dir; mz = 0; }
      else { mx = 0; mz = p.dir; }
    }
    p.x += mx * spd * dt;
    p.z += mz * spd * dt;
    p.moving = (mx !== 0 || mz !== 0);
    if (mx !== 0 || mz !== 0) p.angle = Math.atan2(mx, mz);
    // Crossing arrival: snap to the far curb, flip side, wait a while.
    if (p.act === 'cross' && !p.flee && !p.returning && p.moving) {
      var cr2 = p.cross;
      var to2 = cr2.axis === 'x' ? cr2.z - 15 * cr2.side : cr2.x - 15 * cr2.side;
      var from2 = cr2.axis === 'x' ? cr2.z + 15 * cr2.side : cr2.x + 15 * cr2.side;
      var pos2 = cr2.axis === 'x' ? p.z : p.x;
      var arrived = (to2 >= from2) ? pos2 >= to2 : pos2 <= to2;
      if (arrived && Math.abs(pos2 - from2) > 2) {
        if (cr2.axis === 'x') p.z = to2; else p.x = to2;
        cr2.side *= -1;
        p.waitT = rngSpawn.range(2, 5);
      }
    }
    // Chatting peds face their partner (heads nod via walkPhase in syncMeshes).
    if (p.act === 'chat' && p.partner && !p.flee && !p.returning) {
      p.angle = Math.atan2(p.partner.x - p.x, p.partner.z - p.z);
    }
    // Pointers face the player and raise an arm when the heat is on.
    if (p.variant === 'pointer' && !p.flee && S.wanted > 0 && d < 30) {
      p.angle = Math.atan2(px - p.x, pz - p.z);
    }
    // Walk phase: joggers swing fast, chatters nod slowly, others normal.
    var rate = p.act === 'jog' ? 11 : (p.act === 'chat' ? 2 : 6);
    p.walkPhase += dt * (p.flee ? 10 : rate);
    // Turn at intersections sometimes; stay in the city (roamers only).
    if (!p.flee && !stationary && p.act !== 'cross' && p.variant !== 'phone' && rngSpawn.chance(dt * 0.08)) {
      if (p.axis === 'x') { p.axis = 'z'; p.dir = rngSpawn.chance(0.5) ? 1 : -1; }
      else { p.axis = 'x'; p.dir = rngSpawn.chance(0.5) ? 1 : -1; }
    }
    var cl = clampToCity(p.x, p.z);
    p.x = cl.x; p.z = cl.z;
    var res = collideBuildings(city, p.x, p.z, 0.5);
    p.x = res.x; p.z = res.z;
  }
}

/* ============================== wanted & police ============================== */

function addWanted(n) {
  S.wanted = clamp(S.wanted + n, 0, 5);
  S.lastCrime = S.time;
  updateWantedHud();
}

function setWanted(n) {
  S.wanted = clamp(n, 0, 5);
  S.lastCrime = S.time;
  updateWantedHud();
}

function spawnPoliceCar() {
  // Spawn on a road 60-100 units from the player.
  for (var tries = 0; tries < 12; tries++) {
    var a = rngSpawn.range(0, Math.PI * 2);
    var d = rngSpawn.range(60, 100);
    var x = player.x + Math.cos(a) * d;
    var z = player.z + Math.sin(a) * d;
    if (Math.abs(x) > CITY_W / 2 - 30 || Math.abs(z) > CITY_H / 2 - 30) continue;
    var c = addCar('police', x, z, Math.atan2(player.x - x, player.z - z), 0x111111);
    c.maxSpeed = 34;
    c.speed = 20;
    return c;
  }
  return null;
}

var sirenRedLight = null, sirenBlueLight = null, copSpawnCooldown = 0;

function ensureAudio() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.12;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* audio unavailable */ }
}

function startSiren() {
  if (S.sirenOn) return;
  ensureAudio();
  if (!audioCtx) return;
  try {
    sirenOsc = audioCtx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 700;
    sirenGain = audioCtx.createGain();
    sirenGain.gain.value = 0.035;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(masterGain);
    sirenOsc.start();
    sirenHigh = false;
    sirenTimer = setInterval(function () {
      if (!sirenOsc) return;
      sirenHigh = !sirenHigh;
      sirenOsc.frequency.value = sirenHigh ? 950 : 700;
    }, 420);
    S.sirenOn = true;
  } catch (e) { /* siren unavailable */ }
}

function stopSiren() {
  if (!S.sirenOn) return;
  S.sirenOn = false;
  if (sirenTimer) { clearInterval(sirenTimer); sirenTimer = null; }
  try { if (sirenOsc) sirenOsc.stop(); } catch (e) {}
  sirenOsc = null;
  sirenGain = null;
}

function spawnCop(x, z) {
  // Push the spawn point out of any building so the cop can actually reach the player.
  var cl = collideBuildings(city, x, z, 1.0);
  x = cl.x; z = cl.z;
  var mesh = makePedMesh(0x1a2a6b, { pants: 0x141414, skin: 0xe8b98a, hat: 0x0a0a2a });
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  var cop = { mesh: mesh, x: x, z: z, angle: 0, walkPhase: 0, variant: 'cop' };
  cops.push(cop);
  return cop;
}

function updateCops(dt) {
  if (copSpawnCooldown > 0) copSpawnCooldown -= dt;
  // Foot cops appear when the player is on foot, wanted, and the patrol cars
  // have lost them (nearest police car > 30 away) — classic GTA cornering.
  if (S.wanted >= 1 && !S.inCar && !S.over && cops.length < 2 && copSpawnCooldown <= 0) {
    var nearCar = 1e9;
    for (var i = 0; i < police.length; i++) nearCar = Math.min(nearCar, dist2(police[i].x, police[i].z, player.x, player.z));
    if (nearCar > 30) {
      var a = rngSpawn.range(0, Math.PI * 2);
      var d = rngSpawn.range(35, 50);
      spawnCop(player.x + Math.cos(a) * d, player.z + Math.sin(a) * d);
      copSpawnCooldown = 3;
    }
  }
  if (S.wanted === 0 || S.inCar) {
    for (var j = cops.length - 1; j >= 0; j--) { scene.remove(cops[j].mesh); cops.splice(j, 1); }
    bustedTimer = 0;
    return;
  }
  var closest = 1e9;
  for (var k = 0; k < cops.length; k++) {
    var c = cops[k];
    var dx = player.x - c.x, dz = player.z - c.z;
    var dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
    closest = Math.min(closest, dist);
    c.angle = Math.atan2(dx, dz);
    c.x += (dx / dist) * 4.2 * dt;
    c.z += (dz / dist) * 4.2 * dt;
    c.walkPhase += dt * 9;
    var res = collideBuildings(city, c.x, c.z, 0.5);
    c.x = res.x; c.z = res.z;
    c.mesh.position.set(c.x, Math.abs(Math.sin(c.walkPhase)) * 0.05, c.z);
    c.mesh.rotation.y = c.angle;
    var la = c.mesh.getObjectByName('legL'), lb = c.mesh.getObjectByName('legR');
    var aa = c.mesh.getObjectByName('armL'), ab = c.mesh.getObjectByName('armR');
    if (la) la.rotation.x = Math.sin(c.walkPhase) * 0.55;
    if (lb) lb.rotation.x = -Math.sin(c.walkPhase) * 0.55;
    if (aa) aa.rotation.x = -Math.sin(c.walkPhase) * 0.45;
    if (ab) ab.rotation.x = Math.sin(c.walkPhase) * 0.45;
  }
  // BUSTED: a foot cop within 2 m for 3 straight seconds.
  if (cops.length && closest < 2) {
    bustedTimer += dt;
    if (bustedTimer >= 3) busted();
  } else {
    bustedTimer = Math.max(0, bustedTimer - dt);
  }
}

function updatePolice(dt) {
  // Desired count follows the wanted level.
  var want = S.wanted > 0 ? Math.min(S.wanted + 1, 6) : 0;
  while (police.length < want) {
    if (!spawnPoliceCar()) break;
  }
  var flash = Math.floor(S.time * 6) % 2 === 0;
  // Siren lights: real red/blue point lights on the nearest police car.
  if (police.length) {
    if (!sirenRedLight) {
      sirenRedLight = new THREE.PointLight(0xff2222, 0, 45);
      sirenBlueLight = new THREE.PointLight(0x2255ff, 0, 45);
      scene.add(sirenRedLight);
      scene.add(sirenBlueLight);
    }
    var np = police[0], nd = 1e9;
    for (var q = 0; q < police.length; q++) {
      var qd = dist2(police[q].x, police[q].z, player.x, player.z);
      if (qd < nd) { nd = qd; np = police[q]; }
    }
    sirenRedLight.position.set(np.x - 0.6, 2.2, np.z);
    sirenBlueLight.position.set(np.x + 0.6, 2.2, np.z);
    sirenRedLight.intensity = flash ? 3.2 : 0.3;
    sirenBlueLight.intensity = flash ? 0.3 : 3.2;
    startSiren();
  } else {
    if (sirenRedLight) { sirenRedLight.intensity = 0; sirenBlueLight.intensity = 0; }
    stopSiren();
  }
  for (var i = police.length - 1; i >= 0; i--) {
    var p = police[i];
    if (p.wrecked) continue;
    // Flash the light bar + the road glow under the car.
    var red = p.mesh.getObjectByName('lightRed');
    var blue = p.mesh.getObjectByName('lightBlue');
    if (red) red.material.emissiveIntensity = flash ? 3 : 0.4;
    if (blue) blue.material.emissiveIntensity = flash ? 0.4 : 3;
    var glow = p.mesh.getObjectByName('sirenGlow');
    if (glow) {
      glow.material.color.setHex(flash ? 0xff2222 : 0x2255ff);
      glow.material.opacity = 0.22;
    }
    if (p.cooldown > 0) p.cooldown -= dt;
    var dx = player.x - p.x, dz = player.z - p.z;
    var d = Math.sqrt(dx * dx + dz * dz) || 0.001;
    // HARD RULE 1 — chase ease-in: full speed far away, 2 m/s up close.
    // No heat, no chase: police idle and leave.
    var targetSpeed;
    if (S.wanted === 0) targetSpeed = 0;
    else if (d > 40) targetSpeed = p.maxSpeed;
    else if (d < 6) targetSpeed = 2;
    else targetSpeed = 2 + (p.maxSpeed - 2) * (d - 6) / (40 - 6);
    p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 1.2);
    var wantAngle = Math.atan2(dx, dz);
    p.angle = angleLerp(p.angle, wantAngle, Math.min(1, dt * 2.2));
    var nx = p.x + Math.sin(p.angle) * p.speed * dt;
    var nz = p.z + Math.cos(p.angle) * p.speed * dt;
    var res = collideBuildings(city, nx, nz, 2.4);
    var cl = clampToCity(res.x, res.z);
    p.x = cl.x; p.z = cl.z;
    // HARD RULE 2 — ramming: 14 damage, only when closing speed > 1,
    // per-car cooldown 2.5 s; heat rises only when the PLAYER is faster.
    if (d < 4.2 && p.cooldown <= 0) {
      var playerSpeed = S.inCar ? Math.abs(S.inCar.speed) : player.speed;
      var closing = Math.abs(p.speed - playerSpeed);
      if (closing > 1) {
        if (S.inCar) damageCar(S.inCar, RAM_DMG, false);
        else damagePlayer(RAM_DMG);
        if (playerSpeed > p.speed) addWanted(1);
        p.cooldown = RAM_COOLDOWN;
        setStatus('Police rammed you! -' + RAM_DMG + ' damage.');
      }
    }
    // Despawn police that fell far behind when wanted is gone.
    if (S.wanted === 0 && d > 60) {
      scene.remove(p.mesh);
      cars.splice(cars.indexOf(p), 1);
      police.splice(i, 1);
    }
  }
  // Wanted stars blink while "searching": no police car can see the player.
  // Hide long enough and the heat drops one star at a time.
  var searching = false;
  if (S.wanted > 0) {
    var nearest = 1e9;
    for (var j = 0; j < police.length; j++) {
      nearest = Math.min(nearest, dist2(police[j].x, police[j].z, player.x, player.z));
    }
    if (nearest > 55) {
      searching = true;
      S.hiddenTimer += dt;
      if (S.hiddenTimer > 8) {
        S.wanted = Math.max(0, S.wanted - 1);
        S.hiddenTimer = 0;
        updateWantedHud();
        if (S.wanted === 0) setStatus('You lost the cops.');
      }
    } else {
      S.hiddenTimer = 0;
    }
  } else {
    S.hiddenTimer = 0;
  }
  if (searching !== S.searching) {
    S.searching = searching;
    updateWantedHud();
  }
  updateCops(dt);
}

/* ============================== helicopter ============================== */

function updateHeli(dt) {
  if (S.wanted >= 4 && !heli) {
    heli = { mesh: makeHeliMesh(), angle: 0 };
    heli.light = new THREE.SpotLight(0xfff8cc, 2.2, 220, 0.35, 0.4, 1);
    heli.light.target = new THREE.Object3D();
    // Visible searchlight cone from the belly to the ground.
    heli.cone = new THREE.Mesh(
      new THREE.ConeGeometry(14, 60, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff8cc, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
    );
    scene.add(heli.mesh);
    scene.add(heli.light);
    scene.add(heli.light.target);
    scene.add(heli.cone);
    setStatus('Police helicopter overhead!');
  }
  if (S.wanted < 4 && heli) {
    scene.remove(heli.mesh);
    scene.remove(heli.light);
    scene.remove(heli.light.target);
    scene.remove(heli.cone);
    heli = null;
  }
  if (!heli) return;
  heli.angle += dt * 0.35;
  var hx = player.x + Math.cos(heli.angle) * 42;
  var hz = player.z + Math.sin(heli.angle) * 42;
  heli.mesh.position.set(hx, 62, hz);
  heli.mesh.rotation.y = -heli.angle;
  var rotor = heli.mesh.getObjectByName('rotor');
  if (rotor) rotor.rotation.y += dt * 22;
  heli.light.position.set(hx, 60, hz);
  heli.light.target.position.set(player.x, 0, player.z);
  // Cone: apex at the heli belly, base on the ground under the player.
  heli.cone.position.set((hx + player.x) / 2, 31, (hz + player.z) / 2);
  heli.cone.lookAt(player.x, 0, player.z);
  heli.cone.rotateX(-Math.PI / 2);
}

/* ============================== combat ============================== */

var lastShot = -10;
var lastPunch = -10;

function shoot() {
  if (!S.started || S.over || S.inCar) return;
  if (S.time - lastShot < 0.35) return;
  lastShot = S.time;
  addWanted(1);
  lastShotPos = { x: player.x + Math.sin(player.angle) * 10, z: player.z + Math.cos(player.angle) * 10, t: S.time };
  scarePeds(lastShotPos.x, lastShotPos.z, 30);
  var fx = Math.sin(player.angle), fz = Math.cos(player.angle);
  // Hit the nearest ped / police / traffic car in front within 40 units.
  var best = null, bestD = 40;
  for (var i = 0; i < peds.length; i++) {
    var p = peds[i];
    if (!p.alive) continue;
    var dx = p.x - player.x, dz = p.z - player.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    var dot = (dx * fx + dz * fz) / (d || 1);
    if (d < bestD && dot > 0.86) { bestD = d; best = { kind: 'ped', ref: p }; }
  }
  for (var j = 0; j < police.length; j++) {
    var pc = police[j];
    if (pc.wrecked) continue;
    var pdx = pc.x - player.x, pdz = pc.z - player.z;
    var pd = Math.sqrt(pdx * pdx + pdz * pdz);
    var pdot = (pdx * fx + pdz * fz) / (pd || 1);
    if (pd < bestD && pdot > 0.86) { bestD = pd; best = { kind: 'police', ref: pc }; }
  }
  if (best) {
    if (best.kind === 'ped') {
      best.ref.alive = false;
      best.ref.mesh.visible = false;
      spawnBlood(best.ref.x, 1.2, best.ref.z, 16);
      scarePeds(best.ref.x, best.ref.z, 30);
      addWanted(1);
      setStatus('You shot a pedestrian! Wanted up.');
    } else {
      best.ref.health -= 25;
      if (best.ref.health <= 0) {
        best.ref.wrecked = true;
        best.ref.speed = 0;
        best.ref.mesh.children[0].material = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
        addWanted(1);
        setStatus('Police car destroyed! Wanted up.');
      }
    }
  }
  flashMuzzle();
}

function punch() {
  if (!S.started || S.over || S.inCar) return;
  if (S.time - lastPunch < 0.5) return;
  lastPunch = S.time;
  var fx = Math.sin(player.angle), fz = Math.cos(player.angle);
  for (var i = 0; i < peds.length; i++) {
    var p = peds[i];
    if (!p.alive) continue;
    var dx = p.x - player.x, dz = p.z - player.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    var dot = (dx * fx + dz * fz) / (d || 1);
    if (d < 2.6 && dot > 0.5) {
      p.alive = false;
      p.mesh.visible = false;
      spawnBlood(p.x, 1.2, p.z, 14);
      scarePeds(p.x, p.z, 25);
      addWanted(1);
      setStatus('You punched a pedestrian! Wanted up.');
      return;
    }
  }
}

function flashMuzzle() {
  var m = $('muzzle');
  if (!m) return;
  m.style.opacity = '1';
  setTimeout(function () { m.style.opacity = '0'; }, 60);
}

/* ============================== missions ============================== */

var missionTarget = null; // {x, z, radius}

function missionTargetFor(missionIdx, stepIdx) {
  // Fixed targets per mission step (seeded), 250-550 units from the centre.
  var r = makeRng(SEED + 500 + missionIdx * 10 + stepIdx);
  var p = randomRoadPoint(r);
  var tries = 0;
  while (tries < 20 && dist2(p.x, p.z, 0, 0) < 220) { p = randomRoadPoint(r); tries++; }
  return { x: p.x, z: p.z, radius: 14 };
}

function placeMissionTarget() {
  if (S.mission >= MISSIONS.length) {
    S.allMissionsDone = true;
    missionTarget = null; markers[0].visible = false; markerLight.visible = false; updateMissionHud(); return;
  }
  var m = MISSIONS[S.mission];
  var step = m.steps[S.missionStep];
  if (step.kind === 'heat') {
    missionTarget = null;
    markers[0].visible = false;
    markerLight.visible = false;
  } else {
    missionTarget = missionTargetFor(S.mission, S.missionStep);
    markers[0].position.set(missionTarget.x, 15, missionTarget.z);
    markers[0].visible = true;
    markerLight.position.set(missionTarget.x, 20, missionTarget.z);
    markerLight.visible = true;
  }
  updateMissionHud();
}

function currentTarget() { return missionTarget; }

function startMission(i) {
  if (i < 0 || i >= MISSIONS.length) return;
  S.mission = i;
  S.missionStep = 0;
  S.missionWait = 0;
  S.missionDone = false;
  if (i === 2) setWanted(2);
  if (i === 4) setWanted(4);
  placeMissionTarget();
  setStatus('Mission: ' + MISSIONS[i].name + ' — ' + MISSIONS[i].text);
}

function completeStep() {
  var m = MISSIONS[S.mission];
  S.missionStep++;
  S.missionWait = 0;
  if (S.missionStep >= m.steps.length) completeMission();
  else placeMissionTarget();
}

function completeMission() {
  var m = MISSIONS[S.mission];
  S.cash += m.payout;
  // HARD RULE 3 — mission counter increments BEFORE the save is written.
  S.mission += 1;
  writeSave();
  updateCashHud();
  // Floating "+$200" payout text (GTA).
  var fc = $('float-cash');
  if (fc) {
    fc.textContent = '+$' + m.payout;
    fc.classList.remove('show');
    void fc.offsetWidth; // restart the animation
    fc.classList.add('show');
  }
  if (S.mission >= MISSIONS.length) {
    S.allMissionsDone = true;
    S.missionStep = 0;
    missionTarget = null;
    markers[0].visible = false;
    markerLight.visible = false;
    setStatus('All missions complete! Port Meridian is yours. Free roam.');
  } else {
    S.missionStep = 0;
    placeMissionTarget();
    setStatus('Mission complete! +$' + m.payout + '. Next: ' + MISSIONS[S.mission].name);
  }
  updateMissionHud();
}

function updateMissions(dt) {
  if (S.mission >= MISSIONS.length || S.over) return;
  var m = MISSIONS[S.mission];
  var step = m.steps[S.missionStep];
  if (step.kind === 'heat') {
    if (S.wanted === 0) completeStep();
    return;
  }
  if (!missionTarget) return;
  var d = dist2(player.x, player.z, missionTarget.x, missionTarget.z);
  if (step.kind === 'hold') {
    if (d < 14) {
      S.missionWait += dt;
      if (S.missionWait >= (step.hold || 10)) completeStep();
    } else {
      S.missionWait = Math.max(0, S.missionWait - dt * 2);
    }
    return;
  }
  if (d < missionTarget.radius) completeStep();
}

/* ============================== HUD ============================== */

function setStatus(text) {
  var el = $('status');
  if (el) el.textContent = text;
}

function updateCashHud() { var el = $('hud-cash'); if (el) el.textContent = '$' + S.cash.toLocaleString('en-US'); }
function updateHealthHud() {
  var el = $('hud-health-fill');
  if (el) el.style.width = Math.max(0, S.health) + '%';
  var t = $('hud-health-text');
  if (t) t.textContent = Math.ceil(Math.max(0, S.health));
}
function updateWantedHud() {
  var el = $('hud-wanted');
  if (!el) return;
  var stars = '';
  for (var i = 0; i < 5; i++) stars += i < S.wanted ? '★' : '☆';
  el.textContent = stars;
  el.style.color = S.wanted >= 4 ? '#ff4444' : (S.wanted > 0 ? '#ffcc00' : '#dddddd');
  // Stars blink while the cops are "searching" (player out of sight).
  if (S.searching && S.wanted > 0) el.classList.add('flashing');
  else el.classList.remove('flashing');
  var sr = $('hud-searching');
  if (sr) sr.textContent = (S.searching && S.wanted > 0) ? 'DICARI' : '';
}
function updateCarHud() {
  var el = $('hud-car');
  if (el) el.textContent = S.inCar ? ('Car ' + Math.ceil(Math.max(0, S.carHealth)) + '%') : '';
}
function updateMissionHud() {
  var el = $('hud-mission');
  if (!el) return;
  if (S.allMissionsDone) { el.innerHTML = '<b>All missions complete!</b><br>Free roam — Port Meridian is yours.'; return; }
  if (S.mission >= MISSIONS.length) { el.textContent = ''; return; }
  var m = MISSIONS[S.mission];
  var step = m.steps[S.missionStep];
  var extra = step.kind === 'hold' ? (' (' + Math.max(0, Math.ceil((step.hold || 10) - S.missionWait)) + 's)') : '';
  var d = missionTarget ? Math.round(dist2(player.x, player.z, missionTarget.x, missionTarget.z)) + 'm' : '';
  el.innerHTML = '<b>' + m.name + ' ($' + m.payout + ')</b><br>' + step.text + extra + (d ? '<br>' + d + ' to marker' : '');
}
// GTA waypoint arrow: points at the mission target, shows the distance.
function updateMissionArrow() {
  var wrap = $('mission-arrow');
  if (!wrap) return;
  if (!missionTarget || S.over || !S.started) { wrap.style.display = 'none'; return; }
  var d = dist2(player.x, player.z, missionTarget.x, missionTarget.z);
  var targetAngle = Math.atan2(missionTarget.x - player.x, missionTarget.z - player.z);
  // Camera forward heading is camYaw + PI; the arrow rotates by the bearing.
  var rel = targetAngle - (camYaw + Math.PI);
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  wrap.style.display = 'block';
  var glyph = $('mission-arrow-glyph');
  if (glyph) glyph.style.transform = 'rotate(' + (rel * 180 / Math.PI) + 'deg)';
  var dist = $('mission-dist');
  if (dist) dist.textContent = Math.round(d) + 'm';
}

function updateHud() {
  updateCashHud();
  updateHealthHud();
  updateWantedHud();
  updateCarHud();
  updateMissionHud();
}

/* ============================== minimap ============================== */

var mapStatic = null;
function buildStaticMap() {
  var c = document.createElement('canvas');
  c.width = 180; c.height = 180;
  var g = c.getContext('2d');
  var sx = 180 / CITY_W, sy = 180 / CITY_H;
  g.fillStyle = '#20241f';
  g.fillRect(0, 0, 180, 180);
  g.strokeStyle = '#4a4f45';
  g.lineWidth = 1;
  var xs = streetXs(), zs = avenueZs();
  for (var i = 0; i < xs.length; i++) {
    g.beginPath(); g.moveTo((xs[i] + CITY_W / 2) * sx, 0); g.lineTo((xs[i] + CITY_W / 2) * sx, 180); g.stroke();
  }
  for (i = 0; i < zs.length; i++) {
    g.beginPath(); g.moveTo(0, (zs[i] + CITY_H / 2) * sy); g.lineTo(180, (zs[i] + CITY_H / 2) * sy); g.stroke();
  }
  g.fillStyle = '#3d4a55';
  for (i = 0; i < city.buildings.length; i++) {
    var b = city.buildings[i];
    g.fillRect((b.x - b.w / 2 + CITY_W / 2) * sx, (b.z - b.d / 2 + CITY_H / 2) * sy, Math.max(1, b.w * sx), Math.max(1, b.d * sy));
  }
  mapStatic = c;
}

function drawMinimap() {
  var cv = $('minimap');
  if (!cv) return;
  var g = cv.getContext('2d');
  if (!mapStatic) buildStaticMap();
  g.drawImage(mapStatic, 0, 0);
  var sx = 180 / CITY_W, sy = 180 / CITY_H;
  function dot(x, z, color, r) {
    g.fillStyle = color;
    g.beginPath();
    g.arc((x + CITY_W / 2) * sx, (z + CITY_H / 2) * sy, r, 0, Math.PI * 2);
    g.fill();
  }
  if (missionTarget) dot(missionTarget.x, missionTarget.z, '#ffd23f', 5);
  // Pay 'n Spray blip (green $).
  dot(city.paynspray.x, city.paynspray.z, '#2ecc71', 4);
  for (var i = 0; i < police.length; i++) {
    if (!police[i].wrecked) dot(police[i].x, police[i].z, '#ff3333', 3);
  }
  // Foot cops (dark blue).
  for (var k = 0; k < cops.length; k++) dot(cops[k].x, cops[k].z, '#3355ff', 3);
  // Player arrow.
  var px = (player.x + CITY_W / 2) * sx, py = (player.z + CITY_H / 2) * sy;
  g.save();
  g.translate(px, py);
  g.rotate(Math.PI - player.angle);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5); g.closePath();
  g.fill();
  g.restore();
  // North indicator: 'N' rides the rim in the direction of world north.
  var nx2 = 90 + Math.sin(camYaw) * 78;
  var ny2 = 90 - Math.cos(camYaw) * 78;
  g.fillStyle = '#ffffff';
  g.font = 'bold 13px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('N', nx2, ny2);
  window.__mapN = true;
}

/* ============================== save ============================== */

function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: S.cash, mission: S.mission, health: S.health, time: S.time }));
  } catch (e) { /* storage unavailable — the game still runs */ }
}

function loadSave() {
  try {
    var raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function loadSaveIntoHud() {
  var sv = loadSave();
  var btn = $('btn-continue');
  if (btn) btn.style.display = sv ? 'inline-block' : 'none';
}

/* ============================== WASTED ============================== */

var wastedTimer = -1;

function wasted() {
  if (S.over) return;
  S.over = true;
  S.overKind = 'wasted';
  S.cash = Math.max(0, S.cash - 200);
  writeSave();
  // BUG FIX — the HUD cash must refresh after the $200 cut.
  updateCashHud();
  var el = $('wasted');
  if (el) el.style.display = 'flex';
  wastedTimer = 2.5;
}

// BUSTED: a foot cop held the player for 3 seconds. -$100, heat gone.
function busted() {
  if (S.over) return;
  S.over = true;
  S.overKind = 'busted';
  S.cash = Math.max(0, S.cash - 100);
  S.wanted = 0;
  writeSave();
  updateCashHud();
  updateWantedHud();
  for (var i = cops.length - 1; i >= 0; i--) { scene.remove(cops[i].mesh); cops.splice(i, 1); }
  bustedTimer = 0;
  var el = $('busted');
  if (el) el.style.display = 'flex';
  wastedTimer = 2.5;
  setStatus('BUSTED by the Port Meridian PD. -$100.');
}

function respawn() {
  S.over = false;
  S.health = 100;
  S.wanted = 0;
  S.inCar = null;
  S.carHealth = 100;
  player.x = 0; player.z = 30; player.angle = 0;
  var el = $('wasted');
  if (el) el.style.display = 'none';
  var b = $('busted');
  if (b) b.style.display = 'none';
  updateHealthHud();
  updateWantedHud();
  updateCarHud();
  if (S.overKind === 'busted') setStatus('You walked out of the precinct. -$100.');
  else setStatus('You woke up at the Meridian clinic. -$200.');
  S.overKind = '';
}

/* ============================== radio ============================== */

var audioCtx = null, masterGain = null, radioTimer = null, nextNote = 0, radioStep = 0;
var CHORDS = [
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
  [261.63, 329.63, 392.0], // C
  [196.0, 246.94, 293.66], // G
];
var BASSLINE = [55, 0, 55, 65.41, 55, 0, 49, 58.27, 55, 0, 55, 65.41, 82.41, 0, 73.42, 65.41];

function startRadio() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.12;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    S.radioOn = true;
    nextNote = audioCtx.currentTime + 0.1;
    radioStep = 0;
    if (!radioTimer) radioTimer = setInterval(scheduleRadio, 100);
    updateRadioHud();
  } catch (e) { /* audio unavailable — the game still runs */ }
}

function scheduleRadio() {
  if (!audioCtx || !S.radioOn) return;
  var spb = S.radio === 0 ? 0.5 : 60 / 112 / 2; // station 1: 112 BPM eighth notes
  while (nextNote < audioCtx.currentTime + 0.3) {
    if (S.radio === 0) {
      var chord = CHORDS[Math.floor(radioStep / 8) % CHORDS.length];
      if (radioStep % 8 === 0) {
        for (var i = 0; i < chord.length; i++) padNote(chord[i], nextNote, 4.0);
        padNote(chord[0] / 2, nextNote, 4.0);
      }
    } else {
      var beat = radioStep % 16;
      if (beat % 4 === 0) kick(nextNote);
      if (beat % 2 === 1) hat(nextNote);
      var bn = BASSLINE[beat];
      if (bn > 0) bassNote(bn, nextNote, spb * 0.9);
    }
    nextNote += spb;
    radioStep++;
  }
}

function padNote(freq, t, dur) {
  var o1 = audioCtx.createOscillator(), o2 = audioCtx.createOscillator();
  var g = audioCtx.createGain();
  o1.type = 'triangle'; o2.type = 'sine';
  o1.frequency.value = freq; o2.frequency.value = freq * 1.005;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.8);
  g.gain.setValueAtTime(0.5, t + dur - 0.8);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o1.connect(g); o2.connect(g); g.connect(masterGain);
  o1.start(t); o2.start(t); o1.stop(t + dur); o2.stop(t + dur);
}

function kick(t) {
  var o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
  o.connect(g); g.connect(masterGain);
  o.start(t); o.stop(t + 0.2);
}

function hat(t) {
  var len = 0.05, buf = audioCtx.createBuffer(1, audioCtx.sampleRate * len, audioCtx.sampleRate);
  var data = buf.getChannelData(0);
  for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  var src = audioCtx.createBufferSource();
  src.buffer = buf;
  var g = audioCtx.createGain();
  g.gain.value = 0.25;
  src.connect(g); g.connect(masterGain);
  src.start(t);
}

function bassNote(freq, t, dur) {
  var o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sawtooth';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.01, t + dur);
  o.connect(g); g.connect(masterGain);
  o.start(t); o.stop(t + dur);
}

function switchRadio() {
  S.radio = (S.radio + 1) % 2;
  radioStep = 0;
  updateRadioHud();
  var name = S.radio === 0 ? 'VELVET FM' : 'MERIDIAN BEATS';
  setStatus('Radio: ' + name);
  // GTA station banner.
  var bn = $('radio-banner');
  if (bn) {
    bn.textContent = '♪ ' + name;
    bn.style.opacity = '1';
    clearTimeout(bn._t);
    bn._t = setTimeout(function () { bn.style.opacity = '0'; }, 2500);
  }
}

function updateRadioHud() {
  var el = $('hud-radio');
  if (el) el.textContent = S.radioOn ? (S.radio === 0 ? '♪ VELVET FM' : '♪ MERIDIAN BEATS') : '♪ Radio off (M)';
}

/* ============================== sync & loop ============================== */

function syncMeshes() {
  player.group.position.set(player.x, 0, player.z);
  player.group.rotation.y = player.angle;
  player.group.visible = !S.inCar;
  // Player walk animation: arms and legs swing.
  var wp = player.walkPhase || 0;
  var pll = player.group.getObjectByName('legL'), plr = player.group.getObjectByName('legR');
  var pal = player.group.getObjectByName('armL'), par = player.group.getObjectByName('armR');
  var moving = player.speed > 0.1 && !S.inCar;
  if (pll) pll.rotation.x = moving ? Math.sin(wp) * 0.6 : 0;
  if (plr) plr.rotation.x = moving ? -Math.sin(wp) * 0.6 : 0;
  if (pal) pal.rotation.x = moving ? -Math.sin(wp) * 0.5 : 0;
  if (par) par.rotation.x = moving ? Math.sin(wp) * 0.5 : 0;
  for (var i = 0; i < cars.length; i++) {
    var c = cars[i];
    c.mesh.position.set(c.x, 0, c.z);
    c.mesh.rotation.y = c.angle;
    // Wheels: front wheels steer, all wheels spin with speed.
    var wheels = c.mesh.userData.wheels;
    if (wheels) {
      for (var wi = 0; wi < wheels.length; wi++) {
        var w = wheels[wi];
        if (w.front) w.group.rotation.y = (c === S.inCar ? c.steer : 0) * 0.4;
        w.spin.rotation.x += c.speed * 0.016 / 0.36;
      }
    }
  }
  // Headlight spotlight follows the player's car.
  if (headlight) {
    if (S.inCar) {
      var car = S.inCar;
      headlight.visible = true;
      headlight.position.set(car.x + Math.sin(car.angle) * 1.5, 1.0, car.z + Math.cos(car.angle) * 1.5);
      headTarget.position.set(car.x + Math.sin(car.angle) * 30, 0, car.z + Math.cos(car.angle) * 30);
    } else {
      headlight.visible = false;
    }
  }
  for (var j = 0; j < peds.length; j++) {
    var p = peds[j];
    var sitting = p.act === 'sit' && !p.flee && !p.returning;
    p.mesh.position.set(p.x, sitting ? -0.15 : Math.abs(Math.sin(p.walkPhase)) * 0.06, p.z);
    p.mesh.rotation.y = p.angle;
    // Walk animation: arms and legs swing when moving; pointers raise an arm
    // at the player. Sitting peds bend their legs forward onto the bench;
    // chatting peds nod their heads at their partner.
    var swing = p.moving ? Math.sin(p.walkPhase) * 0.55 : 0;
    var ll = p.mesh.getObjectByName('legL'), lr = p.mesh.getObjectByName('legR');
    var al = p.mesh.getObjectByName('armL'), ar = p.mesh.getObjectByName('armR');
    var hd = p.mesh.getObjectByName('head');
    if (ll) ll.rotation.x = sitting ? -1.4 : swing;
    if (lr) lr.rotation.x = sitting ? -1.4 : -swing;
    if (al) al.rotation.x = sitting ? -0.4 : -swing;
    if (ar) {
      if (p.variant === 'phone') ar.rotation.x = -2.2; // stays on the phone
      else if (p.variant === 'pointer' && S.wanted > 0 && dist2(p.x, p.z, player.x, player.z) < 30) ar.rotation.x = -1.4; // pointing
      else ar.rotation.x = sitting ? -0.4 : swing;
    }
    if (hd) {
      if (p.act === 'chat' && !p.flee && !p.returning) {
        hd.rotation.y = Math.sin(p.walkPhase) * 0.45; // talking: head turns
        hd.rotation.x = Math.sin(p.walkPhase * 0.7) * 0.12; // nodding
      } else if (p.act === 'wait' && !p.flee && !p.returning) {
        hd.rotation.y = Math.sin(S.time * 0.5 + p.walkPhase) * 0.6; // looking around
        hd.rotation.x = 0;
      } else {
        hd.rotation.y = 0;
        hd.rotation.x = 0;
      }
    }
    // The dog follows 1.3 units behind its owner, tail wagging.
    if (p.dog) {
      var dg = p.dog;
      dg.position.set(p.x - Math.sin(p.angle) * 1.3, p.moving ? Math.abs(Math.sin(p.walkPhase)) * 0.05 : 0, p.z - Math.cos(p.angle) * 1.3);
      dg.rotation.y = p.angle - Math.PI / 2;
      var tail = dg.getObjectByName('tail');
      if (tail) tail.rotation.y = Math.sin(S.time * 6 + p.walkPhase) * 0.5;
      for (var dli = 0; dli < 4; dli++) {
        var dl2 = dg.getObjectByName('dogLeg' + dli);
        if (dl2) dl2.rotation.x = p.moving ? Math.sin(p.walkPhase + (dli % 2) * Math.PI) * 0.5 : 0;
      }
    }
  }
  if (markers[0].visible) {
    markers[0].material.opacity = 0.25 + 0.15 * Math.sin(S.time * 4);
    markers[0].rotation.y += 0.01;
  }
}

var hudTimer = 0;

function loop() {
  requestAnimationFrame(loop);
  // dt clamp 0.1 keeps game time near wall time down to ~10 fps (weak GPUs).
  var dt = Math.min(clock.getDelta(), 0.1);
  if (!S.started) {
    syncMeshes();
    updateCamera(0.016);
    renderer.render(scene, camera);
    return;
  }
  if (S.over) {
    wastedTimer -= dt;
    if (wastedTimer <= 0) respawn();
    renderer.render(scene, camera);
    return;
  }
  S.time += dt;
  // Slow health regen after 6s without damage.
  if (S.time - S.lastHurt > 6 && S.health > 0 && S.health < 100) {
    S.health = Math.min(100, S.health + 2 * dt);
  }
  updatePlayer(dt);
  updateTraffic(dt);
  updatePeds(dt);
  updatePolice(dt);
  updateHeli(dt);
  updateMissions(dt);
  updateParticles(dt);
  updateClouds(dt);
  syncMeshes();
  updateCamera(dt);
  hudTimer += dt;
  if (hudTimer > 0.1) {
    hudTimer = 0;
    updateHealthHud();
    updateMissionHud();
    updateMissionArrow();
    if (typeof updateWorldFx === 'function') updateWorldFx(S.time);
    var sp = $('hud-speed');
    if (sp) sp.textContent = Math.round(S.speedKmh) + ' km/h';
    drawMinimap();
  }
  renderer.render(scene, camera);
}

/* ============================== start screen ============================== */

function startGame(fromSave) {
  if (fromSave) {
    var sv = loadSave();
    if (sv) {
      S.cash = sv.cash || 0;
      S.mission = Math.min(sv.mission || 0, MISSIONS.length);
      S.health = sv.health || 100;
      S.missionStep = 0;
      placeMissionTarget();
    }
  } else {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    S.cash = 0; S.mission = 0; S.health = 100; S.missionStep = 0;
    placeMissionTarget();
  }
  $('start-screen').style.display = 'none';
  S.started = true;
  startRadio();
  updateHud();
  updateMissionArrow();
  setStatus('Welcome to Port Meridian. Steal a car — mission: ' + MISSIONS[Math.min(S.mission, MISSIONS.length - 1)].name);
}

window.addEventListener('DOMContentLoaded', function () {
  try {
    init();
    $('btn-start').addEventListener('click', function () { startGame(false); });
    $('btn-continue').addEventListener('click', function () { startGame(true); });
    $('btn-radio').addEventListener('click', function () { if (S.radioOn) switchRadio(); else startRadio(); });
    loop();
  } catch (err) {
    window.VC_ERRORS = window.VC_ERRORS || [];
    window.VC_ERRORS.push(String(err && err.stack || err));
    var el = $('load-error');
    if (el) { el.style.display = 'block'; el.textContent = 'Failed to start: ' + err.message; }
  }
});

window.addEventListener('error', function (e) {
  window.VC_ERRORS = window.VC_ERRORS || [];
  window.VC_ERRORS.push(String(e.message));
});
window.VC_ERRORS = [];
