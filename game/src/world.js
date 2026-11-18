// VELVET CITY — the simulation. A flat top-down world (x, y, angle) drives the 3D
// renderer; a fixed seed always plays the same way.

const EVENT_NONE = 0;
const EVENT_SHOT = 1;
const EVENT_CRASH = 2;
const EVENT_PICKUP = 4;
const EVENT_STEAL = 8;
const EVENT_PUNCH = 16;
const EVENT_HIT = 32;
const EVENT_MISSION_START = 64;
const EVENT_MISSION_DONE = 128;
const EVENT_MISSION_FAIL = 256;
const EVENT_BUSTED = 512;
const EVENT_WASTED = 1024;
const EVENT_WIN = 2048;
const EVENT_SIREN = 4096;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function dist2(ax, ay, bx, by) { const dx = ax - bx; const dy = ay - by; return dx * dx + dy * dy; }
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function createWorld(random) {
  const city = createCity(random);
  const { nodes } = city;

  const player = {
    x: CITY.roadsX[1], y: CITY.roadsY[2] + 40, angle: 0, health: PLAYER.health,
    money: 0, inCar: null, ammo: PLAYER.gunAmmo, reloading: 0, punchCooldown: 0,
    gunCooldown: 0, invulnerable: 0, speed: 0, moving: false, regenDelay: 0,
    walkPhase: 0,
  };

  const cars = [];
  for (let i = 0; i < 42; i += 1) {
    cars.push({
      active: false, kind: 'sedan', x: 0, y: 0, angle: 0, speed: 0, color: '#888888',
      health: CAR.health, driver: 'none', path: [], pathI: 0, cruise: TRAFFIC.speed,
      siren: 0, smoke: 0, stuckTimer: 0, ramCooldown: 0, targetNode: -1, isTarget: false,
      // Renderer-only: smoothed steering angle, braking flag. The sim never reads them.
      steerVis: 0, braking: false, prevAngle: 0, prevSpeed: 0,
    });
  }
  const peds = [];
  for (let i = 0; i < 80; i += 1) {
    peds.push({
      active: false, x: 0, y: 0, angle: 0, speed: 0, state: 'walk', color: '#ffffff',
      tx: 0, ty: 0, downTimer: 0, panicTimer: 0, walkPhase: 0,
      // Renderer-only variety. Set on spawn.
      scale: 1, skin: '#d0a080', hat: false,
    });
  }
  const bullets = [];
  for (let i = 0; i < 24; i += 1) bullets.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  const particles = [];
  for (let i = 0; i < 140; i += 1) {
    particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: '#ffffff', size: 3 });
  }
  const pickups = [];
  for (let i = 0; i < 12; i += 1) pickups.push({ active: false, kind: 'cash', x: 0, y: 0, timer: 0 });

  const wanted = { heat: 0, stars: 0, hiddenTimer: 0, policeCount: 0 };
  const mission = {
    index: 0, stage: 0, objective: '', marker: null, markerLabel: '',
    timer: 0, timerMax: 0, progress: 0, progressMax: 0, banner: '', bannerTimer: 0,
    between: false, targetCar: null, done: false, failed: false,
  };
  // Police helicopter at 4-5 stars: circles with a searchlight, never shoots.
  const heli = { active: false, angle: 0, x: 0, y: 0, z: 230 };
  const state = {
    player, cars, peds, bullets, particles, pickups, wanted, mission, city, heli,
    elapsed: 0, missionsDone: 0, carsStolen: 0, pedsHit: 0, shotsFired: 0,
    busted: false, wasted: false, won: false, over: false, bustTimer: 0,
    trafficTimer: 0, pedTimer: 0, pickupTimer: 0, sirenTimer: 0,
  };

  function freeCar() { for (const c of cars) if (!c.active) return c; return null; }
  function freePed() { for (const p of peds) if (!p.active) return p; return null; }
  function freeBullet() { for (const b of bullets) if (!b.active) return b; return null; }
  function freeParticle() { for (const p of particles) if (!p.active) return p; return null; }
  function freePickup() { for (const p of pickups) if (!p.active) return p; return null; }

  function spawnParticle(x, y, vx, vy, life, color, size) {
    const p = freeParticle();
    if (!p) return;
    p.active = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life; p.color = color; p.size = size;
  }
  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i += 1) {
      const a = random() * TAU;
      const s = speed * (0.4 + random() * 0.8);
      spawnParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.3 + random() * 0.4, color, 2 + random() * 3);
    }
  }

  function addHeat(amount) {
    wanted.heat = clamp(wanted.heat + amount, 0, 100);
    wanted.stars = Math.min(5, Math.floor(wanted.heat / 20));
    wanted.hiddenTimer = 0;
  }

  function carCircles(car) {
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    return [
      { x: car.x + fx * 16, y: car.y + fy * 16, r: 14 },
      { x: car.x, y: car.y, r: 15 },
      { x: car.x - fx * 16, y: car.y - fy * 16, r: 14 },
    ];
  }

  function carHitsBuilding(car) {
    const circles = carCircles(car);
    for (const c of circles) {
      for (const b of city.buildings) {
        if (circleHitsBuilding(c.x, c.y, c.r, b)) return b;
      }
    }
    return null;
  }

  function resolveCarBuildings(car) {
    // Push the car out of buildings, circle by circle; returns true on a hard hit.
    let hit = false;
    const circles = carCircles(car);
    for (const c of circles) {
      for (const b of city.buildings) {
        const r = resolveCircleBuilding(c.x, c.y, c.r, b);
        if (r.hit) {
          // Move the whole car by the correction applied to this circle.
          car.x += r.x - c.x;
          car.y += r.y - c.y;
          hit = true;
        }
      }
    }
    return hit;
  }

  function spawnTrafficCar() {
    const car = freeCar();
    if (!car) return null;
    const ang = random() * TAU;
    const d = TRAFFIC.spawnDistance + random() * 300;
    const rp = nearestRoadPoint(player.x + Math.cos(ang) * d, player.y + Math.sin(ang) * d);
    const node = nodes[nearestNode(nodes, rp.x, rp.y)];
    const dest = nodes[Math.floor(random() * nodes.length)];
    car.active = true;
    car.kind = random() < 0.12 ? 'taxi' : random() < 0.15 ? 'van' : random() < 0.2 ? 'sport' : 'sedan';
    car.x = node.x;
    car.y = node.y;
    car.angle = random() * TAU;
    car.speed = 0;
    car.color = car.kind === 'taxi' ? TAXI_COLOR : pick(random, CAR_COLORS);
    car.health = CAR.health;
    car.driver = 'traffic';
    car.cruise = TRAFFIC.speed + (random() - 0.5) * TRAFFIC.speedJitter;
    car.path = findPath(nodes, nodes.indexOf(node), nodes.indexOf(dest));
    car.pathI = 1;
    car.siren = 0;
    car.smoke = 0;
    car.isTarget = false;
    return car;
  }

  function spawnParkedCar(nearX, nearY) {
    const car = freeCar();
    if (!car) return null;
    const rp = nearestRoadPoint(nearX, nearY);
    car.active = true;
    car.kind = random() < 0.2 ? 'sport' : random() < 0.3 ? 'van' : 'sedan';
    car.x = rp.x + (random() - 0.5) * 20;
    car.y = rp.y + (random() - 0.5) * 20;
    car.angle = random() < 0.5 ? 0 : Math.PI / 2;
    car.speed = 0;
    car.color = pick(random, CAR_COLORS);
    car.health = CAR.health;
    car.driver = 'parked';
    car.cruise = 0;
    car.path = [];
    car.pathI = 0;
    car.siren = 0;
    car.smoke = 0;
    car.isTarget = false;
    return car;
  }

  // A point on a sidewalk near (x, y): the nearest road, offset past the road edge
  // onto the pavement, with a random side and a stroll along the road.
  function sidewalkPoint(x, y) {
    const rp = nearestRoadPoint(x, y);
    let dv = Infinity;
    for (const rx of CITY.roadsX) dv = Math.min(dv, Math.abs(x - rx));
    let dh = Infinity;
    for (const ry of CITY.roadsY) dh = Math.min(dh, Math.abs(y - ry));
    const off = CITY.roadWidth / 2 + 8;
    const side = random() < 0.5 ? -off : off;
    if (dv <= dh) return { x: rp.x + side, y: rp.y + (random() - 0.5) * 160 };
    return { x: rp.x + (random() - 0.5) * 160, y: rp.y + side };
  }

  function spawnPed(nearX, nearY) {
    const p = freePed();
    if (!p) return null;
    const ang = random() * TAU;
    const d = 100 + random() * 400;
    const sp = sidewalkPoint(nearX + Math.cos(ang) * d, nearY + Math.sin(ang) * d);
    p.active = true;
    p.x = sp.x;
    p.y = sp.y;
    p.angle = random() * TAU;
    p.speed = PED.walkSpeed;
    p.state = 'walk';
    p.color = pick(random, PED_COLORS);
    p.scale = PED.scaleMin + random() * (PED.scaleMax - PED.scaleMin);
    p.skin = pick(random, PALETTE.pedSkin);
    p.hat = random() < PED.hatChance;
    const t = sidewalkPoint(p.x + (random() - 0.5) * 500, p.y + (random() - 0.5) * 500);
    p.tx = t.x;
    p.ty = t.y;
    p.downTimer = 0;
    p.panicTimer = 0;
    p.walkPhase = random() * TAU;
    return p;
  }

  // Fill the sidewalks around the player up to the ped cap. Staging only: the live
  // game tops the population up over time; a screenshot stages the same busy street
  // at once instead of waiting a minute for the trickle.
  function populatePeds() {
    for (let i = 0; i < 40; i += 1) {
      let n = 0;
      for (const p of peds) if (p.active) n += 1;
      if (n >= PED.count) break;
      spawnPed(player.x, player.y);
    }
  }

  function spawnPickup(kind, x, y) {
    const p = freePickup();
    if (!p) return null;
    p.active = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.timer = 60;
    return p;
  }

  function spawnPolice() {
    const car = freeCar();
    if (!car) return null;
    const ang = random() * TAU;
    const d = POLICE.spawnDistance + random() * 200;
    const rp = nearestRoadPoint(player.x + Math.cos(ang) * d, player.y + Math.sin(ang) * d);
    car.active = true;
    car.kind = 'police';
    car.x = rp.x;
    car.y = rp.y;
    car.angle = Math.atan2(player.y - rp.y, player.x - rp.x);
    car.speed = 0;
    car.color = PALETTE.police;
    car.health = CAR.health;
    car.driver = 'police';
    car.cruise = POLICE.maxSpeed;
    car.path = [];
    car.pathI = 0;
    car.siren = 0;
    car.smoke = 0;
    car.isTarget = false;
    return car;
  }

  function countPolice() {
    let n = 0;
    for (const c of cars) if (c.active && c.driver === 'police') n += 1;
    return n;
  }

  function nearestPoliceDistance() {
    let best = Infinity;
    for (const c of cars) {
      if (!c.active || c.driver !== 'police') continue;
      const d = Math.hypot(c.x - player.x, c.y - player.y);
      if (d < best) best = d;
    }
    return best;
  }

  // ---- Missions ----
  function missionDef() { return MISSIONS[mission.index]; }

  function setObjective(text, marker, label) {
    mission.objective = text;
    mission.marker = marker;
    mission.markerLabel = label || '';
  }

  function startMission(index) {
    mission.index = index;
    mission.stage = 0;
    mission.timer = 0;
    mission.timerMax = 0;
    mission.progress = 0;
    mission.progressMax = 0;
    mission.targetCar = null;
    mission.failed = false;
    mission.between = false;
    const def = missionDef();
    mission.banner = 'Mission ' + def.id + ': ' + def.name;
    mission.bannerTimer = 3;
    if (index === 0) {
      setObjective('Steal a car (press F near one)', null, '');
    } else if (index === 1) {
      setObjective('Go to the package', city.spots.package, 'Package');
    } else if (index === 2) {
      setObjective('Pick up the crew', city.spots.crew, 'Crew');
    } else if (index === 3) {
      setObjective('Stop the target car', city.spots.target, 'Target');
      spawnTargetCar();
    } else if (index === 4) {
      setObjective('Reach the Central Bank', city.spots.vault, 'Vault');
    }
    return EVENT_MISSION_START;
  }

  function spawnTargetCar() {
    const car = freeCar();
    if (!car) return;
    const s = city.spots.target;
    car.active = true;
    car.kind = 'sport';
    car.x = s.x;
    car.y = s.y;
    car.angle = 0;
    car.speed = 0;
    car.color = '#ff2e5e';
    car.health = 80;
    car.driver = 'target';
    car.cruise = 420;
    car.path = [];
    car.pathI = 0;
    car.isTarget = true;
    mission.targetCar = car;
  }

  function completeMission() {
    const def = missionDef();
    player.money += def.reward;
    state.missionsDone += 1;
    mission.banner = 'Mission complete! +$' + def.reward;
    mission.bannerTimer = 3.5;
    mission.between = true;
    mission.marker = null;
    mission.objective = '';
    if (mission.index >= MISSIONS.length - 1) {
      state.won = true;
      state.over = true;
      mission.done = true;
      return EVENT_WIN;
    }
    return EVENT_MISSION_DONE;
  }

  function failMission(reason) {
    mission.failed = true;
    mission.banner = 'Mission failed: ' + reason + '. Press R to retry.';
    mission.bannerTimer = 4;
    return EVENT_MISSION_FAIL;
  }

  function retryMission() {
    mission.failed = false;
    mission.banner = '';
    mission.bannerTimer = 0;
    // Clear heat so the retry is fair, and put the player back on foot near the action.
    wanted.heat = 0;
    wanted.stars = 0;
    // A stale bust timer would re-bust the player at once, and a unit left over from
    // the failed run would keep shooting a player the law has forgotten about.
    state.bustTimer = 0;
    for (const c of cars) if (c.active && c.driver === 'police') c.active = false;
    if (player.inCar) {
      player.inCar.driver = 'parked';
      player.inCar = null;
    }
    player.health = PLAYER.health;
    startMission(mission.index);
  }

  // ---- Player ----
  function stepPlayer(dt, input) {
    if (player.invulnerable > 0) player.invulnerable = Math.max(0, player.invulnerable - dt);
    if (player.punchCooldown > 0) player.punchCooldown -= dt;
    if (player.gunCooldown > 0) player.gunCooldown -= dt;
    if (player.reloading > 0) {
      player.reloading -= dt;
      if (player.reloading <= 0) player.ammo = PLAYER.gunAmmo;
    }
    if (player.regenDelay > 0) player.regenDelay -= dt;
    else if (player.health < PLAYER.health && wanted.stars === 0) {
      player.health = Math.min(PLAYER.health, player.health + 2 * dt);
    }

    if (player.inCar) return; // The car step moves the player.

    const mx = input.mx || 0;
    const my = input.my || 0;
    const mag = Math.hypot(mx, my);
    player.moving = mag > 0.05;
    if (player.moving) {
      const speed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
      player.speed = speed;
      player.angle = Math.atan2(my, mx);
      player.x += (mx / Math.max(1, mag)) * speed * dt;
      player.y += (my / Math.max(1, mag)) * speed * dt;
      player.walkPhase += dt * speed * 0.055;
    } else {
      player.speed = 0;
    }
    // Buildings block the player.
    for (const b of city.buildings) {
      const r = resolveCircleBuilding(player.x, player.y, PLAYER.radius, b);
      if (r.hit) { player.x = r.x; player.y = r.y; }
    }
    player.x = clamp(player.x, PLAYER.radius, WORLD.width - PLAYER.radius);
    player.y = clamp(player.y, PLAYER.radius, WORLD.height - PLAYER.radius);
    // Shooting aims at the mouse's ground point.
    if (input.shoot && input.aimX !== undefined && input.aimY !== undefined) {
      player.angle = Math.atan2(input.aimY - player.y, input.aimX - player.x);
    }
  }

  function playerShoot(input, events) {
    if (!input.shoot || player.gunCooldown > 0 || player.reloading > 0 || player.inCar) return events;
    if (player.ammo <= 0) {
      player.reloading = PLAYER.reloadTime;
      return events;
    }
    const b = freeBullet();
    if (!b) return events;
    player.ammo -= 1;
    player.gunCooldown = PLAYER.gunCooldown;
    state.shotsFired += 1;
    const a = player.angle;
    b.active = true;
    b.x = player.x + Math.cos(a) * 16;
    b.y = player.y + Math.sin(a) * 16;
    b.vx = Math.cos(a) * 760;
    b.vy = Math.sin(a) * 760;
    b.life = PLAYER.gunRange / 760;
    spawnParticle(b.x, b.y, Math.cos(a) * 60, Math.sin(a) * 60, 0.08, '#ffd76a', 4);
    addHeat(WANTED.shoot * 0.4);
    return events | EVENT_SHOT;
  }

  function playerPunch(events) {
    if (player.punchCooldown > 0 || player.inCar) return events;
    player.punchCooldown = PLAYER.punchCooldown;
    const px = player.x + Math.cos(player.angle) * 24;
    const py = player.y + Math.sin(player.angle) * 24;
    let hit = false;
    for (const p of peds) {
      if (!p.active || p.state === 'down') continue;
      if (dist2(p.x, p.y, px, py) < (PLAYER.punchRange + 12) * (PLAYER.punchRange + 12)) {
        p.state = 'down';
        p.downTimer = 2.5;
        burst(p.x, p.y, '#ffd76a', 6, 120);
        hit = true;
      }
    }
    for (const c of cars) {
      if (!c.active || c.driver === 'player') continue;
      if (dist2(c.x, c.y, px, py) < 46 * 46) {
        c.health -= PLAYER.punchDamage;
        burst(c.x, c.y, '#ffd76a', 5, 100);
        hit = true;
      }
    }
    return hit ? events | EVENT_PUNCH : events;
  }

  function tryEnterExitCar(events) {
    if (player.inCar) {
      // Exit: step out beside the car, keep it parked.
      const car = player.inCar;
      const side = Math.cos(car.angle + Math.PI / 2);
      const sideY = Math.sin(car.angle + Math.PI / 2);
      player.x = car.x + side * 30;
      player.y = car.y + sideY * 30;
      player.inCar = null;
      car.driver = 'parked';
      car.speed = 0;
      return events;
    }
    // Find the nearest car within reach.
    let best = null;
    let bestD = 70 * 70;
    for (const c of cars) {
      if (!c.active || c.driver === 'player') continue;
      const d = dist2(c.x, c.y, player.x, player.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) return events;
    if (best.driver === 'traffic' || best.driver === 'target') {
      // Jacking a moving car: the driver is thrown out as a pedestrian.
      const p = freePed();
      if (p) {
        p.active = true;
        p.x = best.x + 30;
        p.y = best.y + 30;
        p.angle = random() * TAU;
        p.speed = PED.runSpeed;
        p.state = 'flee';
        p.panicTimer = 3;
        p.color = pick(random, PED_COLORS);
        p.scale = PED.scaleMin + random() * (PED.scaleMax - PED.scaleMin);
        p.skin = pick(random, PALETTE.pedSkin);
        p.hat = random() < PED.hatChance;
        p.tx = p.x + (random() - 0.5) * 300;
        p.ty = p.y + (random() - 0.5) * 300;
      }
      addHeat(WANTED.stealCar);
      state.carsStolen += 1;
      events |= EVENT_STEAL;
    } else if (best.driver === 'police') {
      // Stealing a police car is a big deal.
      addHeat(WANTED.stealCar + 15);
      state.carsStolen += 1;
      events |= EVENT_STEAL;
    } else {
      // A parked car: nobody sees it go, so no heat — but it is still a stolen car.
      state.carsStolen += 1;
      events |= EVENT_STEAL;
    }
    best.driver = 'player';
    player.inCar = best;
    return events;
  }

  // ---- Cars ----
  function driveCar(car, dt, throttle, steer, handbrake) {
    const maxSpeed = car.kind === 'sport' ? CAR.sportMaxSpeed : CAR.maxSpeed;
    if (car.health <= 0) throttle = 0;
    // Visuals: front wheels follow the steering input, smoothed; brake lights come
    // on when the driver brakes while moving forward.
    car.steerVis += (steer * clamp(Math.abs(car.speed) / 240, 0, 1) - car.steerVis) * Math.min(1, dt * 10);
    car.braking = throttle < 0 && car.speed > 20;
    if (throttle > 0) car.speed += CAR.accel * throttle * dt;
    else if (throttle < 0) car.speed += (car.speed > 0 ? -CAR.brake : CAR.accel * 0.6) * dt;
    const drag = handbrake ? CAR.handbrakeDrag : CAR.drag;
    car.speed -= car.speed * drag * dt;
    if (throttle === 0 && Math.abs(car.speed) < 8) car.speed = 0;
    car.speed = clamp(car.speed, -CAR.reverseMax, maxSpeed);
    const steerAmount = steer * CAR.steer * clamp(Math.abs(car.speed) / 240, 0, 1) * (handbrake ? 1.5 : 1);
    car.angle += steerAmount * Math.sign(car.speed) * dt;
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
  }

  function stepPlayerCar(dt, input, events) {
    const car = player.inCar;
    if (!car) return events;
    const throttle = input.moveY !== 0 ? -input.moveY : 0; // W = up = forward
    const steer = input.moveX;
    const before = car.speed;
    driveCar(car, dt, throttle, steer, input.handbrake);
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    player.speed = Math.abs(car.speed);
    player.moving = Math.abs(car.speed) > 5;
    const hitBuilding = resolveCarBuildings(car);
    if (hitBuilding && Math.abs(before) > CAR.crashDamageSpeed) {
      car.health -= 12;
      player.health -= 4;
      player.regenDelay = 4;
      burst(car.x, car.y, '#ffb03f', 8, 160);
      events |= EVENT_CRASH;
      car.speed *= 0.35;
    }
    if (car.health <= 0 && car.smoke === 0) car.smoke = 1;
    if (car.health <= 0) {
      car.speed *= (1 - 2 * dt);
      if (Math.abs(car.speed) < 5) car.speed = 0;
    }
    return events;
  }

  function stepTrafficCar(car, dt) {
    if (car.driver !== 'traffic' && car.driver !== 'target') return;
    if (car.health <= 0) {
      car.speed = Math.max(0, car.speed - 300 * dt);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      return;
    }
    // The target car flees the player; traffic follows its route.
    if (car.driver === 'target') {
      const away = Math.atan2(car.y - player.y, car.x - player.x);
      const tx = car.x + Math.cos(away) * 400;
      const ty = car.y + Math.sin(away) * 400;
      const rp = nearestRoadPoint(tx, ty);
      const want = Math.atan2(rp.y - car.y, rp.x - car.x);
      const diff = angleDiff(car.angle, want);
      car.angle += clamp(diff * 2.2, -2.4 * dt, 2.4 * dt);
      car.speed = Math.min(car.cruise, car.speed + CAR.accel * 0.7 * dt);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      resolveCarBuildings(car);
      return;
    }
    // Follow the road-graph path in the right-hand lane.
    const path = car.path;
    if (!path || path.length === 0 || car.pathI >= path.length) {
      const dest = nodes[Math.floor(random() * nodes.length)];
      car.path = findPath(nodes, nearestNode(nodes, car.x, car.y), nodes.indexOf(dest));
      car.pathI = 1;
      return;
    }
    const target = pathTarget(nodes, path, car.pathI, 1);
    const d = Math.hypot(target.x - car.x, target.y - car.y);
    if (d < 50 && car.pathI < path.length - 1) car.pathI += 1;
    // Slow for a car stopped ahead in this lane.
    let blocked = false;
    for (const o of cars) {
      if (!o.active || o === car) continue;
      const along = (o.x - car.x) * Math.cos(car.angle) + (o.y - car.y) * Math.sin(car.angle);
      const lat = Math.abs((o.x - car.x) * -Math.sin(car.angle) + (o.y - car.y) * Math.cos(car.angle));
      if (along > 0 && along < 80 && lat < 22) { blocked = true; break; }
    }
    const want = Math.atan2(target.y - car.y, target.x - car.x);
    const diff = angleDiff(car.angle, want);
    car.angle += clamp(diff * 2.0, -2.2 * dt, 2.2 * dt);
    const wantSpeed = blocked ? 0 : car.cruise;
    if (car.speed < wantSpeed) car.speed = Math.min(wantSpeed, car.speed + CAR.accel * 0.5 * dt);
    else car.speed = Math.max(wantSpeed, car.speed - CAR.brake * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    // Pushed off the road: steer back to the nearest road point.
    if (!onRoad(car.x, car.y)) {
      const rp = nearestRoadPoint(car.x, car.y);
      const w2 = Math.atan2(rp.y - car.y, rp.x - car.x);
      car.angle += clamp(angleDiff(car.angle, w2) * 2.0, -2.2 * dt, 2.2 * dt);
    }
    resolveCarBuildings(car);
  }

  function stepPoliceCar(car, dt, events) {
    if (car.health <= 0) {
      car.speed = Math.max(0, car.speed - 300 * dt);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      return events;
    }
    car.siren += dt;
    // Chase the player: steer hard, accelerate hard, ram when close.
    const want = Math.atan2(player.y - car.y, player.x - car.x);
    const diff = angleDiff(car.angle, want);
    car.angle += clamp(diff * 2.6, -2.8 * dt, 2.8 * dt);
    const d = Math.hypot(player.x - car.x, player.y - car.y);
    const wantSpeed = d > 120 ? POLICE.maxSpeed : POLICE.maxSpeed * 0.55;
    if (car.speed < wantSpeed) car.speed = Math.min(wantSpeed, car.speed + POLICE.accel * dt);
    else car.speed = Math.max(wantSpeed, car.speed - CAR.brake * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    resolveCarBuildings(car);
    // Police shoot at a player on foot who is close and in range.
    if (!player.inCar && d < POLICE.shootRange) {
      car.shootTimer = (car.shootTimer || 0) - dt;
      if (car.shootTimer <= 0) {
        car.shootTimer = POLICE.shootCooldown;
        if (player.invulnerable <= 0) {
          player.health -= POLICE.shootDamage;
          player.regenDelay = 4;
          burst(player.x, player.y, '#ff4a4a', 4, 100);
          events |= EVENT_HIT;
        }
      }
    }
    return events;
  }

  function collideCars(events) {
    for (let i = 0; i < cars.length; i += 1) {
      const a = cars[i];
      if (!a.active) continue;
      for (let j = i + 1; j < cars.length; j += 1) {
        const b = cars[j];
        if (!b.active) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 44 * 44 || d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const push = (44 - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        const rel = Math.abs(a.speed - b.speed);
        if (rel > 120) {
          a.health -= 6;
          b.health -= 6;
          burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffb03f', 6, 140);
          events |= EVENT_CRASH;
          const playerCar = a.driver === 'player' ? a : b.driver === 'player' ? b : null;
          const other = playerCar === a ? b : a;
          // A police ram only counts as a player crime when the player's car is
          // faster: being rammed by the police is not the player's fault.
          if (playerCar && other.driver === 'police' && playerCar.speed > other.speed) addHeat(WANTED.hitPolice);
          else if (playerCar && rel > 260) addHeat(4);
          if (playerCar) {
            const tmp = a.speed;
            a.speed = b.speed * 0.6;
            b.speed = tmp * 0.6;
          }
        }
      }
    }
    return events;
  }

  function carHitsPeds(events) {
    const pc = player.inCar;
    if (!pc) return events;
    for (const p of peds) {
      if (!p.active || p.state === 'down') continue;
      if (dist2(p.x, p.y, pc.x, pc.y) < 30 * 30 && Math.abs(pc.speed) > 60) {
        p.state = 'down';
        p.downTimer = 3;
        p.vx = (p.x - pc.x) * 0.4;
        p.vy = (p.y - pc.y) * 0.4;
        burst(p.x, p.y, '#ff4a4a', 8, 160);
        addHeat(WANTED.hitPed);
        state.pedsHit += 1;
        events |= EVENT_HIT;
      }
    }
    return events;
  }

  function stepPeds(dt) {
    for (const p of peds) {
      if (!p.active) continue;
      if (p.state === 'down') {
        p.downTimer -= dt;
        if (p.downTimer <= 0) { p.state = 'walk'; p.panicTimer = 0; }
        continue;
      }
      // Flee from a speeding player car or nearby gunfire.
      const pc = player.inCar;
      const threatD = pc ? Math.hypot(p.x - pc.x, p.y - pc.y) : Infinity;
      if ((pc && threatD < 130 && Math.abs(pc.speed) > 80) || p.panicTimer > 0) {
        if (p.panicTimer <= 0) {
          p.panicTimer = 2;
          p.tx = p.x + (p.x - (pc ? pc.x : player.x)) * 2;
          p.ty = p.y + (p.y - (pc ? pc.y : player.y)) * 2;
        }
        p.panicTimer -= dt;
        p.speed = PED.runSpeed;
      } else {
        p.speed = PED.walkSpeed;
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 30) {
        const sp = sidewalkPoint(p.x + (random() - 0.5) * 600, p.y + (random() - 0.5) * 600);
        p.tx = sp.x;
        p.ty = sp.y;
      } else {
        p.angle = Math.atan2(dy, dx);
        p.x += (dx / d) * p.speed * dt;
        p.y += (dy / d) * p.speed * dt;
        p.walkPhase += dt * p.speed * 0.09;
      }
      for (const b of city.buildings) {
        const r = resolveCircleBuilding(p.x, p.y, 10, b);
        if (r.hit) { p.x = r.x; p.y = r.y; }
      }
      if (Math.hypot(p.x - player.x, p.y - player.y) > PED.despawnDistance) p.active = false;
    }
  }

  function stepBullets(dt, events) {
    for (const b of bullets) {
      if (!b.active) continue;
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.life <= 0) { b.active = false; continue; }
      let dead = false;
      for (const bd of city.buildings) {
        if (b.x >= bd.x && b.x <= bd.x + bd.w && b.y >= bd.y && b.y <= bd.y + bd.h) {
          burst(b.x, b.y, '#ffd76a', 3, 80);
          dead = true;
          break;
        }
      }
      if (dead) { b.active = false; continue; }
      for (const c of cars) {
        if (!c.active || c.driver === 'player') continue;
        if (dist2(b.x, b.y, c.x, c.y) < 26 * 26) {
          c.health -= PLAYER.gunDamage;
          burst(b.x, b.y, '#ffb03f', 5, 120);
          if (c.driver === 'police') addHeat(WANTED.hitPolice);
          b.active = false;
          dead = true;
          break;
        }
      }
      if (dead) continue;
      for (const p of peds) {
        if (!p.active || p.state === 'down') continue;
        if (dist2(b.x, b.y, p.x, p.y) < 14 * 14) {
          p.state = 'down';
          p.downTimer = 3;
          addHeat(WANTED.killPed);
          burst(b.x, b.y, '#ff4a4a', 6, 120);
          b.active = false;
          break;
        }
      }
    }
    return events;
  }

  function stepPickups(dt, events) {
    state.pickupTimer -= dt;
    if (state.pickupTimer <= 0) {
      state.pickupTimer = 14;
      const ang = random() * TAU;
      const d = 300 + random() * 500;
      const rp = nearestRoadPoint(player.x + Math.cos(ang) * d, player.y + Math.sin(ang) * d);
      spawnPickup('cash', rp.x, rp.y);
    }
    for (const p of pickups) {
      if (!p.active) continue;
      p.timer -= dt;
      if (p.timer <= 0) { p.active = false; continue; }
      if (dist2(p.x, p.y, player.x, player.y) < 44 * 44) {
        p.active = false;
        if (p.kind === 'cash') {
          player.money += 25;
          mission.banner = '+$25';
          mission.bannerTimer = 1.2;
        } else if (p.kind === 'health') {
          player.health = Math.min(PLAYER.health, player.health + 30);
          mission.banner = '+30 HP';
          mission.bannerTimer = 1.2;
        } else {
          player.ammo = PLAYER.gunAmmo;
          player.reloading = 0;
          mission.banner = 'Ammo refilled';
          mission.bannerTimer = 1.2;
        }
        events |= EVENT_PICKUP;
      }
    }
    return events;
  }

  function stepWanted(dt) {
    const pd = nearestPoliceDistance();
    const visible = pd < 600;
    if (visible) wanted.hiddenTimer = 0;
    else wanted.hiddenTimer += dt;
    if (wanted.hiddenTimer > WANTED.decayDelay && wanted.heat > 0) {
      wanted.heat = Math.max(0, wanted.heat - WANTED.decayRate * dt);
      wanted.stars = Math.min(5, Math.floor(wanted.heat / 20));
    }
    // Keep the police count matched to the wanted level.
    const wantCount = wanted.stars === 0 ? 0 : Math.min(WANTED.maxPolice, wanted.stars + 1);
    let have = countPolice();
    if (have < wantCount) {
      spawnPolice();
      have += 1;
    }
    // Despawn far police when the heat is gone.
    if (wanted.stars === 0) {
      for (const c of cars) {
        if (c.active && c.driver === 'police') {
          const d = Math.hypot(c.x - player.x, c.y - player.y);
          if (d > POLICE.despawnDistance) c.active = false;
        }
      }
    }
    // Roadblocks at 3+ stars: park two police cars across the road ahead, with a gap
    // between them the player can thread — a wall would end the run on the spot.
    if (wanted.stars >= POLICE.roadblockAtStars && state.elapsed % 9 < dt) {
      const ahead = player.inCar ? player.inCar : player;
      const a = player.angle;
      const bx = ahead.x + Math.cos(a) * 520;
      const by = ahead.y + Math.sin(a) * 520;
      const rp = nearestRoadPoint(bx, by);
      for (let i = 0; i < 2; i += 1) {
        const car = spawnPolice();
        if (!car) break;
        const off = i === 0 ? -55 : 55;
        car.x = rp.x + Math.cos(a) * off;
        car.y = rp.y + Math.sin(a) * off;
        car.angle = a + Math.PI / 2;
        car.speed = 0;
      }
    }
    // The helicopter circles at 4-5 stars.
    heli.active = wanted.stars >= 4;
    // Bust: a police car close to a slow player for long enough.
    if (wanted.stars > 0 && pd < POLICE.bustRange && player.speed < 90) {
      state.bustTimer += dt;
      if (state.bustTimer > POLICE.bustTime) {
        state.busted = true;
        state.over = true;
        return EVENT_BUSTED;
      }
    } else {
      state.bustTimer = Math.max(0, state.bustTimer - dt * 2);
    }
    return EVENT_NONE;
  }

  // ---- Mission progression ----
  function nearMarker(r) {
    if (!mission.marker) return false;
    const dx = player.x - mission.marker.x;
    const dy = player.y - mission.marker.y;
    return dx * dx + dy * dy < r * r;
  }

  function stepMission(dt) {
    if (mission.done || mission.failed || state.over) return EVENT_NONE;
    if (mission.between) {
      // Next mission starts shortly after the last one ends.
      if (mission.bannerTimer <= 0) return startMission(mission.index + 1);
      return EVENT_NONE;
    }
    const idx = mission.index;
    if (idx === 0) {
      if (player.inCar) {
        setObjective('Drive to the garage', city.spots.garage, 'Garage');
        mission.stage = 1;
      }
      if (mission.stage === 1 && nearMarker(70)) return completeMission();
    } else if (idx === 1) {
      if (mission.stage === 0) {
        if (nearMarker(50)) {
          mission.stage = 1;
          mission.timer = 90;
          mission.timerMax = 90;
          addHeat(WANTED.missionHeat);
          setObjective('Deliver the package to the drop-off!', city.spots.delivery, 'Drop-off');
        }
      } else {
        mission.timer -= dt;
        if (mission.timer <= 0) return failMission('delivery too slow');
        if (nearMarker(70)) return completeMission();
      }
    } else if (idx === 2) {
      if (mission.stage === 0) {
        if (nearMarker(50)) {
          mission.stage = 1;
          addHeat(45);
          setObjective('Lose the cops, then reach the safehouse', city.spots.safehouse, 'Safehouse');
        }
      } else if (mission.stage === 1) {
        if (wanted.heat < 5) mission.stage = 2;
      } else if (mission.stage === 2) {
        if (nearMarker(70)) return completeMission();
      }
    } else if (idx === 3) {
      const t = mission.targetCar;
      if (mission.stage === 0) {
        if (!t || !t.active || t.health <= 0) {
          mission.stage = 1;
          setObjective('Target stopped. Reach the marker.', city.spots.garage, 'Garage');
        }
      } else if (nearMarker(70)) {
        return completeMission();
      }
    } else if (idx === 4) {
      if (mission.stage === 0) {
        if (nearMarker(70)) {
          mission.stage = 1;
          mission.progress = 0;
          mission.progressMax = 5;
          setObjective('Robbing the vault — stay close!', city.spots.vault, 'Vault');
        }
      } else if (mission.stage === 1) {
        if (nearMarker(90)) {
          mission.progress += dt;
          if (mission.progress >= mission.progressMax) {
            mission.stage = 2;
            addHeat(80);
            player.money += 500;
            setObjective('Escape the 4-star heat — reach the safehouse!', city.spots.safehouse, 'Safehouse');
          }
        } else {
          mission.progress = Math.max(0, mission.progress - dt * 2);
        }
      } else if (mission.stage === 2) {
        if (nearMarker(70)) return completeMission();
      }
    }
    return EVENT_NONE;
  }

  // ---- Spawning upkeep ----
  function stepSpawns(dt) {
    state.trafficTimer -= dt;
    if (state.trafficTimer <= 0) {
      state.trafficTimer = 0.8;
      let traffic = 0;
      for (const c of cars) if (c.active && c.driver === 'traffic') traffic += 1;
      if (traffic < TRAFFIC.count) spawnTrafficCar();
      // Despawn far traffic and parked cars.
      for (const c of cars) {
        if (!c.active || c.driver === 'player') continue;
        if (c.driver === 'police' || c.driver === 'target') continue;
        const d = Math.hypot(c.x - player.x, c.y - player.y);
        if (d > TRAFFIC.despawnDistance) c.active = false;
      }
    }
    state.pedTimer -= dt;
    if (state.pedTimer <= 0) {
      state.pedTimer = 0.6;
      let count = 0;
      for (const p of peds) if (p.active) count += 1;
      for (let i = 0; i < 3 && count < PED.count; i += 1) { spawnPed(player.x, player.y); count += 1; }
    }
  }

  function step(dt, input) {
    let events = EVENT_NONE;
    state.elapsed += dt;
    if (mission.bannerTimer > 0) mission.bannerTimer -= dt;

    if (input.enterExit) events = tryEnterExitCar(events);
    if (input.punch) events = playerPunch(events);
    events = playerShoot(input, events);

    stepPlayer(dt, input);
    if (player.inCar) events = stepPlayerCar(dt, input, events);
    for (const c of cars) {
      if (!c.active) continue;
      if (c.driver === 'player') continue; // driveCar already set its visuals.
      const prevAngle = c.angle;
      const prevSpeed = c.speed;
      if (c.driver === 'traffic' || c.driver === 'target') stepTrafficCar(c, dt);
      else if (c.driver === 'police') events = stepPoliceCar(c, dt, events);
      // AI visuals: steering follows the heading change, brake lights when slowing.
      c.steerVis = clamp(angleDiff(prevAngle, c.angle) / Math.max(dt, 0.001) / 2.2, -1, 1);
      c.braking = prevSpeed - c.speed > 60 * dt;
    }
    events = collideCars(events);
    events = carHitsPeds(events);
    stepPeds(dt);
    events = stepBullets(dt, events);
    events = stepPickups(dt, events);
    events = stepWanted(dt) | events;
    events = stepMission(dt) | events;
    stepSpawns(dt);

    // Helicopter orbit (visual only).
    if (heli.active) {
      heli.angle += dt * 0.35;
      heli.x = player.x + Math.cos(heli.angle) * 300;
      heli.y = player.y + Math.sin(heli.angle) * 300;
    }

    // Particles.
    for (const p of particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= (1 - 2 * dt);
      p.vy *= (1 - 2 * dt);
    }
    // Smoke from wrecked cars.
    for (const c of cars) {
      if (!c.active || c.health > 25) continue;
      if (random() < 0.25) {
        spawnParticle(c.x, c.y - 10, (random() - 0.5) * 20, -30 - random() * 20, 0.7, '#888888', 6);
      }
    }
    // Siren ambience flag.
    state.sirenTimer -= dt;
    if (countPolice() > 0 && nearestPoliceDistance() < 700) {
      if (state.sirenTimer <= 0) {
        state.sirenTimer = 1.6;
        events |= EVENT_SIREN;
      }
    }

    if (player.health <= 0 && !state.over) {
      state.wasted = true;
      state.over = true;
      mission.banner = 'Wasted! Press R to retry the mission.';
      mission.bannerTimer = 5;
      events |= EVENT_WASTED;
    }
    return events;
  }

  function reset() {
    player.x = CITY.roadsX[1];
    player.y = CITY.roadsY[2] + 40;
    player.angle = 0;
    player.health = PLAYER.health;
    player.money = 0;
    player.inCar = null;
    player.ammo = PLAYER.gunAmmo;
    player.reloading = 0;
    player.punchCooldown = 0;
    player.gunCooldown = 0;
    player.invulnerable = 0;
    player.speed = 0;
    player.moving = false;
    player.regenDelay = 0;
    player.walkPhase = 0;
    for (const c of cars) { c.active = false; c.driver = 'none'; c.isTarget = false; c.smoke = 0; c.steerVis = 0; c.braking = false; }
    for (const p of peds) p.active = false;
    for (const b of bullets) b.active = false;
    for (const p of particles) p.active = false;
    for (const p of pickups) p.active = false;
    wanted.heat = 0;
    wanted.stars = 0;
    wanted.hiddenTimer = 0;
    wanted.policeCount = 0;
    heli.active = false;
    heli.angle = 0;
    state.elapsed = 0;
    state.missionsDone = 0;
    state.carsStolen = 0;
    state.pedsHit = 0;
    state.shotsFired = 0;
    state.busted = false;
    state.wasted = false;
    state.won = false;
    state.over = false;
    state.bustTimer = 0;
    state.trafficTimer = 0;
    state.pedTimer = 0;
    state.pickupTimer = 0;
    state.sirenTimer = 0;
    // Starting population: traffic, peds, parked cars, a few pickups.
    for (let i = 0; i < 8; i += 1) spawnTrafficCar();
    for (let i = 0; i < 24; i += 1) spawnPed(player.x, player.y);
    for (let i = 0; i < 3; i += 1) spawnParkedCar(player.x + (random() - 0.5) * 400, player.y + (random() - 0.5) * 400);
    spawnPickup('health', city.spots.hospital.x, city.spots.hospital.y);
    spawnPickup('cash', CITY.roadsX[4], CITY.roadsY[3]);
    spawnPickup('ammo', CITY.roadsX[6], CITY.roadsY[5]);
    startMission(0);
  }

  reset();
  return {
    state, reset, step, startMission, retryMission,
    addHeat, spawnPolice, spawnTrafficCar, spawnParkedCar, populatePeds,
  };
}
