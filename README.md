# VELVET CITY

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![make.fun rank](https://make.fun/badge/gta6-01/muhammad-rafly/gta6-open-world/rank.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![make.fun reward](https://make.fun/badge/gta6-01/muhammad-rafly/gta6-open-world/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An original open-world crime game set in **Port Meridian**, a fictional
sun-soaked city built with three.js. Explore on foot and by car, steal
vehicles, outrun the police, and run five missions to take over the city.

## Play

Open `game/index.html` in desktop Chrome (or serve the `game/` folder with
any static server, e.g. `node serve.ts`), then press Enter.

- **WASD / arrows** — walk or drive
- **Shift** — run
- **E** — enter / exit a car (stealing one raises your wanted level)
- **F** — punch · **Click / Space** — shoot
- **R** — switch radio station (VELVET FM / MERIDIAN BEATS)
- **Mouse drag** — orbit camera · **Wheel** — zoom

## The city

- A deterministic city (seed 1337): ~178 buildings, 30 cars (10 parked,
  20 in traffic), 72 citizens, traffic lights that actually stop traffic,
  zebra crossings, bus stops, food stalls, neon signs and a plaza.
- Citizens live their day: chatting in pairs, sitting on benches, waiting
  at bus stops, jogging, walking dogs, crossing at zebra crossings, and
  running the food stalls. Scare them and they run.
- Street furniture (benches, flags, bus stops) sits on sidewalks and in the
  plaza — never in a traffic lane.
- **Wanted 1–5 stars**: foot cops, police cars, and a helicopter with a
  searchlight at 4–5 stars. Hide for 8+ seconds and the heat drops a star.
- **5 missions** ($200 / $400 / $600 / $800 / $1,500), a **Pay 'n Spray**
  at the plaza (repair + clear wanted, $100), **WASTED** (−$200) and
  **BUSTED** (−$100) — with a GTA-style HUD, round minimap, blinking
  wanted stars, radio banners and floating cash text.
- Procedural WebAudio: two radio stations, police sirens, engine hum.
- Save / continue via localStorage (`velvet-city-save-v1`).

Everything is original: the city, characters, vehicles, names, story, art,
sounds and music. No Rockstar Games assets, names or maps.

## Entry

Built for the make.fun bounty **gta6-01 — "Make GTA 6"**. `main.ts`
(Node 22) copies `game/` and `screenshots/` to the output directory and
writes `dossier.json` with the kit's `vendor/makefun-game.ts`.

License: MIT.
