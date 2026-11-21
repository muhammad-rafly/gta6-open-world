// main.js — VELVET CITY gameplay: player, cars, police, missions, HUD.
// Classic script (global THREE from game/vendor/three.min.js). No network,
// no external assets: everything is generated in code or drawn on canvas.
(function () {
  'use strict';

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function angleLerp(a, b, t) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  // ---------- game state ----------
  var S = {
    started: false, paused: false, wasted: false, wastedTimer: 0,
    cash: 0, health: 100, wanted: 0, wantedTimer: 0,
    mission: 0, // index of the current mission (0..4), 5 = all done
    missionState: 'idle', // idle | active | done
    missionTimer: 0, missionHold: 0, missionStops: 0,
    inCar: false, car: null, speed: 0,
    time: 0, shots: 0, crimes: 0
  };
  var SAVE_KEY = 'velvetcity-save-v1';

  function writeSave() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ mission: S.mission, cash: S.cash }));
    } catch (e) { /* storage unavailable: play on without saving */ }
  }
  function readSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (typeof d.mission === 'number' && typeof d.cash === 'number') return d;
    } catch (e) { /* ignore corrupt saves */ }
    return null;
  }

  // ---------- renderer / scene ----------
  var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  $('game').appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);
  camera.position.set(60, 30, 660);

  // PMREM environment map: soft dusk reflections on cars and windows.
  (function buildEnv() {
    try {
      var pmrem = new THREE.PMREMGenerator(renderer);
      var envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x2a2f55);
      var top = new THREE.Mesh(new THREE.SphereGeometry(50, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x8a6fd0, side: THREE.BackSide }));
      envScene.add(top);
      var glow = new THREE.Mesh(new THREE.SphereGeometry(8, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffb36b }));
      glow.position.set(-30, 8, -30); envScene.add(glow);
      scene.environment = pmrem.fromScene(envScene, 0.04).texture;
      pmrem.dispose();
    } catch (e) { /* environment is polish, not required */ }
  })();

  var city = VCCity.buildCity(scene);

  // ---------- materials shared by vehicles ----------
  var CAR_COLORS = [0xc0392b, 0x2471a3, 0x1e8449, 0xd4ac0d, 0x7d3c98, 0xca6f1e, 0x2e4053, 0x922b21, 0x117864, 0x6c3483];
  var glassMat = new THREE.MeshLambertMaterial({ color: 0x101418 });
  var tyreMat = new THREE.MeshLambertMaterial({ color: 0x0c0c0c });
  var chromeMat = new THREE.MeshLambertMaterial({ color: 0xb8bcc4 });

  function wheelMesh() {
    var w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12), tyreMat);
    w.rotation.z = Math.PI / 2;
    w.castShadow = true;
    return w;
  }

  // Build a car: body + cabin + wheels (player and police only) + lights.
  // police=true gives the black-white livery, light bar and POLICE decals.
  function makeCar(color, opts) {
    opts = opts || {};
    var isPolice = !!opts.police;
    var optsTrafficWheels = !!opts.traffic;
    var g = new THREE.Group();
    var bodyMat = new THREE.MeshLambertMaterial({ color: isPolice ? 0x111214 : color });
    var body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 4.6), bodyMat);
    body.position.y = 0.75; body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.65, 2.2), glassMat);
    cabin.position.set(0, 1.4, -0.2); cabin.castShadow = true;
    g.add(cabin);
    // headlights + taillights
    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
    hl.position.set(-0.7, 0.8, 2.32); g.add(hl);
    var hl2 = hl.clone(); hl2.position.x = 0.7; g.add(hl2);
    var tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff2211 }));
    tl.position.set(-0.7, 0.8, -2.32); g.add(tl);
    var tl2 = tl.clone(); tl2.position.x = 0.7; g.add(tl2);
    var wheels = [];
    if (!optsTrafficWheels) {
      // wheels on player + police cars only; traffic cars get a dark skirt
      [[-1.05, 1.5], [1.05, 1.5], [-1.05, -1.5], [1.05, -1.5]].forEach(function (p) {
        var w = wheelMesh();
        w.position.set(p[0], 0.55, p[1]);
        g.add(w); wheels.push(w);
      });
    } else {
      var skirt = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 4.3),
        new THREE.MeshLambertMaterial({ color: 0x0a0a0a }));
      skirt.position.y = 0.35; g.add(skirt);
    }
    if (isPolice) {
      // black hood + trunk, white door band
      var hood = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.1, 1.1),
        new THREE.MeshLambertMaterial({ color: 0x050506 }));
      hood.position.set(0, 1.14, 1.7); g.add(hood);
      var trunk = hood.clone(); trunk.position.z = -1.7; g.add(trunk);
      var band = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.5, 2.4),
        new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
      band.position.set(0, 0.85, 0); g.add(band);
      // full-width light bar with bigger red / blue lenses, alternating flash
      var bar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 0.5),
        new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
      bar.position.set(0, 1.85, -0.2); g.add(bar);
      var redLens = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.26, 0.54),
        new THREE.MeshBasicMaterial({ color: 0xff1111 }));
      redLens.position.set(-0.48, 1.85, -0.2); g.add(redLens);
      var blueLens = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.26, 0.54),
        new THREE.MeshBasicMaterial({ color: 0x2244ff }));
      blueLens.position.set(0.48, 1.85, -0.2); g.add(blueLens);
      // POLICE decals on both doors
      var decal = (function () {
        var c = document.createElement('canvas'); c.width = 256; c.height = 64;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = '#0a0a0a'; ctx.font = 'bold 44px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('POLICE', 128, 34);
        var t = new THREE.CanvasTexture(c); t.anisotropy = 8;
        return t;
      })();
      [-1.14, 1.14].forEach(function (x) {
        var d = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5),
          new THREE.MeshBasicMaterial({ map: decal }));
        d.position.set(x, 0.85, 0); d.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2;
        g.add(d);
      });
      g.userData.redLens = redLens; g.userData.blueLens = blueLens;
    }
    g.userData.wheels = wheels;
    return g;
  }

  // ---------- player ----------
  var player = (function makePlayer() {
    var g = new THREE.Group();
    var shirt = new THREE.MeshLambertMaterial({ color: 0x2e86c1 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.5), shirt);
    body.position.y = 1.15; body.castShadow = true; g.add(body);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xd9a066 }));
    head.position.y = 2.05; head.castShadow = true; g.add(head);
    var legs = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.45),
      new THREE.MeshLambertMaterial({ color: 0x1c2833 }));
    legs.position.y = 0.45; legs.castShadow = true; g.add(legs);
    g.position.set(city.spawn.x, 0, city.spawn.z);
    g.rotation.y = city.spawn.heading;
    scene.add(g);
    return {
      mesh: g, x: city.spawn.x, z: city.spawn.z, heading: city.spawn.heading,
      vy: 0, onGround: true, walkSpeed: 0
    };
  })();

  // ---------- cars in the world ----------
  var cars = []; // {mesh, x, z, heading, speed, isPlayer, isPolice, isTraffic, color, health, ramCooldown, heatCooldown, loop, loopDist, parked}
  var rng = VCRng.makeRng(987654321);

  function addCar(x, z, heading, color, opts) {
    opts = opts || {};
    var mesh = makeCar(color, { police: !!opts.police, traffic: !!opts.traffic });
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    var car = {
      mesh: mesh, x: x, z: z, heading: heading, speed: 0,
      isPlayer: false, isPolice: !!opts.police, isTraffic: !!opts.traffic,
      parked: !!opts.parked, color: color, health: opts.police ? 60 : 100,
      ramCooldown: 0, heatCooldown: 0, loop: opts.loop || 0, loopDist: opts.loopDist || 0,
      steer: 0, disabled: false
    };
    cars.push(car);
    return car;
  }

  // traffic: 10 cars circulating the road loops
  for (var ti = 0; ti < 10; ti++) {
    var tLoop = city.trafficPaths[ti % city.trafficPaths.length];
    var p0 = tLoop.points[0];
    addCar(p0.x + rng.range(-6, 6), p0.z + rng.range(-6, 6), rng.range(0, Math.PI * 2),
      CAR_COLORS[ti % CAR_COLORS.length],
      { traffic: true, loop: ti % city.trafficPaths.length, loopDist: rng.range(0, 400) });
  }
  // parked cars the player can steal for free
  var parkedSpots = [
    { x: 80, z: 640, h: 0 }, { x: -60, z: 600, h: Math.PI / 2 },
    { x: 370, z: 620, h: 0 }, { x: -330, z: -230, h: Math.PI },
    { x: 720, z: 270, h: -Math.PI / 2 }, { x: 60, z: -480, h: Math.PI / 2 }
  ];
  parkedSpots.forEach(function (s, i) {
    addCar(s.x, s.z, s.h, CAR_COLORS[(i * 3 + 1) % CAR_COLORS.length], { parked: true });
  });

  // ---------- pedestrians: 72 sidewalk walkers ----------
  var PED_SHIRTS = [0xe74c3c, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xecf0f1, 0xe67e22, 0x1abc9c, 0xfd79a8];
  var peds = [];
  city.pedSpots.forEach(function (spot, i) {
    var g = new THREE.Group();
    var shirt = new THREE.MeshLambertMaterial({ color: PED_SHIRTS[i % PED_SHIRTS.length] });
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.45), shirt);
    body.position.y = 1.0; body.castShadow = true; g.add(body);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xc98d5f }));
    head.position.y = 1.8; head.castShadow = true; g.add(head);
    g.position.set(spot.x, 0, spot.z);
    scene.add(g);
    peds.push({
      mesh: g, x: spot.x, z: spot.z, alongX: spot.alongX,
      dir: rng.chance(0.5) ? 1 : -1, speed: rng.range(0.9, 1.9),
      base: spot.alongX ? spot.x : spot.z, range: rng.range(60, 130),
      down: 0, fleeing: false
    });
  });

  // ---------- police + helicopter ----------
  var policeCars = [];
  var heli = null; // {mesh, rotor, light, angle}
  var heliTarget = null;

  function spawnPolice() {
    var a = rng.range(0, Math.PI * 2);
    var px = player.x + Math.cos(a) * 130, pz = player.z + Math.sin(a) * 130;
    px = clamp(px, city.bounds.minX + 40, city.bounds.maxX - 40);
    pz = clamp(pz, city.bounds.minZ + 40, city.bounds.maxZ - 40);
    var car = addCar(px, pz, a + Math.PI, 0x111214, { police: true });
    policeCars.push(car);
    return car;
  }
  function spawnHeli() {
    if (heli) return;
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 6.5),
      new THREE.MeshLambertMaterial({ color: 0x1a1d24 }));
    body.castShadow = true; g.add(body);
    var tail = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 5),
      new THREE.MeshLambertMaterial({ color: 0x1a1d24 }));
    tail.position.set(0, 0.3, -5.2); g.add(tail);
    var rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x333333 }));
    rotor.position.y = 1.1; g.add(rotor);
    var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lamp.position.y = -0.9; g.add(lamp);
    // Searchlight: this three.js build attenuates the spot far less than
    // 1/d^1.2 would suggest, so 900 (and even 400) blew the bank facade
    // and plaza out to white whenever the beam caught them. 30 leaves a
    // readable pool on the player without clipping nearby surfaces
    // (verified by screenshot probes at 0 / 30 / 80 / 400).
    var spot = new THREE.SpotLight(0xfff2cc, 30, 150, 0.45, 0.5, 1.2);
    spot.position.set(0, -0.9, 0);
    g.add(spot); g.add(spot.target);
    g.position.set(player.x + 60, 95, player.z - 60);
    scene.add(g);
    heli = { mesh: g, rotor: rotor, spot: spot, angle: 0 };
    heliTarget = { x: player.x, z: player.z };
  }
  function removeHeli() {
    if (!heli) return;
    scene.remove(heli.mesh);
    heli = null; heliTarget = null;
  }

  // ---------- input ----------
  var keys = {};
  var camYaw = Math.PI, camPitch = 0.32, camDist = 13;
  var dragging = false, dragMoved = 0, lastMX = 0, lastMY = 0;
  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
    if (e.code === 'KeyE') tryEnterCar();
    if (e.code === 'KeyF') tryExitCar();
    if (e.code === 'KeyM') toggleMission();
    if (e.code === 'KeyR') radioNext();
    if (e.code === 'KeyN') radioMuteToggle();
    if (e.code === 'KeyP') togglePause();
    if (e.code === 'KeyC') camDist = camDist > 12 ? 9 : 16;
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  renderer.domElement.addEventListener('mousedown', function (e) {
    dragging = true; dragMoved = 0; lastMX = e.clientX; lastMY = e.clientY;
  });
  window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastMX, dy = e.clientY - lastMY;
    lastMX = e.clientX; lastMY = e.clientY;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    camYaw -= dx * 0.005;
    camPitch = clamp(camPitch + dy * 0.004, 0.05, 1.1);
  });
  window.addEventListener('mouseup', function (e) {
    if (dragging && dragMoved < 6 && S.started && !S.paused && !S.wasted) shoot();
    dragging = false;
  });
  renderer.domElement.addEventListener('wheel', function (e) {
    e.preventDefault();
    camDist = clamp(camDist + (e.deltaY > 0 ? 2 : -2), 6, 22);
  }, { passive: false });
  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- collision: circle vs building AABBs ----------
  function collideCircle(x, z, r) {
    for (var i = 0; i < city.colliders.length; i++) {
      var c = city.colliders[i];
      var nx = clamp(x, c.x - c.hw, c.x + c.hw);
      var nz = clamp(z, c.z - c.hd, c.z + c.hd);
      var dx = x - nx, dz = z - nz;
      var d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 < 0.0001) { x = c.x + c.hw + r; continue; }
        var d = Math.sqrt(d2);
        x = nx + (dx / d) * r; z = nz + (dz / d) * r;
      }
    }
    x = clamp(x, city.bounds.minX + 6, city.bounds.maxX - 6);
    z = clamp(z, city.bounds.minZ + 6, city.bounds.maxZ - 6);
    return { x: x, z: z };
  }

  // ---------- enter / exit cars ----------
  function nearestCar(maxD, wantParked) {
    var best = null, bestD = maxD * maxD;
    cars.forEach(function (c) {
      if (c.isPlayer || c.isPolice || c.disabled) return;
      if (wantParked !== undefined && c.parked !== wantParked && !c.isTraffic) return;
      var d2 = dist2(player.x, player.z, c.x, c.z);
      if (d2 < bestD) { bestD = d2; best = c; }
    });
    return best;
  }
  function tryEnterCar() {
    if (!S.started || S.paused || S.wasted || S.inCar) return;
    var c = nearestCar(5);
    if (!c) return;
    if (c.isTraffic) {
      // stealing an occupied car: the driver flees, the law notices
      addWanted(1);
      banner('CAR STOLEN', 'The driver ran off. The law noticed.');
      // the car leaves the traffic flow: it must stop following its loop,
      // or the traffic update would snap it back onto the road every frame
      c.isTraffic = false;
    }
    c.isPlayer = true; c.parked = false;
    S.inCar = true; S.car = c;
    player.mesh.visible = false;
    S.speed = 0;
    playBlip(660, 0.08);
  }
  function tryExitCar() {
    if (!S.inCar || !S.car) return;
    var c = S.car;
    c.isPlayer = false;
    var sx = c.x + Math.cos(c.heading + Math.PI / 2) * 3.5;
    var sz = c.z - Math.sin(c.heading + Math.PI / 2) * 3.5;
    var p = collideCircle(sx, sz, 1);
    player.x = p.x; player.z = p.z; player.heading = c.heading;
    player.mesh.position.set(player.x, 0, player.z);
    player.mesh.rotation.y = player.heading;
    player.mesh.visible = true;
    S.inCar = false; S.car = null; S.speed = 0;
  }

  // ---------- movement ----------
  function updatePlayer(dt) {
    var run = keys['ShiftLeft'] || keys['ShiftRight'];
    var sp = run ? 9 : 5;
    var fwd = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
    var str = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
    var mx = 0, mz = 0;
    if (fwd || str) {
      var sy = Math.sin(camYaw), cy = Math.cos(camYaw);
      mx = -sy * fwd + cy * str;
      mz = -cy * fwd - sy * str;
      var len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      player.heading = Math.atan2(mx, mz);
    }
    var nx = player.x + mx * sp * dt, nz = player.z + mz * sp * dt;
    var p = collideCircle(nx, nz, 1);
    player.x = p.x; player.z = p.z;
    player.walkSpeed = (fwd || str) ? sp : 0;
    // jump
    if (keys['Space'] && player.onGround) { player.vy = 7; player.onGround = false; }
    if (!player.onGround) {
      player.vy -= 22 * dt;
      var y = player.mesh.position.y + player.vy * dt;
      if (y <= 0) { y = 0; player.vy = 0; player.onGround = true; }
      player.mesh.position.y = y;
    }
    player.mesh.position.x = player.x;
    player.mesh.position.z = player.z;
    player.mesh.rotation.y = angleLerp(player.mesh.rotation.y, player.heading, Math.min(1, dt * 12));
    // walk bob (only while grounded; jumping uses its own height)
    if (player.onGround && player.walkSpeed > 0) {
      player.mesh.position.y = Math.abs(Math.sin(S.time * 10)) * 0.08;
    }
  }

  function updatePlayerCar(dt) {
    var c = S.car;
    if (!c) return;
    var fwd = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
    var str = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
    var handbrake = keys['Space'];
    var accel = fwd * (fwd > 0 ? 24 : 16);
    c.speed += accel * dt;
    c.speed -= c.speed * (handbrake ? 1.6 : 0.55) * dt;
    if (Math.abs(c.speed) < 0.15 && !fwd) c.speed = 0;
    c.speed = clamp(c.speed, -13, 40);
    var steerTarget = -str * 0.55 * clamp(Math.abs(c.speed) / 12, 0, 1) * (c.speed < 0 ? -1 : 1);
    if (handbrake) steerTarget *= 1.7;
    c.steer = lerp(c.steer, steerTarget, Math.min(1, dt * 6));
    c.heading += c.steer * (c.speed / 14) * dt * 2.2;
    var nx = c.x + Math.sin(c.heading) * c.speed * dt;
    var nz = c.z + Math.cos(c.heading) * c.speed * dt;
    var p = collideCircle(nx, nz, 2.1);
    if (Math.abs(p.x - nx) > 0.01 || Math.abs(p.z - nz) > 0.01) {
      // hit a building: scrape speed off, small camera shake
      c.speed *= 0.55;
      if (Math.abs(c.speed) > 6) { addWanted(0); }
    }
    c.x = p.x; c.z = p.z;
    c.mesh.position.set(c.x, 0, c.z);
    c.mesh.rotation.y = c.heading;
    // body roll + wheel spin
    c.mesh.rotation.z = lerp(c.mesh.rotation.z, -c.steer * 0.05, Math.min(1, dt * 8));
    c.mesh.userData.wheels.forEach(function (w) { w.rotation.x += c.speed * dt * 1.6; });
    S.speed = c.speed;
    // keep the player position glued to the car
    player.x = c.x; player.z = c.z; player.heading = c.heading;
    // running over pedestrians
    peds.forEach(function (pd) {
      if (pd.down > 0) return;
      if (dist2(c.x, c.z, pd.x, pd.z) < 9 && Math.abs(c.speed) > 5) {
        knockPed(pd, true);
      }
    });
  }

  // ---------- traffic + pedestrians ----------
  function updateTraffic(dt) {
    cars.forEach(function (c) {
      if (!c.isTraffic || c.disabled) return;
      var loop = city.trafficPaths[c.loop];
      var pts = loop.points;
      c.loopDist += 11 * dt;
      var per = loop.length / 4;
      var seg = Math.floor(c.loopDist / per) % 4;
      var t = (c.loopDist % per) / per;
      var a = pts[seg], b = pts[(seg + 1) % 4];
      var nx = lerp(a.x, b.x, t), nz = lerp(a.z, b.z, t);
      // slow down if the player's car is right ahead
      if (S.inCar && S.car && dist2(nx, nz, S.car.x, S.car.z) < 120) {
        c.loopDist -= 4 * dt;
      }
      c.x = nx; c.z = nz;
      c.heading = Math.atan2(b.x - a.x, b.z - a.z);
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.heading;
    });
  }

  function updatePeds(dt) {
    peds.forEach(function (pd) {
      if (pd.down > 0) {
        pd.down -= dt;
        if (pd.down <= 0) { pd.mesh.rotation.x = 0; pd.fleeing = true; }
        return;
      }
      var sp = pd.fleeing ? pd.speed * 2.4 : pd.speed;
      if (pd.alongX) {
        pd.x += pd.dir * sp * dt;
        if (Math.abs(pd.x - pd.base) > pd.range) pd.dir *= -1;
      } else {
        pd.z += pd.dir * sp * dt;
        if (Math.abs(pd.z - pd.base) > pd.range) pd.dir *= -1;
      }
      pd.mesh.position.set(pd.x, 0, pd.z);
      pd.mesh.rotation.y = pd.alongX ? (pd.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (pd.dir > 0 ? 0 : Math.PI);
      // stop fleeing once far from the player
      if (pd.fleeing && dist2(pd.x, pd.z, player.x, player.z) > 2500) pd.fleeing = false;
    });
  }

  function knockPed(pd, byCar) {
    pd.down = 3;
    pd.mesh.rotation.x = -Math.PI / 2;
    pd.mesh.position.y = 0.4;
    addWanted(1);
    playBlip(180, 0.15);
    if (byCar) banner('PEDESTRIAN DOWN', 'Witnesses called the police.');
  }

  // ---------- wanted level ----------
  function addWanted(n) {
    if (n <= 0) return;
    var before = S.wanted;
    S.wanted = clamp(S.wanted + n, 0, 5);
    if (S.wanted > before) { S.wantedTimer = 0; S.crimes++; }
    updateWantedHud();
  }
  function updateWantedHud() {
    var el = $('wanted');
    el.textContent = '★'.repeat(S.wanted) + '☆'.repeat(5 - S.wanted);
    el.className = S.wanted >= 4 ? 'hot' : (S.wanted > 0 ? 'warm' : '');
  }
  function updateWanted(dt) {
    // decay: lay low and slow, out of sight, and the heat fades
    var nearestPolice = 1e9;
    policeCars.forEach(function (pc) {
      nearestPolice = Math.min(nearestPolice, Math.hypot(pc.x - player.x, pc.z - player.z));
    });
    var spd = S.inCar ? Math.abs(S.speed) : player.walkSpeed;
    if (S.wanted > 0 && nearestPolice > 80 && spd < 8) {
      S.wantedTimer += dt;
      if (S.wantedTimer > 18) { S.wanted--; S.wantedTimer = 0; updateWantedHud(); }
    } else {
      S.wantedTimer = 0;
    }
    // keep the right number of police on the street
    var want = Math.min(S.wanted, 4);
    while (policeCars.length < want) spawnPolice();
    while (policeCars.length > want) {
      var old = policeCars.pop();
      scene.remove(old.mesh);
      var idx = cars.indexOf(old); if (idx >= 0) cars.splice(idx, 1);
    }
    if (S.wanted >= 4) spawnHeli(); else if (heli && S.wanted < 4) removeHeli();
  }

  // ---------- police AI ----------
  // Hard rule 1 — ease-in: dist > 40 full speed / dist < 6 -> 2 m/s / ramp between.
  // Hard rule 2 — ram: RAM_DMG 14, closing speed > 1, per-car cooldown 2.5 s,
  // and a ram only adds heat when the PLAYER is the faster one.
  var RAM_DMG = 14;
  function updatePolice(dt) {
    policeCars.forEach(function (pc) {
      pc.ramCooldown = Math.max(0, pc.ramCooldown - dt);
      pc.heatCooldown = Math.max(0, pc.heatCooldown - dt);
      var dx = player.x - pc.x, dz = player.z - pc.z;
      var dist = Math.hypot(dx, dz);
      var targetSpeed;
      if (dist > 40) targetSpeed = 34;
      else if (dist < 6) targetSpeed = 2;
      else targetSpeed = 2 + (34 - 2) * (dist - 6) / (40 - 6);
      pc.speed = lerp(pc.speed, targetSpeed, Math.min(1, dt * 1.4));
      var wantHeading = Math.atan2(dx, dz);
      pc.heading = angleLerp(pc.heading, wantHeading, Math.min(1, dt * 2.2));
      var nx = pc.x + Math.sin(pc.heading) * pc.speed * dt;
      var nz = pc.z + Math.cos(pc.heading) * pc.speed * dt;
      var p = collideCircle(nx, nz, 2.1);
      pc.x = p.x; pc.z = p.z;
      pc.mesh.position.set(pc.x, 0, pc.z);
      pc.mesh.rotation.y = pc.heading;
      pc.mesh.userData.wheels.forEach(function (w) { w.rotation.x += pc.speed * dt * 1.6; });
      // light bar: alternating red / blue flash
      var phase = Math.floor(S.time * 6) % 2 === 0;
      if (pc.mesh.userData.redLens) {
        pc.mesh.userData.redLens.material.color.setHex(phase ? 0xff1111 : 0x550000);
        pc.mesh.userData.blueLens.material.color.setHex(phase ? 0x000055 : 0x2244ff);
      }
      // ram the player
      if (dist < 4.5 && pc.ramCooldown <= 0) {
        var closing = pc.speed - (S.inCar ? Math.abs(S.speed) : player.walkSpeed);
        if (closing > 1) {
          damagePlayer(RAM_DMG);
          pc.ramCooldown = 2.5;
          playBlip(120, 0.2);
          // heat only when the player is the faster one (player ramming police)
          if (S.inCar && Math.abs(S.speed) > pc.speed && pc.heatCooldown <= 0) {
            addWanted(1); pc.heatCooldown = 2.5;
          }
        }
      }
      // player car ramming a police car adds heat
      if (S.inCar && dist < 5 && Math.abs(S.speed) > pc.speed + 4 && pc.heatCooldown <= 0) {
        addWanted(1); pc.heatCooldown = 2.5;
      }
      // police car too far away: teleport it back into the chase
      if (dist > 420) {
        var a = rng.range(0, Math.PI * 2);
        pc.x = clamp(player.x + Math.cos(a) * 130, city.bounds.minX + 40, city.bounds.maxX - 40);
        pc.z = clamp(player.z + Math.sin(a) * 130, city.bounds.minZ + 40, city.bounds.maxZ - 40);
      }
    });
    // helicopter: hover above the player, searchlight tracking them
    if (heli) {
      heli.angle += dt * 0.35;
      var hx = player.x + Math.cos(heli.angle) * 55;
      var hz = player.z + Math.sin(heli.angle) * 55;
      heli.mesh.position.x = lerp(heli.mesh.position.x, hx, Math.min(1, dt * 1.5));
      heli.mesh.position.z = lerp(heli.mesh.position.z, hz, Math.min(1, dt * 1.5));
      heli.mesh.position.y = 95 + Math.sin(S.time * 0.7) * 4;
      heli.mesh.rotation.y = Math.atan2(player.x - heli.mesh.position.x, player.z - heli.mesh.position.z);
      heli.rotor.rotation.y += dt * 22;
      heli.spot.target.position.set(player.x - heli.mesh.position.x, -95, player.z - heli.mesh.position.z);
      heli.spot.target.updateMatrixWorld();
    }
  }

  // ---------- health / wasted ----------
  function damagePlayer(n) {
    if (S.wasted || !S.started) return;
    S.health = Math.max(0, S.health - n);
    updateHealthHud();
    if (S.health <= 0) wasted();
  }
  function wasted() {
    S.wasted = true; S.wastedTimer = 0;
    if (S.inCar) tryExitCar();
    $('wasted').style.display = 'flex';
    S.cash = Math.max(0, S.cash - 200);
    updateCashHud(); // the $200 hospital bill must show on the HUD right away
    writeSave();
  }
  function respawn() {
    S.wasted = false; S.health = 100; S.wanted = 0;
    updateWantedHud(); updateHealthHud();
    $('wasted').style.display = 'none';
    player.x = city.spawn.x; player.z = city.spawn.z; player.heading = city.spawn.heading;
    player.mesh.position.set(player.x, 0, player.z);
    player.mesh.rotation.y = player.heading;
    camYaw = Math.PI;
    // clear the police
    policeCars.forEach(function (pc) { scene.remove(pc.mesh); var i = cars.indexOf(pc); if (i >= 0) cars.splice(i, 1); });
    policeCars.length = 0;
    removeHeli();
  }

  // ---------- combat: pistol ----------
  var raycaster = new THREE.Raycaster();
  var tracer = null;
  function shoot() {
    if (S.inCar) return; // no drive-by in this build: shoot on foot
    S.shots++;
    var dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    raycaster.set(camera.position, dir);
    raycaster.far = 90;
    var targets = [];
    peds.forEach(function (pd) { if (pd.down <= 0) targets.push(pd.mesh); });
    policeCars.forEach(function (pc) { targets.push(pc.mesh); });
    cars.forEach(function (c) { if (!c.isPlayer && !c.isPolice) targets.push(c.mesh); });
    var hits = raycaster.intersectObjects(targets, true);
    // tracer line from the player toward the shot
    if (tracer) scene.remove(tracer);
    var end = hits.length ? hits[0].point : camera.position.clone().add(dir.multiplyScalar(60));
    var start = player.mesh.position.clone(); start.y = 1.6;
    var geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    tracer = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8 }));
    scene.add(tracer);
    setTimeout(function () { if (tracer) { scene.remove(tracer); tracer = null; } }, 70);
    playBlip(1400, 0.05);
    if (!hits.length) return;
    var obj = hits[0].object;
    var pd = peds.find(function (p) { return p.mesh === obj || p.mesh.children.indexOf(obj) >= 0; });
    if (pd) { knockPed(pd, false); return; }
    var pc = policeCars.find(function (c) { return c.mesh === obj || c.mesh.children.indexOf(obj) >= 0; });
    if (pc) {
      pc.health -= 25;
      addWanted(1);
      if (pc.health <= 0 && !pc.disabled) {
        pc.disabled = true; pc.speed = 0;
        pc.mesh.rotation.z = 0.12;
        banner('POLICE CAR DISABLED', 'That one is out of the chase.');
      }
      return;
    }
    addWanted(0);
  }

  // ---------- missions ----------
  var MISSIONS = [
    { name: 'First Wheels', pay: 200, type: 'reach', needCar: true,
      desc: 'Steal a car and drive to the docks marker.',
      target: { x: 700, z: 750 } },
    { name: 'Courier Run', pay: 400, type: 'reach', timer: 90,
      desc: 'Deliver the package to the north plaza. 90 seconds.',
      target: { x: -700, z: -750 } },
    { name: 'Bank Job Prep', pay: 600, type: 'multi',
      desc: 'Pick up the crew: two stops across town.',
      targets: [{ x: -350, z: 500 }, { x: 1050, z: -500 }] },
    { name: 'Heat Wave', pay: 800, type: 'loseheat', startWanted: 3,
      desc: 'You are at 3 stars. Lay low until the heat fades.',
      target: null },
    { name: 'The Central Vault', pay: 1500, type: 'hold', holdTime: 20,
      desc: 'Hold the vault steps for 20 seconds, then escape.',
      target: { x: 0, z: -175 } }
  ];
  var missionMarker = null; // {mesh, beacon, x, z}
  var missionBeacon = null;

  function missionTarget() {
    var m = MISSIONS[S.mission];
    if (!m) return null;
    if (m.type === 'multi') return m.targets[S.missionStops];
    return m.target;
  }
  function placeMarker(x, z) {
    clearMarker();
    var g = new THREE.Group();
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    beam.position.y = 30; g.add(beam);
    var dia = new THREE.Mesh(new THREE.OctahedronGeometry(2.2),
      new THREE.MeshBasicMaterial({ color: 0xffd34d }));
    dia.position.y = 8; g.add(dia);
    var ring = new THREE.Mesh(new THREE.RingGeometry(3, 4.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; g.add(ring);
    g.position.set(x, 0, z);
    scene.add(g);
    missionMarker = { mesh: g, beacon: dia, x: x, z: z };
  }
  function clearMarker() {
    if (missionMarker) { scene.remove(missionMarker.mesh); missionMarker = null; }
  }
  function toggleMission() {
    if (!S.started || S.paused || S.wasted) return;
    if (S.mission >= MISSIONS.length) { banner('ALL MISSIONS DONE', 'Port Meridian is yours.'); return; }
    if (S.missionState === 'idle') startMission();
    else $('objective').textContent = 'Objective: ' + MISSIONS[S.mission].desc;
  }
  function startMission() {
    var m = MISSIONS[S.mission];
    S.missionState = 'active';
    S.missionTimer = m.timer || 0;
    S.missionHold = 0; S.missionStops = 0;
    if (m.type === 'loseheat') S.wanted = Math.max(S.wanted, m.startWanted), updateWantedHud();
    var t = missionTarget();
    if (t) placeMarker(t.x, t.z);
    $('objective').textContent = 'Mission ' + (S.mission + 1) + '/5 — ' + m.name + ': ' + m.desc;
    playBlip(880, 0.12);
  }
  function completeMission() {
    var m = MISSIONS[S.mission];
    S.cash += m.pay;
    banner('MISSION PASSED', m.name + ' — +$' + m.pay);
    // Hard rule 3 — save ordering: mission += 1 FIRST, then writeSave().
    S.mission += 1;
    writeSave();
    S.missionState = 'idle';
    clearMarker();
    $('objective').textContent = S.mission >= MISSIONS.length
      ? 'All missions complete. Free roam Port Meridian.'
      : 'Press M for mission ' + (S.mission + 1) + ': ' + MISSIONS[S.mission].name;
    updateCashHud();
    playBlip(990, 0.15); setTimeout(function () { playBlip(1320, 0.2); }, 160);
  }
  function failMission(reason) {
    banner('MISSION FAILED', reason);
    S.missionState = 'idle';
    clearMarker();
    $('objective').textContent = 'Press M to retry mission ' + (S.mission + 1) + ': ' + MISSIONS[S.mission].name;
  }
  function updateMissions(dt) {
    if (S.missionState !== 'active' || S.mission >= MISSIONS.length) return;
    var m = MISSIONS[S.mission];
    if (missionMarker) {
      missionMarker.beacon.rotation.y += dt * 2;
      missionMarker.beacon.position.y = 8 + Math.sin(S.time * 2) * 0.8;
    }
    if (m.timer) {
      S.missionTimer -= dt;
      if (S.missionTimer <= 0) { failMission('Out of time on ' + m.name + '.'); return; }
      $('objective').textContent = 'Mission ' + (S.mission + 1) + '/5 — ' + m.name + ': ' + m.desc +
        ' (' + Math.ceil(S.missionTimer) + 's)';
    }
    var t = missionTarget();
    if (m.type === 'hold' && t) {
      var d = Math.hypot(player.x - t.x, player.z - t.z);
      if (d < 14) {
        S.missionHold += dt;
        $('objective').textContent = 'Mission 5/5 — The Central Vault: hold the vault ' +
          Math.ceil(m.holdTime - S.missionHold) + 's…';
        if (S.missionHold >= m.holdTime) completeMission();
      } else {
        S.missionHold = Math.max(0, S.missionHold - dt * 0.5);
      }
      return;
    }
    if (m.type === 'loseheat') {
      if (S.wanted === 0) completeMission();
      return;
    }
    if (t) {
      var dd = Math.hypot(player.x - t.x, player.z - t.z);
      if (dd < 12) {
        if (m.type === 'multi') {
          S.missionStops++;
          playBlip(990, 0.1);
          var next = missionTarget();
          if (next) { placeMarker(next.x, next.z); $('objective').textContent = 'Mission 3/5 — Bank Job Prep: one more stop.'; }
          else completeMission();
        } else {
          if (m.needCar && !S.inCar) {
            $('objective').textContent = 'Mission 1/5 — First Wheels: you need a car for this one.';
            return;
          }
          completeMission();
        }
      }
    }
  }

  // ---------- HUD ----------
  var bannerUntil = 0;
  function banner(title, text) {
    $('bannerTitle').textContent = title;
    $('bannerText').textContent = text;
    $('banner').style.display = 'block';
    bannerUntil = S.time + 3.5;
  }
  function updateCashHud() { $('cash').textContent = '$' + S.cash.toLocaleString('en-US'); }
  function updateHealthHud() {
    var bar = $('healthBar');
    bar.style.width = S.health + '%';
    bar.style.background = S.health > 50 ? '#2ecc71' : (S.health > 25 ? '#f39c12' : '#e74c3c');
  }
  function togglePause() {
    if (!S.started || S.wasted) return;
    S.paused = !S.paused;
    $('pause').style.display = S.paused ? 'flex' : 'none';
  }

  // minimap: top-down canvas, roads + buildings + player + police + marker
  var mapCtx = $('minimap').getContext('2d');
  var mapTimer = 0;
  function drawMinimap() {
    var c = mapCtx, W = 200, H = 200;
    var sx = W / 3400, sz = H / 2600; // world -> map
    var mx = function (x) { return (x + 1700) * sx; };
    var mz = function (z) { return (z + 1300) * sz; };
    c.fillStyle = '#20242e'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#1d4e6b'; c.fillRect(0, mz(1200), W, H - mz(1200)); // water
    c.fillStyle = '#3d6b35'; c.fillRect(mx(city.parkPos.x - 160), mz(city.parkPos.z - 110), 320 * sx, 220 * sz); // park
    c.fillStyle = '#3a3f4a';
    city.buildings.forEach(function (b) {
      c.fillRect(mx(b.x - b.w / 2), mz(b.z - b.d / 2), Math.max(1, b.w * sx), Math.max(1, b.d * sz));
    });
    c.strokeStyle = '#6b7280'; c.lineWidth = 1;
    VCCity.AVENUES.forEach(function (x) { c.beginPath(); c.moveTo(mx(x), 0); c.lineTo(mx(x), H); c.stroke(); });
    VCCity.STREETS.forEach(function (z) { c.beginPath(); c.moveTo(0, mz(z)); c.lineTo(W, mz(z)); c.stroke(); });
    // traffic (white) and police (red/blue)
    c.fillStyle = '#ffffff';
    cars.forEach(function (car) {
      if (car.isTraffic) c.fillRect(mx(car.x) - 1, mz(car.z) - 1, 2, 2);
    });
    cars.forEach(function (car) {
      if (car.isPolice) {
        c.fillStyle = Math.floor(S.time * 4) % 2 ? '#ff2222' : '#2244ff';
        c.beginPath(); c.arc(mx(car.x), mz(car.z), 3, 0, 7); c.fill();
      }
    });
    if (heli) {
      c.fillStyle = '#ffdd55';
      c.beginPath(); c.arc(mx(heli.mesh.position.x), mz(heli.mesh.position.z), 3, 0, 7); c.fill();
    }
    // mission marker
    var t = S.missionState === 'active' ? missionTarget() : null;
    if (t) {
      c.fillStyle = '#ffd34d';
      c.save(); c.translate(mx(t.x), mz(t.z)); c.rotate(Math.PI / 4);
      c.fillRect(-4, -4, 8, 8); c.restore();
    }
    // player arrow
    c.save();
    c.translate(mx(player.x), mz(player.z));
    c.rotate(-player.heading + Math.PI);
    c.fillStyle = '#2ecc71';
    c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath(); c.fill();
    c.restore();
  }

  // ---------- radio: two synthesized stations (WebAudio, no assets) ----------
  var audioCtx = null, masterGain = null, radioOn = true, radioStation = 0, radioStep = 0, radioNextTime = 0;
  // 16-step patterns: [midi note, length in steps] per step, 0 = rest
  var STATIONS = [
    { name: 'VELVET FM', bpm: 112, wave: 'sawtooth', bass: [45, 0, 45, 0, 48, 0, 45, 0, 43, 0, 43, 0, 50, 0, 48, 0],
      lead: [69, 0, 72, 0, 76, 0, 72, 0, 74, 0, 76, 0, 79, 0, 76, 0] },
    { name: 'MERIDIAN 98.5', bpm: 100, wave: 'square', bass: [41, 41, 0, 41, 0, 44, 0, 41, 36, 0, 36, 0, 39, 0, 46, 0],
      lead: [65, 0, 0, 68, 0, 0, 70, 0, 0, 72, 0, 68, 0, 0, 65, 0] }
  ];
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function ensureAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = radioOn ? 0.16 : 0;
      masterGain.connect(audioCtx.destination);
      radioNextTime = audioCtx.currentTime + 0.1;
    } catch (e) { audioCtx = null; }
  }
  function playNote(freq, when, dur, type, vol) {
    if (!audioCtx || !radioOn) return;
    var o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g); g.connect(masterGain);
    o.start(when); o.stop(when + dur + 0.02);
  }
  function playBlip(freq, dur) {
    if (!audioCtx) return;
    playNote(freq, audioCtx.currentTime, dur || 0.1, 'sine', 0.25);
  }
  function radioTick() {
    if (!audioCtx || !radioOn) return;
    var st = STATIONS[radioStation];
    var stepDur = 60 / st.bpm / 4;
    while (radioNextTime < audioCtx.currentTime + 0.18) {
      var s = radioStep % 16;
      var b = st.bass[s], l = st.lead[s];
      if (b) playNote(midiToFreq(b), radioNextTime, stepDur * 1.8, st.wave, 0.5);
      if (l) playNote(midiToFreq(l), radioNextTime, stepDur * 1.4, 'triangle', 0.22);
      radioNextTime += stepDur;
      radioStep++;
    }
  }
  function radioNext() {
    if (!S.started) return;
    radioStation = (radioStation + 1) % STATIONS.length;
    $('radio').textContent = '♪ ' + STATIONS[radioStation].name;
  }
  function radioMuteToggle() {
    radioOn = !radioOn;
    if (masterGain) masterGain.gain.value = radioOn ? 0.16 : 0;
    $('radio').textContent = radioOn ? '♪ ' + STATIONS[radioStation].name : '♪ muted (N to unmute)';
  }

  // ---------- camera ----------
  var camTarget = new THREE.Vector3();
  function updateCamera(dt) {
    var focus = S.inCar && S.car ? S.car : player;
    var heading = S.inCar && S.car ? S.car.heading : player.heading;
    var moving = S.inCar ? Math.abs(S.speed) > 2 : player.walkSpeed > 0;
    if (moving && !dragging) {
      camYaw = angleLerp(camYaw, heading + Math.PI, Math.min(1, dt * 1.4));
    }
    var tx = focus.x, tz = focus.z;
    var dist = S.inCar ? camDist + 3 : camDist;
    var height = 4.5 + camPitch * 7;
    var cx = tx + Math.sin(camYaw) * dist;
    var cz = tz + Math.cos(camYaw) * dist;
    camTarget.set(tx, 1.6, tz);
    camera.position.x = lerp(camera.position.x, cx, Math.min(1, dt * 7));
    camera.position.y = lerp(camera.position.y, height, Math.min(1, dt * 7));
    camera.position.z = lerp(camera.position.z, cz, Math.min(1, dt * 7));
    camera.lookAt(camTarget);
    // moon shadow camera follows the player
    city.moon.position.set(player.x + 220, 320, player.z + 140);
    city.moon.target.position.set(player.x, 0, player.z);
    city.moon.target.updateMatrixWorld();
  }

  // ---------- start / continue ----------
  function startGame(load) {
    var save = load ? readSave() : null;
    if (save) { S.mission = save.mission; S.cash = save.cash; }
    else { S.mission = 0; S.cash = 0; writeSave(); }
    S.health = 100; S.wanted = 0; S.missionState = 'idle';
    S.started = true; S.paused = false;
    $('startScreen').style.display = 'none';
    $('hud').style.display = 'block';
    updateCashHud(); updateHealthHud(); updateWantedHud();
    $('objective').textContent = S.mission >= MISSIONS.length
      ? 'All missions complete. Free roam Port Meridian.'
      : 'Press M for mission ' + (S.mission + 1) + ': ' + MISSIONS[S.mission].name;
    $('radio').textContent = '♪ ' + STATIONS[radioStation].name;
    ensureAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  $('btnNew').addEventListener('click', function () { startGame(false); });
  $('btnContinue').addEventListener('click', function () { startGame(true); });
  (function initStartScreen() {
    var save = readSave();
    if (save && (save.mission > 0 || save.cash > 0)) {
      $('btnContinue').style.display = 'inline-block';
      $('saveInfo').textContent = save.mission >= 5
        ? 'Save found: all missions done, $' + save.cash
        : 'Save found: mission ' + (save.mission + 1) + '/5, $' + save.cash;
    }
  })();

  // ---------- screenshot presets (?shot=) ----------
  function applyShotPreset() {
    var q = new URLSearchParams(window.location.search);
    var shot = q.get('shot');
    if (!shot || shot === 'start') return;
    startGame(false);
    if (shot === 'drive') {
      var car = cars.find(function (c) { return c.parked; });
      if (car) {
        car.isPlayer = true; car.parked = false;
        S.inCar = true; S.car = car;
        player.mesh.visible = false;
        // downtown avenue 0, driving north past tall buildings
        car.x = 0; car.z = 300; car.heading = Math.PI; car.speed = 22;
        player.x = car.x; player.z = car.z; player.heading = car.heading;
        camYaw = 0; camDist = 11;
      }
    } else if (shot === 'chase') {
      var car2 = cars.find(function (c) { return c.parked; });
      if (car2) {
        car2.isPlayer = true; car2.parked = false;
        S.inCar = true; S.car = car2;
        player.mesh.visible = false;
        // downtown avenue 0, speeding north; police close in around the car
        car2.x = 0; car2.z = 100; car2.heading = Math.PI; car2.speed = 26;
        player.x = car2.x; player.z = car2.z; player.heading = car2.heading;
        camYaw = 0; camDist = 11; camPitch = 0.28;
      }
      S.wanted = 3; updateWantedHud();
      spawnPolice(); spawnPolice(); spawnPolice();
      policeCars.forEach(function (pc, i) {
        var spot = [[-14, 60], [14, 75], [18, 108]][i];
        pc.x = spot[0]; pc.z = spot[1]; pc.heading = Math.PI;
      });
    } else if (shot === 'mission') {
      S.mission = 4;
      var car3 = cars.find(function (c) { return c.parked; });
      if (car3) {
        car3.isPlayer = true; car3.parked = false;
        S.inCar = true; S.car = car3; S.speed = 0;
        player.mesh.visible = false;
        car3.x = 0; car3.z = -140; car3.heading = Math.PI;
        player.x = car3.x; player.z = car3.z; player.heading = car3.heading;
        // camera south of the car, looking north: the bank's base and
        // columns loom ahead and the vault marker is on the steps
        camYaw = 0; camPitch = 0.12;
      } else {
        player.x = 0; player.z = -140; player.heading = Math.PI;
      }
      S.wanted = 4; updateWantedHud();
      startMission();
      spawnPolice(); spawnPolice();
    }
  }

  // ---------- main loop ----------
  var lastT = performance.now();
  var fpsEma = 60;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    fpsEma = lerp(fpsEma, 1 / Math.max(dt, 0.001), 0.05);
    if (!S.paused) {
      S.time += dt;
      if (S.started && !S.wasted) {
        if (S.inCar) updatePlayerCar(dt); else updatePlayer(dt);
        updateTraffic(dt);
        updatePeds(dt);
        updatePolice(dt);
        updateWanted(dt);
        updateMissions(dt);
        radioTick();
      }
      if (S.wasted) {
        S.wastedTimer += dt;
        if (S.wastedTimer > 3) respawn();
      }
      // traffic lights cycle
      city.trafficLights.forEach(function (tl) {
        tl.timer += dt;
        var phase = Math.floor(tl.timer / 6) % 2 === 0;
        tl.red.material.color.setHex(phase ? 0xff2a22 : 0x441111);
        tl.green.material.color.setHex(phase ? 0x114411 : 0x22ff66);
      });
      if (bannerUntil && S.time > bannerUntil) { $('banner').style.display = 'none'; bannerUntil = 0; }
      if (tracer && S.time % 1 < 0.02) { /* tracer is removed by timeout */ }
      updateCamera(dt);
      // HUD readouts
      if (S.started) {
        $('speed').textContent = S.inCar ? Math.round(Math.abs(S.speed) * 3.6) + ' km/h' : '';
        mapTimer -= dt;
        if (mapTimer <= 0) { drawMinimap(); mapTimer = 0.15; }
      }
    }
    renderer.render(scene, camera);
  }

  // ---------- debug hooks for the playtest harness ----------
  window.VC = {
    version: 'r5-1', S: S, player: player, cars: cars, policeCars: policeCars,
    peds: peds, city: city, MISSIONS: MISSIONS,
    get fps() { return fpsEma; },
    get heli() { return heli; },
    startGame: startGame, startMission: startMission, completeMission: completeMission,
    addWanted: addWanted, damagePlayer: damagePlayer, tryEnterCar: tryEnterCar,
    get missionMarker() { return missionMarker; }
  };

  applyShotPreset();
  updateCashHud(); updateHealthHud(); updateWantedHud();
  requestAnimationFrame(loop);
})();
