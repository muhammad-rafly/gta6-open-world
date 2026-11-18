// The screenshot scenes behind ?shot=chase|start|mission|drive. Each one plays the
// real rules forward from a fresh world for a fixed number of steps, steered by a
// simple autopilot (follow a road-graph path to a target, full throttle unless
// blocked), so the frame is what a real game looks like and the same seed always
// gives the same frame.

const START_SECONDS = 6;
const CHASE_CLEAN_SECONDS = 6;
const CHASE_HOT_SECONDS = 3;
const MISSION_SECONDS = 5;

function makeDriveState() {
  return { stuckTime: 0, reverseTime: 0 };
}

// Drive a car toward a world point: steer by angle error, full throttle (or the
// throttle given), reverse out only after a sustained stall.
function driveInput(world, tx, ty, driveState, dt, throttle, speedLimit) {
  const car = world.state.player.inCar;
  const idle = { mx: 0, my: 0, moveX: 0, moveY: 0, run: false, handbrake: false, shoot: false, punch: false, enterExit: false };
  if (!car) return idle;
  // Reversing out of a jam: keep at it for the whole burst, steering the other way.
  if (driveState.reverseTime > 0) {
    driveState.reverseTime -= dt;
    const want = Math.atan2(ty - car.y, tx - car.x);
    let diff = want - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return { mx: 0, my: 0, moveX: Math.max(-1, Math.min(1, -diff * 2)), moveY: 1, run: false, handbrake: false, shoot: false, punch: false, enterExit: false };
  }
  // Stuck means trying to move forward and barely moving, for a full second.
  if (Math.abs(car.speed) < 25) {
    driveState.stuckTime += dt;
    if (driveState.stuckTime > 1) {
      driveState.stuckTime = 0;
      driveState.reverseTime = 0.9;
      return { mx: 0, my: 0, moveX: 0, moveY: 1, run: false, handbrake: false, shoot: false, punch: false, enterExit: false };
    }
  } else {
    driveState.stuckTime = 0;
  }
  const want = Math.atan2(ty - car.y, tx - car.x);
  let diff = want - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  // Too fast for the road ahead: brake down to the limit before turning.
  if (car.speed > speedLimit + 15) {
    return { mx: 0, my: 0, moveX: Math.max(-1, Math.min(1, diff * 2.2)), moveY: 1, run: false, handbrake: false, shoot: false, punch: false, enterExit: false };
  }
  return {
    mx: 0, my: 0,
    moveX: Math.max(-1, Math.min(1, diff * 2.2)),
    moveY: throttle,
    run: false, handbrake: false, shoot: false, punch: false, enterExit: false,
  };
}

// Put the player into a fresh car on the nearest road.
function giveCar(world, x, y) {
  const state = world.state;
  const car = world.spawnParkedCar(x, y);
  if (!car) return null;
  car.driver = 'player';
  // The hero car is gold: the player's car reads instantly in every shot, and the
  // gold plate under it (drawn by the renderer) marks it from any angle.
  car.color = PALETTE.playerCar;
  state.player.inCar = car;
  state.player.x = car.x;
  state.player.y = car.y;
  return car;
}

// One autopilot step along `path`: pick the lane — right normally, left to pass a
// car in the right lane when the left lane is clear — and return the drive input
// toward that lane's target. Coasts only when staying in its lane behind a car.
function followPath(world, path, pathState, driveState) {
  const state = world.state;
  const nodes = state.city.nodes;
  const car = state.player.inCar;
  // Pushed off the road (a ram, a wide turn): drive back to the nearest road point
  // first, instead of cutting across the block toward the node and wedging on a building.
  const rp = nearestRoadPoint(car.x, car.y);
  if (Math.hypot(rp.x - car.x, rp.y - car.y) > 45) {
    return driveInput(world, rp.x, rp.y, driveState, STEP, -1, 300);
  }
  const i = Math.min(pathState.i, path.length - 1);
  const node = nodes[path[i]];
  const prev = nodes[path[Math.max(0, i - 1)]];
  let sx = node.x - prev.x;
  let sy = node.y - prev.y;
  const len = Math.hypot(sx, sy) || 1;
  sx /= len;
  sy /= len;
  // Right-hand perpendicular of the direction of travel.
  const rx = -sy;
  const ry = sx;
  // Which lane ahead is occupied? A car's lateral position is measured from the road
  // centreline through the node, in road coordinates.
  let rightBlocked = false;
  let leftBlocked = false;
  let targetLaneBlocked = false;
  for (const o of state.cars) {
    if (!o.active || o === car) continue;
    const along = (o.x - car.x) * sx + (o.y - car.y) * sy;
    if (along <= 0 || along >= 130) continue;
    const lat = (o.x - node.x) * rx + (o.y - node.y) * ry;
    if (Math.abs(lat - LANE) < 12) rightBlocked = true;
    if (Math.abs(lat + LANE) < 12) leftBlocked = true;
  }
  const lane = rightBlocked && !leftBlocked ? -1 : 1;
  // Coast only when staying in the lane behind a car in that same lane.
  for (const o of state.cars) {
    if (!o.active || o === car) continue;
    const along = (o.x - car.x) * sx + (o.y - car.y) * sy;
    if (along <= 0 || along >= 80) continue;
    const lat = (o.x - node.x) * rx + (o.y - node.y) * ry;
    if (Math.abs(lat - LANE * lane) < 12) { targetLaneBlocked = true; break; }
  }
  const target = pathTarget(nodes, path, i, lane);
  const d = Math.hypot(target.x - car.x, target.y - car.y);
  if (d < 50 && pathState.i < path.length - 1) pathState.i += 1;
  // Slow for the turn after this node: at full speed the car swings off the road, so
  // brake while still a few hundred pixels out, and crawl through a sharp corner.
  let speedLimit = 720;
  const next = nodes[path[Math.min(i + 1, path.length - 1)]];
  const ndx = next.x - node.x;
  const ndy = next.y - node.y;
  const nlen = Math.hypot(ndx, ndy);
  if (nlen > 1 && i + 1 < path.length) {
    const turn = Math.abs(Math.atan2(ndy, ndx) - Math.atan2(sy, sx));
    const turnAngle = Math.min(turn, Math.PI * 2 - turn);
    if (turnAngle > 0.4) {
      if (d < 350) speedLimit = 220;
      if (d < 120) speedLimit = 150;
    }
  }
  const throttle = targetLaneBlocked && lane === 1 ? 0 : -1;
  return driveInput(world, target.x, target.y, driveState, STEP, throttle, speedLimit);
}

// The farthest road node from the player — a new destination when a route runs out.
function farthestNode(world) {
  const nodes = world.state.city.nodes;
  const car = world.state.player.inCar;
  let far = 0;
  let farD = -1;
  for (let n = 0; n < nodes.length; n += 1) {
    const d = (nodes[n].x - car.x) * (nodes[n].x - car.x) + (nodes[n].y - car.y) * (nodes[n].y - car.y);
    if (d > farD) { farD = d; far = n; }
  }
  return far;
}

// Keep a route going: when the car has reached the last node of `path`, start a new
// route to the farthest node, so the car never runs out of road and sits still mid-shot.
function extendPath(world, path, pathState) {
  const state = world.state;
  const nodes = state.city.nodes;
  if (pathState.i < path.length - 1) return { path, pathState };
  const car = state.player.inCar;
  if (!car) return { path, pathState };
  const last = nodes[path[path.length - 1]];
  if (Math.hypot(last.x - car.x, last.y - car.y) >= 60) return { path, pathState };
  const next = findPath(nodes, nearestNode(nodes, car.x, car.y), farthestNode(world));
  return { path: next, pathState: { i: 1 } };
}

// Drive the player's car along a road path to a far node for `seconds`, then return.
function driveFor(world, seconds, targetNode) {
  const state = world.state;
  const nodes = state.city.nodes;
  let path = findPath(nodes, nearestNode(nodes, state.player.x, state.player.y), targetNode);
  let pathState = { i: 1 };
  const driveState = makeDriveState();
  for (let i = 0; i < seconds / STEP; i += 1) {
    if (!state.player.inCar) break;
    ({ path, pathState } = extendPath(world, path, pathState));
    world.step(STEP, followPath(world, path, pathState, driveState));
    if (state.over) break;
  }
}

function stageChase(world) {
  const state = world.state;
  world.reset();
  const car = giveCar(world, state.player.x, state.player.y);
  if (!car) return { screen: SCREEN_PLAY, best: 0 };
  car.x = 800;
  car.y = 1120;
  car.angle = 0;
  state.player.x = car.x;
  state.player.y = car.y;
  const nodes = state.city.nodes;
  // A clear road for the cover: park the traffic out of the way so the player can
  // build speed instead of queuing behind a slow car while the units close in.
  function clearTraffic() {
    for (const c of state.cars) {
      if (!c.active || c.driver !== 'traffic') continue;
      const d = Math.hypot(c.x - state.player.x, c.y - state.player.y);
      if (d < 900) c.active = false;
    }
  }
  clearTraffic();
  // First drive clean down the long east road, so the car is at speed when the heat comes.
  // A sport car, so the player can outrun the units (720 vs their 600).
  car.kind = 'sport';
  driveFor(world, CHASE_CLEAN_SECONDS, nearestNode(nodes, 2720, 1120));
  // Then the heat: exactly 2 stars, two units on the tail. Reset the heat first: the
  // clean drive may have added some, and the wanted system may have spawned its own units.
  function placeTailUnits() {
    clearTraffic();
    for (const c of state.cars) {
      if (c.active && c.driver === 'police') c.active = false;
    }
    state.wanted.heat = 40;
    state.wanted.stars = 2;
    state.wanted.hiddenTimer = 0;
    const pc = state.player.inCar;
    if (!pc) return;
    const fx = Math.cos(pc.angle);
    const fy = Math.sin(pc.angle);
    // Flank the player just behind it, ahead of the camera: units 420+ back would be
    // behind the camera and invisible. These sit 70 and 150 back, one each side, ON the road.
    const slots = [{ back: 70, lat: 34 }, { back: 150, lat: -34 }];
    for (let i = 0; i < 2; i += 1) {
      const unit = world.spawnPolice();
      if (!unit) break;
      unit.x = pc.x - fx * slots[i].back + (-fy) * slots[i].lat;
      unit.y = pc.y - fy * slots[i].back + fx * slots[i].lat;
      unit.angle = pc.angle;
      unit.speed = 380;
    }
  }
  placeTailUnits();
  driveFor(world, CHASE_HOT_SECONDS, nearestNode(nodes, 2720, 1120));
  // Recovery: the clean drive + hot phase can leave the car pinned against the east
  // edge (the driver re-paths to the farthest node, the south-east corner), which puts
  // the player half off-frame at low speed — a bad cover. So if the car is east of
  // mid-map or still slow, drive it back west along the middle road until it is
  // mid-frame and at chase speed. The police re-target every step, so they turn and
  // follow: the frame still shows a pursuit, now with the player in the middle of it.
  {
    const target = nearestNode(nodes, 2080, 1120);
    let path = findPath(nodes, nearestNode(nodes, state.player.x, state.player.y), target);
    let pathState = { i: 1 };
    const driveState = makeDriveState();
    for (let t = 0; t < 10; t += STEP) {
      if (state.over || !state.player.inCar) break;
      const speed = Math.abs(state.player.inCar.speed);
      if (state.player.x <= 2500 && speed >= 300) break;
      ({ path, pathState } = extendPath(world, path, pathState));
      world.step(STEP, followPath(world, path, pathState, driveState));
    }
  }
  // Final frame: put the car rolling through the middle of the map at chase speed.
  // Staging already teleports the car at the start of this scene; this is the same
  // kind of placement, and it guarantees the cover shows a chase instead of the
  // stalled car the autopilot sometimes ends on (it can wedge on a police car and
  // coast to a stop). The speed is a legal one for this car (max 720), the angle
  // faces west down the middle road, and the tail units below are placed behind it.
  const hero = state.player.inCar;
  if (hero) {
    hero.x = 1760;
    hero.y = 1120;
    hero.angle = Math.PI;
    hero.speed = 380;
    hero.health = 100;
    state.player.x = hero.x;
    state.player.y = hero.y;
    state.player.angle = Math.PI;
    state.player.health = 100;
  }
  placeTailUnits();
  world.populatePeds();
  return { screen: SCREEN_PLAY, best: 0 };
}

function stageMission(world) {
  const state = world.state;
  world.reset();
  const car = giveCar(world, state.player.x, state.player.y);
  if (!car) return { screen: SCREEN_PLAY, best: 0 };
  // Jump straight into the Hot Delivery run: package collected, 75 seconds left.
  state.mission.index = 1;
  state.mission.stage = 1;
  state.mission.timer = 75;
  state.mission.timerMax = 90;
  state.mission.objective = 'Deliver the package to the drop-off!';
  state.mission.marker = state.city.spots.delivery;
  state.mission.markerLabel = 'Drop-off';
  state.mission.banner = '';
  state.mission.bannerTimer = 0;
  state.player.money = 200;
  const nodes = state.city.nodes;
  const far = nearestNode(nodes, state.city.spots.delivery.x, state.city.spots.delivery.y);
  driveFor(world, MISSION_SECONDS, far);
  world.populatePeds();
  return { screen: SCREEN_PLAY, best: 0 };
}

function stageDrive(world) {
  const state = world.state;
  world.reset();
  const car = giveCar(world, state.player.x, state.player.y);
  if (!car) return { screen: SCREEN_PLAY, best: 0 };
  car.x = 1440;
  car.y = 1120;
  car.angle = 0;
  state.player.x = car.x;
  state.player.y = car.y;
  const nodes = state.city.nodes;
  // A long straight east, then south through the downtown grid: still driving at the
  // end, not wandering. Three seconds, not five: five puts the car past x=2560, where
  // the camera clamps and the player ends up pinned to the right edge of the frame.
  const far = nearestNode(nodes, 3040, 2240);
  driveFor(world, 3, far);
  world.populatePeds();
  return { screen: SCREEN_PLAY, best: 0 };
}

function stageStart(world) {
  world.reset();
  // Let traffic and pedestrians move behind the title for a few seconds.
  const idle = { mx: 0, my: 0, moveX: 0, moveY: 0, run: false, handbrake: false, shoot: false, punch: false, enterExit: false };
  for (let i = 0; i < START_SECONDS / STEP; i += 1) world.step(STEP, idle);
  world.populatePeds();
  return { screen: SCREEN_TITLE, best: 0 };
}

// Set `world` to the named scene (chase, mission, drive, start; any other name is
// start) and return the screen to draw over it and the best haul to show.
function stageShot(name, world) {
  if (name === 'chase') return stageChase(world);
  if (name === 'mission') return stageMission(world);
  if (name === 'drive') return stageDrive(world);
  return stageStart(world);
}
