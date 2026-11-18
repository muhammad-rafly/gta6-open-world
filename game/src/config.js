// VELVET CITY — every tuning number and colour in one place. The world is a
// 3200x2400 dense city; the 3D camera chases the player, so no rule below depends on
// the screen size. Classic script: top-level names are shared with the other game
// scripts loaded after this one.

const WORLD = { width: 3200, height: 2400 };
const VIEW = { width: 1280, height: 720 };

// The simulation's fixed step: 60 updates a second whatever the display's rate.
const STEP = 1 / 60;
const TAU = Math.PI * 2;

// Roads run on a grid; blocks between them hold the buildings.
const CITY = {
  roadWidth: 64,
  block: 256,
  roadsX: [160, 480, 800, 1120, 1440, 1760, 2080, 2400, 2720, 3040],
  roadsY: [160, 480, 800, 1120, 1440, 1760, 2080, 2240],
  // Districts by block column/row: downtown centre, commercial east, plaza west.
  plazaBlock: { col: 1, row: 4 },
  hospitalBlock: { col: 5, row: 1 },
};

// Building extrusion: the 2D height seed (16..42) maps to 3D height this way.
const HEIGHT = {
  base: 55,
  scale: 3.2,
  downtown: [26, 42],
  normal: [16, 30],
  commercial: [22, 38],
};

const PLAYER = {
  radius: 11,
  height: 26,
  walkSpeed: 230,
  runSpeed: 350,
  health: 100,
  punchDamage: 20,
  punchRange: 34,
  punchCooldown: 0.35,
  gunDamage: 34,
  gunRange: 460,
  gunCooldown: 0.22,
  gunAmmo: 12,
  reloadTime: 1.2,
  invulnerable: 0.8,
};

const CAR = {
  length: 54,
  width: 26,
  height: 13,
  accel: 540,
  brake: 900,
  maxSpeed: 640,
  sportMaxSpeed: 720,
  reverseMax: 220,
  steer: 2.6,
  drag: 0.55,
  handbrakeDrag: 2.4,
  health: 100,
  ramDamage: 26,
  crashDamageSpeed: 260,
  // Visual steering: how far the front wheels turn at full lock (radians).
  wheelTurn: 0.45,
};

const TRAFFIC = {
  count: 18,
  speed: 200,
  speedJitter: 60,
  spawnDistance: 700,
  despawnDistance: 1200,
};

const PED = {
  count: 72,
  walkSpeed: 55,
  runSpeed: 170,
  spawnDistance: 650,
  despawnDistance: 1100,
  // Visual variety: pedestrians stand 0.88x..1.12x tall, one in four wears a hat.
  scaleMin: 0.88,
  scaleMax: 1.12,
  hatChance: 0.25,
};

const POLICE = {
  maxSpeed: 600,
  accel: 620,
  chaseRange: 1400,
  spawnDistance: 550,
  despawnDistance: 1500,
  bustTime: 2.2,
  bustRange: 90,
  shootRange: 380,
  shootCooldown: 0.9,
  shootDamage: 8,
  roadblockAtStars: 3,
};

const WANTED = {
  // Heat 0..100; stars = floor(heat / 20), capped at 5.
  stealCar: 25,
  hitPed: 12,
  killPed: 20,
  hitPolice: 18,
  shoot: 12,
  missionHeat: 20,
  decayDelay: 4,
  decayRate: 7,
  maxPolice: 6,
};

const MISSIONS = [
  { id: 1, name: 'First Wheels', reward: 200, brief: 'Steal any car and drive it to the garage.' },
  { id: 2, name: 'Hot Delivery', reward: 400, brief: 'Grab the package and deliver it across town. 90 seconds. The heat is on.' },
  { id: 3, name: 'Getaway', reward: 600, brief: 'Pick up the crew, then lose the cops and reach the safehouse.' },
  { id: 4, name: 'Takedown', reward: 800, brief: 'Stop the target car — ram it or shoot it — then reach the marker.' },
  { id: 5, name: 'The Big Score', reward: 1500, brief: 'Rob the Central Bank vault, then escape the 4-star heat to the safehouse.' },
];

// Chase camera: distances in world units behind/above the player.
const CAMERA = {
  onFootBack: 150,
  onFootUp: 95,
  onFootLook: 90,
  carBack: 240,
  carUp: 120,
  carLook: 170,
  fov: 62,
  fovKick: 8,
  smooth: 5.5,
};

// Realism tuning: how the city looks at dusk. The environment map is rendered once
// from a procedural sky (gradient + sun + neon strips), so car paint, glass and wet
// asphalt reflect a real dusk instead of a flat colour. Shot mode gets the soft 2048
// shadow map; live play keeps 1024 so the software renderer stays responsive.
const REALISM = {
  exposure: 1.12,
  envIntensityPaint: 1.35,
  envIntensityGlass: 1.6,
  envIntensityGround: 0.55,
  shadowMapShot: 2048,
  shadowMapPlay: 1024,
  // Traffic lights: an 18 s cycle — 7 s green, 2 s amber, 7 s cross green, 2 s amber.
  // Neighbouring intersections run half a cycle out of phase, so the grid feels alive.
  lightCycle: 18,
  lightGreen: 7,
  lightAmber: 2,
  // Headlight beams are on at dusk by default; H toggles them.
  headlightsOn: true,
  beamOpacity: 0.13,
  beamLength: 150,
  beamWidth: 34,
};

const PALETTE = {
  // Dusk sky: deep indigo above, ember orange at the horizon. Our own dusk, not pink.
  skyTop: '#14102e',
  skyMid: '#452452',
  skyHorizon: '#ff8c42',
  fog: '#2e2140',
  sun: '#ffb03f',
  ground: '#1e1e26',
  road: '#232329',
  roadEdge: '#3a3f4c',
  lane: '#d8c95a',
  sidewalk: '#454a56',
  plaza: '#565d6b',
  building: ['#6a5266', '#8e5a44', '#3e5f6e', '#74424c', '#4a6e42', '#7a6234', '#4a4f72', '#7e4a62'],
  roof: ['#3a3340', '#4a3a34', '#333a44', '#443038'],
  windowLit: '#ffd76a',
  windowLitCool: '#bfe0ff',
  windowDark: '#20242f',
  // Neon signs: cyan, magenta, amber, lime — the Velvet City glow.
  neon: ['#29e6ff', '#ff2e88', '#ffb03f', '#a8ff3f', '#ff5a3f'],
  neonWords: ['VELVET', 'NEON', 'HOTEL', '24H', 'BAR', 'CINEMA', 'RAMEN', 'TAXI', 'CLUB', 'MOTEL', 'DANCE', 'PIER'],
  treeDark: '#1f4d28',
  treeMid: '#2e7a3a',
  treeLight: '#4a9a4a',
  player: '#ffcf3f',
  playerCar: '#ffcf3f',
  police: '#e8e8f0',
  policeLightR: '#ff2e2e',
  policeLightB: '#2e7dff',
  ped: ['#e8e0d0', '#d0a080', '#a0c0d0', '#c0a0d0', '#e0c080'],
  pedSkin: ['#d0a080', '#a87a52', '#e8c39a', '#8a5f3c', '#f0d0b0'],
  money: '#3fd47e',
  health: '#3fd47e',
  danger: '#ff4a4a',
  text: '#f2f0e8',
  muted: '#a8a294',
  marker: '#ffd23f',
  markerTarget: '#ff4a4a',
  headlight: '#ffe9a8',
  shadow: 'rgba(0,0,0,0.32)',
  // Distant skyline silhouettes, shopfront glass, wet-asphalt puddles, street props.
  skyline: '#1a1430',
  shopGlass: '#9fc4d8',
  puddle: '#2c3a55',
  hydrant: '#c03028',
  bin: '#23262e',
  busStop: '#2e7dff',
};

const CAR_COLORS = ['#8e2f2f', '#2f5a8e', '#2f6e48', '#9a9aa2', '#26262e', '#8e6224', '#5e3a7a', '#3a7a6e'];
const TAXI_COLOR = '#ffc93f';
const PED_COLORS = PALETTE.ped;

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// Where the save (money, missions, best) is kept between visits (this browser only).
const SAVE_KEY = 'velvet-city.save';
