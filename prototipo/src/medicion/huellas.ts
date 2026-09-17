// ============================================================================
// huellas.ts — La "huella espectral" de cada tecla del piano.
//
// Una huella es el espectro promedio de una nota sostenida: dónde están su
// fundamental y sus armónicos y con qué peso. Hay dos formas de obtenerla:
//   - sintética: fórmula (armónicos que decaen). Sirve sin calibrar.
//   - calibrada: grabando esa tecla en ESTE piano, ESTA sala, ESTE micrófono.
//     Es mucho mejor, porque cada piano y cada micrófono suenan distinto.
//
// Las huellas calibradas se guardan en localStorage del navegador.
// ============================================================================

import type { STFT } from './fft';

export interface Huellas {
  /** Parámetros con que se calcularon; si cambian, las huellas no sirven. */
  tasa: number;
  N: number;
  bins: number;
  /** Rango de teclas que nos interesan (MIDI). */
  midiMin: number;
  midiMax: number;
  porMidi: Record<string, number[]>;
  /** Espectro del ruido de fondo de la sala (calibración de silencio). */
  ruido: number[] | null;
  /** Nivel del silencio de la sala, en dB. */
  pisoDb: number | null;
}

const CLAVE = 'huellas-piano-v1';

export function huellasVacias(stft: STFT, midiMin = 36, midiMax = 96): Huellas {
  return { tasa: stft.tasa, N: stft.N, bins: stft.bins, midiMin, midiMax, porMidi: {}, ruido: null, pisoDb: null };
}

export function normalizar(v: Float32Array): Float32Array {
  let suma = 0;
  for (let i = 0; i < v.length; i++) suma += v[i] * v[i];
  const norma = Math.sqrt(suma) || 1;
  const salida = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) salida[i] = v[i] / norma;
  return salida;
}

export function midiAHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Huella por fórmula: 16 armónicos con peso 1/k^0.9, cada uno "desparramado" en ±3 bins. */
export function huellaSintetica(midi: number, stft: STFT): Float32Array {
  const v = new Float32Array(stft.bins);
  const f0 = midiAHz(midi);
  for (let k = 1; k <= 16; k++) {
    const pos = stft.binDe(f0 * k);
    if (pos >= stft.bins) break;
    const peso = 1 / k ** 0.9;
    for (let b = Math.max(0, Math.floor(pos) - 3); b <= Math.min(stft.bins - 1, Math.ceil(pos) + 3); b++) {
      v[b] += peso * Math.exp(-((b - pos) ** 2) / 2);
    }
  }
  return normalizar(v);
}

/** Huella a partir de espectros grabados: promedio y normalización. */
export function huellaDesdeEspectros(espectros: Float32Array[]): Float32Array {
  const v = new Float32Array(espectros[0].length);
  for (const e of espectros) for (let i = 0; i < v.length; i++) v[i] += e[i];
  return normalizar(v);
}

/** Ruido "rosa" por fórmula, para cuando no se calibró el silencio. */
export function ruidoSintetico(bins: number): Float32Array {
  const v = new Float32Array(bins);
  for (let b = 0; b < bins; b++) v[b] = 1 / Math.sqrt(b + 1);
  return normalizar(v);
}

/** Devuelve la huella de una tecla: la calibrada si existe, si no la sintética. */
export function huellaDe(h: Huellas, midi: number, stft: STFT): { vector: Float32Array; calibrada: boolean } {
  const guardada = h.porMidi[String(midi)];
  if (guardada) return { vector: Float32Array.from(guardada), calibrada: true };
  return { vector: huellaSintetica(midi, stft), calibrada: false };
}

export function ruidoDe(h: Huellas): Float32Array {
  return h.ruido ? Float32Array.from(h.ruido) : ruidoSintetico(h.bins);
}

export function teclasCalibradas(h: Huellas): number[] {
  return Object.keys(h.porMidi).map(Number).sort((a, b) => a - b);
}

// --- persistencia ------------------------------------------------------------

export function guardarHuellas(h: Huellas): void {
  try {
    // Redondeamos a 4 decimales para que ocupe poco.
    const compacto = { ...h, porMidi: Object.fromEntries(Object.entries(h.porMidi).map(([k, v]) => [k, v.map((x) => Math.round(x * 1e4) / 1e4)])) };
    localStorage.setItem(CLAVE, JSON.stringify(compacto));
  } catch {
    // sin localStorage (modo privado): las huellas viven solo en memoria
  }
}

export function cargarHuellas(stft: STFT): Huellas | null {
  try {
    const texto = localStorage.getItem(CLAVE);
    if (!texto) return null;
    const h = JSON.parse(texto) as Huellas;
    if (h.tasa !== stft.tasa || h.N !== stft.N || h.bins !== stft.bins) return null;
    return h;
  } catch {
    return null;
  }
}

export function borrarHuellas(): void {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    // nada
  }
}
