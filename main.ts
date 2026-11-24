// main.ts — VELVET CITY entry program (gta6-01).
// Copies game/ and screenshots/ from this repository into the output
// directory and writes /output/dossier.json with buildDossier from the
// kit's vendor/makefun-game.ts. Outside the grader, MAKEFUN_OUTPUT_DIR
// stands in for /output. Node 22, standard library only.
// Fix pass (Round 4): dossier schema makefun/dossier/v1 via kit vendor/makefun-game.ts.
// Fix-2 (Round 4): no logic change — screenshots regenerated after benches/flags moved off roads.
// Fix-3 (Round 4, recording #14): no logic change — README badge fix only.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const gameOut = join(outDir, 'game');
  const shotsOut = join(outDir, 'screenshots');
  if (existsSync(gameOut)) rmSync(gameOut, { recursive: true, force: true });
  if (existsSync(shotsOut)) rmSync(shotsOut, { recursive: true, force: true });
  cpSync(join(repoRoot, 'game'), gameOut, { recursive: true });
  cpSync(join(repoRoot, 'screenshots'), shotsOut, { recursive: true });
  const dossier = buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 256 * 1024 },
    game_max_files: 993,
    game_max_bytes: 48 * 1024 * 1024,
    game_path_max_bytes: 1000,
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  console.log('VELVET CITY dossier written: ' + dossier.length + ' bytes');
}

main();
