// ============================================================================
// scripts/evaluar-grabacion.mjs — Evalúa los tres motores sobre una grabación
// REAL de la escala cromática (una nota por vez, ascendente) hecha por Juan.
//
//   node scripts/evaluar-grabacion.mjs docs/resultados/muestras/prueba1.mp3 41 74
//
// Para cada motor: sube el archivo al bloque 4, agrupa las notas detectadas
// por ataque (las que empiezan a menos de 150 ms se consideran el mismo
// ataque), y compara el k-ésimo ataque con la k-ésima nota esperada.
// Después calibra las huellas con esa misma grabación y repite con huellas.
// Requiere `npm run dev` corriendo.
// ============================================================================

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [archivo, minTxt, maxTxt] = process.argv.slice(2);
if (!archivo) throw new Error('uso: node scripts/evaluar-grabacion.mjs <audio> [midiMin] [midiMax]');
const MIDI_MIN = Number(minTxt ?? 41), MIDI_MAX = Number(maxTxt ?? 74);
const esperadas = [];
for (let m = MIDI_MIN; m <= MIDI_MAX; m++) esperadas.push(m);
const NOMBRES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nombre = (m) => NOMBRES[m % 12] + (Math.floor(m / 12) - 1);

const navegador = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11'] });
const pagina = await navegador.newPage();
pagina.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await pagina.goto('http://localhost:5173/');
await pagina.click('#btn-vista-medicion');
await pagina.waitForSelector('text=listo (backend', { timeout: 120000 });

async function analizar(etiqueta) {
  await pagina.locator('#resultado-archivo').evaluateAll((els) => els.forEach((e) => e.remove()));
  await pagina.setInputFiles('#archivo-audio', resolve(archivo));
  await pagina.waitForSelector('#resultado-archivo', { state: 'attached', timeout: 900000 });
  const r = JSON.parse(await pagina.locator('#resultado-archivo').textContent());
  // Agrupar por ataque.
  const notas = [...r.notas].sort((a, b) => a.inicioSeg - b.inicioSeg);
  const ataques = [];
  for (const n of notas) {
    const ultimo = ataques[ataques.length - 1];
    if (ultimo && n.inicioSeg - ultimo.tiempo < 0.15) ultimo.midis.push(n.midi);
    else ataques.push({ tiempo: n.inicioSeg, midis: [n.midi] });
  }
  // Comparar k-ésimo ataque con k-ésima esperada (si sobran o faltan ataques, se nota).
  let exactas = 0, vistas = 0, extras = 0;
  const detalle = [];
  esperadas.forEach((m, k) => {
    const a = ataques[k];
    const d = a ? [...new Set(a.midis)] : [];
    const ok = d.includes(m);
    if (ok) vistas++;
    if (ok && d.length === 1) exactas++;
    extras += d.filter((x) => x !== m).length;
    if (!(ok && d.length === 1)) detalle.push(`${nombre(m)}→${d.map(nombre).join(' ') || '—'}`);
  });
  const resumen = { etiqueta, ataquesDetectados: ataques.length, notasEsperadas: esperadas.length, vistas, exactas, extras, msProceso: r.ms, detalleMotor: r.detalle };
  console.log(`${etiqueta}: ataques ${ataques.length}/${esperadas.length}, notas vistas ${vistas}/${esperadas.length}, exactas ${exactas}, extras ${extras}, proceso ${r.ms} ms · ${r.detalle}`);
  console.log('   errores:', detalle.join(' | ') || 'ninguno');
  return { resumen, ataques, detalle };
}

const salida = {};
await pagina.selectOption('#motor', 'huellas');
await pagina.check('#solo-esperadas').catch(() => {});
await pagina.uncheck('#solo-esperadas'); // no sabemos qué esperar: buscar en todo el rango
salida.huellasSinCalibrar = await analizar('huellas sin calibrar');

// Calibrar con esta misma grabación (rango = las notas de la escala).
await pagina.fill('#calib-estado ~ * input', String(MIDI_MIN)).catch(() => {});
const inputsRango = pagina.locator('input[type=number][min="21"][max="108"]');
await inputsRango.nth(0).fill(String(MIDI_MIN));
await inputsRango.nth(1).fill(String(MIDI_MAX));
await pagina.setInputFiles('#archivo-calibracion', resolve(archivo));
await pagina.waitForTimeout(3000);
const estadoCalib = (await pagina.locator('.caja').nth(1).textContent()).replace(/\s+/g, ' ');
console.log('calibración:', estadoCalib.slice(estadoCalib.indexOf('teclas calibradas') - 8, estadoCalib.indexOf('teclas calibradas') + 200));
salida.huellasCalibradas = await analizar('huellas calibradas');

await pagina.selectOption('#motor', 'basic-pitch');
salida.basicPitch = await analizar('basic-pitch');

await pagina.selectOption('#motor', 'onsets-frames');
await pagina.click('#btn-cargar-oaf');
await pagina.waitForFunction(() => { const e = document.querySelector('#oaf-estado'); return !e || (e.textContent ?? '').startsWith('error'); }, null, { timeout: 600000 });
salida.onsetsFrames = await analizar('onsets and frames');

writeFileSync(`docs/resultados/grabacion-real-${MIDI_MIN}-${MIDI_MAX}.json`, JSON.stringify(salida, null, 2));
await navegador.close();
