// ============================================================================
// motores.ts — Los dos "motores" de detección detrás de una misma interfaz,
// y la compuerta de energía que se aplica antes de cualquiera de ellos.
//
//   basic-pitch: red neuronal genérica (detector.ts). Busca entre 88 teclas.
//   huellas:     NMF informada por la partitura (nmf.ts). Busca entre las
//                notas esperadas y sus vecinas, con huellas calibradas.
//
// La compuerta responde a la pregunta "¿hay algo que analizar?": compara el
// nivel del clip con el piso de ruido. Si no hay señal, no se corre ningún
// modelo y el resultado es "silencio". Así el modelo nunca ve un cuarto
// callado y no puede inventar notas a partir del zumbido.
// ============================================================================

import { TASA_MODELO, type Detector, type NotaDetectada, type Umbrales } from './detector';
import { dB, percentil, rms } from './fft';
import type { DetectorHuellas } from './nmf';
import { TASA_OAF, type DetectorOaf } from './oaf';

export type NombreMotor = 'basic-pitch' | 'huellas' | 'onsets-frames';

export interface ResultadoMotor {
  notas: NotaDetectada[];
  msProceso: number;
  detalle: string;
}

export interface Motor {
  nombre: NombreMotor;
  /** Tasa de muestreo a la que hay que entregarle el clip. */
  tasa: number;
  analizar(clip: Float32Array, esperadas?: number[], pisoDb?: number | null): Promise<ResultadoMotor>;
}

export function motorBasicPitch(detector: Detector, umbrales: Umbrales): Motor {
  return {
    nombre: 'basic-pitch',
    tasa: TASA_MODELO,
    async analizar(clip) {
      const { notas, msInferencia } = await detector.detectar(clip, umbrales);
      return { notas, msProceso: msInferencia, detalle: `${notas.length} notas` };
    },
  };
}

export function motorOnsetsFrames(detector: DetectorOaf): Motor {
  return {
    nombre: 'onsets-frames',
    tasa: TASA_OAF,
    async analizar(clip) {
      const { notas, msInferencia } = await detector.detectar(clip);
      return { notas, msProceso: msInferencia, detalle: `${notas.length} notas` };
    },
  };
}

/** `soloEsperadas`: si es true, el motor solo busca las notas esperadas y sus vecinas (el caso del producto). */
export function motorHuellas(detector: DetectorHuellas, soloEsperadas: boolean): Motor {
  return {
    nombre: 'huellas',
    tasa: detector.stft.tasa,
    async analizar(clip, esperadas, pisoDb) {
      const r = detector.analizarClip(clip, soloEsperadas ? esperadas : undefined, pisoDb);
      return { notas: r.notas, msProceso: r.msProceso, detalle: r.detalle };
    },
  };
}

export interface AnalisisClip extends ResultadoMotor {
  silencio: boolean;
  /** Nivel máximo del clip (RMS en ventanas de 100 ms), en dB. */
  nivelDb: number;
  pisoDb: number;
  compuertaDb: number;
  /** Pico > 0.98: la señal llegó recortada. */
  satura: boolean;
}

/** Piso de ruido que asumimos cuando nadie lo calibró: nunca peor que −40 dB. */
const PISO_MAXIMO_ASUMIDO_DB = -40;

/**
 * Compuerta + motor. `pisoDb` es el piso calibrado del micrófono; si es null
 * se estima con las partes más silenciosas del propio clip.
 */
export async function analizarClip(
  motor: Motor,
  clip: Float32Array,
  pisoDb: number | null,
  margenDb: number,
  esperadas?: number[],
): Promise<AnalisisClip> {
  const ventana = Math.floor(motor.tasa * 0.1);
  const niveles: number[] = [];
  let pico = 0;
  for (let i = 0; i + ventana <= clip.length; i += ventana) niveles.push(dB(rms(clip.subarray(i, i + ventana))));
  for (let i = 0; i < clip.length; i++) pico = Math.max(pico, Math.abs(clip[i]));
  const nivelDb = niveles.length ? Math.max(...niveles) : -180;
  const piso = pisoDb ?? Math.min(percentil(niveles, 10), PISO_MAXIMO_ASUMIDO_DB);
  const compuertaDb = piso + margenDb;
  const base = { nivelDb: Math.round(nivelDb), pisoDb: Math.round(piso), compuertaDb: Math.round(compuertaDb), satura: pico > 0.98 };
  if (nivelDb < compuertaDb) {
    return { notas: [], msProceso: 0, detalle: 'silencio (bajo la compuerta)', silencio: true, ...base };
  }
  const r = await motor.analizar(clip, esperadas, piso);
  return { ...r, silencio: false, ...base };
}
