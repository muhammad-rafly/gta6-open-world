# VELVET CITY

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/muhammad-rafly/gta6-open-world/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/muhammad-rafly/gta6-open-world/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**VELVET CITY** is an original open-world crime game set in Port Meridian, a
sun-soaked dusk city of ~176 buildings, built in full 3D with three.js. It runs
offline from static files — no build step, no network. Entry for the make.fun
**gta6-01** bounty ("Make GTA 6").

## Play

Open `game/index.html` in desktop Chrome (or run `node serve.ts` and open
http://localhost:8080). Keyboard + mouse.

| Key | Action |
| --- | --- |
| W A S D | Move / drive |
| Shift | Run |
| Space | Jump / handbrake |
| E | Steal & enter car |
| F | Exit car |
| Click | Shoot (on foot) |
| M | Start / retry mission |
| R | Radio station (2 synthesized stations) |
| N | Mute radio |
| P | Pause |
| Mouse drag / wheel | Look around / zoom camera |

## The game

- **Open world:** Port Meridian (3200×2400) — avenues, streets, sidewalks,
  traffic, 72 pedestrians, a park, a beach and the Central Bank.
- **Wanted system:** 1–5 stars. Police cars chase with an ease-in pursuit,
  ram with limited damage, and a helicopter with a searchlight joins at 4–5
  stars. Lay low and the heat fades.
- **Missions:** five jobs for the crew — First Wheels ($200), Courier Run
  ($400), Bank Job Prep ($600), Heat Wave ($800) and The Central Vault
  ($1,500) — with a save that carries your progress (localStorage).
- **HD look:** black-white police livery with a flashing red/blue light bar
  and POLICE door decals, antialiased rendering, soft shadows that follow
  the player, an environment map, and 2× road and facade textures.
- **HUD + minimap:** cash, health, wanted stars, mission objective,
  speedometer, live minimap with police and mission blips, and two
  synthesized radio stations.

## Layout

- `main.ts` — Node 22 entrypoint: copies `game/` + `screenshots/` to
  `/output` and writes `dossier.json` (see `vendor/makefun-game.ts`).
- `game/index.html` — the game shell and HUD.
- `game/src/rng.js` — seeded random numbers (the city is deterministic).
- `game/src/world.js` — Port Meridian: city, roads, buildings, bank, park.
- `game/src/main.js` — gameplay: player, cars, police, helicopter,
  missions, combat, HUD, minimap, radio.
- `game/vendor/three.min.js` — vendored three.js.
- `screenshots/` — 4 real renders of the game.

## License

MIT — see `LICENSE`.
