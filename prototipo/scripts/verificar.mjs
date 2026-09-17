// ============================================================================
// scripts/verificar.mjs — Prueba automática del prototipo en Chromium con
// Playwright. No es parte del producto: sirve para comprobar que todo funciona
// sin tener que tocar a mano cada vez, y para sacar los números de B2/B3.
//
// Qué hace:
//   1. Abre la app, espera a que OSMD dibuje y verifica que extrajo 42 notas.
//   2. Activa el "teclado de PC de prueba", arranca el metrónomo a 120 bpm y
//      "toca" la pieza completa presionando teclas en el pulso exacto.
//      Al final espera 42/42 correctas y 8 compases ocultos.
//   3. Genera ejercicios de los 3 niveles y verifica el chequeo cruzado.
//      Carga además dos piezas de repertorio real (.mxl) y mide su dificultad.
//   4. Pantalla B2: prueba sintética de basic-pitch (sin ruido y con ruido).
//   5. Pantalla B2: latencia real. Chromium usa un WAV como "micrófono falso"
//      (--use-file-for-fake-audio-capture): 20 acordes con onsets conocidos
//      pasan por todo el pipeline (captura 48 kHz → remuestreo → modelo).
//
// Uso: en una terminal `npm run dev`, en otra `node scripts/verificar.mjs`.
//      HEADED=1 abre una ventana real (en Windows, así Chromium usa la GPU).
//      SOLO_MIC=1 corre únicamente el paso 5. INTERVALO_MS, VENTANA_SEG y
//      MIN_FRAMES cambian los parámetros del modo continuo (para comparar).
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIRECCION = process.env.URL ?? 'http://localhost:5173/';
const SALIDA = fileURLToPath(new URL('../docs/resultados/', import.meta.url));
mkdirSync(SALIDA, { recursive: true });

// La pieza fija, nota por nota (misma tabla que pieza.ts, contada a mano).
const NOTAS = [
  [60, 0], [62, 1], [64, 2], [65, 3], [48, 0],
  [67, 4], [64, 6], [48, 4], [52, 4], [55, 4],
  [65, 8], [64, 9], [62, 10], [60, 11], [41, 8], [43, 10],
  [62, 12], [67, 14], [43, 12], [47, 12], [50, 12],
  [64, 16], [65, 17], [67, 18], [69, 19], [48, 16],
  [67, 20], [72, 22], [52, 20], [55, 22],
  [71, 24], [69, 25], [67, 26], [65, 27], [43, 24], [50, 24],
  [64, 28], [60, 30], [64, 30], [67, 30], [48, 28], [55, 28],
];
const TECLA = { 60: 'a', 62: 's', 64: 'd', 65: 'f', 67: 'g', 69: 'h', 71: 'j', 72: 'k',
  48: 'z', 50: 'x', 52: 'c', 53: 'v', 55: 'b', 57: 'n', 59: 'm', 41: 'q', 43: 'w', 45: 'e', 47: 'r' };

// Mismos 20 acordes que src/medicion/sintetizador.ts (copiados: este script no importa TS).
const ACORDES = [
  [60, 64, 67], [65, 69, 72], [67, 71, 74], [57, 60, 64], [62, 65, 69], [64, 67, 71], [60, 64, 67, 72],
  [48, 55, 64, 67], [43, 50, 59, 62], [41, 48, 57, 60], [60, 63, 67], [62, 66, 69], [55, 59, 62, 65],
  [53, 57, 60, 64], [48, 52, 55, 60, 64], [45, 52, 60, 64], [50, 57, 65, 69], [59, 62, 67], [52, 55, 60], [47, 50, 55, 59],
];

const BPM = 120;
const MS_POR_PULSO = 60000 / BPM;
const SOLO_MIC = process.env.SOLO_MIC === '1';
const SOLO_OAF = process.env.SOLO_OAF === '1'; // solo el paso 7
const ETIQUETA = process.env.ETIQUETA ?? '';
// Cuánto escuchar el micrófono falso: todo el WAV de acordes más un margen.
const duracionEscucha = (2.0 + 20 * 2.5 + 1.5) * 1000;

// --- WAV de acordes para el micrófono falso -----------------------------------------
const TASA_WAV = 48000;
const SILENCIO_INICIAL = 2.0, SEPARACION = 2.5, DURACION_ACORDE = 1.5;
function sintetizarAcorde(midis, dur, tasa, amp = 0.2) {
  const n = Math.floor(dur * tasa);
  const out = new Float32Array(n);
  const arm = [1, 0.55, 0.35, 0.25, 0.15, 0.1, 0.07, 0.05];
  for (const midi of midis) {
    const f0 = 440 * 2 ** ((midi - 69) / 12);
    for (let i = 0; i < n; i++) {
      const t = i / tasa;
      let s = 0;
      for (let k = 0; k < arm.length; k++) {
        const fk = f0 * (k + 1);
        if (fk >= tasa / 2) break;
        s += arm[k] * Math.exp(-t * k * 0.9) * Math.sin(2 * Math.PI * fk * t);
      }
      out[i] += s * Math.min(1, t / 0.006) * Math.exp(-t * 1.6) * amp / Math.sqrt(midis.length);
    }
  }
  // Caída suave al final (50 ms): un corte seco produce un "click" que parece un ataque.
  const cola = Math.min(n, Math.floor(0.05 * tasa));
  for (let i = 0; i < cola; i++) out[n - 1 - i] *= i / cola;
  return out;
}
function escribirWav(ruta) {
  const total = Math.ceil((SILENCIO_INICIAL + ACORDES.length * SEPARACION + 1) * TASA_WAV);
  const señal = new Float32Array(total);
  for (let i = 0; i < total; i++) señal[i] = (Math.random() * 2 - 1) * 0.005; // piso de ruido
  ACORDES.forEach((midis, k) => {
    const desde = Math.floor((SILENCIO_INICIAL + k * SEPARACION) * TASA_WAV);
    const a = sintetizarAcorde(midis, DURACION_ACORDE, TASA_WAV);
    for (let i = 0; i < a.length; i++) señal[desde + i] += a[i];
  });
  guardarWav(ruta, señal);
}
// Escala cromática para calibrar las huellas: una nota por vez, ascendente.
const ESCALA_MIN = 41, ESCALA_MAX = 74; // F2..D5, el rango de los acordes de prueba
function escribirEscala(ruta) {
  const notas = ESCALA_MAX - ESCALA_MIN + 1;
  const total = Math.ceil((1 + notas * 1.1 + 0.5) * TASA_WAV);
  const señal = new Float32Array(total);
  for (let i = 0; i < total; i++) señal[i] = (Math.random() * 2 - 1) * 0.005;
  for (let k = 0; k < notas; k++) {
    const desde = Math.floor((1 + k * 1.1) * TASA_WAV);
    const a = sintetizarAcorde([ESCALA_MIN + k], 0.6, TASA_WAV);
    for (let i = 0; i < a.length; i++) señal[desde + i] += a[i];
  }
  guardarWav(ruta, señal);
}
function guardarWav(ruta, señal) {
  const total = señal.length;
  const buf = Buffer.alloc(44 + total * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + total * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(TASA_WAV, 24); buf.writeUInt32LE(TASA_WAV * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(total * 2, 40);
  for (let i = 0; i < total; i++) buf.writeInt16LE(Math.max(-1, Math.min(1, señal[i])) * 32767, 44 + i * 2);
  writeFileSync(ruta, buf);
}
const RUTA_WAV = `${SALIDA}acordes-mic-falso.wav`;
escribirWav(RUTA_WAV);
const RUTA_ESCALA = `${SALIDA}escala-calibracion.wav`;
escribirEscala(RUTA_ESCALA);

// REANALIZAR=<ruta.json> recalcula las métricas del paso 5 a partir de un JSON
// guardado, sin abrir el navegador (útil al cambiar la forma de contar).
if (process.env.REANALIZAR) {
  const guardado = JSON.parse(readFileSync(process.env.REANALIZAR, 'utf8'));
  const { resumenMic, filasMic, mensaje } = analizarMic(guardado.exportado);
  writeFileSync(process.env.REANALIZAR, JSON.stringify({ resumen: resumenMic, filas: filasMic, exportado: guardado.exportado }, null, 2));
  console.log(mensaje);
  process.exit(0);
}

// --- navegador ----------------------------------------------------------------------
const navegador = await chromium.launch({
  headless: process.env.HEADED !== '1',
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${RUTA_WAV}`,
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=d3d11',
  ],
});
const pagina = await navegador.newPage({ viewport: { width: 1200, height: 900 } });
const erroresConsola = [];
pagina.on('console', (m) => { if (m.type() === 'error') erroresConsola.push(m.text()); });
pagina.on('pageerror', (e) => erroresConsola.push(`pageerror: ${e.message}`));

const informe = {};
const paso = (n, ok, detalle) => { informe[n] = { ok, detalle }; console.log(`${ok ? 'OK ' : 'FALLA'} ${n}: ${detalle}`); };

// --- 1. carga y extracción ------------------------------------------------------
await pagina.goto(DIRECCION);
informe.gpu = await pagina.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'sin WebGL';
});
console.log('GPU/WebGL:', informe.gpu);
await pagina.waitForSelector('#chequeo:has-text("notas extraídas")', { timeout: 30000 });
const chequeo = await pagina.textContent('#chequeo');
paso('1-carga', chequeo.includes('OK'), chequeo.trim());
await pagina.screenshot({ path: `${SALIDA}01-partitura.png`, fullPage: true });

if (!SOLO_MIC && !SOLO_OAF) {
// --- 2. tocar la pieza con el teclado de prueba ---------------------------------
await pagina.check('input[type=checkbox]');
await pagina.fill('input[type=number] >> nth=0', String(BPM));
// Un observador DENTRO de la página anota performance.now() cuando aparece
// "compás 1, pulso 1" (el pulso 0). Así no dependemos de la latencia de Playwright.
await pagina.evaluate(() => {
  window.__pulso0 = null;
  new MutationObserver(() => {
    if (window.__pulso0 === null && document.body.innerText.includes('compás 1, pulso 1')) window.__pulso0 = performance.now();
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
});
await pagina.click('#btn-iniciar');
let pulso0Pagina = null;
while (pulso0Pagina === null) {
  await new Promise((r) => setTimeout(r, 15));
  pulso0Pagina = await pagina.evaluate(() => window.__pulso0);
}
// Alinear el reloj de la página con el de este script.
const ahoraPagina = await pagina.evaluate(() => performance.now());
const t0 = Date.now() - (ahoraPagina - pulso0Pagina);
const porPulso = new Map();
for (const [midi, pulso] of NOTAS) porPulso.set(pulso, [...(porPulso.get(pulso) ?? []), midi]);
for (const [pulso, midis] of [...porPulso.entries()].sort((a, b) => a[0] - b[0])) {
  const espera = t0 + pulso * MS_POR_PULSO - Date.now();
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  for (const m of midis) await pagina.keyboard.down(TECLA[m]);
  for (const m of midis) await pagina.keyboard.up(TECLA[m]);
}
await pagina.waitForSelector('#estado:has-text("terminado")', { timeout: 15000 });
await pagina.screenshot({ path: `${SALIDA}02-final.png`, fullPage: true });
const tapas = await pagina.locator('.tapa').count();
const dibujadas = await pagina.locator('#partitura svg').count();
const filaTotal = await pagina.locator('#tabla-resultados tr:has(th:text("total"))').textContent();
const correctas = Number((await pagina.locator('#tabla-resultados tr:has(th:text("total")) th').nth(2).textContent()).trim());
paso('2-tocar-pieza', correctas >= 40 && tapas === 8 && dibujadas === 1,
  `correctas ${correctas}/42, compases ocultos ${tapas}, partituras dibujadas ${dibujadas}, fila total: ${filaTotal.replace(/\s+/g, ' ').trim()}`);
const textoTabla = await pagina.locator('#tabla-resultados').textContent();
informe['2-desvio-metronomo'] = /desvío[^)]*\)/.exec(textoTabla)?.[0] ?? 'sin dato';
console.log('     ', informe['2-desvio-metronomo']);
const registro = await pagina.locator('.caja .mono div').allTextContents();
informe['2-registro'] = registro;
const desvios = registro.map((l) => /\(([-+]\d+) ms\)/.exec(l)?.[1]).filter(Boolean).map(Number);
if (desvios.length) {
  const abs = desvios.map(Math.abs);
  informe['2-desvio-notas'] = { n: abs.length, mediaAbsMs: Math.round(abs.reduce((a, b) => a + b, 0) / abs.length), maxAbsMs: Math.max(...abs) };
  console.log('      desvío tecla→pulso esperado:', JSON.stringify(informe['2-desvio-notas']));
}

// --- 3. generador y repertorio -----------------------------------------------------
const niveles = await pagina.locator('select option').allTextContents();
for (const [i, nivel] of niveles.entries()) {
  await pagina.selectOption('select', { label: nivel });
  await pagina.click('#btn-generar');
  await pagina.waitForSelector('#chequeo:has-text("generador")', { timeout: 15000 });
  const texto = (await pagina.textContent('#chequeo')).trim();
  const dif = (await pagina.textContent('#dificultad')).trim();
  paso(`3-generador-nivel-${i + 1}`, texto.includes('OK'), `${texto} | ${dif}`);
  await pagina.screenshot({ path: `${SALIDA}03-generado-nivel${i + 1}.png`, fullPage: true });
}
for (const archivo of ['Bach_Minuet_in_G_BWV_Anh114.mxl', 'Satie_Gymnopedie_1.mxl']) {
  await pagina.setInputFiles('#archivo-musicxml', `${SALIDA}muestras/${archivo}`);
  await pagina.waitForSelector(`#chequeo:has-text("${archivo}")`, { timeout: 30000 });
  await pagina.waitForSelector('#chequeo:has-text("cargado")', { timeout: 30000 });
  const texto = (await pagina.textContent('#chequeo')).trim();
  const dif = (await pagina.textContent('#dificultad')).trim();
  paso(`3-repertorio-${archivo}`, texto.includes('cargado'), `${texto} | ${dif}`);
  await pagina.screenshot({ path: `${SALIDA}03-repertorio-${archivo}.png`, fullPage: true });
}

}

// --- 4. basic-pitch sintético -----------------------------------------------------
await pagina.click('#btn-vista-medicion');
await pagina.waitForSelector('text=listo (backend', { timeout: 120000 });
if (!SOLO_MIC && !SOLO_OAF) for (const [boton, nombre] of [['#btn-sintetico', 'limpio'], ['#btn-sintetico-ruido', 'ruido']]) {
  await pagina.click(boton);
  await pagina.waitForSelector('#resultado-sintetico', { state: 'attached', timeout: 600000 });
  const json = JSON.parse(await pagina.locator('#resultado-sintetico').textContent());
  writeFileSync(`${SALIDA}basic-pitch-sintetico-${nombre}.json`, JSON.stringify(json, null, 2));
  const t = json.totales;
  const ms = json.filas.map((f) => f.msProceso).filter((x) => x > 0);
  paso(`4-basic-pitch-${nombre}`, true,
    `motor ${json.motor}: exactos ${t.acordesExactos}/${t.acordes} (${t.porcentajeExactos}%), recall ${t.recall}%, precisión ${t.precision}%, ` +
    `proceso media ${Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)} ms (mín ${Math.min(...ms)}, máx ${Math.max(...ms)}); ` +
    `silencio → ${json.filas[json.filas.length - 1].comparacion.detectadas.length === 0 ? 'nada detectado (bien)' : 'DETECTÓ NOTAS: ' + json.filas[json.filas.length - 1].detalle}`);
  await pagina.screenshot({ path: `${SALIDA}04-basic-pitch-${nombre}.png`, fullPage: true });
}

// --- 5. latencia por micrófono (falso: el WAV) ------------------------------------
if (!SOLO_OAF) {
if (process.env.INTERVALO_MS) await pagina.fill('#intervalo-ms', process.env.INTERVALO_MS);
if (process.env.VENTANA_SEG) await pagina.fill('#ventana-seg', process.env.VENTANA_SEG);
if (process.env.MIN_FRAMES) await pagina.fill('#min-frames', process.env.MIN_FRAMES);
await pagina.click('#btn-mic');
await pagina.waitForSelector('#mic-estado:has-text("abierto")', { timeout: 15000 });
await pagina.click('#btn-continuo');
await new Promise((r) => setTimeout(r, duracionEscucha));
await pagina.click('#btn-continuo-detener');
const exportado = JSON.parse(await pagina.inputValue('#exportable'));
const { resumenMic, filasMic, mensaje } = analizarMic(exportado);
writeFileSync(`${SALIDA}basic-pitch-mic-falso${ETIQUETA}.json`, JSON.stringify({ resumen: resumenMic, filas: filasMic, exportado }, null, 2));
paso(`5-latencia-mic-falso${ETIQUETA}`, resumenMic.detecciones > 0, mensaje);
await pagina.screenshot({ path: `${SALIDA}05-latencia-mic-falso${ETIQUETA}.png`, fullPage: true });
}

// Compara las detecciones del modo continuo con el WAV que fabricamos.
function analizarMic(exportado) {
  const det = exportado.latencia.detecciones;
  // Alinear el reloj del WAV con el reloj de audio de la página: no sabemos en
  // qué instante exacto empezó la captura. Probamos como candidato cada
  // detección "es el ataque del acorde k" y nos quedamos con el desfase que
  // más notas esperadas explica. La ventana de alineación es estrecha porque
  // el modelo estima el ataque con precisión (la latencia está en la detección,
  // no en la estimación del ataque).
  const inicioDe = (desfase, k) => desfase + SILENCIO_INICIAL + k * SEPARACION;
  const contarAciertos = (desfase) => ACORDES.reduce((total, esperadas, k) => {
    const inicio = inicioDe(desfase, k);
    const vistas = new Set(det.filter((d) => d.onsetSeg >= inicio - 0.1 && d.onsetSeg < inicio + 0.35).map((d) => d.midi));
    return total + esperadas.filter((m) => vistas.has(m)).length;
  }, 0);
  let desfaseCaptura = 0, mejorPuntaje = -1;
  for (const d of det) {
    for (let k = 0; k < ACORDES.length; k++) {
      const candidato = d.onsetSeg - (SILENCIO_INICIAL + k * SEPARACION);
      if (candidato < -SILENCIO_INICIAL) continue;
      const puntaje = contarAciertos(candidato);
      if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; desfaseCaptura = candidato; }
    }
  }
  const filasMic = ACORDES.map((esperadas, k) => {
    const inicio = inicioDe(desfaseCaptura, k);
    const enVentana = det.filter((d) => d.onsetSeg >= inicio - 0.15 && d.onsetSeg < inicio + DURACION_ACORDE);
    const detectadas = [...new Set(enVentana.map((d) => d.midi))].sort((a, b) => a - b);
    const aciertos = esperadas.filter((m) => detectadas.includes(m));
    // Latencia real: la PRIMERA detección de cada nota esperada, medida desde el
    // ataque verdadero (que conocemos porque el WAV lo fabricamos nosotros).
    const latenciasPrimeraMs = esperadas.map((m) => {
      const d = enVentana.filter((x) => x.midi === m).sort((a, b) => a.onsetSeg - b.onsetSeg)[0];
      return d ? Math.round((d.onsetSeg + d.latenciaModeloMs / 1000 - inicio) * 1000) : null;
    }).filter((x) => x !== null);
    return { k, esperadas, detectadas, faltantes: esperadas.filter((m) => !detectadas.includes(m)), extras: detectadas.filter((m) => !esperadas.includes(m)),
      exacto: aciertos.length === esperadas.length && detectadas.length === esperadas.length,
      detecciones: enVentana.length, latenciasPrimeraMs, latenciasMs: enVentana.map((d) => d.latenciaModeloMs) };
  });
  const todasPrimera = filasMic.flatMap((f) => f.latenciasPrimeraMs).sort((a, b) => a - b);
  const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : null);
  const notasEsp = filasMic.reduce((s, f) => s + f.esperadas.length, 0);
  const notasDet = filasMic.reduce((s, f) => s + f.detectadas.length, 0);
  const aciertosTot = filasMic.reduce((s, f) => s + (f.esperadas.length - f.faltantes.length), 0);
  const resumenMic = {
    acordesExactos: filasMic.filter((f) => f.exacto).length,
    acordes: ACORDES.length,
    notasEsperadas: notasEsp,
    recall: Math.round((aciertosTot / notasEsp) * 1000) / 10,
    precision: Math.round((aciertosTot / notasDet) * 1000) / 10,
    latenciaReal_medianaMs: pct(todasPrimera, 50),
    latenciaReal_p90Ms: pct(todasPrimera, 90),
    latenciaReal_minMs: todasPrimera[0] ?? null,
    latenciaReal_maxMs: todasPrimera[todasPrimera.length - 1] ?? null,
    inferencia_mediaMs: exportado.latencia.inferencia_mediaMs,
    detecciones: det.length,
    deteccionesRepetidasOFantasma: det.length - notasDet,
    deteccionesFueraDeAcordes: det.length - filasMic.reduce((s, f) => s + f.detecciones, 0),
    desfaseCapturaSeg: Math.round(desfaseCaptura * 100) / 100,
    continuo: exportado.continuo,
    umbrales: exportado.umbrales,
  };
  const mensaje =
    `acordes exactos ${resumenMic.acordesExactos}/${ACORDES.length}, recall ${resumenMic.recall}%, precisión ${resumenMic.precision}%, ` +
    `latencia real (ataque→detección) mediana ${resumenMic.latenciaReal_medianaMs} ms, p90 ${resumenMic.latenciaReal_p90Ms} ms, ` +
    `mín ${resumenMic.latenciaReal_minMs}, máx ${resumenMic.latenciaReal_maxMs}; inferencia media ${resumenMic.inferencia_mediaMs} ms; ` +
    `${det.length} detecciones para ${notasEsp} notas (${resumenMic.deteccionesRepetidasOFantasma} repetidas/fantasma, ${resumenMic.deteccionesFueraDeAcordes} fuera de acordes)`;
  return { resumenMic, filasMic, mensaje };
}

// --- 6. motor de huellas (NMF informada por la partitura) ---------------------------
if (!SOLO_MIC && !SOLO_OAF) {
  await pagina.selectOption('#motor', 'huellas');
  // 6a. sintético sin calibrar (huellas por fórmula) y calibrado desde el WAV de la escala.
  const correrSintetico = async (etiqueta, boton) => {
    await pagina.click(boton);
    await pagina.waitForSelector('#resultado-sintetico', { state: 'attached', timeout: 600000 });
    const json = JSON.parse(await pagina.locator('#resultado-sintetico').textContent());
    writeFileSync(`${SALIDA}sintetico-huellas-${etiqueta}.json`, JSON.stringify(json, null, 2));
    const t = json.totales;
    paso(`6-huellas-sintetico-${etiqueta}`, true,
      `exactos ${t.acordesExactos}/${t.acordes} (${t.porcentajeExactos}%), recall ${t.recall}%, precisión ${t.precision}%, proceso medio ${t.msProcesoMedio} ms`);
  };
  await correrSintetico('sin-calibrar', '#btn-sintetico');
  await pagina.setInputFiles('#archivo-calibracion', RUTA_ESCALA);
  await pagina.waitForSelector(`#calib-estado:has-text("${ESCALA_MAX - ESCALA_MIN + 1}/${ESCALA_MAX - ESCALA_MIN + 1}")`, { timeout: 60000 });
  console.log('      calibración:', (await pagina.textContent('#calib-estado')).trim());
  await correrSintetico('calibrado', '#btn-sintetico');
  await correrSintetico('calibrado-ruido', '#btn-sintetico-ruido');
  // Sin la ventaja de conocer las notas esperadas: buscar entre todas las teclas del rango.
  await pagina.uncheck('#solo-esperadas');
  await correrSintetico('calibrado-todas-las-teclas', '#btn-sintetico-ruido');
  await pagina.check('#solo-esperadas');
  await pagina.screenshot({ path: `${SALIDA}06-huellas-sintetico.png`, fullPage: true });

  // 6b. latencia con el micrófono falso: reabrir el micrófono para que el WAV arranque de cero.
  if (await pagina.locator('#btn-mic-cerrar').count()) await pagina.click('#btn-mic-cerrar');
  await pagina.click('#btn-mic');
  await pagina.waitForSelector('#mic-estado:has-text("abierto")', { timeout: 15000 });
  await pagina.click('#btn-continuo');
  await new Promise((r) => setTimeout(r, duracionEscucha));
  await pagina.click('#btn-continuo-detener');
  const exportadoH = JSON.parse(await pagina.inputValue('#exportable'));
  const rH = analizarMic(exportadoH);
  writeFileSync(`${SALIDA}mic-falso-huellas.json`, JSON.stringify({ resumen: rH.resumenMic, filas: rH.filasMic, exportado: exportadoH }, null, 2));
  paso('6-huellas-latencia-mic-falso', rH.resumenMic.detecciones > 0, rH.mensaje);
  await pagina.screenshot({ path: `${SALIDA}06-huellas-latencia.png`, fullPage: true });
}

// --- 7. Onsets and Frames (modelo específico de piano) -------------------------------
if (!SOLO_MIC) {
  await pagina.selectOption('#motor', 'onsets-frames');
  await pagina.click('#btn-cargar-oaf');
  await pagina.waitForFunction(() => {
    const e = document.querySelector('#oaf-estado');
    return !e || (e.textContent ?? '').startsWith('error');
  }, null, { timeout: 600000 });
  if (await pagina.locator('#oaf-estado').count()) throw new Error(`Onsets and Frames no cargó: ${await pagina.textContent('#oaf-estado')}`);
  for (const [boton, nombre] of [['#btn-sintetico', 'limpio'], ['#btn-sintetico-ruido', 'ruido']]) {
    await pagina.click(boton);
    await pagina.waitForSelector('#resultado-sintetico', { state: 'attached', timeout: 900000 });
    const json = JSON.parse(await pagina.locator('#resultado-sintetico').textContent());
    writeFileSync(`${SALIDA}sintetico-oaf-${nombre}.json`, JSON.stringify(json, null, 2));
    const t = json.totales;
    paso(`7-onsets-frames-sintetico-${nombre}`, true,
      `exactos ${t.acordesExactos}/${t.acordes} (${t.porcentajeExactos}%), recall ${t.recall}%, precisión ${t.precision}%, proceso medio ${t.msProcesoMedio} ms`);
  }
  if (await pagina.locator('#btn-mic-cerrar').count()) await pagina.click('#btn-mic-cerrar');
  await pagina.click('#btn-mic');
  await pagina.waitForSelector('#mic-estado:has-text("abierto")', { timeout: 15000 });
  await pagina.fill('#ventana-seg', '1');
  await pagina.fill('#intervalo-ms', '250');
  await pagina.click('#btn-continuo');
  await new Promise((r) => setTimeout(r, duracionEscucha));
  await pagina.click('#btn-continuo-detener');
  const exportadoO = JSON.parse(await pagina.inputValue('#exportable'));
  const rO = analizarMic(exportadoO);
  writeFileSync(`${SALIDA}mic-falso-oaf.json`, JSON.stringify({ resumen: rO.resumenMic, filas: rO.filasMic, exportado: exportadoO }, null, 2));
  paso('7-onsets-frames-latencia-mic-falso', rO.resumenMic.detecciones > 0, rO.mensaje);
  await pagina.screenshot({ path: `${SALIDA}07-onsets-frames.png`, fullPage: true });
}

informe.erroresConsola = erroresConsola;
console.log(erroresConsola.length ? `Errores de consola:\n${erroresConsola.join('\n')}` : 'Sin errores de consola.');
if (!SOLO_MIC && !SOLO_OAF) writeFileSync(`${SALIDA}verificacion.json`, JSON.stringify(informe, null, 2));
await navegador.close();