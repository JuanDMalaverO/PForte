// scripts/descargar-modelo-oaf.mjs — Baja el checkpoint de Onsets and Frames
// (Magenta) a public/model-oaf/. Son ~60 MB, por eso no van al repo.
//   node scripts/descargar-modelo-oaf.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'https://storage.googleapis.com/magentadata/js/checkpoints/transcription/onsets_frames_uni';
const destino = fileURLToPath(new URL('../public/model-oaf/', import.meta.url));
mkdirSync(destino, { recursive: true });

async function bajar(nombre) {
  const ruta = `${destino}${nombre}`;
  if (existsSync(ruta)) return;
  const r = await fetch(`${BASE}/${nombre}`);
  if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status}`);
  writeFileSync(ruta, Buffer.from(await r.arrayBuffer()));
  console.log('bajado', nombre);
}

await bajar('config.json');
await bajar('weights_manifest.json');
const manifiesto = JSON.parse((await import('node:fs')).readFileSync(`${destino}weights_manifest.json`, 'utf8'));
for (const grupo of manifiesto) for (const p of grupo.paths) await bajar(p);
console.log('modelo Onsets and Frames listo en', destino);
