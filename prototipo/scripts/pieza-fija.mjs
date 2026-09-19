// ============================================================================
// scripts/pieza-fija.mjs — La pieza de `src/pieza.ts` transcrita a mano, para
// que los scripts de prueba puedan "tocarla" con el teclado de la PC.
//
// Cada entrada es [nota MIDI, pulso desde el inicio]. Si se cambia pieza.ts,
// hay que cambiar esto (y la prueba lo detecta: fallan las cuentas).
// ============================================================================

export const NOTAS = [
  [60, 0], [62, 1], [64, 2], [65, 3], [48, 0],
  [67, 4], [64, 6], [48, 4], [52, 4], [55, 4],
  [65, 8], [64, 9], [62, 10], [60, 11], [41, 8], [43, 10],
  [62, 12], [67, 14], [43, 12], [47, 12], [50, 12],
  [64, 16], [65, 17], [67, 18], [69, 19], [48, 16],
  [67, 20], [72, 22], [52, 20], [55, 22],
  [71, 24], [69, 25], [67, 26], [65, 27], [43, 24], [50, 24],
  [64, 28], [60, 30], [64, 30], [67, 30], [48, 28], [55, 28],
];

/** Qué tecla de la PC produce cada nota MIDI (ver `activarTecladoDePrueba`). */
export const TECLA = {
  60: 'a', 62: 's', 64: 'd', 65: 'f', 67: 'g', 69: 'h', 71: 'j', 72: 'k',
  48: 'z', 50: 'x', 52: 'c', 53: 'v', 55: 'b', 57: 'n', 59: 'm',
  41: 'q', 43: 'w', 45: 'e', 47: 'r',
};

export const BPM = 120;
export const MS_POR_PULSO = 60000 / BPM;
export const PULSOS_POR_COMPAS = 4;
export const NUM_COMPASES = 8;

/**
 * "Toca" la pieza en la página: espera el pulso 0 (fin de la cuenta de
 * entrada) leyendo el reloj de la propia página, y después presiona cada
 * tecla en su pulso. Las notas simultáneas se presionan juntas.
 *
 * `opciones.omitir(midi, pulso)` → true para saltear esa nota (simula que el
 * alumno no la tocó). `opciones.agregar` son notas de más, como [[midi, pulso]].
 */
export async function tocarPieza(pagina, opciones = {}) {
  const { omitir = () => false, agregar = [] } = opciones;
  await pagina.evaluate(() => {
    window.__pulso0 = null;
    new MutationObserver(() => {
      if (window.__pulso0 === null && document.body.innerText.includes('compás 1, pulso 1')) {
        window.__pulso0 = performance.now();
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await pagina.click('#btn-iniciar');
  let pulso0 = null;
  while (pulso0 === null) {
    await new Promise((r) => setTimeout(r, 15));
    pulso0 = await pagina.evaluate(() => window.__pulso0);
  }
  // Alinear el reloj de la página con el de este script.
  const ahora = await pagina.evaluate(() => performance.now());
  const t0 = Date.now() - (ahora - pulso0);
  const porPulso = new Map();
  for (const [midi, pulso] of NOTAS) {
    if (omitir(midi, pulso)) continue;
    porPulso.set(pulso, [...(porPulso.get(pulso) ?? []), midi]);
  }
  for (const [midi, pulso] of agregar) porPulso.set(pulso, [...(porPulso.get(pulso) ?? []), midi]);
  for (const [pulso, midis] of [...porPulso.entries()].sort((a, b) => a[0] - b[0])) {
    const espera = t0 + pulso * MS_POR_PULSO - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    for (const m of midis) await pagina.keyboard.down(TECLA[m]);
    for (const m of midis) await pagina.keyboard.up(TECLA[m]);
  }
}
