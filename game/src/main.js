// VELVET CITY — the entry point. Boots the world and the 3D renderer, owns the game
// loop and the title/pause/over/win flow, and translates keyboard + mouse into the
// sim's input shape. ?shot=chase|start|mission|drive&seed=N stages a fixed scene for
// screenshots; anything else is the normal game.
//
// Movement is camera-relative: the camera sits behind the player's facing, so W walks
// or drives forward in the direction the player faces, A/D strafe or steer, and the
// mouse aims (the aim is the world point under the cursor). H toggles the headlights
// at dusk. The sim returns an events bitmask each step; this file turns those events
// into sounds and camera shake. No debug hooks: the shipped game exposes nothing on
// window except __shotReady (set only in ?shot= mode, for the screenshot harness).

const params = new URLSearchParams(window.location.search);
const seedParam = Number(params.get('seed'));
const seed = Number.isFinite(seedParam) && seedParam > 0 ? Math.floor(seedParam) : 7;

const canvas = document.getElementById('game');
canvas.width = VIEW.width;
canvas.height = VIEW.height;

const rng = createRandom(seed);
const world = createWorld(rng);
const state = world.state;
// Screenshot mode renders with MSAA (crisp stills); live play runs without it so the
// game stays responsive under a software renderer. Same scene, same sim either way.
const renderer = createRenderer(canvas, params.has('shot'));
const audio = createAudio();

let screen = SCREEN_TITLE;
let best = 0;
let lastTime = 0;
let accumulated = 0;
let radioStarted = false;

const radioEl = document.getElementById('hud-radio');

// Load the save: the best haul shows on the title, and Enter continues the saved
// money and mission (N starts fresh). The city itself always starts fresh.
let save = null;
try {
  const saved = window.localStorage.getItem(SAVE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed.best === 'number') {
      best = parsed.best;
      save = parsed;
    }
  }
} catch (err) {
  // localStorage may be unavailable (private mode): play without a saved haul.
}

function saveGame() {
  try {
    const data = {
      best: Math.max(best, state.player.money),
      money: state.player.money,
      mission: state.mission.index,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    // Keep the in-memory save in sync: R ("TRY AGAIN") on the game-over
    // screen restarts from this save, and without this the load-time save
    // would silently discard progress earned this session.
    save = data;
  } catch (err) {
    // Saving is best-effort.
  }
}

function startGame(continueSave) {
  if (screen !== SCREEN_TITLE && screen !== SCREEN_OVER && screen !== SCREEN_WIN) return;
  if (screen !== SCREEN_TITLE) world.reset();
  state.player.money = 0;
  if (continueSave && save) {
    state.player.money = save.money || 0;
    if (save.mission > 0) world.startMission(save.mission);
  }
  screen = SCREEN_PLAY;
  audio.unlock();
}

function gameOver() {
  screen = SCREEN_OVER;
  best = Math.max(best, state.player.money);
  saveGame();
}

function winGame() {
  screen = SCREEN_WIN;
  best = Math.max(best, state.player.money);
  saveGame();
}

// Input: keyboard state -> the sim's input shape.
const keys = {};
let mouseX = VIEW.width / 2;
let mouseY = VIEW.height / 2;
let mouseDown = false;

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code === 'KeyH' && screen === SCREEN_PLAY) {
    // Headlights: H toggles the beams and the headlight glow at dusk.
    renderer.setHeadlights(!renderer.headlightsAreOn());
  }
  if (e.code === 'KeyC' && screen === SCREEN_PLAY) {
    const name = audio.nextStation();
    if (radioEl) radioEl.textContent = '♪ ' + name;
  }
  if (e.code === 'KeyP' && (screen === SCREEN_PLAY || screen === SCREEN_PAUSED)) {
    screen = screen === SCREEN_PLAY ? SCREEN_PAUSED : SCREEN_PLAY;
  }
  if (e.code === 'KeyR' && screen === SCREEN_PLAY && state.mission.failed) {
    world.retryMission();
  }
  if (e.code === 'KeyR' && (screen === SCREEN_OVER || screen === SCREEN_WIN)) startGame(true);
  if (e.code === 'Enter' && screen !== SCREEN_PLAY && screen !== SCREEN_PAUSED) startGame(true);
  if (e.code === 'KeyN' && screen !== SCREEN_PLAY && screen !== SCREEN_PAUSED) startGame(false);
  if (e.code === 'KeyF' && screen === SCREEN_PLAY) {
    // Enter/exit is a tap, not a hold: flip the flag for one step.
    keys._enterExit = true;
  }
  if (e.code === 'KeyJ' && screen === SCREEN_PLAY) {
    keys._punch = true;
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) * (VIEW.width / rect.width);
  mouseY = (e.clientY - rect.top) * (VIEW.height / rect.height);
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  mouseDown = true;
  if (screen !== SCREEN_PLAY) startGame(true);
});

window.addEventListener('mouseup', () => { mouseDown = false; });

// The screen overlays' buttons start the game too.
const titleButton = document.getElementById('title-start');
if (titleButton) titleButton.addEventListener('click', () => startGame(true));
const overButton = document.getElementById('over-restart');
if (overButton) overButton.addEventListener('click', () => startGame(true));
const winButton = document.getElementById('win-restart');
if (winButton) winButton.addEventListener('click', () => startGame(true));

function readInput() {
  const aim = renderer.screenToWorld(mouseX, mouseY);
  const moveX = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const moveY = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  // Camera-relative walking: forward is the player's facing, right is 90 degrees
  // clockwise from it (the camera sits behind the facing, so this is screen-right).
  const a = state.player.angle;
  const fx = Math.cos(a);
  const fy = Math.sin(a);
  const rx = -Math.sin(a);
  const ry = Math.cos(a);
  const fwd = -moveY; // W gives moveY -1, which is forward.
  const input = {
    mx: fx * fwd + rx * moveX,
    my: fy * fwd + ry * moveX,
    moveX,
    moveY,
    run: Boolean(keys.ShiftLeft || keys.ShiftRight),
    handbrake: Boolean(keys.Space),
    shoot: mouseDown,
    punch: Boolean(keys._punch),
    enterExit: Boolean(keys._enterExit),
    aimX: aim.x,
    aimY: aim.y,
  };
  keys._enterExit = false;
  keys._punch = false;
  return input;
}

// Turn one step's events into sounds and camera shake.
function handleEvents(events) {
  if (events & EVENT_SHOT) audio.shoot();
  if (events & EVENT_CRASH) { audio.crash(); renderer.addShake(10); }
  if (events & EVENT_PICKUP) audio.pickup();
  if (events & EVENT_STEAL) audio.steal();
  if (events & EVENT_PUNCH) audio.punch();
  if (events & EVENT_MISSION_START) audio.mission();
  if (events & EVENT_MISSION_DONE) audio.mission();
  if (events & EVENT_WIN) audio.mission();
  if (events & EVENT_MISSION_FAIL) audio.fail();
  if (events & EVENT_BUSTED) audio.fail();
  if (events & EVENT_WASTED) audio.fail();
}

function nearestPoliceDistance() {
  let best = Infinity;
  for (const c of state.cars) {
    if (!c.active || c.driver !== 'police') continue;
    const d = Math.hypot(c.x - state.player.x, c.y - state.player.y);
    if (d < best) best = d;
  }
  return best;
}

function frame(time) {
  requestAnimationFrame(frame);
  if (!lastTime) lastTime = time;
  // Catch up at most 0.25s per frame: on a slow software renderer the presents are
  // slow (not the sim — a step costs under 1ms), and a smaller cap would make the game
  // run in slow motion there. A longer stall (a hidden tab) is dropped, not chased.
  const dt = Math.min(0.25, (time - lastTime) / 1000);
  lastTime = time;
  if (screen === SCREEN_PLAY) {
    accumulated += dt;
    while (accumulated >= STEP) {
      accumulated -= STEP;
      const events = world.step(STEP, readInput());
      handleEvents(events);
      if (state.over) {
        if (state.won) winGame();
        else gameOver();
        break;
      }
    }
    // Ambience follows the player: radio once, engine by speed, siren when close.
    if (!radioStarted) {
      radioStarted = true;
      audio.radio(true);
      if (radioEl) radioEl.textContent = '♪ ' + audio.radioName();
    }
    const speedLevel = state.player.inCar
      ? Math.abs(state.player.inCar.speed) / CAR.sportMaxSpeed
      : 0;
    audio.engine(speedLevel);
    // The siren follows the nearest unit: closer wails louder, far away fades out.
    audio.siren(nearestPoliceDistance());
  } else {
    if (radioStarted) {
      radioStarted = false;
      audio.radio(false);
    }
    audio.engine(0);
    audio.siren(false);
    // The title screen still animates: traffic moves behind the menu.
    if (screen === SCREEN_TITLE) {
      accumulated += dt;
      while (accumulated >= STEP) {
        accumulated -= STEP;
        world.step(STEP, { mx: 0, my: 0, moveX: 0, moveY: 0, run: false, handbrake: false, shoot: false, punch: false, enterExit: false });
      }
    }
  }
  renderer.draw(state, screen, best, dt);
}

// Screenshot mode: stage the scene, render a fixed number of frames so the chase
// camera settles, then signal readiness.
const shotName = params.get('shot');
if (shotName) {
  const staged = stageShot(shotName, world);
  screen = staged.screen;
  best = staged.best;
  // Render frames until the camera is behind the car, then flag readiness.
  let frames = 0;
  const shotLoop = () => {
    renderer.draw(state, screen, best, STEP);
    frames += 1;
    if (frames < 45) {
      requestAnimationFrame(shotLoop);
    } else {
      window.__shotReady = true;
    }
  };
  requestAnimationFrame(shotLoop);
} else {
  requestAnimationFrame(frame);
}
