// ============================================================================
// sintetizador.ts — Un "piano de juguete" en puro cálculo: suma de armónicos
// con decaimiento exponencial. Sirve para:
//   - probar el pipeline de basic-pitch sin micrófono (prueba sintética), y
//   - reproducir acordes por los parlantes para una prueba de "loopback".
//
// NO reemplaza la medición con piano real: un piano tiene inarmonicidad,
// ruido de martillo, resonancia por simpatía y reverberación de la sala.
// Los números sintéticos son un piso optimista, no el resultado final.
// ============================================================================

/** Genera una nota (Float32Array mono) a la tasa de muestreo indicada. */
export function sintetizarNota(midi: number, duracionSeg: number, tasa: number, amplitud = 0.2): Float32Array {
  const f0 = 440 * 2 ** ((midi - 69) / 12);
  const n = Math.floor(duracionSeg * tasa);
  const salida = new Float32Array(n);
  // Amplitud relativa de cada armónico (1º, 2º, 3º...). Aproximación gruesa.
  const armonicos = [1, 0.55, 0.35, 0.25, 0.15, 0.1, 0.07, 0.05];
  for (let i = 0; i < n; i++) {
    const t = i / tasa;
    const ataque = Math.min(1, t / 0.006);
    const decaimiento = Math.exp(-t * 1.6);
    let s = 0;
    for (let k = 0; k < armonicos.length; k++) {
      const fk = f0 * (k + 1);
      if (fk >= tasa / 2) break; // evita aliasing
      // Los armónicos agudos decaen más rápido, como en un piano.
      s += armonicos[k] * Math.exp(-t * k * 0.9) * Math.sin(2 * Math.PI * fk * t);
    }
    salida[i] = s * ataque * decaimiento * amplitud;
  }
  // Caída suave al final (50 ms): un corte seco produce un "click" que parece un ataque.
  const cola = Math.min(n, Math.floor(0.05 * tasa));
  for (let i = 0; i < cola; i++) salida[n - 1 - i] *= i / cola;
  return salida;
}

/** Suma varias notas que empiezan al mismo tiempo. */
export function sintetizarAcorde(midis: number[], duracionSeg: number, tasa: number, amplitud = 0.2): Float32Array {
  const n = Math.floor(duracionSeg * tasa);
  const salida = new Float32Array(n);
  for (const midi of midis) {
    const nota = sintetizarNota(midi, duracionSeg, tasa, amplitud / Math.sqrt(midis.length));
    for (let i = 0; i < n; i++) salida[i] += nota[i];
  }
  return salida;
}

/** Ruido blanco suave sumado a la señal (simula sala/micrófono barato). */
export function agregarRuido(datos: Float32Array, nivel = 0.005): Float32Array {
  const salida = new Float32Array(datos.length);
  for (let i = 0; i < datos.length; i++) salida[i] = datos[i] + (Math.random() * 2 - 1) * nivel;
  return salida;
}

/**
 * Acordes de prueba: tríadas y acordes de 4-5 notas en posiciones típicas de
 * piano, a dos manos, incluyendo graves (donde basic-pitch suele fallar más).
 * Esta misma lista es el protocolo para la prueba con piano real.
 */
export const ACORDES_PRUEBA: { nombre: string; midis: number[] }[] = [
  { nombre: 'C mayor (C4 E4 G4)', midis: [60, 64, 67] },
  { nombre: 'F mayor (F4 A4 C5)', midis: [65, 69, 72] },
  { nombre: 'G mayor (G4 B4 D5)', midis: [67, 71, 74] },
  { nombre: 'A menor (A3 C4 E4)', midis: [57, 60, 64] },
  { nombre: 'D menor (D4 F4 A4)', midis: [62, 65, 69] },
  { nombre: 'E menor (E4 G4 B4)', midis: [64, 67, 71] },
  { nombre: 'C mayor 4 notas (C4 E4 G4 C5)', midis: [60, 64, 67, 72] },
  { nombre: 'C dos manos (C3 G3 E4 G4)', midis: [48, 55, 64, 67] },
  { nombre: 'G dos manos (G2 D3 B3 D4)', midis: [43, 50, 59, 62] },
  { nombre: 'F dos manos (F2 C3 A3 C4)', midis: [41, 48, 57, 60] },
  { nombre: 'C menor (C4 Eb4 G4)', midis: [60, 63, 67] },
  { nombre: 'D mayor (D4 F#4 A4)', midis: [62, 66, 69] },
  { nombre: 'G7 (G3 B3 D4 F4)', midis: [55, 59, 62, 65] },
  { nombre: 'F mayor grave (F3 A3 C4 E4)', midis: [53, 57, 60, 64] },
  { nombre: 'C 5 notas (C3 E3 G3 C4 E4)', midis: [48, 52, 55, 60, 64] },
  { nombre: 'A menor abierto (A2 E3 C4 E4)', midis: [45, 52, 60, 64] },
  { nombre: 'D menor abierto (D3 A3 F4 A4)', midis: [50, 57, 65, 69] },
  { nombre: 'G mayor grave (B3 D4 G4)', midis: [59, 62, 67] },
  { nombre: 'C 1ª inversión grave (E3 G3 C4)', midis: [52, 55, 60] },
  { nombre: 'G grave (B2 D3 G3 B3)', midis: [47, 50, 55, 59] },
];
