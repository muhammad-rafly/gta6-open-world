// main.js — VELVET CITY: an original open-world crime game in Port Meridian.
// Three.js (vendored), static files only, keyboard + mouse, no network.
// Written fresh for the gta6-01 bounty. Systems: on-foot + driving, traffic
// with working red lights, pedestrians with visible daily activities,
// wanted level + police (cars, foot cops, helicopter), 5 missions, combat,
// blood, GTA-style HUD + minimap, procedural radio + sirens, save/continue.
(function (global) {
  'use strict';

  var THREE = global.THREE;
  var SAVE_KEY = 'velvet-city-save-v1';
  var RAM_DMG = 14;          // hard rule 2: ram damage
  var RAM_COOLDOWN = 2.5;    // hard rule 2: per-car ram cooldown (s)
  var CITY_SEED = 1337;

  // ---------------------------------------------------------------- state
  var S = {
    started: false, paused: false,
    cash: 0, mission: 0, health: 100, wanted: 0,
    time: 0, hiddenTime: 0, searching: false,
    station: 0, radioOn: true,
    bustedTimer: 0, pnsCooldown: 0, missionTimer: 0,
    kills: 0, carsStolen: 0, stagedCruise: false
  };

  function defaultSave() { return { cash: 0, mission: 0, health: 100 }; }
  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (typeof s.cash !== 'number' || typeof s.mission !== 'number') return null;
      return s;
    } catch (e) { return null; }
  }
  function writeSave() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: S.cash, mission: S.mission, health: S.health }));
    } catch (e) { /* storage unavailable (headless): ignore */ }
  }

  // ---------------------------------------------------------------- dom
  function $(id) { return document.getElementById(id); }
  var hud = {};
  ['missionBox', 'missionTitle', 'missionDesc', 'missionDist', 'cash', 'stars',
   'dicari', 'healthFill', 'healthNum', 'weapon', 'carHealth', 'minimap',
   'radioBanner', 'floatLayer', 'flash', 'wasted', 'busted', 'startScreen',
   'helpBox', 'toast', 'speedo', 'speedNum', 'dialog', 'dialogName', 'dialogText'].forEach(function (id) { hud[id] = $(id); });

  function updateCashHud() { hud.cash.textContent = '$' + S.cash; }
  function updateHealthHud() {
    hud.healthFill.style.width = Math.max(0, S.health) + '%';
    hud.healthFill.style.background = S.health > 50 ? '#3ecf5a' : S.health > 25 ? '#e8a020' : '#e04030';
    hud.healthNum.textContent = Math.max(0, Math.round(S.health)) + ' HP';
  }
  function updateStarsHud() {
    var s = '';
    for (var i = 0; i < 5; i++) s += i < S.wanted ? '★' : '☆';
    hud.stars.textContent = s;
    hud.stars.classList.toggle('blink', S.searching && S.wanted > 0);
    hud.dicari.style.display = (S.searching && S.wanted > 0) ? 'block' : 'none';
  }
  function floatText(txt, color) {
    var el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = txt;
    if (color) el.style.color = color;
    el.style.left = (42 + Math.random() * 16) + '%';
    hud.floatLayer.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1800);
  }
  function toast(msg, ms) {
    hud.toast.textContent = msg;
    hud.toast.style.opacity = '1';
    setTimeout(function () { hud.toast.style.opacity = '0'; }, ms || 2600);
  }
  function damageFlash() {
    hud.flash.style.opacity = '0.55';
    setTimeout(function () { hud.flash.style.opacity = '0'; }, 180);
  }

  // ---------------------------------------------------------------- boot
  var renderer, scene, camera, city, cityData;
  var clock = { last: 0 };
  var sunLight, hemiLight, headlight, headlightTarget;
  var trafficPhaseT = 0; // 16s cycle: <8 NS green, else EW green

  function trafficPhase() { return (trafficPhaseT % 16) < 8 ? 'NS' : 'EW'; }
  function setTrafficPhase(p) {
    trafficPhaseT = p === 'NS' ? 0 : 8;
    updateTrafficLights();
  }

  function init() {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputEncoding = THREE.sRGBEncoding;
    $('game').appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x6fb3e8);
    scene.fog = new THREE.Fog(0xb9d2ea, 400, 2000);

    camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 4000);
    camera.position.set(200, 60, 300);

    // Sky: gradient dome + sun disc.
    var skyGeo = new THREE.SphereGeometry(2600, 16, 12);
    var skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2a7de8) },
        mid: { value: new THREE.Color(0x8fd0f5) },
        bot: { value: new THREE.Color(0xffe0b0) }
      },
      vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;' +
        'void main(){ float h=normalize(vP).y; vec3 c = h>0.25 ? mix(mid,top,smoothstep(0.25,0.8,h)) : mix(bot,mid,smoothstep(-0.05,0.25,h)); gl_FragColor=vec4(c,1.0); }'
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));
    var sunDisc = new THREE.Mesh(new THREE.CircleGeometry(90, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe8b0, fog: false }));
    sunDisc.position.set(1500, 700, -2200);
    sunDisc.lookAt(camera.position);
    scene.add(sunDisc);

    // Bright daylight, kept calm so the ground reads sage, not white.
    // Whiter sun + cooler fog: the dark asphalt stays dark grey, never brown.
    hemiLight = new THREE.HemisphereLight(0xbfd8ff, 0x8a8a8a, 0.5);
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight(0xfff0d0, 1.15);
    sunLight.position.set(900, 700, -500);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    var sc = sunLight.shadow.camera;
    sc.left = -220; sc.right = 220; sc.top = 220; sc.bottom = -220;
    sc.near = 100; sc.far = 2600;
    sunLight.shadow.bias = -0.0006;
    scene.add(sunLight);
    scene.add(sunLight.target);

    city = VCWorld.buildCity(THREE, CITY_SEED);
    cityData = city.data;
    scene.add(city.group);

    buildPlayer();
    spawnParkedCars();
    spawnTrafficCars();
    spawnPedestrians();
    buildMissions();
    buildMinimapBase();
    drawMinimap(); // minimap must not be an empty black circle on the title screen
    initAudio();
    bindInput();
    updateCashHud(); updateHealthHud(); updateStarsHud();
    showStartScreen();
    animate(0);
  }

  // ---------------------------------------------------------------- input
  var keys = {};
  var mouse = { down: false, lx: 0, ly: 0, yawOff: 0, pitchOff: 0, zoom: 14 };
  function bindInput() {
    window.addEventListener('keydown', function (e) {
      keys[e.code] = true;
      S.stagedCruise = false; // input pemain asli membatalkan cruise
      if (e.code === 'Enter' && !S.started) startGame();
      if (e.code === 'KeyE') tryEnterExitCar();
      if (e.code === 'KeyF') punch();
      if (e.code === 'KeyR') cycleRadio();
      if (e.code === 'Space') { shoot(); e.preventDefault(); }
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('mousedown', function (e) {
      mouse.down = true; mouse.lx = e.clientX; mouse.ly = e.clientY;
      if (S.started && !S.paused) shoot();
    });
    window.addEventListener('mouseup', function () { mouse.down = false; });
    window.addEventListener('mousemove', function (e) {
      if (!mouse.down) return;
      mouse.yawOff -= (e.clientX - mouse.lx) * 0.005;
      mouse.pitchOff = Math.max(-0.3, Math.min(0.5, mouse.pitchOff + (e.clientY - mouse.ly) * 0.003));
      mouse.lx = e.clientX; mouse.ly = e.clientY;
    });
    window.addEventListener('wheel', function (e) {
      mouse.zoom = Math.max(8, Math.min(26, mouse.zoom + (e.deltaY > 0 ? 1.5 : -1.5)));
    });
    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // ---------------------------------------------------------------- audio
  // All sound is procedural WebAudio: two radio stations, sirens, engine.
  var AC = null, masterGain, radioGain, sirenOscA, sirenOscB, sirenGain, engineOsc, engineGain;
  var radioTimer = null, radioStep = 0;
  var STATIONS = [
    { name: 'VELVET FM', bpm: 92, root: 220, minor: true },
    { name: 'MERIDIAN BEATS', bpm: 122, root: 196, minor: false }
  ];
  function initAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      AC = new Ctx();
      masterGain = AC.createGain(); masterGain.gain.value = 0.5;
      masterGain.connect(AC.destination);
      radioGain = AC.createGain(); radioGain.gain.value = 0.16;
      radioGain.connect(masterGain);
      sirenGain = AC.createGain(); sirenGain.gain.value = 0;
      sirenGain.connect(masterGain);
      sirenOscA = AC.createOscillator(); sirenOscA.type = 'sine'; sirenOscA.frequency.value = 700;
      sirenOscB = AC.createOscillator(); sirenOscB.type = 'sine'; sirenOscB.frequency.value = 950;
      var sgA = AC.createGain(); sgA.gain.value = 0.5;
      var sgB = AC.createGain(); sgB.gain.value = 0.5;
      sirenOscA.connect(sgA); sgA.connect(sirenGain);
      sirenOscB.connect(sgB); sgB.connect(sirenGain);
      sirenOscA.start(); sirenOscB.start();
      engineOsc = AC.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 55;
      engineGain = AC.createGain(); engineGain.gain.value = 0;
      var ef = AC.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 320;
      engineOsc.connect(ef); ef.connect(engineGain); engineGain.connect(masterGain);
      engineOsc.start();
      scheduleRadio();
    } catch (e) { AC = null; }
  }
  function noteFreq(root, semis) { return root * Math.pow(2, semis / 12); }
  function playTone(freq, when, dur, type, gain) {
    var o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain || 0.2, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g); g.connect(radioGain);
    o.start(when); o.stop(when + dur + 0.05);
  }
  function scheduleRadio() {
    if (!AC) return;
    radioStep = 0;
    var st = STATIONS[S.station];
    var stepDur = 60 / st.bpm / 2; // 8th notes
    // Chord roots for a 4-bar loop (semitones from station root).
    var chords = st.minor ? [0, -4, -7, -2] : [0, 5, 7, 3];
    var bassNotes = [0, 0, 7, 5];
    function tick() {
      if (!AC) return;
      var bar = Math.floor(radioStep / 8) % 4;
      var beat = radioStep % 8;
      var now = AC.currentTime + 0.05;
      var chordRoot = noteFreq(st.root, chords[bar]);
      if (beat === 0) {
        // pad chord (3 notes, long)
        [0, st.minor ? 3 : 4, 7].forEach(function (iv) {
          playTone(noteFreq(chordRoot, iv), now, stepDur * 7, 'triangle', 0.10);
        });
      }
      if (st.minor) {
        if (beat % 2 === 0) playTone(noteFreq(st.root / 2, bassNotes[bar]), now, stepDur * 1.8, 'sine', 0.22);
        if (beat === 4) playTone(noteFreq(chordRoot, 12), now, stepDur, 'sine', 0.08);
      } else {
        playTone(noteFreq(st.root / 2, bassNotes[bar]), now, stepDur * 0.9, 'square', 0.14);
        if (beat % 2 === 1) playTone(noteFreq(st.root * 2, 0), now, stepDur * 0.4, 'sine', 0.05);
      }
      radioStep++;
      radioTimer = setTimeout(tick, stepDur * 1000);
    }
    if (radioTimer) clearTimeout(radioTimer);
    tick();
  }
  function cycleRadio() {
    S.station = (S.station + 1) % STATIONS.length;
    scheduleRadio();
    showRadioBanner();
  }
  function showRadioBanner() {
    hud.radioBanner.textContent = '♪ ' + STATIONS[S.station].name;
    hud.radioBanner.style.opacity = '1';
    setTimeout(function () { hud.radioBanner.style.opacity = '0'; }, 3000);
  }

  // ---------------------------------------------------------------- start
  function showStartScreen() {
    hud.startScreen.style.display = 'flex';
    var save = loadSave();
    var btn = $('continueBtn');
    if (save && (save.mission > 0 || save.cash > 0)) {
      btn.style.display = 'inline-block';
      btn.textContent = 'CONTINUE — Mission ' + (save.mission + 1) + ' · $' + save.cash;
    } else {
      btn.style.display = 'none';
    }
  }
  function startGame(fromSave) {
    if (fromSave) {
      var save = loadSave();
      if (save) { S.cash = save.cash; S.mission = save.mission; S.health = save.health; }
    }
    S.started = true;
    hud.startScreen.style.display = 'none';
    hud.dialog.style.display = 'block';
    mouse.yawOff = 0; mouse.pitchOff = 0;
    hud.helpBox.style.display = 'block';
    setTimeout(function () { hud.helpBox.style.display = 'none'; }, 9000);
    updateCashHud(); updateHealthHud(); updateStarsHud(); updateMissionHud();
    showRadioBanner();
    if (AC && AC.state === 'suspended') AC.resume();
    toast('Welcome to Port Meridian. Mission 1: First Wheels.');
  }
  $('startBtn').addEventListener('click', function () { startGame(false); });
  $('continueBtn').addEventListener('click', function () { startGame(true); });

  // ---------------------------------------------------------------- player
  var player = null; // {group, parts, x, z, angle, speed, inCar, car}
  var PLAYER_SPEED_WALK = 6, PLAYER_SPEED_RUN = 10;

  function makePersonMesh(opts) {
    // Articulated low-poly person: torso, head (+hair/hat), arms, legs.
    // opts: shirt, skin, hair, hat (color or null), scale.
    var g = new THREE.Group();
    var scale = (opts && opts.scale) || 1;
    var shirt = new THREE.MeshStandardMaterial({ color: (opts && opts.shirt) || 0x3a6ab8, roughness: 0.9 });
    var skin = new THREE.MeshStandardMaterial({ color: (opts && opts.skin) || 0xc89878, roughness: 0.8 });
    var pants = new THREE.MeshStandardMaterial({ color: (opts && opts.pants) || 0x2a2e36, roughness: 0.9 });
    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.95, 0.45), shirt);
    torso.position.y = 1.35;
    torso.castShadow = true;
    g.add(torso);
    var head = new THREE.Group();
    head.position.y = 2.05;
    var skull = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
    skull.castShadow = true;
    head.add(skull);
    var hairMat = new THREE.MeshStandardMaterial({ color: (opts && opts.hair) || 0x2a2018, roughness: 1 });
    var hair = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.2, 0.54), hairMat);
    hair.position.y = 0.3;
    head.add(hair);
    if (opts && opts.hat) {
      var hat = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.14, 10),
        new THREE.MeshStandardMaterial({ color: opts.hat, roughness: 0.9 }));
      hat.position.y = 0.38;
      head.add(hat);
    }
    g.add(head);
    function limb(w, h, d, mat, x, y) {
      var pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.y = -h / 2;
      m.castShadow = true;
      pivot.add(m);
      g.add(pivot);
      return pivot;
    }
    var armL = limb(0.26, 0.85, 0.26, shirt, -0.58, 1.78);
    var armR = limb(0.26, 0.85, 0.26, shirt, 0.58, 1.78);
    var legL = limb(0.32, 0.9, 0.32, pants, -0.22, 0.9);
    var legR = limb(0.32, 0.9, 0.32, pants, 0.22, 0.9);
    g.scale.setScalar(scale);
    return { group: g, head: head, torso: torso, armL: armL, armR: armR, legL: legL, legR: legR };
  }

  function buildPlayer() {
    var parts = makePersonMesh({ shirt: 0x2a7ab8, skin: 0xc89878, hair: 0x1a1410, scale: 1 });
    player = {
      parts: parts, group: parts.group, x: 175, z: -60, angle: Math.PI,
      speed: 0, inCar: false, car: null, walkPhase: 0, health: 100
    };
    scene.add(parts.group);
  }

  function collideBuildings(x, z, r) {
    for (var i = 0; i < cityData.colliders.length; i++) {
      var c = cityData.colliders[i];
      if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return c;
    }
    return null;
  }
  function clampCity(x, z) {
    return {
      x: Math.max(cityData.bounds.x0 + 20, Math.min(cityData.bounds.x1 - 20, x)),
      z: Math.max(cityData.bounds.z0 + 20, Math.min(cityData.bounds.z1 - 20, z))
    };
  }

  function updatePlayer(dt) {
    if (player.inCar || !S.started) return;
    var run = keys['ShiftLeft'] || keys['ShiftRight'];
    var sp = run ? PLAYER_SPEED_RUN : PLAYER_SPEED_WALK;
    var fx = 0, fz = 0;
    if (keys['KeyW'] || keys['ArrowUp']) fz -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) fz += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) fx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) fx += 1;
    var moving = fx !== 0 || fz !== 0;
    if (moving) {
      var len = Math.sqrt(fx * fx + fz * fz);
      fx /= len; fz /= len;
      // movement relative to camera yaw
      var cy = cameraYaw();
      var wx = fx * Math.cos(cy) - fz * Math.sin(cy);
      var wz = fx * Math.sin(cy) + fz * Math.cos(cy);
      var nx = player.x + wx * sp * dt, nz = player.z + wz * sp * dt;
      var hit = collideBuildings(nx, nz, 0.7);
      if (!hit) { player.x = nx; player.z = nz; }
      else {
        if (!collideBuildings(nx, player.z, 0.7)) player.x = nx;
        else if (!collideBuildings(player.x, nz, 0.7)) player.z = nz;
      }
      var cl = clampCity(player.x, player.z);
      player.x = cl.x; player.z = cl.z;
      player.angle = Math.atan2(wx, wz);
      player.walkPhase += dt * (run ? 11 : 7);
      player.speed = sp;
    } else {
      player.speed = 0;
      player.walkPhase += dt * 1.2;
    }
    // limb swing (visible when walking/running)
    var sw = moving ? Math.sin(player.walkPhase) * (run ? 0.75 : 0.55) : 0;
    player.parts.legL.rotation.x = sw;
    player.parts.legR.rotation.x = -sw;
    player.parts.armL.rotation.x = -sw * 0.8;
    player.parts.armR.rotation.x = sw * 0.8;
    player.group.position.set(player.x, 0, player.z);
    player.group.rotation.y = player.angle;
  }

  function cameraYaw() {
    // yaw of the chase camera (player facing away from camera)
    var dx = player.x - camera.position.x, dz = player.z - camera.position.z;
    return Math.atan2(dx, dz);
  }

  // ---------------------------------------------------------------- cars
  var CAR_TYPES = {
    sedan: { top: 40, accel: 30, turn: 1.9, color: 0xc0c8d0, name: 'Sedan' },
    taxi: { top: 40, accel: 30, turn: 2.1, color: 0xe8c020, name: 'Taxi' },
    van: { top: 30, accel: 18, turn: 1.35, color: 0x7a8a9a, name: 'Van' },
    police: { top: 34, accel: 30, turn: 2.0, color: 0xf0f0f0, name: 'Police' }
  };
  // Vibrant traffic palette (sedan/van only; taxis stay yellow, police white).
  var CAR_COLORS = [0xe83a1e, 0xff8a1e, 0xffd23a, 0x2a9ad0, 0x20b090, 0xe8e8e8, 0x8a5ac0, 0x30c060];
  var carColorRng = VCRng.makeRng(CITY_SEED + 41);
  var cars = [];        // all cars (parked + traffic + police)
  var trafficCars = [];
  var policeCars = [];
  var parkedCars = [];

  function taxiSignTexture() {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 48;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#e8c020'; ctx.fillRect(0, 0, 128, 48);
    ctx.fillStyle = '#111'; ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('TAXI', 64, 26);
    var t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  var TAXI_TEX = null;

  function makeCarMesh(type) {
    var def = CAR_TYPES[type];
    var g = new THREE.Group();
    var bodyMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.35, metalness: 0.55 });
    bodyMat.envMapIntensity = 0.6;
    var isVan = type === 'van';
    var bodyH = isVan ? 1.15 : 0.75;
    var bodyTop = 0.245 + bodyH;
    var body = new THREE.Mesh(new THREE.BoxGeometry(2.1, bodyH, 4.6), bodyMat);
    body.position.y = 0.245 + bodyH / 2;
    body.castShadow = true;
    g.add(body);
    // hood + trunk panels: the car reads as a car from behind, not a slab
    var hood = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 1.3), bodyMat);
    hood.position.set(0, bodyTop + 0.05, 1.55);
    g.add(hood);
    var trunk = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 1.1), bodyMat);
    trunk.position.set(0, bodyTop + 0.05, -1.65);
    g.add(trunk);
    // glass cabin + body-coloured roof + sloped windshield / rear window
    var glassMat = new THREE.MeshStandardMaterial({ color: 0x18242e, roughness: 0.4, metalness: 0.25 });
    glassMat.envMapIntensity = 0.3;
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.0), glassMat);
    cabin.position.set(0, bodyTop + 0.3, -0.2);
    cabin.castShadow = true;
    g.add(cabin);
    var roof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.1, 1.5), bodyMat);
    roof.position.set(0, bodyTop + 0.65, -0.2);
    g.add(roof);
    var shield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.95), glassMat);
    shield.rotation.x = 0.45; // front edge down, top edge at the roof
    shield.position.set(0, bodyTop + 0.38, 0.85);
    g.add(shield);
    var rearWin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.95), glassMat);
    rearWin.rotation.x = -0.45;
    rearWin.position.set(0, bodyTop + 0.38, -1.25);
    g.add(rearWin);
    // license plate (rear)
    var plate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xf0f0e8 }));
    plate.position.set(0, 0.55, -2.33);
    g.add(plate);
    // grille + bumper
    var grille = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.4, metalness: 0.6 }));
    grille.position.set(0, 0.55, 2.32);
    g.add(grille);
    var bumper = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.3, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.4, metalness: 0.7 }));
    bumper.position.set(0, 0.32, 2.32);
    g.add(bumper);
    var bumperR = bumper.clone();
    bumperR.position.z = -2.32;
    g.add(bumperR);
    // headlights (lit) + taillights (bigger, they sell the car from behind)
    var hlMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    [-0.7, 0.7].forEach(function (x) {
      var hl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.1), hlMat);
      hl.position.set(x, 0.68, 2.32);
      g.add(hl);
      var tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.1),
        new THREE.MeshBasicMaterial({ color: 0xff2a20 }));
      tl.position.set(x, 0.68, -2.32);
      g.add(tl);
    });
    // wheels (spin when driving) + hubcaps
    var wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 12);
    var wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
    var hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.36, 10);
    var hubMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.4, metalness: 0.6 });
    var wheels = [];
    [[-1.0, 1.5], [1.0, 1.5], [-1.0, -1.5], [1.0, -1.5]].forEach(function (p) {
      var w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(p[0], 0.42, p[1]);
      w.castShadow = true;
      var hub = new THREE.Mesh(hubGeo, hubMat);
      w.add(hub); // child of the wheel: coaxial, spins with it
      g.add(w);
      wheels.push(w);
    });
    if (type === 'taxi') {
      if (!TAXI_TEX) TAXI_TEX = taxiSignTexture();
      var sign = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.34, 0.5),
        new THREE.MeshBasicMaterial({ map: TAXI_TEX }));
      sign.position.set(0, 1.78, -0.25);
      g.add(sign);
    }
    var extras = { bodyMat: bodyMat };
    if (type === 'police') {
      // black-white livery: black hood + trunk panels (sit on the hood/trunk decks)
      var blackMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.35, metalness: 0.5 });
      var pHood = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.1, 1.1), blackMat);
      pHood.position.set(0, 1.12, 1.6);
      g.add(pHood);
      var pTrunk = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.1, 1.0), blackMat);
      pTrunk.position.set(0, 1.12, -1.7);
      g.add(pTrunk);
      // light bar: red + blue, alternating (animated in update)
      var barBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.22, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 }));
      barBase.position.set(0, 1.72, -0.25);
      g.add(barBase);
      var redMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
      var blueMat = new THREE.MeshBasicMaterial({ color: 0x2040ff });
      var red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.45), redMat);
      red.position.set(-0.32, 1.86, -0.25);
      g.add(red);
      var blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.45), blueMat);
      blue.position.set(0.32, 1.86, -0.25);
      g.add(blue);
      extras.redMat = redMat; extras.blueMat = blueMat;
      // red/blue point lights + ground glow (kept tight so the road stays dark)
      extras.sirenLight = new THREE.PointLight(0xff2020, 0, 18);
      extras.sirenLight.position.set(0, 2.2, 0);
      g.add(extras.sirenLight);
      var glow = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20),
        new THREE.MeshBasicMaterial({ color: 0xff3040, transparent: true, opacity: 0.10 }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.06;
      g.add(glow);
      extras.glowMat = glow.material;
    }
    return { group: g, wheels: wheels, extras: extras };
  }

  function makeCar(type, x, z, angle) {
    var mesh = makeCarMesh(type);
    // colourful traffic: sedan/van get a palette colour (deterministic order)
    if (type === 'sedan' || type === 'van') {
      mesh.extras.bodyMat.color.setHex(carColorRng.pick(CAR_COLORS));
    }
    mesh.group.position.set(x, 0, z);
    mesh.group.rotation.y = angle;
    scene.add(mesh.group);
    var car = {
      mesh: mesh, type: type, x: x, z: z, angle: angle,
      speed: 0, carHealth: 100, ramCooldown: 0,
      isTraffic: false, isPolice: false, isParked: false,
      road: null, dir: 1, lane: 3.5, smoke: null
    };
    cars.push(car);
    return car;
  }

  function spawnParkedCars() {
    var rng = VCRng.makeRng(CITY_SEED + 5);
    var spots = [];
    // parked along the central avenues, on the shoulder lane; one right by the
    // spawn plaza (185,-90) so the first car is a 30-second walk, not a hike.
    // (200,150) must stay: the playtest's Pay 'n Spray run uses that car.
    [[200, -350], [200, 150], [-200, -150], [-200, 350], [185, -90], [600, 450],
     [-600, 250], [-600, -450], [1000, -100], [-1000, 100]].forEach(function (p) { spots.push(p); });
    var types = ['sedan', 'sedan', 'taxi', 'van', 'sedan', 'taxi', 'van', 'sedan', 'van', 'taxi'];
    spots.forEach(function (p, i) {
      var car = makeCar(types[i], p[0] + rng.range(-1, 1), p[1], rng.chance(0.5) ? 0 : Math.PI);
      car.isParked = true;
      parkedCars.push(car);
    });
    // the player's first car: bright red-orange, the visual anchor of the game
    parkedCars[0].mesh.extras.bodyMat.color.setHex(0xe83a1e);
  }

  function spawnTrafficCars() {
    var rng = VCRng.makeRng(CITY_SEED + 9);
    var types = ['sedan', 'sedan', 'taxi', 'van', 'sedan', 'taxi', 'sedan', 'van',
      'taxi', 'sedan', 'sedan', 'taxi', 'van', 'sedan', 'taxi', 'van', 'sedan', 'taxi', 'sedan', 'van'];
    for (var i = 0; i < 20; i++) {
      var alongX = rng.chance(0.5);
      var car;
      if (alongX) {
        var z = rng.pick(cityData.streets);
        var x = rng.range(-1400, 1400);
        car = makeCar(types[i], x, z + (rng.chance(0.5) ? 3.5 : -3.5), rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2);
        car.road = { kind: 'street', at: z };
      } else {
        var x2 = rng.pick(cityData.avenues);
        var z2 = rng.range(-1000, 1000);
        car = makeCar(types[i], x2 + (rng.chance(0.5) ? 3.5 : -3.5), z2, rng.chance(0.5) ? 0 : Math.PI);
        car.road = { kind: 'avenue', at: x2 };
      }
      car.isTraffic = true;
      car.speed = rng.range(7, 12);
      car.dir = 1;
      trafficCars.push(car);
    }
  }

  // Traffic light state for a road axis at the current phase.
  function lightIsGreen(axis) { return trafficPhase() === axis; }

  // Distance from (x,z) to the next intersection centre along a heading.
  function nextIntersection(x, z, alongX, dir) {
    var list = alongX ? cityData.avenues : cityData.streets;
    var pos = alongX ? x : z;
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var d = (list[i] - pos) * dir;
      if (d > 2 && (best === null || d < best)) best = d;
    }
    return best; // units to the intersection centre, or null
  }

  function updateTrafficCar(car, dt) {
    var def = CAR_TYPES[car.type];
    var alongX = car.road.kind === 'street';
    var axis = alongX ? 'EW' : 'NS';
    // Where am I heading? angle 0/+PI = along Z (avenue), +/-PI/2 = along X (street).
    var dirSign = alongX ? (Math.abs(car.angle - Math.PI / 2) < 0.1 ? 1 : -1)
      : (Math.abs(car.angle) < 0.1 ? 1 : -1);
    var distToIx = nextIntersection(car.x, car.z, alongX, dirSign);
    var target = rngCruise(car);
    // Red light: slow down and STOP at the stop line (15u before centre).
    if (distToIx !== null && !lightIsGreen(axis) && distToIx < 45) {
      var stopAt = distToIx - 15;
      if (stopAt <= 0.5) target = 0;
      else target = Math.min(target, Math.max(0, stopAt * 0.35));
    }
    // Car ahead: don't rear-end it.
    for (var i = 0; i < trafficCars.length; i++) {
      var o = trafficCars[i];
      if (o === car || o.road.kind !== car.road.kind) continue;
      var dx = o.x - car.x, dz = o.z - car.z;
      var ahead = alongX ? dx * dirSign : dz * dirSign;
      var lateral = alongX ? Math.abs(dz) : Math.abs(dx);
      if (ahead > 0 && ahead < 12 && lateral < 4) target = Math.min(target, o.speed * 0.8);
    }
    car.speed += (target - car.speed) * Math.min(1, dt * 1.5);
    if (car.speed < 0.05) car.speed = 0;
    var step = car.speed * dt;
    if (alongX) car.x += dirSign * step; else car.z += dirSign * step;
    // Reached the end of the road: turn onto a perpendicular road.
    var end = alongX ? 1550 : 1150;
    var pos = alongX ? car.x : car.z;
    if (Math.abs(pos) > end) {
      if (alongX) {
        car.road = { kind: 'avenue', at: nearestRoad(car.x, cityData.avenues) };
        car.z = car.road.at + (Math.random() < 0.5 ? 3.5 : -3.5);
        car.angle = dirSign > 0 ? 0 : Math.PI;
        car.x = Math.max(-1400, Math.min(1400, car.x));
      } else {
        car.road = { kind: 'street', at: nearestRoad(car.z, cityData.streets) };
        car.x = car.road.at + (Math.random() < 0.5 ? 3.5 : -3.5);
        car.angle = dirSign > 0 ? Math.PI / 2 : -Math.PI / 2;
        car.z = Math.max(-1000, Math.min(1000, car.z));
      }
    }
    car.mesh.group.position.set(car.x, 0, car.z);
    car.mesh.group.rotation.y = car.angle;
    spinWheels(car, dt);
    // smoke when badly damaged
    if (car.carHealth < 40 && !car.smoke) {
      car.smoke = makeSmoke(car);
    }
  }
  function rngCruise(car) { return 9 + (car.type === 'van' ? -2 : car.type === 'taxi' ? 2 : 0); }
  function nearestRoad(v, list) {
    var best = list[0], bd = 1e9;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(list[i] - v);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return best;
  }
  function spinWheels(car, dt) {
    var rot = car.speed * dt / 0.42;
    car.mesh.wheels.forEach(function (w) { w.rotation.x += rot; });
  }

  function makeSmoke(car) {
    var mat = new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.5 });
    var puff = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), mat);
    puff.position.set(0, 1.6, 1.8);
    car.mesh.group.add(puff);
    return puff;
  }

  // ---------------------------------------------------------------- police
  var footCops = [];
  var heli = null;
  var heliOrbit = { r: 48, h: 28 }; // orbit radius/height (debug can tighten it for a shot)
  var sirenOn = false;

  function spawnPoliceCar() {
    var rng = VCRng.makeRng(CITY_SEED + 31 + policeCars.length * 7);
    var x = player.x + rng.range(-160, 160), z = player.z + rng.range(-160, 160);
    var car = makeCar('police', x, z, 0);
    car.isPolice = true;
    car.speed = 0;
    policeCars.push(car);
    return car;
  }
  function spawnFootCop() {
    var parts = makePersonMesh({ shirt: 0x1a2a4a, skin: 0xc89878, hair: 0x1a1410, hat: 0x1a2a4a });
    var cop = {
      parts: parts, group: parts.group,
      x: player.x + (Math.random() < 0.5 ? -30 : 30), z: player.z + (Math.random() < 0.5 ? -30 : 30),
      angle: 0, speed: 0, phase: Math.random() * 6
    };
    scene.add(parts.group);
    footCops.push(cop);
    return cop;
  }
  function spawnHeli() {
    if (heli) return;
    var g = new THREE.Group();
    var whiteMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, metalness: 0.3 });
    var blueMat = new THREE.MeshStandardMaterial({ color: 0x2a4a8a, roughness: 0.4, metalness: 0.3 });
    var glassMat = new THREE.MeshStandardMaterial({ color: 0x18242e, roughness: 0.35, metalness: 0.25 });
    var darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
    // badan ramping: putih + garis perut biru (polisi) — kontras dengan langit
    var body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 4.2), whiteMat);
    body.castShadow = true;
    g.add(body);
    var belly = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.35, 4.3), blueMat);
    belly.position.y = -0.55;
    g.add(belly);
    // kabin kaca GELAP di hidung (miring) + jendela samping
    var nose = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 1.2), glassMat);
    nose.position.set(0, 0.15, 2.0);
    nose.rotation.x = -0.25;
    g.add(nose);
    [-1.22, 1.22].forEach(function (x) {
      var win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 1.4), glassMat);
      win.position.set(x, 0.25, 0.6);
      g.add(win);
    });
    // ekor panjang + sirip vertikal + ROTOR EKOR (2 bilah menyilang)
    var boom = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 4.5), whiteMat);
    boom.position.set(0, 0.25, -4.2);
    g.add(boom);
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 1.0), blueMat);
    fin.position.set(0, 0.8, -6.2);
    g.add(fin);
    var tailRotor = new THREE.Group();
    tailRotor.position.set(0.35, 0.5, -6.4);
    [0, Math.PI / 2].forEach(function (a) {
      var b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.7, 0.12), darkMat);
      b.rotation.z = a;
      tailRotor.add(b);
    });
    g.add(tailRotor);
    // rotor utama: 2 bilah jelas di atas tiang (berputar)
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.7, 8), darkMat);
    mast.position.y = 0.95;
    g.add(mast);
    var rotor = new THREE.Group();
    rotor.position.y = 1.35;
    [0, Math.PI / 2].forEach(function (a) {
      var blade = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.55), darkMat);
      blade.rotation.y = a;
      rotor.add(blade);
    });
    g.add(rotor);
    // SKID pendaratan: dua tabung di bawah badan (ciri khas helikopter)
    [-0.95, 0.95].forEach(function (x) {
      var skid = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.6, 6), darkMat);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(x, -1.05, 0.3);
      g.add(skid);
      [-1.1, 1.1].forEach(function (z) {
        var strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), darkMat);
        strut.position.set(x, -0.8, z);
        g.add(strut);
      });
    });
    // lampu sorot: bola lampu terang di hidung + beam + kolam cahaya (lebih jelas)
    var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff6c0 }));
    lamp.position.set(0, -0.75, 1.6);
    g.add(lamp);
    var beam = new THREE.SpotLight(0xfff2c0, 2.2, 120, 0.28, 0.4, 1);
    beam.position.set(0, -0.8, 1);
    g.add(beam);
    var beamTarget = new THREE.Object3D();
    beamTarget.position.set(0, -60, 0);
    g.add(beamTarget);
    beam.target = beamTarget;
    var disc = new THREE.Mesh(new THREE.CircleGeometry(7, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.20 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -55;
    g.add(disc);
    scene.add(g);
    heli = { group: g, rotor: rotor, tailRotor: tailRotor, beam: beam, disc: disc, angle: 0 };
  }

  // HARD RULE 1: police ease-in — full speed beyond 40u, 2 m/s inside 6u,
  // ramping linearly between.
  function policeEaseSpeed(dist, full) {
    if (dist > 40) return full;
    if (dist < 6) return 2;
    return 2 + (full - 2) * (dist - 6) / (40 - 6);
  }

  function nearestPoliceDist() {
    var nearest = 1e9;
    policeCars.forEach(function (c) {
      var d = Math.hypot(player.x - c.x, player.z - c.z);
      if (d < nearest) nearest = d;
    });
    footCops.forEach(function (c) {
      var d = Math.hypot(player.x - c.x, player.z - c.z);
      if (d < nearest) nearest = d;
    });
    return nearest;
  }

  function updatePolice(dt) {
    var want = S.wanted;
    // Engagement: police respond while they can see the player. Once every
    // unit has lost the player (>400u), they disengage and stop spawning —
    // that is what lets the wanted level decay after 8s+ hidden.
    var nearest = nearestPoliceDist();
    if (nearest < 150) S.policeEngaged = true;
    if (want === 0) {
      // stand down: clear every unit
      policeCars.forEach(function (c) { scene.remove(c.mesh.group); });
      policeCars.length = 0;
      cars = cars.filter(function (c) { return !c.isPolice; });
      footCops.forEach(function (c) { scene.remove(c.group); });
      footCops.length = 0;
      if (heli) { scene.remove(heli.group); heli = null; }
      S.policeEngaged = false;
    } else if (S.policeEngaged) {
      // keep the right number of units out
      var wantCars = want >= 2 ? Math.min(3, want - 1) : 0;
      while (policeCars.length < wantCars) spawnPoliceCar();
      while (footCops.length < (want >= 1 ? Math.min(3, want) : 0)) spawnFootCop();
      if (want >= 4) spawnHeli();
    }
    if (want < 4 && heli) { scene.remove(heli.group); heli = null; }

    // police cars chase the player while close; beyond 200u they drive to
    // the last seen position and search there; beyond 400u they give up.
    for (var pi = policeCars.length - 1; pi >= 0; pi--) {
      var car = policeCars[pi];
      var dx = player.x - car.x, dz = player.z - car.z;
      var dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
      if (dist > 400) {
        scene.remove(car.mesh.group);
        policeCars.splice(pi, 1);
        cars.splice(cars.indexOf(car), 1);
        continue;
      }
      var tx, tz;
      if (dist < 10 && player.inCar && player.car) {
        // close in: take a flanking slot beside the suspect (never overlap it)
        var slot = policeCars.indexOf(car) % 3;
        var pa = player.car.angle;
        var fx = Math.sin(pa), fz = Math.cos(pa);
        var lx = -Math.cos(pa), lz = Math.sin(pa); // left of the car
        var offs = [[-8, 5], [8, 5], [-8, -6]][slot];
        tx = player.x + lx * offs[0] + fx * offs[1];
        tz = player.z + lz * offs[0] + fz * offs[1];
        car.lastSeen = { x: player.x, z: player.z };
      } else if (dist < 200) {
        tx = player.x; tz = player.z;
        car.lastSeen = { x: player.x, z: player.z };
      } else if (car.lastSeen) {
        tx = car.lastSeen.x; tz = car.lastSeen.z;
      } else {
        tx = player.x; tz = player.z;
      }
      var tdx = tx - car.x, tdz = tz - car.z;
      var tdist = Math.sqrt(tdx * tdx + tdz * tdz) || 0.01;
      var full = CAR_TYPES.police.top;
      var target;
      if (dist >= 200 && tdist < 10) target = 0; // arrived at last seen: search
      else if (dist < 10 && player.inCar && tdist < 2) target = 0; // holding the flank
      else target = policeEaseSpeed(dist < 200 ? dist : tdist, full) * (dist < 200 ? 1 : 0.6);
      car.speed += (target - car.speed) * Math.min(1, dt * 1.2);
      var wantAngle = Math.atan2(tdx, tdz);
      var da = wantAngle - car.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      car.angle += Math.max(-CAR_TYPES.police.turn * dt, Math.min(CAR_TYPES.police.turn * dt, da));
      car.x += Math.sin(car.angle) * car.speed * dt;
      car.z += Math.cos(car.angle) * car.speed * dt;
      var cl = clampCity(car.x, car.z);
      car.x = cl.x; car.z = cl.z;
      car.mesh.group.position.set(car.x, 0, car.z);
      car.mesh.group.rotation.y = car.angle;
      spinWheels(car, dt);
      // siren light bar: alternate red/blue
      var on = Math.floor(S.time * 3) % 2 === 0;
      car.mesh.extras.redMat.color.setHex(on ? 0xff2020 : 0x401010);
      car.mesh.extras.blueMat.color.setHex(on ? 0x101040 : 0x2040ff);
      car.mesh.extras.sirenLight.color.setHex(on ? 0xff2020 : 0x2040ff);
      car.mesh.extras.sirenLight.intensity = 1.0;
      car.mesh.extras.glowMat.color.setHex(on ? 0xff3040 : 0x3040ff);
      car.ramCooldown = Math.max(0, car.ramCooldown - dt);
      // RAM: only when the PLAYER is faster (closing > 1)
      if (player.inCar && player.car) {
        var pdx = player.x - car.x, pdz = player.z - car.z;
        var pd = Math.sqrt(pdx * pdx + pdz * pdz);
        if (pd < 4.5 && car.ramCooldown <= 0) {
          var closing = player.car.speed - car.speed;
          if (closing > 1) {
            player.car.carHealth -= RAM_DMG;
            car.ramCooldown = RAM_COOLDOWN;
            addHeat(1);
            damageFlash();
            toast('Police rammed your car!');
            if (player.car.carHealth <= 0) { explodeCar(player.car); }
          }
        }
      }
    }

    // foot cops chase (on foot); same last-seen + give-up rules
    for (var ci = footCops.length - 1; ci >= 0; ci--) {
      var cop = footCops[ci];
      var cdx = player.x - cop.x, cdz = player.z - cop.z;
      var cdist = Math.sqrt(cdx * cdx + cdz * cdz) || 0.01;
      if (cdist > 400) {
        scene.remove(cop.group);
        footCops.splice(ci, 1);
        continue;
      }
      var ctx2, ctz2;
      if (cdist < 200) {
        ctx2 = player.x; ctz2 = player.z;
        cop.lastSeen = { x: player.x, z: player.z };
      } else if (cop.lastSeen) {
        ctx2 = cop.lastSeen.x; ctz2 = cop.lastSeen.z;
      } else {
        ctx2 = player.x; ctz2 = player.z;
      }
      var ctdx = ctx2 - cop.x, ctdz = ctz2 - cop.z;
      var ctdist = Math.sqrt(ctdx * ctdx + ctdz * ctdz) || 0.01;
      var sp = cdist < 200 ? (S.wanted >= 3 ? 7.5 : 6) : 4.5;
      if (cdist >= 200 && ctdist < 8) sp = 0; // searching at last seen
      cop.angle = Math.atan2(ctdx, ctdz);
      cop.x += Math.sin(cop.angle) * sp * dt;
      cop.z += Math.cos(cop.angle) * sp * dt;
      cop.phase += dt * 9;
      var sw = Math.sin(cop.phase) * 0.6;
      cop.parts.legL.rotation.x = sw;
      cop.parts.legR.rotation.x = -sw;
      cop.parts.armL.rotation.x = -sw * 0.8;
      cop.parts.armR.rotation.x = sw * 0.8;
      cop.group.position.set(cop.x, 0, cop.z);
      cop.group.rotation.y = cop.angle;
    }
    if (policeCars.length === 0 && footCops.length === 0 && !heli) S.policeEngaged = false;
    // BUSTED: a foot cop within 2m for 3s while wanted, player on foot.
    if (S.wanted > 0 && !player.inCar) {
      var near = footCops.some(function (c) {
        var ddx = player.x - c.x, ddz = player.z - c.z;
        return Math.sqrt(ddx * ddx + ddz * ddz) <= 2;
      });
      if (near) {
        S.bustedTimer += dt;
        if (S.bustedTimer >= 3) busted();
      } else S.bustedTimer = 0;
    } else S.bustedTimer = 0;

    // helicopter circles above the player (low enough to see from the car)
    if (heli) {
      heli.angle += dt * 0.15; // slow orbit: stays in the chase camera's view
      heli.group.position.set(
        player.x + Math.cos(heli.angle) * heliOrbit.r, heliOrbit.h, player.z + Math.sin(heli.angle) * heliOrbit.r);
      heli.group.rotation.y = -heli.angle;
      heli.rotor.rotation.y += dt * 18;
      if (heli.tailRotor) heli.tailRotor.rotation.x += dt * 25;
      heli.beam.target.position.set(player.x - heli.group.position.x, -heliOrbit.h, player.z - heli.group.position.z);
      heli.disc.position.set(player.x - heli.group.position.x, -heliOrbit.h, player.z - heli.group.position.z);
    }

    // siren audio follows the nearest police unit
    var nearest2 = nearestPoliceDist();
    if (AC) {
      var wantSiren = S.wanted > 0 && nearest2 < 160;
      sirenGain.gain.value += ((wantSiren ? Math.max(0, 0.24 - nearest2 * 0.0012) : 0) - sirenGain.gain.value) * 0.1;
      var alt = Math.floor(S.time * 1.6) % 2 === 0;
      sirenOscA.frequency.value = alt ? 700 : 950;
      sirenOscB.frequency.value = alt ? 950 : 700;
    }
  }

  function explodeCar(car) {
    spawnBlood(car.x, car.z, 12);
    toast('Your car is wrecked!');
    if (player.inCar && player.car === car) {
      player.inCar = false; player.car = null;
      player.x = car.x + 3; player.z = car.z + 3;
    }
    car.speed = 0;
    car.carHealth = 100;
    car.x = 200; car.z = -350; // towed away
    car.mesh.group.position.set(car.x, 0, car.z);
  }

  // ---------------------------------------------------------------- driving
  function tryEnterExitCar() {
    if (!S.started) return;
    if (player.inCar) {
      // exit on the left side
      player.inCar = false;
      player.x = player.car.x - 3; player.z = player.car.z;
      player.car = null;
      return;
    }
    var best = null, bd = 6.5;
    cars.forEach(function (c) {
      var d = Math.hypot(player.x - c.x, player.z - c.z);
      if (d < bd) { bd = d; best = c; }
    });
    if (!best) return;
    player.inCar = true;
    player.car = best;
    best.isParked = false;
    if (best.isTraffic) {
      best.isTraffic = false;
      trafficCars.splice(trafficCars.indexOf(best), 1);
    }
    S.carsStolen++;
    addHeat(1);
    toast('You stole a ' + CAR_TYPES[best.type].name + '. The cops noticed!');
    player.group.visible = false;
  }

  function updateDriving(dt) {
    if (!player.inCar || !player.car) return;
    var car = player.car;
    var def = CAR_TYPES[car.type];
    var throttle = 0;
    if (S.stagedCruise) throttle = 1; // shot yang di-stage: mobil terus jalan
    if (keys['KeyW'] || keys['ArrowUp']) throttle = 1;
    if (keys['KeyS'] || keys['ArrowDown']) throttle = -0.6;
    var steer = 0;
    if (keys['KeyA'] || keys['ArrowLeft']) steer = 1;
    if (keys['KeyD'] || keys['ArrowRight']) steer = -1;
    var target = throttle * def.top;
    car.speed += (target - car.speed) * Math.min(1, dt * (throttle !== 0 ? def.accel / def.top : 1.2));
    if (Math.abs(car.speed) < 0.15 && throttle === 0) car.speed = 0;
    var dir = car.speed >= 0 ? 1 : -1;
    car.angle += steer * def.turn * dt * Math.min(1, Math.abs(car.speed) / 8) * dir;
    var nx = car.x + Math.sin(car.angle) * car.speed * dt;
    var nz = car.z + Math.cos(car.angle) * car.speed * dt;
    var hit = collideBuildings(nx, nz, 2.4);
    if (hit) {
      // slide along the wall, lose a little speed
      if (!collideBuildings(nx, car.z, 2.4)) car.x = nx;
      else if (!collideBuildings(car.x, nz, 2.4)) car.z = nz;
      else car.speed *= 0.4;
      if (Math.abs(car.speed) > 12) {
        car.carHealth -= 4;
        if (car.carHealth <= 0) explodeCar(car);
      }
    } else {
      car.x = nx; car.z = nz;
    }
    var cl = clampCity(car.x, car.z);
    car.x = cl.x; car.z = cl.z;
    player.x = car.x; player.z = car.z;
    car.mesh.group.position.set(car.x, 0, car.z);
    car.mesh.group.rotation.y = car.angle;
    spinWheels(car, dt);
    if (car.carHealth < 40 && !car.smoke) car.smoke = makeSmoke(car);
    if (car.smoke) {
      car.smoke.position.y = 1.6 + Math.sin(S.time * 5) * 0.15;
      car.smoke.scale.setScalar(1 + Math.sin(S.time * 3) * 0.2);
    }
    // run over pedestrians: blood + wanted
    peds.forEach(function (p) {
      if (p.dead) return;
      var d = Math.hypot(p.x - car.x, p.z - car.z);
      if (d < 2.2 && Math.abs(car.speed) > 3) {
        killPed(p, true);
        addHeat(1);
      }
    });
    // headlight follows the car
    if (headlight) {
      headlight.position.set(car.x - Math.sin(car.angle) * 0, 2.2, car.z);
      headlightTarget.position.set(car.x + Math.sin(car.angle) * 30, 0, car.z + Math.cos(car.angle) * 30);
    }
    if (engineOsc && AC) {
      engineGain.gain.value = 0.05 + Math.abs(car.speed) / def.top * 0.06;
      engineOsc.frequency.value = 50 + Math.abs(car.speed) * 3.2;
    }
  }

  function addHeat(n) {
    if (S.wanted < 5) {
      S.wanted = Math.min(5, S.wanted + n);
      S.searching = true;
      S.hiddenTime = 0;
      S.policeEngaged = true;
      updateStarsHud();
    }
  }

  function busted() {
    S.bustedTimer = 0;
    S.cash = Math.max(0, S.cash - 100);
    S.wanted = 0;
    S.searching = false;
    updateCashHud(); updateStarsHud();
    hud.busted.style.opacity = '1';
    setTimeout(function () { hud.busted.style.opacity = '0'; }, 2200);
    toast('BUSTED! -$100. The cops let you go with a warning.');
    respawnSafe();
    writeSave();
  }

  function wasted() {
    S.health = 100;
    S.cash = Math.max(0, S.cash - 200);
    S.wanted = 0;
    S.searching = false;
    updateCashHud(); // hard rule: wasted() must refresh the cash HUD
    updateHealthHud(); updateStarsHud();
    hud.wasted.style.opacity = '1';
    setTimeout(function () { hud.wasted.style.opacity = '0'; }, 2400);
    toast('WASTED! -$200. You wake up at the plaza clinic.');
    respawnSafe();
    writeSave();
  }

  function respawnSafe() {
    player.inCar = false; player.car = null;
    player.group.visible = true;
    player.x = 175; player.z = -60;
    player.group.position.set(player.x, 0, player.z);
    // clear police
    policeCars.forEach(function (c) { scene.remove(c.mesh.group); });
    policeCars.length = 0;
    cars = cars.filter(function (c) { return !c.isPolice; });
    footCops.forEach(function (c) { scene.remove(c.group); });
    footCops.length = 0;
    if (heli) { scene.remove(heli.group); heli = null; }
  }

  // ---------------------------------------------------------------- pedestrians
  // 72 citizens, each with a VISIBLE daily activity:
  // walk 28, chat pairs 10, sit 7, wait at bus stop 6, jog 7, dog walk 5,
  // cross at zebra 6, vendor 3. Activities must READ visually, not just exist.
  var peds = [];
  var SHIRTS = [0xd84a30, 0x2a7ab8, 0xe8a020, 0x3a9a5a, 0x8a4ab8, 0x20a0a0, 0xe8e0d0, 0x505860];
  var SKINS = [0xc89878, 0x8a5a38, 0xe8b890, 0x6a4028, 0xd8a080];
  var HAIRS = [0x1a1410, 0x6a4a2a, 0xc8c8c8, 0x8a2020, 0x2a2a3a];
  var HATS = [0xd84a30, 0x2a7ab8, 0xe8c020, null, null, null];

  function makePed(opts) {
    var parts = makePersonMesh(opts);
    scene.add(parts.group);
    return { parts: parts, group: parts.group, x: 0, z: 0, angle: 0, speed: 0,
      activity: 'walk', phase: Math.random() * 6, dead: false, anchor: null,
      state: 0, stateT: 0, dog: null, leash: null, partner: null, crossing: null };
  }

  function spawnPedestrians() {
    var rng = VCRng.makeRng(CITY_SEED + 21);
    var count = { walk: 0, chat: 0, sit: 0, wait: 0, jog: 0, dog: 0, cross: 0, vendor: 0 };
    function basePed() {
      return makePed({
        shirt: rng.pick(SHIRTS), skin: rng.pick(SKINS),
        hair: rng.pick(HAIRS), hat: rng.pick(HATS),
        scale: rng.range(0.92, 1.08)
      });
    }
    function sidewalkSpot() {
      var av = rng.pick(cityData.avenues);
      var z = rng.range(-1000, 1000);
      var side = rng.chance(0.5) ? 1 : -1;
      return { x: av + side * (7 + 2.5 + 2), z: z };
    }

    // 28 walkers: stroll the sidewalks.
    for (var i = 0; i < 28; i++) {
      var p = basePed();
      var s = sidewalkSpot();
      p.x = s.x; p.z = s.z;
      p.activity = 'walk'; p.speed = 1.6;
      p.anchor = { x: s.x, z: s.z, road: 'avenue', at: nearestRoad(s.x, cityData.avenues), side: s.x > nearestRoad(s.x, cityData.avenues) ? 1 : -1 };
      p.angle = rng.chance(0.5) ? 0 : Math.PI;
      peds.push(p); count.walk++;
    }

    // 10 chatters: 5 pairs standing FACE TO FACE ~1u apart, heads turning
    // and nodding, at spots the player actually passes (near the bus stop,
    // the crossings, the stall and the plaza).
    var pairSpots = [
      { x: 215, z: -140 }, { x: 185, z: -215 }, { x: 160, z: -55 },
      { x: 150, z: -95 }, { x: -185, z: 185 }
    ];
    pairSpots.forEach(function (spot) {
      var a = basePed(), b = basePed();
      a.x = spot.x; a.z = spot.z; a.activity = 'chat';
      b.x = spot.x + 1.0; b.z = spot.z; b.activity = 'chat';
      a.angle = Math.PI / 2; b.angle = -Math.PI / 2; // facing each other
      a.partner = b; b.partner = a;
      a.anchor = { x: spot.x, z: spot.z }; b.anchor = { x: spot.x + 1, z: spot.z };
      peds.push(a); peds.push(b); count.chat += 2;
    });

    // 7 sitters: clearly SEATED on benches (bent legs, body on the bench).
    cityData.benches.slice(0, 7).forEach(function (bench) {
      var p = basePed();
      p.activity = 'sit';
      p.anchor = { x: bench.x, z: bench.z, rotY: bench.rotY };
      p.x = bench.x; p.z = bench.z;
      p.angle = bench.rotY;
      peds.push(p); count.sit++;
    });

    // 6 waiters: standing INSIDE the bus-stop shelters, heads turning.
    cityData.busStops.forEach(function (bs) {
      for (var k = 0; k < 2 && count.wait < 6; k++) {
        var p = basePed();
        p.activity = 'wait';
        p.anchor = { x: bs.x, z: bs.z, face: bs.face };
        p.x = bs.x + (k === 0 ? -1.5 : 1.5);
        p.z = bs.z + 0.2;
        p.angle = bs.face > 0 ? Math.PI / 2 : -Math.PI / 2; // facing the road
        peds.push(p); count.wait++;
      }
    });

    // 7 joggers: 2x speed, big limb swing, forward lean — visibly running.
    for (var j = 0; j < 7; j++) {
      var p = basePed();
      var s2 = sidewalkSpot();
      p.x = s2.x; p.z = s2.z;
      p.activity = 'jog'; p.speed = 3.2;
      p.anchor = { x: s2.x, z: s2.z };
      p.angle = rng.chance(0.5) ? 0 : Math.PI;
      peds.push(p); count.jog++;
    }

    // 5 dog walkers: a VISIBLE small dog on a leash, tail wagging.
    for (var d = 0; d < 5; d++) {
      var p = basePed();
      var s3 = sidewalkSpot();
      p.x = s3.x; p.z = s3.z;
      p.activity = 'dog'; p.speed = 1.6;
      p.anchor = { x: s3.x, z: s3.z };
      p.angle = rng.chance(0.5) ? 0 : Math.PI;
      // dog: body + head + 4 legs + wagging tail
      var dog = new THREE.Group();
      var dogMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 });
      var dbody = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.35, 0.32), dogMat);
      dbody.position.y = 0.42;
      dbody.castShadow = true;
      dog.add(dbody);
      var dhead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.28), dogMat);
      dhead.position.set(0.48, 0.6, 0);
      dog.add(dhead);
      var dear = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.08), dogMat);
      dear.position.set(0.42, 0.8, 0.1);
      dog.add(dear);
      var tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.08), dogMat);
      tail.position.set(-0.45, 0.55, 0);
      dog.add(tail);
      var dogLegs = [];
      [[0.26, 0.12], [0.26, -0.12], [-0.26, 0.12], [-0.26, -0.12]].forEach(function (lp) {
        var leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), dogMat);
        leg.position.set(lp[0], 0.16, lp[1]);
        dog.add(leg);
        dogLegs.push(leg);
      });
      scene.add(dog);
      p.dog = { group: dog, tail: tail, legs: dogLegs };
      // leash: a line from the owner's hand to the dog
      var leashGeo = new THREE.BufferGeometry();
      leashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      var leash = new THREE.Line(leashGeo, new THREE.LineBasicMaterial({ color: 0x222222 }));
      scene.add(leash);
      p.leash = leash;
      peds.push(p); count.dog++;
    }

    // 6 crossers: wait at the curb while cars have green, cross ON the thick
    // white zebra stripes while cars have red.
    cityData.crossings.forEach(function (c) {
      var p = basePed();
      p.activity = 'cross';
      p.crossing = c;
      p.anchor = { x: c.x, z: c.z };
      p.x = c.x - 13; p.z = c.z - 1.5; // waiting at the west curb, ON a stripe line
      p.state = 0; // 0 waiting, 1 crossing
      p.angle = Math.PI / 2; // facing east, across the road
      peds.push(p); count.cross++;
    });

    // 3 vendors: standing BEHIND their stalls, facing the street.
    cityData.stalls.forEach(function (st) {
      var p = basePed();
      p.activity = 'vendor';
      p.anchor = { x: st.x, z: st.z, rotY: st.rotY };
      // behind the counter: local -Z of the stall group
      var bx = st.x - Math.sin(st.rotY) * 1.9, bz = st.z - Math.cos(st.rotY) * 1.9;
      p.x = bx; p.z = bz;
      p.angle = st.rotY; // facing the street (same way the stall faces)
      peds.push(p); count.vendor++;
    });

    S.pedCounts = count;
  }

  function pedWalkAnim(p, dt, freq, amp) {
    p.phase += dt * freq;
    var sw = Math.sin(p.phase) * amp;
    p.parts.legL.rotation.x = sw;
    p.parts.legR.rotation.x = -sw;
    p.parts.armL.rotation.x = -sw * 0.8;
    p.parts.armR.rotation.x = sw * 0.8;
  }

  function updatePeds(dt) {
    var playerPos = { x: player.x, z: player.z };
    peds.forEach(function (p) {
      if (p.dead) return;
      // Panic: a crime nearby or a fast car close by -> run away, then return.
      var dxp = playerPos.x - p.x, dzp = playerPos.z - p.z;
      var dp = Math.sqrt(dxp * dxp + dzp * dzp);
      var scared = false;
      if (dp < 14 && (S.lastCrimeT !== undefined && S.time - S.lastCrimeT < 2.5)) scared = true;
      if (player.inCar && player.car && dp < 7 && Math.abs(player.car.speed) > 9) scared = true;
      if (scared && p.activity !== 'vendor' && p.activity !== 'sit') {
        p.panicT = 2;
      }
      if (p.panicT > 0) {
        p.panicT -= dt;
        var away = Math.atan2(p.x - playerPos.x, p.z - playerPos.z);
        p.x += Math.sin(away) * 4.5 * dt;
        p.z += Math.cos(away) * 4.5 * dt;
        p.angle = away;
        pedWalkAnim(p, dt, 11, 0.8);
        p.group.position.set(p.x, 0, p.z);
        p.group.rotation.y = p.angle;
        return;
      }

      if (p.activity === 'walk' || p.activity === 'jog') {
        var run = p.activity === 'jog';
        var sp = run ? 3.2 : 1.6;
        p.x += Math.sin(p.angle) * sp * dt;
        p.z += Math.cos(p.angle) * sp * dt;
        // turn around at the city edge / at random intersections
        if (Math.abs(p.x) > 1500 || Math.abs(p.z) > 1100) p.angle += Math.PI;
        else if (Math.random() < dt * 0.02) p.angle += Math.PI; // occasional turn
        pedWalkAnim(p, dt, run ? 11 : 6, run ? 0.85 : 0.5);
        // joggers lean visibly forward
        p.parts.torso.rotation.x = run ? 0.22 : 0;
        p.group.position.set(p.x, 0, p.z);
        p.group.rotation.y = p.angle;
      } else if (p.activity === 'chat') {
        // face each other, heads turning + nodding, one arm gesturing
        var t = S.time + p.phase;
        p.parts.head.rotation.y = Math.sin(t * 0.7) * 0.5;
        p.parts.head.rotation.x = Math.max(0, Math.sin(t * 2.2)) * 0.18;
        p.parts.armR.rotation.x = -0.6 + Math.sin(t * 1.3) * 0.3;
        p.parts.armL.rotation.x = 0;
        p.parts.legL.rotation.x = 0; p.parts.legR.rotation.x = 0;
        p.group.position.set(p.x, 0, p.z);
        p.group.rotation.y = p.angle;
      } else if (p.activity === 'sit') {
        // clearly seated: bent legs, body on the bench
        p.parts.legL.rotation.x = -1.35; // thigh forward (horizontal)
        p.parts.legR.rotation.x = -1.35;
        p.parts.armL.rotation.x = -0.5; // hands on lap
        p.parts.armR.rotation.x = -0.5;
        p.parts.head.rotation.y = Math.sin((S.time + p.phase) * 0.4) * 0.4;
        p.group.position.set(p.x, -0.33, p.z); // hips at seat height
        p.group.rotation.y = p.angle;
      } else if (p.activity === 'wait') {
        // inside the shelter, looking up and down the road for the bus
        p.parts.head.rotation.y = Math.sin((S.time + p.phase) * 0.5) * 0.85;
        p.parts.armL.rotation.x = 0; p.parts.armR.rotation.x = 0;
        p.parts.legL.rotation.x = 0; p.parts.legR.rotation.x = 0;
        p.group.position.set(p.x, 0, p.z);
        p.group.rotation.y = p.angle;
      } else if (p.activity === 'dog') {
        p.x += Math.sin(p.angle) * 1.6 * dt;
        p.z += Math.cos(p.angle) * 1.6 * dt;
        if (Math.abs(p.x) > 1500 || Math.abs(p.z) > 1100) p.angle += Math.PI;
        pedWalkAnim(p, dt, 6, 0.5);
        p.group.position.set(p.x, 0, p.z);
        p.group.rotation.y = p.angle;
        // the dog follows 1.2u behind, tail wagging, legs trotting
        if (p.dog) {
          var bx = p.x - Math.sin(p.angle) * 1.2, bz = p.z - Math.cos(p.angle) * 1.2;
          p.dog.group.position.set(bx, 0, bz);
          p.dog.group.rotation.y = p.angle;
          p.dog.tail.rotation.y = Math.sin(S.time * 6 + p.phase) * 0.6;
          var trot = Math.sin(S.time * 9 + p.phase) * 0.5;
          p.dog.legs[0].rotation.x = trot;
          p.dog.legs[3].rotation.x = trot;
          p.dog.legs[1].rotation.x = -trot;
          p.dog.legs[2].rotation.x = -trot;
          // leash from the owner's hand to the dog
          var pos = p.leash.geometry.attributes.position.array;
          pos[0] = p.x + Math.sin(p.angle) * 0.55; pos[1] = 1.35; pos[2] = p.z + Math.cos(p.angle) * 0.55;
          pos[3] = bx; pos[4] = 0.55; pos[5] = bz;
          p.leash.geometry.attributes.position.needsUpdate = true;
        }
      } else if (p.activity === 'cross') {
        var c = p.crossing;
        var carsGreen = lightIsGreen('NS'); // cars on the avenue have green
        if (p.state === 0) {
          // waiting at the curb, looking both ways
          p.parts.head.rotation.y = Math.sin((S.time + p.phase) * 0.9) * 0.7;
          if (!carsGreen) { p.state = 1; } // cars red -> cross now
          p.group.position.set(p.x, 0, p.z);
          p.group.rotation.y = p.angle;
        } else {
          // crossing ON the zebra stripes (z = stripe centre, on the bars)
          p.x += Math.sin(p.angle) * 2.0 * dt;
          p.z = c.z - 1.5;
          pedWalkAnim(p, dt, 7, 0.55);
          if (p.x >= c.x + 13) {
            p.state = 0;
            p.x = c.x + 13;
            p.angle = -Math.PI / 2; // face back west for the next crossing
          } else if (p.x <= c.x - 13 && p.angle < 0) {
            p.state = 0;
            p.x = c.x - 13;
            p.angle = Math.PI / 2;
          }
          p.group.position.set(p.x, 0, p.z);
          p.group.rotation.y = p.angle;
        }
      } else if (p.activity === 'vendor') {
        // behind the stall, facing the street, waving at customers
        p.parts.armR.rotation.x = -1.2 + Math.sin((S.time + p.phase) * 1.1) * 0.25;
        p.parts.armL.rotation.x = -0.3;
        p.parts.head.rotation.y = Math.sin((S.time + p.phase) * 0.45) * 0.5;
        p.group.position.set(p.x, 0, p.z);
        p.group.rotation.y = p.angle;
      }
    });
  }

  // ---------------------------------------------------------------- blood
  var bloodParts = [];
  var splats = [];
  function spawnBlood(x, z, n) {
    for (var i = 0; i < (n || 6); i++) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22),
        new THREE.MeshBasicMaterial({ color: 0xc01818 }));
      m.position.set(x + (Math.random() - 0.5), 1 + Math.random(), z + (Math.random() - 0.5));
      scene.add(m);
      bloodParts.push({
        mesh: m, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3 + 1,
        vz: (Math.random() - 0.5) * 4, life: 0.9
      });
    }
    // ground splat, fades over ~12s, max 20
    var splat = new THREE.Mesh(new THREE.CircleGeometry(0.9, 12),
      new THREE.MeshBasicMaterial({ color: 0x8a1010, transparent: true, opacity: 0.85 }));
    splat.rotation.x = -Math.PI / 2;
    splat.position.set(x, 0.06, z);
    scene.add(splat);
    splats.push({ mesh: splat, life: 12 });
    if (splats.length > 20) {
      var old = splats.shift();
      scene.remove(old.mesh);
    }
  }
  function updateBlood(dt) {
    for (var i = bloodParts.length - 1; i >= 0; i--) {
      var b = bloodParts[i];
      b.life -= dt;
      b.vy -= 9 * dt;
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.y += b.vy * dt;
      b.mesh.position.z += b.vz * dt;
      if (b.mesh.position.y < 0.1) b.mesh.position.y = 0.1;
      if (b.life <= 0) { scene.remove(b.mesh); bloodParts.splice(i, 1); }
    }
    for (var j = splats.length - 1; j >= 0; j--) {
      var s = splats[j];
      s.life -= dt;
      s.mesh.material.opacity = Math.max(0, s.life / 12 * 0.85);
      if (s.life <= 0) { scene.remove(s.mesh); splats.splice(j, 1); }
    }
  }

  function killPed(p, byCar) {
    if (p.dead) return;
    p.dead = true;
    S.kills++;
    S.lastCrimeT = S.time;
    spawnBlood(p.x, p.z, 8);
    // fall over
    p.group.rotation.x = Math.PI / 2 - 0.15;
    p.group.position.y = 0.3;
    if (p.dog) { p.dog.group.visible = false; if (p.leash) p.leash.visible = false; }
    setTimeout(function () {
      // the body is cleared after a while
      p.group.visible = false;
    }, 9000);
  }

  // ---------------------------------------------------------------- combat
  function nearestTarget(maxDist, wantPed) {
    var best = null, bd = maxDist;
    var targets = wantPed ? peds : footCops;
    targets.forEach(function (t) {
      if (t.dead) return;
      var d = Math.hypot(player.x - t.x, player.z - t.z);
      if (d < bd) { bd = d; best = t; }
    });
    return best;
  }
  function punch() {
    if (!S.started || player.inCar) return;
    var t = nearestTarget(2.6, true) || nearestTarget(2.6, false);
    if (!t) return;
    S.lastCrimeT = S.time;
    spawnBlood(t.x, t.z, 5);
    if (t.activity !== undefined) killPed(t, false);
    else {
      // foot cop punched: it fights back a little
      S.health -= 8;
      updateHealthHud();
      damageFlash();
      if (S.health <= 0) wasted();
    }
    addHeat(1);
  }
  function shoot() {
    if (!S.started || player.inCar) return;
    S.lastCrimeT = S.time;
    var t = nearestTarget(26, true) || nearestTarget(26, false);
    if (t) {
      spawnBlood(t.x, t.z, 7);
      if (t.activity !== undefined) { killPed(t, false); addHeat(1); }
      else {
        S.health -= 12;
        updateHealthHud();
        damageFlash();
        addHeat(1);
        if (S.health <= 0) wasted();
      }
    }
    // muzzle flash on the HUD weapon label
    hud.weapon.style.color = '#ffd23a';
    setTimeout(function () { hud.weapon.style.color = ''; }, 120);
  }

  // ---------------------------------------------------------------- Pay 'n Spray
  function updatePaynSpray(dt) {
    S.pnsCooldown = Math.max(0, S.pnsCooldown - dt);
    if (!player.inCar || !player.car || S.pnsCooldown > 0) return;
    var pns = cityData.paynspray;
    var d = Math.hypot(player.x - pns.x, player.z - pns.z);
    if (d < 9 && (S.wanted > 0 || player.car.carHealth < 100) && S.cash >= 100) {
      player.car.carHealth = 100;
      if (player.car.smoke) { player.car.mesh.group.remove(player.car.smoke); player.car.smoke = null; }
      S.wanted = 0;
      S.searching = false;
      S.cash -= 100;
      S.pnsCooldown = 5;
      updateCashHud(); updateStarsHud();
      toast("Pay 'n Spray: car repaired, wanted cleared. -$100");
    }
  }

  // ---------------------------------------------------------------- missions
  // Five missions, five different jobs (rule = what makes each one play different):
  // drive = steal + drive to the marker; timed = beat the clock or the payout
  // is halved; onfoot = the pickup only counts on foot; clean = lose the cops
  // before the marker counts; alarm = the score trips the alarm (wanted 3).
  var MISSIONS = [
    { name: 'First Wheels', desc: 'Steal a car, then drive to the marker.', target: { x: -200, z: -200 }, payout: 200, rule: 'drive', dialog: 'Steal a car, then drive to the marker — hurry!' },
    { name: 'Courier Run', desc: 'Drive the package to the east docks. 2:00 on the clock — late pays half.', target: { x: 1000, z: 600 }, payout: 400, rule: 'timed', timeLimit: 120, dialog: 'Package to the east docks. Two minutes — don\'t be late!' },
    { name: 'Shakedown', desc: 'Collect from the stall district. On foot only — blend in.', target: { x: 600, z: 200 }, payout: 600, rule: 'onfoot', dialog: 'Collect from the stall district. On foot — blend in, no car.' },
    { name: 'Getaway', desc: 'Lose the cops, then reach the hideout.', target: { x: -1000, z: -600 }, payout: 800, rule: 'clean', dialog: 'The cops are on you. Lose them first, then reach the hideout.' },
    { name: 'The Big Score', desc: 'Hit the Meridian Bank vault run. Grab it and run!', target: { x: 200, z: 600 }, payout: 1500, rule: 'alarm', dialog: 'Hit the Meridian Bank vault run. Grab the cash — the alarm will bring everyone.' }
  ];
  var missionMarker = null;
  var missionBlip = null;

  function buildMissions() {
    var geo = new THREE.ConeGeometry(2.2, 4.5, 4);
    var mat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
    missionMarker = new THREE.Mesh(geo, mat);
    missionMarker.rotation.x = Math.PI;
    scene.add(missionMarker);
    missionBlip = new THREE.Mesh(new THREE.CircleGeometry(1.6, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.7 }));
    missionBlip.rotation.x = -Math.PI / 2;
    scene.add(missionBlip);
    updateMissionHud();
  }
  function updateMissionHud() {
    var m = MISSIONS[Math.min(S.mission, MISSIONS.length - 1)];
    if (S.mission >= MISSIONS.length) {
      hud.missionTitle.textContent = 'All missions done!';
      hud.missionDesc.textContent = 'Port Meridian is yours. Free roam.';
      hud.missionDist.textContent = '';
      hud.dialogName.textContent = 'MIRA';
      hud.dialogText.textContent = 'Port Meridian is yours. Free roam — and try not to get caught.';
      return;
    }
    hud.missionTitle.textContent = 'MISSION ' + (S.mission + 1) + '/5 · ' + m.name + ' ($' + m.payout + ')';
    hud.missionDesc.textContent = m.desc;
    hud.dialogName.textContent = 'MIRA';
    hud.dialogText.textContent = m.dialog;
    if (m.rule === 'timed') S.missionTimer = m.timeLimit;
  }
  function updateMissions(dt) {
    if (S.mission >= MISSIONS.length) {
      missionMarker.visible = false;
      missionBlip.visible = false;
      hud.missionDist.textContent = '';
      return;
    }
    var m = MISSIONS[S.mission];
    missionMarker.visible = true;
    missionBlip.visible = true;
    missionMarker.position.set(m.target.x, 7 + Math.sin(S.time * 2) * 0.8, m.target.z);
    missionMarker.rotation.y += dt * 1.5;
    missionBlip.position.set(m.target.x, 0.07, m.target.z);
    var d = Math.hypot(player.x - m.target.x, player.z - m.target.z);
    var distTxt = Math.round(d) + 'm to marker';
    if (m.rule === 'timed') {
      var t = Math.max(0, S.missionTimer);
      var mm = Math.floor(t / 60), ss = Math.floor(t % 60);
      distTxt += ' · ' + mm + ':' + (ss < 10 ? '0' : '') + ss + ' left';
    }
    hud.missionDist.textContent = distTxt;
    if (d < 10) {
      // each mission's rule decides whether arriving counts
      if (m.rule === 'onfoot' && player.inCar) {
        hud.missionDist.textContent = distTxt + ' · get out of the car to collect!';
        return;
      }
      if (m.rule === 'clean' && S.wanted > 0) {
        hud.missionDist.textContent = distTxt + ' · lose the cops first!';
        return;
      }
      complete();
    }
  }
  // HARD RULE 3: complete() raises S.mission += 1 FIRST, then writeSave().
  // (The payout is added before the save too, so the save holds it.)
  function complete() {
    var m = MISSIONS[S.mission];
    var payout = m.payout;
    if (m.rule === 'timed' && S.missionTimer <= 0) {
      payout = Math.floor(m.payout / 2); // late delivery pays half
      toast('Late! Courier payout halved to $' + payout + '.');
    }
    S.mission += 1;
    S.cash += payout;
    writeSave();
    updateCashHud();
    floatText('+$' + payout, '#3ecf5a');
    toast('Mission complete: ' + m.name + ' — +$' + payout);
    if (S.mission < MISSIONS.length) updateMissionHud();
    else updateMissionHud();
    // mission hooks: Getaway starts with the cops already on you;
    // the Big Score trips the alarm the moment you grab the cash.
    if (S.mission < MISSIONS.length && MISSIONS[S.mission].rule === 'clean') addHeat(2);
    if (m.rule === 'alarm') addHeat(3);
  }

  // ---------------------------------------------------------------- traffic lights
  function updateTrafficLights() {
    var phase = trafficPhase();
    cityData.trafficLights.forEach(function (tl) {
      var green = tl.axis === phase;
      tl.lampMats[0].opacity = green ? 0.25 : 1; // red
      tl.lampMats[1].opacity = 0.25;             // amber off
      tl.lampMats[2].opacity = green ? 1 : 0.25; // green
    });
  }

  // ---------------------------------------------------------------- camera
  var camYaw = 0, camPitch = 0.32;
  function updateCamera(dt) {
    var target = player.inCar && player.car ? player.car : player;
    var tx = target.x, tz = target.z;
    var baseYaw = player.inCar && player.car ? player.car.angle : player.angle;
    var yaw = baseYaw + Math.PI + mouse.yawOff; // behind the player
    var dist = mouse.zoom;
    var height = 6.5 + mouse.pitchOff * 8;
    var cx = tx + Math.sin(yaw) * dist;
    var cz = tz + Math.cos(yaw) * dist;
    camera.position.x += (cx - camera.position.x) * Math.min(1, dt * 5);
    camera.position.y += ((height) - camera.position.y) * Math.min(1, dt * 5);
    camera.position.z += (cz - camera.position.z) * Math.min(1, dt * 5);
    camera.lookAt(tx, 2.2, tz);
    // sun follows the player so shadows stay crisp nearby
    sunLight.position.set(tx + 900, 700, tz - 500);
    sunLight.target.position.set(tx, 0, tz);
  }
  function setCamYaw(yaw) { mouse.yawOff = yaw; }

  // ---------------------------------------------------------------- minimap
  var minimapBase = null;
  function buildMinimapBase() {
    var cv = document.createElement('canvas');
    cv.width = 360; cv.height = 360;
    var ctx = cv.getContext('2d');
    var sx = 360 / 3200, sz = 360 / 2400;
    ctx.fillStyle = '#20242a';
    ctx.fillRect(0, 0, 360, 360);
    // buildings
    ctx.fillStyle = '#3a4048';
    cityData.buildings.forEach(function (b) {
      ctx.fillRect((b.x - b.w / 2 + 1600) * sx, (b.z - b.d / 2 + 1200) * sz, b.w * sx, b.d * sz);
    });
    // roads
    ctx.strokeStyle = '#8a9098';
    ctx.lineWidth = 3;
    cityData.avenues.forEach(function (x) {
      ctx.beginPath();
      ctx.moveTo((x + 1600) * sx, 0); ctx.lineTo((x + 1600) * sx, 360); ctx.stroke();
    });
    cityData.streets.forEach(function (z) {
      ctx.beginPath();
      ctx.moveTo(0, (z + 1200) * sz); ctx.lineTo(360, (z + 1200) * sz); ctx.stroke();
    });
    // bus stops + crossings
    ctx.fillStyle = '#ffd23a';
    cityData.busStops.forEach(function (b) {
      ctx.fillRect((b.x + 1600) * sx - 2, (b.z + 1200) * sz - 2, 4, 4);
    });
    minimapBase = cv;
  }
  function drawMinimap() {
    var cv = hud.minimap;
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); ctx.clip();
    var k = 2.2 * (W / 360); // zoom: player stays centred
    var px = (player.x + 1600) / 3200 * 360, pz = (player.z + 1200) / 2400 * 360;
    ctx.translate(W / 2 - px * k, H / 2 - pz * k);
    ctx.scale(k, k);
    ctx.drawImage(minimapBase, 0, 0);
    // mission marker
    if (S.mission < MISSIONS.length) {
      var m = MISSIONS[S.mission];
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath();
      ctx.arc((m.target.x + 1600) / 3200 * 360, (m.target.z + 1200) / 2400 * 360, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // police
    ctx.fillStyle = '#ff4040';
    policeCars.forEach(function (c) {
      ctx.beginPath();
      ctx.arc((c.x + 1600) / 3200 * 360, (c.z + 1200) / 2400 * 360, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
    footCops.forEach(function (c) {
      ctx.beginPath();
      ctx.arc((c.x + 1600) / 3200 * 360, (c.z + 1200) / 2400 * 360, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
    // player arrow (centre); north is up, so rotate by PI - angle
    ctx.fillStyle = '#ffffff';
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(Math.PI - player.angle);
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
    // N indicator
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, 15);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); ctx.stroke();
  }

  // ---------------------------------------------------------------- wanted decay
  function updateWanted(dt) {
    if (S.wanted === 0) { S.searching = false; return; }
    // hidden = no police unit within 60u and not in a car chase
    var nearest = 1e9;
    policeCars.forEach(function (c) {
      var d = Math.hypot(player.x - c.x, player.z - c.z);
      if (d < nearest) nearest = d;
    });
    footCops.forEach(function (c) {
      var d = Math.hypot(player.x - c.x, player.z - c.z);
      if (d < nearest) nearest = d;
    });
    var hidden = nearest > 60;
    if (hidden) {
      S.hiddenTime += dt;
      S.searching = true;
      if (S.hiddenTime >= 8) {
        S.wanted -= 1;
        S.hiddenTime = 0;
        if (S.wanted === 0) S.searching = false;
        updateStarsHud();
        toast('Heat dropping… wanted level ' + S.wanted);
      }
    } else {
      S.hiddenTime = 0;
      S.searching = false;
    }
    updateStarsHud();
  }

  // ---------------------------------------------------------------- main loop
  function update(dt) {
    if (!S.started || S.paused) return;
    S.time += dt;
    trafficPhaseT += dt;
    updateTrafficLights();
    updatePlayer(dt);
    updateDriving(dt);
    trafficCars.forEach(function (c) { updateTrafficCar(c, dt); });
    updatePolice(dt);
    updatePeds(dt);
    updateBlood(dt);
    updateMissions(dt);
    updateWanted(dt);
    updatePaynSpray(dt);
    // clouds drift +x, wrap
    cityData.clouds.forEach(function (cl) {
      cl.position.x += dt * 2.2;
      if (cl.position.x > 1600) cl.position.x = -1600;
    });
    // flags wave
    cityData.flags.forEach(function (f, i) {
      f.cloth.rotation.y = Math.sin(S.time * 2.2 + i) * 0.35;
    });
    // neon flicker (subtle)
    cityData.neons.forEach(function (n, i) {
      n.mesh.material.opacity = 0.85 + Math.sin(S.time * 3 + i * 1.7) * 0.15;
    });
    // health regen slowly when not wanted
    if (S.wanted === 0 && S.health < 100) {
      S.health = Math.min(100, S.health + dt * 1.5);
      updateHealthHud();
    }
    // speedometer (only while driving) + courier countdown
    if (player.inCar && player.car) {
      hud.speedo.style.display = 'block';
      hud.speedNum.textContent = Math.round(Math.abs(player.car.speed) * 3.6);
    } else hud.speedo.style.display = 'none';
    if (S.mission < MISSIONS.length && MISSIONS[S.mission].rule === 'timed' && S.missionTimer > 0) {
      S.missionTimer = Math.max(0, S.missionTimer - dt);
    }
    updateCamera(dt);
    drawMinimap();
  }

  function animate(t) {
    requestAnimationFrame(animate);
    var now = t / 1000;
    var dt = Math.min(0.05, now - (clock.last || now));
    clock.last = now;
    if (S.started && !S.paused) update(dt);
    else {
      // idle camera orbit on the start screen
      if (!S.started) {
        var a = now * 0.05;
        camera.position.set(200 + Math.sin(a) * 320, 130, 200 + Math.cos(a) * 320);
        camera.lookAt(0, 0, 0);
        drawMinimap();
      }
    }
    renderer.render(scene, camera);
  }

  // One synchronous update step (used by the headless playtest driver).
  function step(dt, render) {
    update(dt || 0.05);
    if (render) renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- debug API
  global.VC = { debug: null, state: S };
  function pedActivities() {
    var out = {};
    peds.forEach(function (p) { out[p.activity] = (out[p.activity] || 0) + 1; });
    return out;
  }
  function crossPeds() {
    return peds.filter(function (p) { return p.activity === 'cross'; }).map(function (p) {
      return { x: +p.x.toFixed(1), z: +p.z.toFixed(1), state: p.state, crossing: { x: p.crossing.x, z: p.crossing.z } };
    });
  }
  function trafficStoppedAtRed() {
    // deterministic probe: put a traffic car 20u before a red light, watch it
    // slow down and stop at the stop line, then go again on green.
    var car = trafficCars[0];
    if (!car) return { ok: false, why: 'no traffic car' };
    var alongX = car.road.kind === 'street';
    var axis = alongX ? 'EW' : 'NS';
    // force the car's axis to red
    setTrafficPhase(axis === 'NS' ? 'EW' : 'NS');
    // place the car 20u before the nearest intersection on its road
    var list = alongX ? cityData.avenues : cityData.streets;
    var pos = alongX ? car.x : car.z;
    var target = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] - pos > 20) { target = list[i]; break; }
    }
    if (target === null) target = list[list.length - 1];
    var before = target - 20;
    if (alongX) { car.x = before; car.z = car.road.at + 3.5; car.angle = Math.PI / 2; }
    else { car.z = before; car.x = car.road.at + 3.5; car.angle = 0; }
    car.speed = 12;
    var speeds = [];
    for (var s = 0; s < 160; s++) {
      updateTrafficCar(car, 0.05);
      speeds.push(+car.speed.toFixed(2));
    }
    var stopped = car.speed < 0.5;
    var stopDist = Math.abs((alongX ? car.x : car.z) - (target - 15));
    // now green: it must move again
    setTrafficPhase(axis);
    for (var g = 0; g < 80; g++) updateTrafficCar(car, 0.05);
    var resumed = car.speed > 3;
    return {
      ok: stopped && stopDist < 6 && resumed,
      stopped: stopped, stopDist: +stopDist.toFixed(2), resumed: resumed,
      resumedSpeed: +car.speed.toFixed(2),
      minSpeedDuringRed: Math.min.apply(null, speeds)
    };
  }
  function redLightProbe() { return trafficStoppedAtRed(); }

  function worldProps() {
    return {
      buildings: cityData.buildings.length, trees: cityData.trees.length,
      hydrants: cityData.hydrants.length, lamps: cityData.lamps.length,
      trafficLights: cityData.trafficLights.length, crossings: cityData.crossings.length,
      busStops: cityData.busStops.length, benches: cityData.benches.length,
      stalls: cityData.stalls.length, neons: cityData.neons.length,
      flags: cityData.flags.length, palms: cityData.palms.length, dashes: cityData.dashCount,
      stripes: cityData.stripeCount, hash: city.hash
    };
  }

  // Stage a named screenshot scene deterministically.
  function stage(name) {
    if (name === 'start') {
      S.started = false;
      hud.startScreen.style.display = 'flex';
      camera.position.set(200, 90, 320);
      camera.lookAt(200, 10, -200);
      return { ok: true, shot: 'start' };
    }
    if (!S.started) startGame(false);
    if (name === 'drive') {
      // player in the bright red sedan on avenue 200, close to the action:
      // bus stop (200,-160), chat pair (215,-140), jogger + dog walker on the
      // sidewalks, zebra (200,-200) ahead — shoulders + sidewalk in frame.
      // Fix-2 (Round 4): the two benches that used to sit on the avenue-200
      // centreline now sit on the east sidewalk (211.5), so no bench or
      // seated citizen appears in a traffic lane in this shot.
      var car = parkedCars[0] || makeCar('sedan', 200, -115, Math.PI);
      player.inCar = true; player.car = car;
      car.isParked = false;
      player.group.visible = false;
      car.x = 200; car.z = -115; car.angle = Math.PI; car.speed = 12;
      S.stagedCruise = true;
      player.x = car.x; player.z = car.z;
      mouse.yawOff = 0; mouse.zoom = 15; mouse.pitchOff = 0;
      // put a jogger + a dog walker on the avenue-200 sidewalks, in frame
      var jog = peds.filter(function (p) { return p.activity === 'jog'; })[0];
      if (jog) { jog.x = 213; jog.z = -175; jog.angle = Math.PI; }
      var dog = peds.filter(function (p) { return p.activity === 'dog'; })[0];
      if (dog) { dog.x = 187; dog.z = -135; dog.angle = Math.PI; }
      // a taxi driving ahead of the player (traffic in frame) + a taxi
      // parked on the west shoulder, so the street reads busy
      var taxi = trafficCars.filter(function (c) { return c.type === 'taxi'; })[0] || trafficCars[0];
      if (taxi) {
        taxi.road = { kind: 'avenue', at: 200 };
        taxi.x = 203.5; taxi.z = -168; taxi.angle = Math.PI; taxi.speed = 9;
      }
      var parked = parkedCars[2];
      if (parked && parked !== car) {
        parked.x = 208.5; parked.z = -145; parked.angle = Math.PI; parked.speed = 0;
        parked.isParked = true;
      }
      updateCamera(0.5);
      return { ok: true, shot: 'drive' };
    }
    if (name === 'chase') {
      // the signature red car (parkedCars[0]) so the player car is unmistakable
      var car2 = parkedCars[0] || makeCar('sedan', 200, 100, 0);
      player.inCar = true; player.car = car2;
      car2.isParked = false;
      player.group.visible = false;
      car2.x = 200; car2.z = 100; car2.angle = 0; car2.speed = 20;
      S.stagedCruise = true;
      player.x = car2.x; player.z = car2.z;
      S.wanted = 4; S.searching = false;
      updateStarsHud();
      while (policeCars.length < 2) spawnPoliceCar();
      spawnHeli();
      heliOrbit.r = 36; heliOrbit.h = 22; // rapatkan orbit: heli lebih besar di frame
      if (heli) heli.angle = Math.PI / 2 - 0.5; // heli ahead of the car, in frame
      // low, wide chase camera: the heli (28u up, 48u ahead) fits the frame
      // above the car, with the flanking police cars and the 4 stars.
      mouse.yawOff = 0; mouse.zoom = 20; mouse.pitchOff = -0.25;
      updateCamera(0.5);
      return { ok: true, shot: 'chase', wanted: S.wanted };
    }
    if (name === 'mission') {
      // on foot at the zebra (-200,-200) — the mission marker is right
      // there: a crossing ped mid-crossing ON the thick white stripes,
      // the yellow marker cone ahead. Clear any leftover wanted level
      // from earlier stages so the shot is clean.
      S.wanted = 0; S.searching = false; S.policeEngaged = false;
      updateStarsHud();
      policeCars.forEach(function (c) { scene.remove(c.mesh.group); });
      policeCars.length = 0;
      cars = cars.filter(function (c) { return !c.isPolice; });
      footCops.forEach(function (c) { scene.remove(c.group); });
      footCops.length = 0;
      if (heli) { scene.remove(heli.group); heli = null; }
      player.inCar = false; player.car = null;
      player.group.visible = true;
      // tight framing: the player stands on the sidewalk right by the zebra,
      // so the intersection (zebra + crosser + traffic light + taxi + marker)
      // fills the frame instead of empty grass. x=-198 keeps the corner
      // hydrant out of the shot.
      player.x = -198; player.z = -185;
      player.angle = -Math.PI / 2; // facing west, toward the marker
      S.mission = 0;
      updateMissionHud();
      var cp = peds.filter(function (p) { return p.activity === 'cross' && p.crossing.x === -200 && p.crossing.z === -200; })[0];
      if (cp) {
        cp.state = 1;
        cp.x = -200; cp.z = -201.5; // mid-crossing, ON a stripe
        cp.angle = -Math.PI / 2;
      }
      setTrafficPhase('EW'); // cars on the avenue have red -> peds cross
      // a taxi waiting at the red light on the avenue, just north of the zebra
      var mtaxi = trafficCars.filter(function (c) { return c.type === 'taxi'; })[0] || trafficCars[0];
      if (mtaxi) {
        mtaxi.road = { kind: 'avenue', at: -200 };
        mtaxi.x = -203.5; mtaxi.z = -168; mtaxi.angle = Math.PI; mtaxi.speed = 0;
      }
      mouse.yawOff = -0.6; mouse.zoom = 12; mouse.pitchOff = 0; // look southwest: marker + zebra + crosser in frame
      updateCamera(0.5);
      return { ok: true, shot: 'mission' };
    }
    return { ok: false, why: 'unknown stage ' + name };
  }

  global.VC.debug = {
    cityHash: function () { return city.hash; },
    worldProps: worldProps,
    pedActivities: pedActivities,
    crossPeds: crossPeds,
    trafficPhase: trafficPhase,
    setTrafficPhase: setTrafficPhase,
    trafficLights: function () {
      return cityData.trafficLights.map(function (tl) {
        return { x: tl.x, z: tl.z, axis: tl.axis, green: tl.axis === trafficPhase() };
      });
    },
    trafficStoppedAtRed: trafficStoppedAtRed,
    redLightProbe: redLightProbe,
    step: step,
    stage: stage,
    startGame: function () { startGame(false); },
    state: function () {
      return {
        cash: S.cash, mission: S.mission, health: S.health, wanted: S.wanted,
        searching: S.searching, started: S.started, time: +S.time.toFixed(2),
        player: { x: +player.x.toFixed(1), z: +player.z.toFixed(1), inCar: player.inCar },
        cars: cars.length, traffic: trafficCars.length, police: policeCars.length,
        cops: footCops.length, heli: !!heli, peds: peds.length,
        pedCounts: S.pedCounts || {}
      };
    },
    playerPos: function () { return { x: player.x, z: player.z, inCar: player.inCar }; },
    camPos: function () {
      return { x: +camera.position.x.toFixed(1), y: +camera.position.y.toFixed(1), z: +camera.position.z.toFixed(1) };
    },
    setHeliAngle: function (a) { if (heli) heli.angle = a; },
    setHeliOrbit: function (r, h) { heliOrbit.r = r; heliOrbit.h = h; },
    setWanted: function (n) { S.wanted = n; S.searching = n > 0; S.policeEngaged = n > 0; updateStarsHud(); },
    teleport: function (x, z) {
      player.x = x; player.z = z;
      if (player.inCar && player.car) { player.car.x = x; player.car.z = z; }
      player.group.position.set(x, 0, z);
      updateCamera(0.5);
    },
    setCamYaw: setCamYaw,
    setZoom: function (z) { mouse.zoom = z; },
    enterCar: function () { tryEnterExitCar(); },
    punch: punch,
    shoot: shoot,
    complete: complete,
    wasted: wasted,
    busted: busted,
    saveInfo: function () { return loadSave(); },
    setCash: function (n) { S.cash = n; updateCashHud(); },
    setHealth: function (n) { S.health = n; updateHealthHud(); },
    setCarHealth: function (n) { if (player.inCar && player.car) player.car.carHealth = n; },
    bloodCount: function () { return splats.length + bloodParts.length; },
    copPositions: function () {
      return footCops.map(function (c) { return { x: +c.x.toFixed(1), z: +c.z.toFixed(1) }; });
    },
    policePositions: function () {
      return policeCars.map(function (c) { return { x: +c.x.toFixed(1), z: +c.z.toFixed(1), speed: +c.speed.toFixed(1) }; });
    },
    missionTarget: function () {
      return S.mission < MISSIONS.length ? MISSIONS[S.mission].target : null;
    },
    carsNear: function (x, z, r) {
      return cars.filter(function (c) { return Math.hypot(c.x - x, c.z - z) < r; })
        .map(function (c) { return { type: c.type, x: +c.x.toFixed(1), z: +c.z.toFixed(1), speed: +c.speed.toFixed(1) }; });
    },
    pedsNear: function (x, z, r) {
      return peds.filter(function (p) { return !p.dead && Math.hypot(p.x - x, p.z - z) < r; })
        .map(function (p) { return { activity: p.activity, x: +p.x.toFixed(1), z: +p.z.toFixed(1) }; });
    }
  };

  // Player headlight: a spotlight ahead of the player's car.
  function buildHeadlight() {
    headlight = new THREE.SpotLight(0xfff2c0, 1.6, 55, 0.5, 0.45, 1);
    headlightTarget = new THREE.Object3D();
    scene.add(headlightTarget);
    headlight.target = headlightTarget;
    scene.add(headlight);
  }

  // init runs after the DOM is ready (script tags are at the end of body).
  init();
  buildHeadlight();
})(typeof window !== 'undefined' ? window : globalThis);
