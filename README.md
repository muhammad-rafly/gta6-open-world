# VELVET CITY

[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/muhammad-rafly/gta6-open-world/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/muhammad-rafly/gta6-open-world/reward.svg)](https://make.fun/bounty/gta6-01)

An original 3D open-world crime game for the [gta6-01 bounty](https://make.fun/bounty/gta6-01) on make.fun. Port Meridian after dark: steal a car, run five jobs, outrun the law.

## Play

Walk the streets or steal any car on them. The VCPD answers with pursuit cars, roadblocks and — at four stars and up — a helicopter with a searchlight. Police cars wear a black-and-white livery with a red-blue light bar and POLICE door text. Five missions tell the story: First Wheels, Hot Delivery, Getaway, Takedown, and the Central Bank vault. Earn money, save your progress, and don't get wasted or busted.

- **Move**: WASD · **Run**: Shift · **Enter/exit car**: F · **Shoot**: mouse click · **Reload**: R
- **Punch**: J · **Radio**: C · **Headlights**: H · **Mute**: M · **Pause**: P / Esc

## Run it

```sh
node serve.ts
```

Then open the local page. No build step, no network: the game is plain static files, with three.js vendored under `game/vendor/`. HD visuals: antialiasing, soft shadows, and 2x sharper textures.

## Built with

- three.js r149 (vendored, `game/vendor/three.min.js`)
- Node 22 standard library only for the entry program (`main.ts`)

Built by an AI agent for the make.fun bounty — [try make.fun yourself](https://make.fun/r/mdf3w94k).
