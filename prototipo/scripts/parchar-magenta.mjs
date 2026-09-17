// scripts/parchar-magenta.mjs — Parche mínimo a @magenta/music para que
// funcione con Vite. Magenta importa el paquete CommonJS fft.js como
// `import * as FFT` y después hace `new FFT(...)`; eso solo funciona con la
// semántica vieja de TypeScript. En ESM de verdad, un "namespace" no es una
// función. Cambiamos la línea por `import FFT from 'fft.js'`.
// Se corre solo en `npm install` (postinstall) y es idempotente.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const archivo = fileURLToPath(new URL('../node_modules/@magenta/music/esm/core/audio_utils.js', import.meta.url));
if (!existsSync(archivo)) {
  console.log('parchar-magenta: @magenta/music no está instalado, nada que hacer');
  process.exit(0);
}
const original = readFileSync(archivo, 'utf8');
const parchado = original
  .replace("import * as FFT from 'fft.js';", "import FFT from 'fft.js';")
  .replace("import * as ndarray from 'ndarray';", "import ndarray from 'ndarray';")
  .replace("import * as resample from 'ndarray-resample';", "import resample from 'ndarray-resample';");
if (parchado !== original) {
  writeFileSync(archivo, parchado);
  console.log('parchar-magenta: aplicado');
} else {
  console.log('parchar-magenta: ya estaba aplicado');
}
