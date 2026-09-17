// ============================================================================
// ataques.ts — Detector de ataques (onsets) por "flujo espectral".
//
// Idea: cuando empieza una nota, muchos bins del espectro suben de golpe.
// El flujo espectral de un frame es la suma de las subidas (solo las subidas)
// respecto del frame anterior. Un ataque es un pico del flujo que supera
// claramente el promedio reciente. Es un algoritmo clásico (Bello et al.,
// 2005), barato, y da el "cuándo" con precisión de un hop (~21 ms).
//
// Para confirmar que un frame es un pico hace falta ver el siguiente, así que
// el ataque se reporta con un frame de retraso.
// ============================================================================

export interface OpcionesAtaques {
  /** El flujo debe superar `factor` veces el promedio reciente... */
  factor: number;
  /** ...y además este mínimo absoluto (evita picos sobre silencio). */
  minimo: number;
  /** Dos ataques no pueden estar más cerca que esto. */
  refractarioSeg: number;
  /** Cuántos frames anteriores forman el promedio reciente. */
  historia: number;
}

export const OPCIONES_ATAQUES: OpcionesAtaques = { factor: 2.0, minimo: 0.05, refractarioSeg: 0.08, historia: 10 };

export class DetectorAtaques {
  readonly hopSeg: number;
  readonly opciones: OpcionesAtaques;
  private previo: Float32Array | null = null;
  private previoLog: Float32Array | null = null;
  private readonly flujos: number[] = [];
  private readonly tiempos: number[] = [];
  private ultimoAtaque = -Infinity;

  constructor(hopSeg: number, opciones: OpcionesAtaques = OPCIONES_ATAQUES) {
    this.hopSeg = hopSeg;
    this.opciones = opciones;
  }

  /**
   * Procesa el espectro de un frame. Devuelve el instante del ataque si el
   * frame ANTERIOR resultó ser un pico confirmado; si no, null.
   */
  procesar(espectro: Float32Array, tiempo: number): number | null {
    // Compresión logarítmica: que una nota fuerte no tape a una suave.
    const actualLog = new Float32Array(espectro.length);
    for (let i = 0; i < espectro.length; i++) actualLog[i] = Math.log1p(100 * espectro[i]);
    let flujo = 0;
    if (this.previoLog) {
      for (let i = 0; i < espectro.length; i++) {
        const d = actualLog[i] - this.previoLog[i];
        if (d > 0) flujo += d;
      }
      flujo /= espectro.length;
    }
    this.previo = espectro;
    this.previoLog = actualLog;
    this.flujos.push(flujo);
    this.tiempos.push(tiempo);
    if (this.flujos.length > this.opciones.historia + 3) {
      this.flujos.shift();
      this.tiempos.shift();
    }

    // ¿El penúltimo frame fue un pico?
    const n = this.flujos.length;
    if (n < 3) return null;
    const candidato = this.flujos[n - 2];
    const anterior = this.flujos[n - 3];
    const siguiente = this.flujos[n - 1];
    const historia = this.flujos.slice(0, n - 2);
    const promedio = historia.reduce((s, x) => s + x, 0) / historia.length;
    const tiempoCandidato = this.tiempos[n - 2];
    const esPico = candidato > anterior && candidato >= siguiente;
    const supera = candidato > promedio * this.opciones.factor + this.opciones.minimo;
    if (esPico && supera && tiempoCandidato - this.ultimoAtaque >= this.opciones.refractarioSeg) {
      this.ultimoAtaque = tiempoCandidato;
      return tiempoCandidato;
    }
    return null;
  }

  get ultimoEspectro(): Float32Array | null {
    return this.previo;
  }
}

/**
 * Un ataque de verdad viene con una subida de energía: el RMS justo después
 * debe superar claramente al de justo antes. Las resonancias, el pedal y los
 * golpes del mecanismo producen picos de flujo espectral sin esa subida.
 */
export function tieneSubidaDeEnergia(rms: number[], indiceAtaque: number, factor = 1.4): boolean {
  const antes = rms.slice(Math.max(0, indiceAtaque - 3), indiceAtaque);
  const despues = rms.slice(indiceAtaque + 1, indiceAtaque + 4);
  if (antes.length === 0 || despues.length === 0) return true;
  const media = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return media(despues) > factor * media(antes);
}

/** Ataques de un clip ya cortado en frames. Devuelve índices de frame. */
export function ataquesDeFrames(espectros: Float32Array[], tiempos: number[], hopSeg: number, opciones?: OpcionesAtaques): number[] {
  const det = new DetectorAtaques(hopSeg, opciones);
  const salida: number[] = [];
  espectros.forEach((e, i) => {
    if (det.procesar(e, tiempos[i]) !== null) salida.push(i - 1);
  });
  return salida;
}
