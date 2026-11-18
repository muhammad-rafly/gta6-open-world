# VELVET CITY

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/muhammad-rafly/gta6-open-world/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/muhammad-rafly/gta6-open-world/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

VELVET CITY — an original 3D open-world crime game set in the fictional city of Port Meridian, built for the make.fun "Make GTA 6" bounty (gta6-01). Real 3D with a chase camera, offline from static files, keyboard + mouse. No Rockstar assets, no real car brands, no real city names — the city, the cars, the characters and the story are all original and drawn in code.

## The look: real 3D, dusk, neon

The simulation is a flat top-down world (same coordinates, collisions and missions), and the renderer turns it into a 3D city with three.js (vendored under `game/vendor/`, no CDN): extruded buildings with procedural facades — framed windows in warm and cool lit glass, ground-floor shopfronts with awnings, grime streaks, rooftop water towers and blinking antennas — plus glowing neon signs, a downtown core of taller towers, streets with lane markings, sidewalks and crosswalks, worn asphalt with manhole covers, oil stains and warm light pools under the lamps, and glossy puddles that catch the dusk sky. Car paint and glass are real PBR materials reflecting a procedural environment map (dusk sky, sun and neon rendered once through PMREM), so paint reads as paint and glass as glass; front wheels steer, brake lights flare, and headlight beams cut the dusk (H toggles them). The streets carry hydrants, bins, bus stops and working traffic lights on an 18-second cycle; 72 pedestrians vary in height, skin tone and hats, walking the sidewalks. Beyond the map edge sit a dark skyline silhouette, faint stars and drifting clouds, under a low warm sun with soft shadows, a gradient dusk sky and fog for depth. The chase camera sits behind the player on foot and behind the car when driving, with a speed-driven field-of-view kick; a police helicopter circles overhead at 4–5 stars, its searchlight sweeping the streets. The renderer runs antialiased with the pixel ratio capped at 2 and soft shadows (HD), and the screenshots are crisp 1280×720. All art is drawn in code.

## The game

- **Walk and drive.** WASD to move (Shift to run), F to enter or exit a car, W/S to accelerate and brake, A/D to steer, Space for the handbrake, H for the headlights. Mouse aim, click to shoot, J to punch up close. A stolen car is yours until a cop takes it back.
- **A living city.** 18 traffic cars and 72 pedestrians follow the road grid, and panic when shots ring out. Parked cars line the kerbs; police units, sports cars and vans all drive differently.
- **Wanted, 1–5 stars.** Steal a car, hit a pedestrian, shoot a cop — the heat rises. Units pursue, ram and roadblock; at 4–5 stars a helicopter joins the chase. Lie low and the heat decays; get caught and you are busted.
- **Five story jobs for Vinny.** First Wheels (steal a car and bring it to the garage), Hot Delivery (a timed package run across town), Getaway (lose a 3-star tail), Takedown (stop the target car, then reach the marker), and the Central Bank vault heist — $1,500 and the story complete. Missions pay, the haul is yours to keep, and the best haul saves between sessions.
- **HUD and minimap.** Health, money, wanted stars, speed, ammo, mission tracker with distance and timer, plus a live top-down minimap with the mission beacon, police blips and the player arrow.
- **Radio.** Two procedural WebAudio stations — VELVET FM and NIGHT DRIVE — switch with C, mute with M. No audio files, everything is synthesized.
- **Start, pause, save, game over, win.** Title screen, P to pause, localStorage save — Enter continues your haul and mission, N starts fresh — busted and wasted endings, and a win screen when the vault job is done.

## Run it

Serve it locally with `node serve.ts`, then open http://localhost:8080. No build step, no network: open `game/index.html` from any static server and it runs.

## Screenshots

The cover shows the chase camera in a police pursuit through downtown Port Meridian at dusk. The other shots show the title screen over the living city, the Hot Delivery run with the mission beacon, and open-road driving.

## Tech notes

- `game/src/world.js` is the whole simulation (fixed 1/60 s steps, seeded RNG only — no `Date.now()` or `Math.random()` in the sim, so two runs are byte-identical).
- `game/src/city.js` builds the city from the seeded RNG: road grid, blocks, buildings, trees, lamps, mission spots.
- `game/src/render3d.js` is the three.js renderer: a procedural PMREM environment map, PBR car paint and glass, instanced buildings, lamps, trees and street furniture, working traffic lights, pooled cars and people, the chase camera, the DOM HUD and the minimap.
- `game/src/audio.js` is the procedural WebAudio synth (engine, sirens, radio).
- `game/src/shots.js` stages the four screenshot scenes with a road-graph autopilot.
- `main.ts` (Node 22, stdlib only) copies `game/` and `screenshots/` to the output directory and writes `dossier.json` via the vendored `vendor/makefun-game.ts`.

## Referral

Play more make.fun bounties: https://make.fun/r/mdf3w94k
