// ============================================================================
// scripts/evaluar-grabacion.mjs — Evalúa los tres motores sobre una grabación
// REAL de la escala cromática (una nota por vez, ascendente) hecha por Juan.
//
//   node scripts/evaluar-grabacion.mjs docs/resultados/muestras/prueba1.mp3 41 74
//
// Para cada motor: sube el archivo al bloque 4, agrupa las notas detectadas
// por ataque (las que empiezan a menos de 150 ms se consideran el mismo
// ataque), y compara el k-ésimo ataque con la k-ésima nota esperada.
// Con huellas se corre dos veces: sin calibrar, y calibrando con esa misma
// grabación (la calibración queda en localStorage; cada análisis usa una
// página recién cargada porque subir el mismo archivo dos veces a la misma
// casilla no dispara un análisis nuevo). Requiere `npm run dev` corriendo.
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
const contexto = await navegador.newContext();
const pagina = await contexto.newPage();
pagina.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

async function abrir(motor) {
  await pagina.goto('http://localhost:5173/');
  await pagina.click('#btn-vista-medicion');
  await pagina.waitForSelector('text=listo (backend', { timeout: 120000 });
  await pagina.selectOption('#motor', motor);
  if (motor === 'huellas') await pagina.uncheck('#solo-esperadas'); // no sabemos qué esperar: buscar en todo el rango
  if (motor === 'onsets-frames') {
    await pagina.click('#btn-cargar-oaf');
    await pagina.waitForFunction(() => { const e = document.querySelector('#oaf-estado'); return !e || (e.textContent ?? '').startsWith('error'); }, null, { timeout: 600000 });
  }
}

// Instantes de referencia de cada nota esperada. Los fija la primera corrida
// (motor de huellas, que ubica los ataques por flujo espectral); después cada
// motor se evalúa por VENTANA DE TIEMPO alrededor de esos instantes, así un
// motor que reporta ataques de más no corre la cuenta de los demás.
let referencia = null;

async function analizar(etiqueta) {
  await pagina.setInputFiles('#archivo-audio', resolve(archivo));
  await pagina.waitForSelector('#resultado-archivo', { state: 'attached', timeout: 900000 });
  const r = JSON.parse(await pagina.locator('#resultado-archivo').textContent());
  const notas = [...r.notas].sort((a, b) => a.inicioSeg - b.inicioSeg);
  const ataques = [];
  for (const n of notas) {
    const ultimo = ataques[ataques.length - 1];
    if (ultimo && n.inicioSeg - ultimo.tiempo < 0.15) ultimo.midis.push(n.midi);
    else ataques.push({ tiempo: n.inicioSeg, midis: [n.midi] });
  }
  if (!referencia && ataques.length === esperadas.length) referencia = ataques.map((a) => a.tiempo);
  let exactas = 0, vistas = 0, extras = 0;
  const detalle = [];
  esperadas.forEach((m, k) => {
    let d;
    if (referencia) {
      const t = referencia[k];
      d = [...new Set(notas.filter((n) => n.inicioSeg >= t - 0.25 && n.inicioSeg < t + 0.8).map((n) => n.midi))];
    } else {
      const a = ataques[k];
      d = a ? [...new Set(a.midis)] : [];
    }
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
await abrir('huellas');
await pagina.evaluate(() => localStorage.clear());
await abrir('huellas');
salida.huellasSinCalibrar = await analizar('huellas sin calibrar');

// Calibrar con esta misma grabación (rango = las notas de la escala) y volver a cargar.
const inputsRango = pagina.locator('input[type=number][min="21"][max="108"]');
await inputsRango.nth(0).fill(String(MIDI_MIN));
await inputsRango.nth(1).fill(String(MIDI_MAX));
await pagina.setInputFiles('#archivo-calibracion', resolve(archivo));
await pagina.waitForSelector(`#calib-estado:has-text("${esperadas.length}/${esperadas.length}")`, { timeout: 120000 });
console.log('calibración:', (await pagina.textContent('#calib-estado')).trim());
await abrir('huellas');
salida.huellasCalibradas = await analizar('huellas calibradas');

await abrir('basic-pitch');
salida.basicPitch = await analizar('basic-pitch');

await abrir('onsets-frames');
salida.onsetsFrames = await analizar('onsets and frames');

writeFileSync(`docs/resultados/grabacion-real-${MIDI_MIN}-${MIDI_MAX}.json`, JSON.stringify(salida, null, 2));
await navegador.close();
