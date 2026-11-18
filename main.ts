// VELVET CITY — a make.fun gta6-01 entry (Node 22, standard library only). The game
// is this directory's game/ folder: plain static files a desktop browser loads offline
// (game/index.html and its classic scripts, three.js vendored under game/vendor/).
// This program hands it in: it copies game/ and screenshots/ to /output and writes
// /output/dossier.json, the summary the judge reads, via the vendored make.fun library.
//
// Serve locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes;
// the others refuse an entry the scorer would refuse (more than 4 screenshots or one
// over 256 KiB; more than 993 files in game/ or 48 MiB of game files, or a path under
// game/ over 1000 bytes).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

// One-line summary, so a build that silently copies the wrong thing is obvious.
function countFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  }
  return n;
}
const dossierBytes = statSync(join(out, 'dossier.json')).size;
const shotNames = existsSync(join(out, 'screenshots'))
  ? readdirSync(join(out, 'screenshots')).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort()
  : [];
console.log(
  `VELVET CITY -> ${out}: ${countFiles(join(out, 'game'))} game files, ` +
  `${shotNames.length} screenshots (${shotNames.join(', ')}), dossier ${dossierBytes} bytes`,
);
