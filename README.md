# VELVET CITY

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![make.fun rank](https://make.fun/badge/gta6-01/muhammad-rafly/gta6-open-world/rank.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![make.fun reward](https://make.fun/badge/gta6-01/muhammad-rafly/gta6-open-world/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**VELVET CITY** is an original open-world crime game set in Port Meridian, a
fictional sun-soaked modern city. Built for the make.fun bounty
[gta6-01 — "Make GTA 6"](https://make.fun/bounty/gta6-01). It runs entirely
offline from static files in a desktop browser — no network, no Rockstar
assets, everything here (city, characters, vehicles, names, story, art,
music) is original.

You are Vic Marlowe, a driver with nothing but a fast pair of legs and a whole
city to take. Steal cars, outrun the Port Meridian police, and run five jobs
for the Velvet crew — from your first stolen wheels to the Kingpin.

## How to run

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. Any static file server
works too (for example `npx serve game/`), as long as it serves `game/` from
its root.

## Controls

| Input | Action |
| --- | --- |
| W A S D | Walk / drive (car: W accelerate, S brake/reverse, A/D steer) |
| Shift | Run |
| Mouse drag / wheel | Orbit camera / zoom |
| E | Enter or exit a car (steal parked and traffic cars) |
| F | Shoot |
| Space | Punch |
| M / R | Switch radio station |
| — | Progress saves automatically (Continue on the title screen) |

## Features

- **Port Meridian** — a deterministic procedural city (3200×2400, ~176
  buildings, avenues, sidewalks, street lamps) generated from a seed, so the
  city is identical on every load.
- **Walk and drive** — third-person on foot with a chase camera, arcade car
  handling, enter/exit and car stealing.
- **Traffic and pedestrians** — cars driving the road grid and ~72 sidewalk
  pedestrians who flee when things get loud.
- **Wanted system (1–5 stars)** — police cars chase with an ease-in pursuit,
  ramming rules and cooldowns; a police helicopter with a searchlight joins
  the hunt at 4–5 stars.
- **5 missions** — First Wheels ($200), The Package ($400), Getaway ($600),
  The Heist ($800), The Kingpin ($1,500), with markers, objectives and
  payouts.
- **Combat** — punch and shoot, health, and a WASTED screen (-$200).
- **HUD and minimap** — cash, health, wanted stars, mission tracker, speed,
  and a live minimap with player, police and mission blips.
- **Radio** — two procedural WebAudio stations, VELVET FM and MERIDIAN BEATS.
- **Save / continue** — progress persists in localStorage.
- **HD visuals** — antialiasing, PCF soft shadows, PMREM environment
  lighting, 2× window textures, and black-and-white police cars with a
  full-width red/blue light bar and POLICE door decals.

## Structure

```
game/                  playable game (static files, offline)
  index.html           page, HUD, minimap, start screen
  vendor/three.min.js  vendored three.js r149
  src/rng.js           seeded RNG (mulberry32)
  src/world.js         procedural city generation + meshes
  src/main.js          gameplay: player, cars, traffic, police, missions…
main.ts                entry program: copies game/ + screenshots/ to /output
                       and writes /output/dossier.json
screenshots/           4 renders of the game (1280×720)
vendor/makefun-game.ts make.fun's dossier library (kit file, unchanged)
serve.ts               static file server for local play (kit file)
```

## License

MIT — see [LICENSE](LICENSE).
