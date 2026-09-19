// ============================================================================
// scripts/verificar-sesion.mjs — Verifica el criterio de listo de T1:
// "un alumno toca, termina, y hay un archivo en disco con esa forma sin que
// nadie toque nada más".
//
// Abre la app, escribe el nombre del alumno, toca la pieza entera con el
// teclado de prueba, y NO hace nada más: espera a que el navegador baje solo
// el archivo. Después comprueba el nombre y la forma del JSON, campo por
// campo, y guarda una copia en docs/resultados/sesion-ejemplo.json.
//
// Uso: en una terminal `npm run dev`, en otra `node scripts/verificar-sesion.mjs`
// ============================================================================

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BPM, NOTAS, NUM_COMPASES, PULSOS_POR_COMPAS, tocarPieza } from './pieza-fija.mjs';

const DIRECCION = process.env.URL ?? 'http://localhost:5173/';
const SALIDA = fileURLToPath(new URL('../docs/resultados/', import.meta.url));
const ALUMNO = 'A1';

const fallos = [];
const comprobar = (condicion, descripcion) => {
  if (!condicion) fallos.push(descripcion);
  console.log(`${condicion ? 'OK  ' : 'FALLA'} ${descripcion}`);
};

const navegador = await chromium.launch({ headless: process.env.HEADED !== '1', args: ['--autoplay-policy=no-user-gesture-required'] });
const pagina = await (await navegador.newContext({ acceptDownloads: true })).newPage();
const erroresConsola = [];
pagina.on('pageerror', (e) => erroresConsola.push(String(e)));

await pagina.goto(DIRECCION);
await pagina.waitForSelector('#chequeo:has-text("notas extraídas")', { timeout: 30000 });
await pagina.check('input[type=checkbox]');            // teclado de PC como MIDI de prueba
await pagina.fill('input[type=number] >> nth=0', String(BPM));

/**
 * Toca la pieza y devuelve la sesión que el navegador bajó solo.
 * A partir del "Iniciar" nadie toca nada más: el archivo tiene que aparecer.
 */
async function correrSesion(alumno, opciones) {
  await pagina.fill('#alumno', alumno);
  const esperaDescarga = pagina.waitForEvent('download', { timeout: 60000 });
  await tocarPieza(pagina, opciones);
  await pagina.waitForSelector('#estado:has-text("terminado")', { timeout: 15000 });
  try {
    const descarga = await esperaDescarga;
    const texto = (await (await import('node:fs/promises')).readFile(await descarga.path())).toString();
    comprobar(true, `[${alumno}] el navegador bajó un archivo solo: ${descarga.suggestedFilename()}`);
    return { sesion: JSON.parse(texto), texto, nombre: descarga.suggestedFilename() };
  } catch {
    comprobar(false, `[${alumno}] el navegador bajó un archivo solo al terminar el ejercicio`);
    return { sesion: null, texto: '', nombre: '' };
  }
}

// --- sesión 1: el alumno toca todo bien -------------------------------------------
const { sesion, texto: textoDescargado, nombre } = await correrSesion(ALUMNO, {});

if (sesion) {
  writeFileSync(`${SALIDA}sesion-ejemplo.json`, textoDescargado);

  comprobar(/^sesion-A1-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/.test(nombre), 'el nombre del archivo lleva alumno, fecha y hora');
  comprobar(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(sesion.fecha ?? ''), `fecha con formato ISO local (${sesion.fecha})`);
  comprobar(sesion.alumno === ALUMNO, `alumno === "${ALUMNO}" (${sesion.alumno})`);
  comprobar(sesion.tempo === BPM, `tempo === ${BPM} (${sesion.tempo})`);
  comprobar(sesion.compasesOcultos === 0, `compasesOcultos coherente con el desfase 0 de la pantalla (${sesion.compasesOcultos})`);
  comprobar(Array.isArray(sesion.compases) && sesion.compases.length === NUM_COMPASES, `compases: array de ${NUM_COMPASES} (${sesion.compases?.length})`);

  const campos = ['n', 'esperadas', 'tocadas', 'faltantes', 'extras', 'tiempos'];
  const sinCampo = campos.filter((k) => !sesion.compases.every((c) => k in c));
  comprobar(sinCampo.length === 0, `cada compás trae ${campos.join(', ')}${sinCampo.length ? ` — falta ${sinCampo.join(', ')}` : ''}`);
  comprobar(sesion.compases.every((c, i) => c.n === i + 1), 'los compases están numerados 1..8 en orden');
  comprobar(sesion.compases.every((c) => c.tocadas.length === c.tiempos.length), 'hay un tiempo por cada nota tocada');
  comprobar(sesion.compases.every((c) => c.esperadas.length === c.tiemposEsperados.length), 'hay un tiempo esperado por cada nota esperada');

  const esperadasTotal = sesion.compases.reduce((s, c) => s + c.esperadas.length, 0);
  comprobar(esperadasTotal === NOTAS.length, `las notas esperadas suman las ${NOTAS.length} de la pieza (${esperadasTotal})`);
  comprobar(
    sesion.total?.correctas + sesion.total?.faltantes === NOTAS.length,
    `total.correctas + total.faltantes === ${NOTAS.length} (${sesion.total?.correctas} + ${sesion.total?.faltantes})`,
  );
  comprobar(sesion.total?.correctas >= 40, `el script tocó bien la pieza: ${sesion.total?.correctas}/${NOTAS.length} correctas, ${sesion.total?.extras} extras`);

  // Los tiempos son relativos al inicio del compás: tienen que caer dentro del
  // compás (con un margen por las notas tocadas un poco antes o después).
  const duracionCompas = (PULSOS_POR_COMPAS * 60) / BPM;
  const fuera = sesion.compases.flatMap((c) => c.tiempos.filter((t) => t < -0.5 || t > duracionCompas + 0.5));
  comprobar(fuera.length === 0, `todos los tiempos caen dentro de su compás (0..${duracionCompas.toFixed(1)} s)${fuera.length ? `; fuera: ${fuera}` : ''}`);

  const c1 = sesion.compases[0];
  console.log(`\ncompás 1 del archivo: esperadas [${c1.esperadas}] · tocadas [${c1.tocadas}] · tiempos [${c1.tiempos}]`);
  console.log(`total: ${JSON.stringify(sesion.total)}`);
  console.log(`contexto: pieza "${sesion.pieza}", entrada "${sesion.entrada}", tolerancia ${sesion.toleranciaPulsos} pulsos`);
}

// --- sesión 2: el alumno se equivoca ----------------------------------------------
// Lo que de verdad importa para la semana: que el archivo registre los errores.
// Se saltea el compás 7 entero (pulsos 24..27) y se toca un Do5 de más en el
// compás 3 (pulso 9), que no está en la partitura en ese momento.
const COMPAS_SALTEADO = 7;
const EXTRA = [72, 9];
const notasDelCompas7 = NOTAS.filter(([, p]) => Math.floor(p / PULSOS_POR_COMPAS) === COMPAS_SALTEADO - 1).map(([m]) => m).sort((a, b) => a - b);
const { sesion: fallida, texto: textoFallida } = await correrSesion('A2', {
  omitir: (_midi, pulso) => Math.floor(pulso / PULSOS_POR_COMPAS) === COMPAS_SALTEADO - 1,
  agregar: [EXTRA],
});

if (fallida) {
  writeFileSync(`${SALIDA}sesion-ejemplo-con-errores.json`, textoFallida);
  comprobar(/"esperadas": \[\d+(, \d+)*\]/.test(textoFallida), 'el archivo se lee: las listas de notas van en una línea');
  const c7 = fallida.compases[COMPAS_SALTEADO - 1];
  const c3 = fallida.compases[2];
  comprobar(
    JSON.stringify([...c7.faltantes].sort((a, b) => a - b)) === JSON.stringify(notasDelCompas7),
    `las ${notasDelCompas7.length} notas salteadas quedan como faltantes del compás ${COMPAS_SALTEADO} ([${c7.faltantes}])`,
  );
  comprobar(c7.tocadas.length === 0, `el compás ${COMPAS_SALTEADO} no tiene notas tocadas ([${c7.tocadas}])`);
  comprobar(c3.extras.includes(EXTRA[0]), `la nota de más queda como extra del compás 3 ([${c3.extras}])`);
  comprobar(c3.tocadas.includes(EXTRA[0]), 'la nota de más también aparece en `tocadas`, con su tiempo');
  comprobar(c3.tocadas.length === c3.tiempos.length, 'sigue habiendo un tiempo por cada nota tocada');
  comprobar(
    fallida.total.faltantes === notasDelCompas7.length && fallida.total.extras === 1,
    `el total refleja los errores: ${fallida.total.faltantes} faltantes, ${fallida.total.extras} extras`,
  );
  console.log(`\ncompás ${COMPAS_SALTEADO} (salteado): esperadas [${c7.esperadas}] · faltantes [${c7.faltantes}]`);
  console.log(`compás 3 (con nota de más): tocadas [${c3.tocadas}] · extras [${c3.extras}] · tiempos [${c3.tiempos}]`);
}

comprobar(erroresConsola.length === 0, `sin errores de consola${erroresConsola.length ? `: ${erroresConsola.join(' | ')}` : ''}`);
await navegador.close();

console.log(fallos.length === 0 ? '\nT1 VERIFICADO: la sesión se guarda sola y con la forma pedida.' : `\n${fallos.length} FALLAS:\n- ${fallos.join('\n- ')}`);
process.exit(fallos.length === 0 ? 0 : 1);
