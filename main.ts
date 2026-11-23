// main.ts — VELVET CITY entry program for make.fun gta6-01 ("Make GTA 6").
// Copies game/ and screenshots/ from this repository to the output directory
// ("/output" in the grader, or $MAKEFUN_OUTPUT_DIR outside it) and writes
// /output/dossier.json with vendor/makefun-game.ts buildDossier.
// Node 22, standard library only; run: MAKEFUN_OUTPUT_DIR=out node main.ts
import { buildDossier } from './vendor/makefun-game.ts';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot: string = dirname(fileURLToPath(import.meta.url));
const outDir: string = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const gameDir: string = join(repoRoot, 'game');
const shotsDir: string = join(repoRoot, 'screenshots');
if (!existsSync(gameDir)) throw new Error('game/ is missing from the repository');
if (!existsSync(shotsDir)) throw new Error('screenshots/ is missing from the repository');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(gameDir, join(outDir, 'game'), { recursive: true });
cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

const dossier: Uint8Array = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log('VELVET CITY entry written to ' + outDir + ' (' + dossier.length + ' byte dossier)');
