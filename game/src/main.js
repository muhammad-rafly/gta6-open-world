import { makeRng } from './rng.js';
import { buildWorld, MAP_X, MAP_Z, ROADS_V, ROADS_H } from './world.js';

const THREE = window.THREE;
const params = new URLSearchParams(location.search);
const SEED = params.get('seed') || 'velvet-city';
const SHOT = params.get('shot') || '';
const rng = makeRng(SEED);

const SAVE_KEY = 'velvet-city-save-v1';
const CAR_TOP = 30;
const WALK_SPEED = 6;
const FIRE_CD = 0.22;
const RAM_DMG = 14;
const RAM_CD = 2.5;
const BUST_TIME = 2;
const CAR_R = 2.2;

const MISSIONS = [
  { name: 'Steal a car', pay: 200, target: null },
  { name: 'Deliver to East Docks', pay: 400, target: [800, -400] },
  { name: 'Deliver to West Market', pay: 600, target: [-800, 400] },
  { name: 'Deliver to North Yard', pay: 800, target: [-1000, -800] },
  { name: 'Deliver to South Gate', pay: 1500, target: [1200, 800] },
];

const S = {
  screen: 'title', money: 0, mission: 0, wanted: 0, health: 100, carhp: 100,
  incar: false, speed: 0, x: 0, z: 0, heading: Math.PI / 2,
  bustTimer: 0, fireCd: 0, collCd: 0, hitCd: 0, time: 0, frames: 0,
  headlight: false, station: 0,
};

// ---------- DOM ----------
const canvas = document.getElementById('game');
const hudState = document.getElementById('hud-state');
const elMoney = document.getElementById('hud-money');
const elMission = document.getElementById('hud-mission');
const elStars = document.getElementById('stars');
const elCar = document.getElementById('hud-car');
const elRadio = document.getElementById('hud-radio');
const elObj = document.getElementById('obj');
const elTitle = document.getElementById('ov-title');
const elBig = document.getElementById('ov-big');
const elSub = document.getElementById('ov-sub');
const elCross = document.getElementById('crosshair');
const mm = document.getElementById('minimap');
const mmCtx = mm.getContext('2d');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1420);
scene.fog = new THREE.Fog(0x0d1420, 220, 1500);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(-8, 4, 0);
scene.add(new THREE.HemisphereLight(0x8fa3c7, 0x1a1c20, 0.75));
const moon = new THREE.DirectionalLight(0xffd9a0, 0.85);
moon.position.set(300, 420, 200);
moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.camera.left = -90;
moon.shadow.camera.right = 90;
moon.shadow.camera.top = 90;
moon.shadow.camera.bottom = -90;
moon.shadow.camera.near = 1;
moon.shadow.camera.far = 1200;
moon.shadow.bias = -0.002;
scene.add(moon);
scene.add(moon.target);

const world = buildWorld(scene, rng, renderer);

// ---------- helpers ----------
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function angNorm(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function fwd(h) { return [Math.sin(h), Math.cos(h)]; }
function dist2(ax, az, bx, bz) { const dx = ax - bx; const dz = az - bz; return dx * dx + dz * dz; }
function hitBuilding(x, z, r) {
  for (const b of world.buildings) {
    if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return b;
  }
  return null;
}
function moveWithBuildings(e, dx, dz, r) {
  // Try full move, then axis-separated slide.
  const nx = e.x + dx;
  const nz = e.z + dz;
  if (!hitBuilding(nx, nz, r)) { e.x = nx; e.z = nz; return true; }
  if (!hitBuilding(nx, e.z, r)) { e.x = nx; return false; }
  if (!hitBuilding(e.x, nz, r)) { e.z = nz; return false; }
  return false;
}

// ---------- car factory ----------
// "POLICE" door decal, drawn once and shared by every police car.
function policeTextTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = '#101010';
  g.font = 'bold 46px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('POLICE', 128, 34);
  return new THREE.CanvasTexture(c);
}
const POLICE_TEX = policeTextTexture();

function makeCarMesh(colorHex, police, detailed) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: colorHex });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.72, 4.4), bodyMat);
  body.position.y = 0.62;
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.6, 2.1),
    new THREE.MeshLambertMaterial({ color: 0x11151c }),
  );
  cabin.position.set(0, 1.2, -0.2);
  g.add(cabin);
  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(2.05, 0.34, 4.2),
    new THREE.MeshLambertMaterial({ color: 0x0a0c0e }),
  );
  skirt.position.y = 0.28;
  g.add(skirt);
  const hlMat = new THREE.MeshLambertMaterial({ color: 0x444444, emissive: 0xfff2c0, emissiveIntensity: 0.9 });
  for (const s of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.1), hlMat);
    hl.position.set(s, 0.62, 2.22);
    g.add(hl);
    const tl = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.2, 0.1),
      new THREE.MeshLambertMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: 0.8 }),
    );
    tl.position.set(s, 0.62, -2.22);
    g.add(tl);
  }
  let barL = null;
  let barR = null;
  if (police) {
    // Black-and-white livery: black hood, trunk and door band on the white body.
    const blackMat = new THREE.MeshLambertMaterial({ color: 0x0c0e10 });
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 1.2), blackMat);
    hood.position.set(0, 1.0, 1.5);
    g.add(hood);
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.8), blackMat);
    trunk.position.set(0, 1.0, -1.7);
    g.add(trunk);
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.42, 2.3), blackMat);
    band.position.set(0, 0.62, -0.1);
    g.add(band);
    // Full-width roof light bar: dark base + larger red/blue lenses.
    const barBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.1, 0.42),
      new THREE.MeshLambertMaterial({ color: 0x14161a }),
    );
    barBase.position.set(0, 1.56, -0.2);
    g.add(barBase);
    barL = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.22, 0.36), new THREE.MeshLambertMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 2 }));
    barL.position.set(-0.42, 1.7, -0.2);
    g.add(barL);
    barR = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.22, 0.36), new THREE.MeshLambertMaterial({ color: 0x000022, emissive: 0x2244ff, emissiveIntensity: 2 }));
    barR.position.set(0.42, 1.7, -0.2);
    g.add(barR);
    // "POLICE" decals on both doors (read correctly from either side).
    const sideMat = new THREE.MeshBasicMaterial({ map: POLICE_TEX, transparent: true });
    for (const s of [-1, 1]) {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), sideMat);
      decal.position.set(s * 1.04, 0.62, -0.1);
      decal.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(decal);
    }
  }
  // Wheels on the cars the player sees up close (player + police only,
  // so traffic stays cheap). Axle along X.
  if (detailed) {
    const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 10);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0a0a0a });
    for (const wx of [-0.95, 0.95]) {
      for (const wz of [-1.45, 1.45]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.45, wz);
        g.add(w);
      }
    }
  }
  // Solid car parts cast shadows — player + police only (traffic stays
  // cheap in the shadow pass); transparent decals must not.
  if (detailed) g.traverse((o) => { if (o.isMesh && o.material && o.material.transparent !== true) o.castShadow = true; });
  return { group: g, barL, barR };
}

const TRAFFIC_COLORS = [0x3a6ab0, 0xb0a03a, 0x4a9a5a, 0x8a8f96, 0x7a4a9a, 0xb06a3a, 0x3a9a9a, 0x9a3a4a];
function spawnCar(kind, x, z, heading, speed) {
  const color = kind === 'police' ? 0xe8e8e8 : (kind === 'player' ? 0xb03030 : TRAFFIC_COLORS[Math.floor(rng() * TRAFFIC_COLORS.length)]);
  const mesh = makeCarMesh(color, kind === 'police', kind !== 'traffic');
  mesh.group.position.set(x, 0, z);
  mesh.group.rotation.y = heading;
  scene.add(mesh.group);
  return {
    kind, mesh, x, z, heading, speed,
    hp: 100, ramCd: 0, maxSpeed: kind === 'police' ? 20 : (kind === 'player' ? CAR_TOP : 9 + rng() * 5),
    axis: null, road: 0, dir: 1, lane: 3,
  };
}

// Player car (mission car) parked at (18, 0), heading east.
const playerCar = spawnCar('player', 18, 0, Math.PI / 2, 0);
const cars = [playerCar];

// Traffic: 10 cars on roads, kept away from the spawn area.
const traffic = [];
for (let i = 0; i < 10; i += 1) {
  let x = 0;
  let z = 0;
  let guard = 0;
  do {
    if (rng() < 0.5) {
      z = ROADS_H[Math.floor(rng() * ROADS_H.length)] + (rng() - 0.5) * 6;
      x = (rng() * 2 - 1) * 1400;
    } else {
      x = ROADS_V[Math.floor(rng() * ROADS_V.length)] + (rng() - 0.5) * 6;
      z = (rng() * 2 - 1) * 1000;
    }
    guard += 1;
  } while (guard < 20 && dist2(x, z, 0, 0) < 3600);
  const axis = Math.abs(z - ROADS_H.reduce((a, b) => (Math.abs(z - b) < Math.abs(z - a) ? b : a))) < Math.abs(x - ROADS_V.reduce((a, b) => (Math.abs(x - b) < Math.abs(x - a) ? b : a))) ? 'x' : 'z';
  const dir = rng() < 0.5 ? 1 : -1;
  const head = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
  const c = spawnCar('traffic', x, z, head, 0);
  c.axis = axis;
  c.road = axis === 'x' ? ROADS_H.reduce((a, b) => (Math.abs(z - b) < Math.abs(z - a) ? b : a)) : ROADS_V.reduce((a, b) => (Math.abs(x - b) < Math.abs(x - a) ? b : a));
  c.dir = dir;
  c.speed = 8 + rng() * 5;
  c.lane = dir > 0 ? 3 : -3;
  traffic.push(c);
  cars.push(c);
}

// Police pool (spawned on demand by wanted level).
const police = [];
function spawnPolice() {
  // Place on a road 80-120 m from the player.
  let x = 0;
  let z = 0;
  let guard = 0;
  do {
    const a = rng() * Math.PI * 2;
    const d = 80 + rng() * 40;
    x = clamp(S.x + Math.sin(a) * d, -1500, 1500);
    z = clamp(S.z + Math.cos(a) * d, -1100, 1100);
    // Snap to the nearest road.
    const nv = ROADS_V.reduce((p, b) => (Math.abs(x - b) < Math.abs(x - p) ? b : p));
    const nh = ROADS_H.reduce((p, b) => (Math.abs(z - b) < Math.abs(z - p) ? b : p));
    if (Math.abs(x - nv) < Math.abs(z - nh)) x = nv + (rng() - 0.5) * 6;
    else z = nh + (rng() - 0.5) * 6;
    guard += 1;
  } while (guard < 10 && dist2(x, z, S.x, S.z) < 3600);
  const p = spawnCar('police', x, z, 0, 0);
  p.maxSpeed = 16 + S.wanted * 2.4;
  cars.push(p);
  police.push(p);
  return p;
}

// ---------- pedestrians (72, instanced, sidewalk loops) ----------
const PEDS = 72;
const pedBodyGeo = new THREE.BoxGeometry(0.55, 1.05, 0.32);
const pedBodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const pedBodies = new THREE.InstancedMesh(pedBodyGeo, pedBodyMat, PEDS);
const pedHeadGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
const pedHeadMat = new THREE.MeshLambertMaterial({ color: 0xd9a986 });
const pedHeads = new THREE.InstancedMesh(pedHeadGeo, pedHeadMat, PEDS);
scene.add(pedBodies);
scene.add(pedHeads);
const PED_COLORS = [0xc0392b, 0x2980b9, 0x27ae60, 0x8e44ad, 0xd35400, 0x16a085, 0x7f8c8d, 0xb03a5b];
const peds = [];
for (let i = 0; i < PEDS; i += 1) {
  const vertical = rng() < 0.5;
  const road = vertical ? ROADS_V[Math.floor(rng() * ROADS_V.length)] : ROADS_H[Math.floor(rng() * ROADS_H.length)];
  const side = rng() < 0.5 ? -15 : 15;
  const span = vertical ? 2200 : 3000;
  const along = (rng() * 2 - 1) * (span / 2 - 60);
  const p = {
    vertical, road, side, along, dir: rng() < 0.5 ? 1 : -1,
    speed: 0.9 + rng() * 1.1, fallen: 0, color: PED_COLORS[Math.floor(rng() * PED_COLORS.length)],
  };
  // Keep the opening walk clear.
  if (dist2(vertical ? road + side : along, vertical ? along : road + side, 0, 0) < 100) { p.along += 120; }
  peds.push(p);
  pedBodies.setColorAt(i, new THREE.Color(p.color));
}
pedBodies.instanceColor.needsUpdate = true;

// ---------- player on-foot mesh ----------
const walker = new THREE.Group();
const wBody = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.05, 0.36), new THREE.MeshLambertMaterial({ color: 0x2e6fb0 }));
wBody.position.y = 0.95;
walker.add(wBody);
const wHead = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), new THREE.MeshLambertMaterial({ color: 0xd9a986 }));
wHead.position.y = 1.68;
walker.add(wHead);
scene.add(walker);

// ---------- helicopter (wanted >= 4) ----------
const heli = new THREE.Group();
const hBody = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 6), new THREE.MeshLambertMaterial({ color: 0x1c2733 }));
heli.add(hBody);
const hTail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 5), new THREE.MeshLambertMaterial({ color: 0x1c2733 }));
hTail.position.set(0, 0.3, -5);
heli.add(hTail);
const hRotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.7), new THREE.MeshLambertMaterial({ color: 0x0a0c0e }));
hRotor.position.y = 1;
heli.add(hRotor);
const search = new THREE.SpotLight(0xfff6c0, 0, 260, 0.32, 0.5, 1);
scene.add(search);
scene.add(search.target);
heli.visible = false;
scene.add(heli);

// ---------- mission beacon ----------
const beacon = new THREE.Group();
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(2.2, 2.2, 90, 10, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
);
beam.position.y = 45;
beacon.add(beam);
const beaconBase = new THREE.Mesh(
  new THREE.CylinderGeometry(6, 6, 0.4, 20),
  new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.55 }),
);
beaconBase.position.y = 0.2;
beacon.add(beaconBase);
scene.add(beacon);

// ---------- headlight + muzzle flash ----------
const headlight = new THREE.SpotLight(0xfff2c0, 0, 70, 0.5, 0.45, 1);
scene.add(headlight);
scene.add(headlight.target);
const muzzle = new THREE.PointLight(0xffc860, 0, 26, 1.5);
scene.add(muzzle);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0 });
const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1), tracerMat);
scene.add(tracer);

// ---------- save / missions ----------
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (typeof d.money !== 'number' || typeof d.mission !== 'number') return null;
    return d;
  } catch (e) { return null; }
}
function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ money: S.money, mission: S.mission })); } catch (e) { /* storage unavailable */ }
}
let flashText = '';
let flashT = 0;
function flashObj(t) { flashText = t; flashT = 4; }
function complete(pay) {
  S.mission += 1; // mission index FIRST, then the save is written (hard rule)
  S.money += pay;
  writeSave();
  flashObj('Mission complete! +$' + pay);
}
function clearPolice() {
  for (const p of police) {
    scene.remove(p.mesh.group);
    const i = cars.indexOf(p);
    if (i >= 0) cars.splice(i, 1);
  }
  police.length = 0;
}
let curCar = null;
function resetRun(money, mission) {
  flashT = 0; flashText = '';
  S.money = money; S.mission = mission; S.wanted = 0; S.health = 100; S.carhp = 100;
  S.incar = false; S.speed = 0; S.x = 0; S.z = 0; S.heading = Math.PI / 2;
  S.bustTimer = 0; S.fireCd = 0; S.collCd = 0; S.hitCd = 0;
  curCar = null;
  playerCar.x = 18; playerCar.z = 0; playerCar.heading = Math.PI / 2; playerCar.speed = 0; playerCar.hp = 100;
  clearPolice();
  for (const p of peds) p.fallen = 0;
  S.screen = 'play';
  initAudio();
}
function startGame(useSave) {
  const sv = useSave ? loadSave() : null;
  resetRun(sv ? sv.money : 0, sv ? sv.mission : 0);
}
function restart() { startGame(true); }
function freshStart() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  startGame(false);
}
function goWasted() {
  if (S.screen !== 'play') return;
  S.screen = 'wasted';
  S.wanted = 0;
}
function goBusted() {
  if (S.screen !== 'play') return;
  S.screen = 'busted';
  S.wanted = 0;
}
function damageCar(amount) {
  if (!curCar) return;
  curCar.hp -= amount;
  S.carhp = curCar.hp;
  if (S.carhp <= 0) { S.carhp = 0; goWasted(); }
}

// ---------- input ----------
const keys = {};
function toggleCar() {
  if (!S.incar) {
    let best = null;
    let bd = Infinity;
    for (const c of cars) {
      if (c.kind === 'police') continue;
      const d = dist2(S.x, S.z, c.x, c.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (best && bd <= 36) {
      curCar = best;
      S.incar = true;
      S.carhp = curCar.hp;
      S.x = curCar.x; S.z = curCar.z; S.heading = curCar.heading; S.speed = curCar.speed;
      if (S.mission === 0) complete(MISSIONS[0].pay);
    }
  } else {
    const c = curCar;
    S.x = c.x + Math.cos(c.heading) * 3;
    S.z = c.z - Math.sin(c.heading) * 3;
    S.heading = c.heading;
    S.speed = 0;
    S.incar = false;
    curCar = null;
  }
}
function handlePress(code) {
  if (S.screen === 'title') {
    if (code === 'Enter') startGame(true);
    else if (code === 'KeyN') freshStart();
    return;
  }
  if (S.screen === 'busted' || S.screen === 'wasted') {
    if (code === 'KeyR' || code === 'Enter') restart();
    return;
  }
  if (S.screen !== 'play') return;
  if (code === 'KeyF') toggleCar();
  else if (code === 'KeyH') S.headlight = !S.headlight;
  else if (code === 'KeyQ') setStation((S.station + 1) % 3);
}
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Enter' || e.code === 'KeyN' || e.code === 'KeyR' || e.code === 'KeyF' || e.code === 'KeyH' || e.code === 'KeyQ') handlePress(e.code);
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// ---------- shooting (on foot only) ----------
function shootFx() {
  muzzle.position.set(S.x + Math.sin(S.heading) * 1.6, 1.5, S.z + Math.cos(S.heading) * 1.6);
  muzzle.intensity = 3;
  tracer.position.set(S.x + Math.sin(S.heading) * 20, 1.4, S.z + Math.cos(S.heading) * 20);
  tracer.rotation.y = S.heading;
  tracer.scale.set(1, 1, 40);
  tracerMat.opacity = 0.9;
}
canvas.addEventListener('mousedown', () => {
  if (S.screen !== 'play' || S.incar || S.fireCd > 0) return;
  S.fireCd = FIRE_CD;
  S.wanted = Math.min(5, S.wanted + 1);
  shootFx();
  const fx = Math.sin(S.heading);
  const fz = Math.cos(S.heading);
  let bestPed = null;
  let bestD = 55 * 55;
  for (const p of peds) {
    if (p.fallen > 0) continue;
    const px = p.vertical ? p.road + p.side : p.along;
    const pz = p.vertical ? p.along : p.road + p.side;
    const dx = px - S.x;
    const dz = pz - S.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > bestD) continue;
    const d = Math.sqrt(d2) || 1;
    if ((dx * fx + dz * fz) / d > 0.995) { bestD = d2; bestPed = p; }
  }
  if (bestPed) bestPed.fallen = 15;
  for (const c of cars) {
    if (c === curCar) continue;
    const dx = c.x - S.x;
    const dz = c.z - S.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 3600) continue;
    const d = Math.sqrt(d2) || 1;
    if ((dx * fx + dz * fz) / d > 0.995) c.speed *= 0.7;
  }
  playShot();
});

// ---------- player update ----------
function updatePlayer(dt) {
  if (S.incar) {
    const c = curCar;
    const fwdIn = keys['KeyW'] || keys['ArrowUp'];
    const backIn = keys['KeyS'] || keys['ArrowDown'];
    const leftIn = keys['KeyA'] || keys['ArrowLeft'];
    const rightIn = keys['KeyD'] || keys['ArrowRight'];
    if (fwdIn) c.speed += 13 * dt;
    else if (backIn) c.speed -= (c.speed > 0.5 ? 20 * dt : 8 * dt);
    else c.speed -= c.speed * 0.5 * dt;
    c.speed = clamp(c.speed, -8, CAR_TOP);
    const steer = (leftIn ? 1 : 0) - (rightIn ? 1 : 0);
    c.heading += steer * 1.9 * dt * clamp(c.speed / 8, -1, 1);
    const dx = Math.sin(c.heading) * c.speed * dt;
    const dz = Math.cos(c.heading) * c.speed * dt;
    const blocked = !moveWithBuildings(c, dx, dz, CAR_R);
    if (blocked) {
      if (Math.abs(c.speed) > 6 && S.collCd <= 0) { damageCar(5); S.collCd = 0.5; }
      c.speed *= 0.6;
    }
    if (c.x > 1590 || c.x < -1590) { c.x = clamp(c.x, -1590, 1590); c.speed *= -0.25; }
    if (c.z > 1190 || c.z < -1190) { c.z = clamp(c.z, -1190, 1190); c.speed *= -0.25; }
    S.x = c.x; S.z = c.z; S.heading = c.heading; S.speed = c.speed;
    S.carhp = c.hp;
  } else {
    if (keys['KeyA'] || keys['ArrowLeft']) S.heading += 2.6 * dt;
    if (keys['KeyD'] || keys['ArrowRight']) S.heading -= 2.6 * dt;
    let mv = 0;
    if (keys['KeyW'] || keys['ArrowUp']) mv = WALK_SPEED;
    else if (keys['KeyS'] || keys['ArrowDown']) mv = -3;
    S.speed = mv;
    const fx = Math.sin(S.heading);
    const fz = Math.cos(S.heading);
    moveWithBuildings(S, fx * mv * dt, fz * mv * dt, 0.5);
    S.x = clamp(S.x, -1595, 1595);
    S.z = clamp(S.z, -1195, 1195);
  }
  // Mission delivery check (in a car, missions 1-4).
  if (S.incar && S.mission >= 1 && S.mission <= 4) {
    const t = MISSIONS[S.mission].target;
    if (t && dist2(S.x, S.z, t[0], t[1]) < 64) complete(MISSIONS[S.mission].pay);
  }
}

// ---------- traffic ----------
function updateTraffic(dt) {
  for (const c of traffic) {
    if (c === curCar) {
      // The player is driving this one: sync the mesh only, no AI.
      c.mesh.group.position.set(c.x, 0, c.z);
      c.mesh.group.rotation.y = c.heading;
      continue;
    }
    if (c.axis === 'x') {
      c.x += c.dir * c.speed * dt;
      c.z = c.road + c.lane;
      if (c.x > 1560 || c.x < -1560) { c.dir *= -1; c.heading = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
    } else {
      c.z += c.dir * c.speed * dt;
      c.x = c.road + c.lane;
      if (c.z > 1160 || c.z < -1160) { c.dir *= -1; c.heading = c.dir > 0 ? 0 : Math.PI; }
    }
    c.mesh.group.position.set(c.x, 0, c.z);
    c.mesh.group.rotation.y = c.heading;
    // Collisions with the player.
    if (S.screen !== 'play') continue;
    const d2 = dist2(c.x, c.z, S.x, S.z);
    if (S.incar && d2 < 21 && S.collCd <= 0) {
      damageCar(8);
      S.collCd = 0.5;
      c.speed *= 0.5;
      if (curCar) curCar.speed *= 0.7;
    } else if (!S.incar && d2 < 4.8 && S.hitCd <= 0) {
      S.health -= 10;
      S.hitCd = 1;
      const dx = S.x - c.x;
      const dz = S.z - c.z;
      const d = Math.sqrt(d2) || 1;
      S.x = clamp(S.x + (dx / d) * 3, -1595, 1595);
      S.z = clamp(S.z + (dz / d) * 3, -1195, 1195);
      if (S.health <= 0) { S.health = 0; goWasted(); }
    }
  }
}

// ---------- police ----------
function updatePolice(dt) {
  const want = S.wanted > 0 ? Math.min(S.wanted, 5) : 0;
  while (police.length < want) spawnPolice();
  let nearest = 1e9;
  for (let i = 0; i < police.length; i += 1) {
    const p = police[i];
    p.maxSpeed = 16 + S.wanted * 2.4;
    p.ramCd = Math.max(0, p.ramCd - dt);
    const dx = S.x - p.x;
    const dz = S.z - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
    if (dist < nearest) nearest = dist;
    // Spread formation: each unit aims at a different offset beside the player.
    const off = (i - (police.length - 1) / 2) * 7;
    const tx = S.x + (-dz / dist) * off;
    const tz = S.z + (dx / dist) * off;
    const wantH = Math.atan2(tx - p.x, tz - p.z);
    let err = angNorm(wantH - p.heading);
    const turn = clamp(err, -2.4 * dt, 2.4 * dt);
    p.heading += turn;
    // HARD RULE 1 — ease-in: full speed beyond 40 m, smooth ramp inside,
    // creep at 2 m/s inside 6 m.
    let targetSpeed;
    if (dist > 40) targetSpeed = p.maxSpeed;
    else if (dist < 6) targetSpeed = 2;
    else targetSpeed = 2 + (p.maxSpeed - 2) * ((dist - 6) / 34);
    if (p.speed < targetSpeed) p.speed = Math.min(targetSpeed, p.speed + 12 * dt);
    else p.speed = Math.max(targetSpeed, p.speed - 20 * dt);
    const mdx = Math.sin(p.heading) * p.speed * dt;
    const mdz = Math.cos(p.heading) * p.speed * dt;
    if (!moveWithBuildings(p, mdx, mdz, CAR_R)) p.speed *= 0.3;
    p.x = clamp(p.x, -1590, 1590);
    p.z = clamp(p.z, -1190, 1190);
    p.mesh.group.position.set(p.x, 0, p.z);
    p.mesh.group.rotation.y = p.heading;
    // Light bar flash.
    const phase = Math.floor(S.time * 4) % 2 === 0;
    if (p.mesh.barL) p.mesh.barL.material.emissiveIntensity = phase ? 2.5 : 0.2;
    if (p.mesh.barR) p.mesh.barR.material.emissiveIntensity = phase ? 0.2 : 2.5;
    // HARD RULE 2 — ram: per-car 2.5 s cooldown, only when closing > 1.
    if (S.incar && dist < 4.2 && p.ramCd <= 0) {
      const pvx = Math.sin(p.heading) * p.speed;
      const pvz = Math.cos(p.heading) * p.speed;
      const cvx = Math.sin(S.heading) * S.speed;
      const cvz = Math.cos(S.heading) * S.speed;
      const closing = ((pvx - cvx) * dx + (pvz - cvz) * dz) / dist;
      if (closing > 1) {
        damageCar(RAM_DMG);
        p.ramCd = RAM_CD;
        if (curCar) curCar.speed += 2;
        // Heat rises only when the player's car is faster than the police car.
        if (Math.abs(S.speed) > p.speed) S.wanted = Math.min(5, S.wanted + 1);
      }
    }
  }
  // Bust logic.
  if (S.screen === 'play' && S.wanted > 0 && police.length > 0) {
    if (S.incar) {
      if (Math.abs(S.speed) < 1 && nearest < 3) {
        S.bustTimer += dt;
        if (S.bustTimer >= BUST_TIME) goBusted();
      } else {
        S.bustTimer = 0;
      }
    } else if (nearest < 3) {
      goBusted();
    }
  }
}

// ---------- pedestrians ----------
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
function updatePeds(dt) {
  for (let i = 0; i < peds.length; i += 1) {
    const p = peds[i];
    if (p.fallen > 0) {
      p.fallen -= dt;
      if (p.fallen <= 0) {
        // Respawn at a fresh seeded sidewalk spot.
        p.vertical = rng() < 0.5;
        p.road = p.vertical ? ROADS_V[Math.floor(rng() * ROADS_V.length)] : ROADS_H[Math.floor(rng() * ROADS_H.length)];
        p.side = rng() < 0.5 ? -15 : 15;
        p.along = (rng() * 2 - 1) * 1000;
        p.dir = rng() < 0.5 ? 1 : -1;
      }
      _v.set(0, -3, 0);
      _s.set(1, 1, 1);
      _m4.compose(_v, _q, _s);
      pedBodies.setMatrixAt(i, _m4);
      pedHeads.setMatrixAt(i, _m4);
      continue;
    }
    const span = p.vertical ? 2200 : 3000;
    p.along += p.dir * p.speed * dt;
    if (p.along > span / 2 - 60) p.dir = -1;
    if (p.along < -span / 2 + 60) p.dir = 1;
    const px = p.vertical ? p.road + p.side : p.along;
    const pz = p.vertical ? p.along : p.road + p.side;
    const h = p.vertical ? (p.dir > 0 ? 0 : Math.PI) : (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    _e.set(0, h, 0);
    _q.setFromEuler(_e);
    _v.set(px, 0.55, pz);
    _s.set(1, 1, 1);
    _m4.compose(_v, _q, _s);
    pedBodies.setMatrixAt(i, _m4);
    _v.set(px, 1.68, pz);
    _m4.compose(_v, _q, _s);
    pedHeads.setMatrixAt(i, _m4);
  }
  pedBodies.instanceMatrix.needsUpdate = true;
  pedHeads.instanceMatrix.needsUpdate = true;
}

// ---------- helicopter ----------
let heliAngle = 0;
function updateHeli(dt) {
  if (S.wanted >= 4 && S.screen === 'play') {
    heli.visible = true;
    heliAngle += dt * 0.35;
    const hx = S.x + Math.cos(heliAngle) * 45;
    const hz = S.z + Math.sin(heliAngle) * 45;
    heli.position.set(hx, 56, hz);
    heli.rotation.y = -heliAngle;
    hRotor.rotation.y += dt * 22;
    search.position.set(hx, 55, hz);
    search.target.position.set(S.x, 0, S.z);
    search.intensity = 2.4;
  } else {
    heli.visible = false;
    search.intensity = 0;
  }
}

// ---------- camera ----------
const camPos = new THREE.Vector3(-8, 4, 0);
function updateCamera(dt) {
  const fx = Math.sin(S.heading);
  const fz = Math.cos(S.heading);
  const dist = S.incar ? 11.5 : 7;
  const height = S.incar ? 4.6 : 3.2;
  const tx = S.x - fx * dist;
  const tz = S.z - fz * dist;
  const k = 1 - Math.exp(-6 * dt);
  camPos.x += (tx - camPos.x) * k;
  camPos.y += (height - camPos.y) * k;
  camPos.z += (tz - camPos.z) * k;
  camera.position.copy(camPos);
  camera.lookAt(S.x + fx * 3, 1.2, S.z + fz * 3);
  if (S.incar && curCar) {
    headlight.position.set(curCar.x + fx * 2, 1, curCar.z + fz * 2);
    headlight.target.position.set(curCar.x + fx * 30, 0, curCar.z + fz * 30);
    headlight.intensity = S.headlight ? 2.2 : 0;
  } else {
    headlight.intensity = 0;
  }
}

// ---------- HUD / minimap ----------
function objText() {
  if (flashT > 0) return flashText;
  if (S.mission === 0) return 'Objective: steal a car — get in the car ahead (press F)';
  if (S.mission >= 1 && S.mission <= 4) {
    const t = MISSIONS[S.mission].target;
    const d = Math.round(Math.sqrt(dist2(S.x, S.z, t[0], t[1])));
    return 'Objective: ' + MISSIONS[S.mission].name + ' — ' + d + ' m';
  }
  return 'All missions complete — free roam. Port Meridian is yours.';
}
function objDist() {
  if (S.mission === 0) return Math.round(Math.sqrt(dist2(S.x, S.z, 18, 0)));
  if (S.mission >= 1 && S.mission <= 4) {
    const t = MISSIONS[S.mission].target;
    return Math.round(Math.sqrt(dist2(S.x, S.z, t[0], t[1])));
  }
  return 0;
}
function updateHud() {
  const d = hudState.dataset;
  d.screen = S.screen;
  d.money = String(S.money);
  d.mission = String(S.mission);
  d.wanted = String(S.wanted);
  d.incar = S.incar ? '1' : '0';
  d.carhp = String(Math.round(S.carhp));
  d.health = String(Math.round(S.health));
  d.speed = Math.abs(S.speed).toFixed(1);
  d.x = S.x.toFixed(1);
  d.z = S.z.toFixed(1);
  d.heading = S.heading.toFixed(3);
  d.dist = String(objDist());
  elMoney.innerHTML = 'Cash <b>$' + S.money + '</b>';
  elMission.textContent = S.mission >= 5 ? 'Missions: ALL DONE' : 'Mission ' + (S.mission + 1) + '/5: ' + MISSIONS[S.mission].name + ' — $' + MISSIONS[S.mission].pay;
  elStars.textContent = '★'.repeat(S.wanted) + '☆'.repeat(5 - S.wanted);
  elCar.textContent = S.incar ? ('CAR HP ' + Math.round(S.carhp) + ' | ' + Math.round(Math.abs(S.speed) * 3.6) + ' km/h') : ('ON FOOT | HEALTH ' + Math.round(S.health));
  elRadio.textContent = S.station === 0 ? 'Radio: OFF (Q to change)' : (S.station === 1 ? 'Radio: VELVET FM' : 'Radio: MERIDIAN ROCK');
  elObj.textContent = objText();
  elCross.style.display = (S.screen === 'play' && !S.incar) ? 'block' : 'none';
  if (S.screen === 'title') {
    elTitle.innerHTML = '<div class="t">VELVET CITY</div><div class="s">Port Meridian — an open-world crime story<br>WASD move / drive &nbsp;·&nbsp; F enter car &nbsp;·&nbsp; Click to shoot<br>H headlights &nbsp;·&nbsp; Q radio &nbsp;·&nbsp; R restart<br><br>ENTER — continue &nbsp;&nbsp; N — new game</div>';
    elBig.style.display = 'none';
    elSub.style.display = 'none';
  } else if (S.screen === 'busted') {
    elTitle.innerHTML = '';
    elBig.textContent = 'BUSTED';
    elBig.style.display = 'block';
    elSub.textContent = 'The Port Meridian PD got you. Press R to restart.';
    elSub.style.display = 'block';
  } else if (S.screen === 'wasted') {
    elTitle.innerHTML = '';
    elBig.textContent = 'WASTED';
    elBig.style.display = 'block';
    elSub.textContent = 'Your ride is scrap. Press R to restart.';
    elSub.style.display = 'block';
  } else {
    elTitle.innerHTML = '';
    elBig.style.display = 'none';
    elSub.style.display = 'none';
  }
  // Minimap.
  const g = mmCtx;
  g.fillStyle = 'rgba(8,12,18,0.9)';
  g.fillRect(0, 0, 180, 135);
  g.strokeStyle = '#5a6270';
  g.lineWidth = 2;
  for (const x of ROADS_V) {
    const mx = ((x + MAP_X) / (MAP_X * 2)) * 180;
    g.beginPath(); g.moveTo(mx, 0); g.lineTo(mx, 135); g.stroke();
  }
  for (const z of ROADS_H) {
    const mz = ((z + MAP_Z) / (MAP_Z * 2)) * 135;
    g.beginPath(); g.moveTo(0, mz); g.lineTo(180, mz); g.stroke();
  }
  const px = ((S.x + MAP_X) / (MAP_X * 2)) * 180;
  const pz = ((S.z + MAP_Z) / (MAP_Z * 2)) * 135;
  if (S.mission >= 1 && S.mission <= 4) {
    const t = MISSIONS[S.mission].target;
    g.fillStyle = '#ffd23f';
    g.beginPath();
    g.arc(((t[0] + MAP_X) / (MAP_X * 2)) * 180, ((t[1] + MAP_Z) / (MAP_Z * 2)) * 135, 4, 0, 6.29);
    g.fill();
  }
  g.fillStyle = '#ff5252';
  for (const p of police) {
    g.fillRect(((p.x + MAP_X) / (MAP_X * 2)) * 180 - 1, ((p.z + MAP_Z) / (MAP_Z * 2)) * 135 - 1, 3, 3);
  }
  g.fillStyle = '#37e08a';
  g.beginPath();
  g.arc(px, pz, 3, 0, 6.29);
  g.fill();
}

// ---------- audio (procedural radio, guarded) ----------
let audioCtx = null;
let radioTimer = null;
let stepIdx = 0;
const STATION_NOTES = {
  1: [57, 60, 62, 65, 64, 62, 60, 57, 55, 57, 60, 64],
  2: [45, 45, 48, 50, 52, 50, 48, 45, 43, 45, 48, 52],
};
function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function initAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { audioCtx = null; }
}
function setStation(n) {
  S.station = n;
  if (radioTimer) { clearInterval(radioTimer); radioTimer = null; }
  if (n === 0 || !audioCtx) return;
  stepIdx = 0;
  const beat = n === 1 ? 240 : 170;
  radioTimer = setInterval(() => {
    if (!audioCtx || S.station !== n) return;
    try {
      const notes = STATION_NOTES[n];
      const m = notes[stepIdx % notes.length];
      stepIdx += 1;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = n === 1 ? 'triangle' : 'square';
      o.frequency.value = midiHz(m);
      g.gain.setValueAtTime(0.05, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (beat / 1000) * 0.9);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + beat / 1000);
    } catch (e) { /* audio unavailable */ }
  }, beat);
}
function playShot() {
  if (!audioCtx) return;
  try {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(220, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(60, audioCtx.currentTime + 0.09);
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.11);
  } catch (e) { /* audio unavailable */ }
}

// ---------- screenshot setups ----------
function setupShot(name) {
  if (name === 'start') return;
  resetRun(0, 0);
  if (name === 'chase') {
    S.wanted = 2;
    curCar = playerCar;
    S.incar = true;
    playerCar.x = 120; playerCar.z = 0; playerCar.heading = Math.PI / 2; playerCar.speed = 16;
    S.x = 120; S.z = 0; S.heading = Math.PI / 2; S.speed = 16; S.carhp = 100;
    spawnPolice();
    spawnPolice();
    police[0].x = 40; police[0].z = 8; police[0].heading = Math.PI / 2; police[0].speed = 14;
    police[1].x = 30; police[1].z = -12; police[1].heading = Math.PI / 2; police[1].speed = 14;
  } else if (name === 'mission') {
    S.mission = 1;
    S.money = 200;
    curCar = playerCar;
    S.incar = true;
    playerCar.x = 700; playerCar.z = -400; playerCar.heading = Math.PI / 2; playerCar.speed = 6;
    S.x = 700; S.z = -400; S.heading = Math.PI / 2; S.speed = 6; S.carhp = 100;
  } else if (name === 'drive') {
    S.wanted = 1;
    curCar = playerCar;
    S.incar = true;
    playerCar.x = -300; playerCar.z = 0; playerCar.heading = Math.PI / 2; playerCar.speed = 26;
    S.x = -300; S.z = 0; S.heading = Math.PI / 2; S.speed = 26; S.carhp = 100;
    spawnPolice();
    police[0].x = -380; police[0].z = 6; police[0].heading = Math.PI / 2; police[0].speed = 22;
  }
}

// ---------- main loop ----------
let lastT = performance.now();
let lastHudT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  S.time += dt;
  S.frames += 1;
  if (flashT > 0) flashT -= dt;
  if (S.fireCd > 0) S.fireCd -= dt;
  if (S.collCd > 0) S.collCd -= dt;
  if (S.hitCd > 0) S.hitCd -= dt;
  if (muzzle.intensity > 0) muzzle.intensity = Math.max(0, muzzle.intensity - dt * 30);
  if (tracerMat.opacity > 0) tracerMat.opacity = Math.max(0, tracerMat.opacity - dt * 8);
  if (S.screen === 'play') {
    updatePlayer(dt);
    updateTraffic(dt);
    updatePolice(dt);
    updatePeds(dt);
    updateHeli(dt);
  } else {
    updateTraffic(dt);
    updatePeds(dt);
  }
  playerCar.mesh.group.position.set(playerCar.x, 0, playerCar.z);
  playerCar.mesh.group.rotation.y = playerCar.heading;
  walker.visible = !S.incar;
  walker.position.set(S.x, 0, S.z);
  walker.rotation.y = S.heading;
  if (S.screen === 'play' && S.mission >= 1 && S.mission <= 4) {
    const t = MISSIONS[S.mission].target;
    beacon.position.set(t[0], 0, t[1]);
    beacon.visible = true;
    beam.material.opacity = 0.2 + 0.12 * Math.sin(S.time * 3);
  } else {
    beacon.visible = false;
  }
  updateCamera(dt);
  // The moonlight shadow camera follows the player (same light direction).
  moon.position.set(S.x + 300, 420, S.z + 200);
  moon.target.position.set(S.x, 0, S.z);
  moon.target.updateMatrixWorld();
  if (now - lastHudT > 120) { updateHud(); lastHudT = now; }
  renderer.render(scene, camera);
  if (SHOT && S.frames === 3) window.__shotReady = true;
}

// ---------- boot ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
if (SHOT) setupShot(SHOT);
updateHud();
requestAnimationFrame(loop);
