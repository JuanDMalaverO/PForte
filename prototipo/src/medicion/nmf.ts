// ============================================================================
// nmf.ts — Detección de notas "informada por la partitura", por NMF.
//
// Pregunta que responde: dado el espectro de un instante, ¿cuánto de la
// huella de cada tecla candidata hay en él? Se resuelve como una mezcla:
//     espectro ≈ h1·huella(Do4) + h2·huella(Mi4) + ... + hr·huella(ruido)
// con todos los h ≥ 0 (no existe "menos Do4"). Eso es NMF (factorización
// no negativa) con diccionario fijo, resuelto con las actualizaciones
// multiplicativas de Lee & Seung. Las notas presentes son las que tienen
// una activación h grande respecto de la más fuerte.
//
// La ventaja frente a un transcriptor genérico: las candidatas son pocas
// (las notas esperadas y sus vecinas), la huella incluye los armónicos (así
// que un Do4 no se confunde con su octava) y la huella de ruido absorbe el
// zumbido de la sala. Corre en CPU, en cualquier máquina.
// ============================================================================

import type { STFT } from './fft';
import { ataquesDeFrames, tieneSubidaDeEnergia } from './ataques';
import { dB, percentil } from './fft';
import { huellaDe, ruidoDe, type Huellas } from './huellas';

export interface OpcionesNmf {
  iteraciones: number;
  /** Una candidata está presente si su activación ≥ umbralRelativo × la máxima. */
  umbralRelativo: number;
  /** Cuántos frames después del ataque se evalúan (a 21 ms cada uno). */
  framesEvaluacion: number;
  /** dB por encima del piso de ruido para considerar que hay señal. */
  margenCompuertaDb: number;
  /** Selección dispersa: una nota entra solo si reduce el residuo al menos esta fracción de la energía total. */
  mejoraMinima: number;
  /** Máximo de notas simultáneas que buscamos. */
  maxNotas: number;
}

export const OPCIONES_NMF: OpcionesNmf = {
  iteraciones: 60, umbralRelativo: 0.2, framesEvaluacion: 12, margenCompuertaDb: 10, mejoraMinima: 0.01, maxNotas: 8,
};

/** Activaciones h ≥ 0 tales que v ≈ Σ h_k · W_k. */
export function activaciones(W: Float32Array[], v: Float32Array, iteraciones: number): Float32Array {
  const K = W.length;
  // Precalculamos G = Wᵀ·W (K×K) y c = Wᵀ·v (K): el resto es barato.
  const G = new Float32Array(K * K);
  const c = new Float32Array(K);
  for (let a = 0; a < K; a++) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += W[a][i] * v[i];
    c[a] = s;
    for (let b = a; b < K; b++) {
      let g = 0;
      for (let i = 0; i < v.length; i++) g += W[a][i] * W[b][i];
      G[a * K + b] = g;
      G[b * K + a] = g;
    }
  }
  const h = new Float32Array(K).fill(1);
  for (let it = 0; it < iteraciones; it++) {
    for (let a = 0; a < K; a++) {
      let denominador = 1e-9;
      for (let b = 0; b < K; b++) denominador += G[a * K + b] * h[b];
      h[a] *= c[a] / denominador;
    }
  }
  return h;
}

export interface NotaHuella {
  midi: number;
  inicioSeg: number;
  duracionSeg: number;
  /** Activación promedio (amplitud relativa). */
  amplitud: number;
  calibrada: boolean;
}

export interface Evaluacion {
  presentes: number[];
  /** midi → activación promedio, para todas las candidatas. */
  activacion: Map<number, number>;
  ruido: number;
}

export class DetectorHuellas {
  readonly stft: STFT;
  huellas: Huellas;
  opciones: OpcionesNmf;

  constructor(stft: STFT, huellas: Huellas, opciones: OpcionesNmf = OPCIONES_NMF) {
    this.stft = stft;
    this.huellas = huellas;
    this.opciones = opciones;
  }

  /**
   * Candidatas: si sabemos qué se espera, esas notas y sus vecinas (semitono
   * arriba y abajo, octava arriba y abajo: los errores típicos). Si no, todo
   * el rango configurado.
   */
  candidatos(esperadas?: number[]): number[] {
    const { midiMin, midiMax } = this.huellas;
    if (!esperadas || esperadas.length === 0) {
      const todas: number[] = [];
      for (let m = midiMin; m <= midiMax; m++) todas.push(m);
      return todas;
    }
    const conjunto = new Set<number>();
    for (const e of esperadas) for (const d of [0, 1, -1, 12, -12]) {
      const m = e + d;
      if (m >= 21 && m <= 108) conjunto.add(m);
    }
    return [...conjunto].sort((a, b) => a - b);
  }

  /**
   * Evalúa un grupo de frames (los que siguen a un ataque) contra las candidatas.
   *
   * Selección dispersa ("matching pursuit" no negativo): en vez de dejar que
   * todas las candidatas se repartan la energía, se agregan de a una, siempre
   * la que mejor explica lo que todavía falta explicar, y se para cuando la
   * siguiente ya no reduce el residuo de forma apreciable. Así, si Fa4 explica
   * el espectro, Fa3 (cuyos armónicos pares son los de Fa4) no aporta nada
   * nuevo y no entra: es la defensa contra la confusión de octava.
   */
  evaluar(espectros: Float32Array[], candidatos: number[]): Evaluacion {
    const W = candidatos.map((m) => huellaDe(this.huellas, m, this.stft).vector);
    const ruido = ruidoDe(this.huellas);
    // Espectro promedio del grupo de frames: más estable que frame a frame.
    const v = new Float32Array(espectros[0].length);
    for (const e of espectros) for (let i = 0; i < v.length; i++) v[i] += e[i] / espectros.length;
    const punto = (a: Float32Array, b: Float32Array) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i] * b[i];
      return s;
    };
    const energiaTotal = punto(v, v) || 1e-12;

    const residuoDe = (indices: number[]): { h: Float32Array; energia: number } => {
      const diccionario = [...indices.map((k) => W[k]), ruido];
      const h = activaciones(diccionario, v, this.opciones.iteraciones);
      const r = Float32Array.from(v);
      diccionario.forEach((w, j) => {
        for (let i = 0; i < r.length; i++) r[i] -= h[j] * w[i];
      });
      return { h, energia: punto(r, r) };
    };

    const elegidos: number[] = [];
    let actual = residuoDe([]); // solo ruido
    let hFinal = actual.h;
    while (elegidos.length < this.opciones.maxNotas) {
      // Residuo actual (lo que las elegidas + ruido todavía no explican).
      const r = Float32Array.from(v);
      [...elegidos.map((k) => W[k]), ruido].forEach((w, j) => {
        for (let i = 0; i < r.length; i++) r[i] -= hFinal[j] * w[i];
      });
      for (let i = 0; i < r.length; i++) if (r[i] < 0) r[i] = 0;
      let mejor = -1;
      let mejorCorr = 0;
      candidatos.forEach((_, k) => {
        if (elegidos.includes(k)) return;
        const c = punto(r, W[k]);
        if (c > mejorCorr) {
          mejorCorr = c;
          mejor = k;
        }
      });
      if (mejor < 0) break;
      const prueba = residuoDe([...elegidos, mejor]);
      const mejora = (actual.energia - prueba.energia) / energiaTotal;
      if (mejora < this.opciones.mejoraMinima) break;
      elegidos.push(mejor);
      actual = prueba;
      hFinal = prueba.h;
    }

    const activacion = new Map<number, number>();
    candidatos.forEach((m) => activacion.set(m, 0));
    let maxima = 0;
    elegidos.forEach((k, j) => {
      activacion.set(candidatos[k], hFinal[j]);
      maxima = Math.max(maxima, hFinal[j]);
    });
    const presentes = elegidos
      .filter((_, j) => hFinal[j] >= this.opciones.umbralRelativo * maxima)
      .map((k) => candidatos[k])
      .sort((a, b) => a - b);
    return { presentes, activacion, ruido: hFinal[hFinal.length - 1] };
  }

  /**
   * Analiza un clip completo (a la tasa del STFT): busca ataques, y tras cada
   * ataque evalúa qué candidatas suenan. Sin ataques, evalúa lo que esté por
   * encima de la compuerta.
   */
  analizarClip(clip: Float32Array, esperadas?: number[], pisoDb?: number | null): { notas: NotaHuella[]; msProceso: number; detalle: string } {
    const t0 = performance.now();
    const { espectros, tiempos, rms } = this.stft.frames(clip);
    if (espectros.length === 0) return { notas: [], msProceso: 0, detalle: 'clip demasiado corto' };
    const rmsDb = rms.map(dB);
    const piso = pisoDb ?? this.huellas.pisoDb ?? percentil(rmsDb, 10);
    const compuerta = piso + this.opciones.margenCompuertaDb;
    const candidatos = this.candidatos(esperadas);
    const notas: NotaHuella[] = [];

    let ataques = ataquesDeFrames(espectros, tiempos, this.stft.hopSeg)
      .filter((i) => rmsDb[Math.min(i + 1, rmsDb.length - 1)] > compuerta)
      .filter((i) => tieneSubidaDeEnergia(rms, i));
    let detalle = `${ataques.length} ataques`;
    if (ataques.length === 0) {
      const primero = rmsDb.findIndex((x) => x > compuerta);
      if (primero < 0) return { notas: [], msProceso: Math.round(performance.now() - t0), detalle: 'silencio (bajo la compuerta)' };
      ataques = [primero];
      detalle = 'sin ataque claro; se evaluó desde que hubo señal';
    }
    for (const a of ataques) {
      const indices: number[] = [];
      for (let i = a + 1; i <= a + this.opciones.framesEvaluacion && i < espectros.length; i++) {
        if (rmsDb[i] > compuerta) indices.push(i);
      }
      if (indices.length === 0) continue;
      const { presentes, activacion } = this.evaluar(indices.map((i) => espectros[i]), candidatos);
      for (const m of presentes) {
        notas.push({
          midi: m,
          inicioSeg: tiempos[a],
          duracionSeg: indices.length * this.stft.hopSeg,
          amplitud: activacion.get(m) ?? 0,
          calibrada: huellaDe(this.huellas, m, this.stft).calibrada,
        });
      }
    }
    return { notas, msProceso: Math.round(performance.now() - t0), detalle };
  }
}
