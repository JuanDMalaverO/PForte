// ============================================================================
// scripts/evaluar-acordes.mjs — La prueba justa con el piano REAL de Juan:
// calibrar las huellas con la grabación de la ESCALA (prueba1) y evaluar los
// tres motores con la grabación de los 20 ACORDES (prueba2), que son
// grabaciones distintas. Usa el bloque 4 de la pantalla B2 con la lista
// esperada (un acorde por línea).
//
//   node scripts/evaluar-acordes.mjs docs/resultados/muestras/prueba1.mp3 docs/resultados/muestras/prueba2.mp3
//
// Requiere `npm run dev` corriendo.
// ============================================================================

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [escala, acordes] = process.argv.slice(2);
if (!escala || !acordes) throw new Error('uso: node scripts/evaluar-acordes.mjs <escala.mp3> <acordes.mp3>');
const MIDI_MIN = 41, MIDI_MAX = 74; // rango de la escala grabada

const navegador = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11'] });
const pagina = await (await navegador.newContext()).newPage();
pagina.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

async function abrir(motor, soloEsperadas = true) {
  await pagina.goto('http://localhost:5173/');
  await pagina.click('#btn-vista-medicion');
  await pagina.waitForSelector('text=listo (backend', { timeout: 120000 });
  await pagina.selectOption('#motor', motor);
  if (motor === 'huellas') {
    if (soloEsperadas) await pagina.check('#solo-esperadas');
    else await pagina.uncheck('#solo-esperadas');
  }
  if (motor === 'onsets-frames') {
    await pagina.click('#btn-cargar-oaf');
    await pagina.waitForFunction(() => { const e = document.querySelector('#oaf-estado'); return !e || (e.textContent ?? '').startsWith('error'); }, null, { timeout: 600000 });
  }
  await pagina.click('text=usar los 20 acordes de prueba');
}

async function evaluar(etiqueta) {
  await pagina.setInputFiles('#archivo-audio', resolve(acordes));
  await pagina.waitForSelector('#resultado-archivo', { state: 'attached', timeout: 900000 });
  const r = JSON.parse(await pagina.locator('#resultado-archivo').textContent());
  const t = r.totales;
  console.log(`${etiqueta}: ataques ${r.ataques}/20, exactos ${t.acordesExactos}/${t.acordes} (${t.porcentajeExactos}%), recall ${t.recall}%, precisión ${t.precision}%, proceso medio ${t.msProcesoMedio} ms`);
  const NOMBRES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const nombre = (m) => NOMBRES[m % 12] + (Math.floor(m / 12) - 1);
  const errores = r.filas.filter((f) => !f.comparacion.exacto).map((f) =>
    `#${f.n} falt[${f.comparacion.faltantes.map(nombre).join(' ')}] extra[${f.comparacion.extras.map(nombre).join(' ')}]${f.satura ? ' SATURA' : ''}`);
  console.log('   errores:', errores.join(' | ') || 'ninguno');
  return r;
}

const salida = {};
await abrir('huellas');
await pagina.evaluate(() => localStorage.clear());
await abrir('huellas');
salida.huellasSinCalibrar = await evaluar('huellas sin calibrar (esperadas y vecinas)');

// Calibrar con la ESCALA y recargar.
const rango = pagina.locator('input[type=number][min="21"][max="108"]');
await rango.nth(0).fill(String(MIDI_MIN));
await rango.nth(1).fill(String(MIDI_MAX));
await pagina.setInputFiles('#archivo-calibracion', resolve(escala));
await pagina.waitForSelector(`#calib-estado:has-text("${MIDI_MAX - MIDI_MIN + 1}/${MIDI_MAX - MIDI_MIN + 1}")`, { timeout: 120000 });
console.log('calibración con la escala:', (await pagina.textContent('#calib-estado')).trim());
await abrir('huellas');
salida.huellasCalibradas = await evaluar('huellas calibradas (esperadas y vecinas)');
await abrir('huellas', false);
salida.huellasCalibradasTodas = await evaluar('huellas calibradas (todas las teclas, sin saber qué se espera)');

await abrir('basic-pitch');
salida.basicPitch = await evaluar('basic-pitch');

await abrir('onsets-frames');
salida.onsetsFrames = await evaluar('onsets and frames');

writeFileSync('docs/resultados/grabacion-real-acordes.json', JSON.stringify(salida, null, 2));
await navegador.close();
