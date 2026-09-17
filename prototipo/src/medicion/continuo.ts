// ============================================================================
// continuo.ts — Escucha continua del micrófono, con los dos motores.
//
//   FlujoEspectral: lee el micrófono de a pedazos, arma frames solapados,
//                   calcula su espectro y corre el detector de ataques.
//   crearEscuchaHuellas: en cada ataque, espera unos pocos frames y evalúa
//                   qué candidatas suenan (NMF). Latencia ≈ frames × 21 ms.
//   crearEscuchaVentana: cada N ms pasa la última ventana de audio por un
//                   motor de clips (basic-pitch, Onsets and Frames) y reporta
//                   los ataques nuevos.
// ============================================================================

import { remuestrear, type Microfono } from './detector';
import { dB, rms, type STFT } from './fft';
import { DetectorAtaques, tieneSubidaDeEnergia } from './ataques';
import type { DetectorHuellas } from './nmf';
import type { Motor } from './motores';

export interface DeteccionContinua {
  midi: number;
  /** Instante del ataque (reloj de audio). */
  onsetSeg: number;
  /** Instante en que la detección estuvo disponible (reloj de audio). */
  tDeteccionSeg: number;
  msProceso: number;
}

export interface Escucha {
  detener(): void;
}

export interface FrameVivo {
  espectro: Float32Array;
  tiempo: number;
  rms: number;
  indice: number;
}

interface CallbacksFlujo {
  onFrame?: (f: FrameVivo) => void;
  onAtaque?: (tiempo: number, indiceFrame: number) => void;
}

export class FlujoEspectral {
  readonly mic: Microfono;
  readonly stft: STFT;
  /** Últimos frames calculados (hasta 400 ≈ 8 s). */
  readonly frames: FrameVivo[] = [];
  private readonly cb: CallbacksFlujo;
  private readonly ataques: DetectorAtaques;
  private indiceLeido = 0;
  private indiceResto = 0;
  private resto = new Float32Array(0);
  private contador = 0;
  private timer: number | null = null;

  constructor(mic: Microfono, stft: STFT, cb: CallbacksFlujo) {
    this.mic = mic;
    this.stft = stft;
    this.cb = cb;
    this.ataques = new DetectorAtaques(stft.hopSeg);
  }

  iniciar(intervaloMs = 40): void {
    this.indiceLeido = Math.max(0, this.mic.escritasTotal - this.stft.N);
    this.indiceResto = this.indiceLeido;
    this.timer = window.setInterval(() => this.tick(), intervaloMs);
  }

  detener(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const { datos, indice } = this.mic.leerDesde(this.indiceLeido);
    this.indiceLeido = indice;
    const nuevo = new Float32Array(this.resto.length + datos.length);
    nuevo.set(this.resto);
    nuevo.set(datos, this.resto.length);
    this.resto = nuevo;
    let offset = 0;
    while (offset + this.stft.N <= this.resto.length) {
      const frame = this.resto.subarray(offset, offset + this.stft.N);
      const f: FrameVivo = {
        espectro: this.stft.espectro(frame),
        tiempo: this.mic.tiempoDe(this.indiceResto + offset),
        rms: rms(frame),
        indice: this.contador++,
      };
      this.frames.push(f);
      if (this.frames.length > 400) this.frames.shift();
      this.cb.onFrame?.(f);
      const t = this.ataques.procesar(f.espectro, f.tiempo);
      if (t !== null) this.cb.onAtaque?.(t, f.indice - 1);
      offset += this.stft.hop;
    }
    this.resto = this.resto.slice(offset);
    this.indiceResto += offset;
  }
}

/** Escucha con huellas: ataque → `framesEval` frames después → NMF sobre las candidatas. */
export function crearEscuchaHuellas(
  mic: Microfono,
  detector: DetectorHuellas,
  candidatos: number[],
  framesEval: number,
  onDeteccion: (d: DeteccionContinua) => void,
): Escucha {
  const pendientes: { tiempo: number; indice: number }[] = [];
  const recientes: { midi: number; onset: number }[] = [];
  const flujo = new FlujoEspectral(mic, detector.stft, {
    onAtaque: (tiempo, indice) => pendientes.push({ tiempo, indice }),
    onFrame: (f) => {
      for (let i = pendientes.length - 1; i >= 0; i--) {
        const p = pendientes[i];
        if (f.indice < p.indice + framesEval) continue;
        pendientes.splice(i, 1);
        const compuerta = mic.compuertaDb;
        // Validación: un ataque real trae subida de energía respecto de justo antes.
        const ventana = flujo.frames.filter((x) => x.indice >= p.indice - 3 && x.indice <= p.indice + 3);
        const rmsVentana = ventana.map((x) => x.rms);
        const posicion = ventana.findIndex((x) => x.indice === p.indice);
        if (posicion >= 0 && !tieneSubidaDeEnergia(rmsVentana, posicion)) continue;
        const utiles = flujo.frames.filter(
          (x) => x.indice > p.indice && x.indice <= p.indice + framesEval && (compuerta === null || dB(x.rms) > compuerta),
        );
        if (utiles.length === 0) continue;
        const t0 = performance.now();
        const { presentes } = detector.evaluar(utiles.map((x) => x.espectro), candidatos);
        const msProceso = Math.round(performance.now() - t0);
        const tDeteccionSeg = mic.ctx.currentTime;
        for (const midi of presentes) {
          if (recientes.some((r) => r.midi === midi && Math.abs(r.onset - p.tiempo) < 0.15)) continue;
          recientes.push({ midi, onset: p.tiempo });
          if (recientes.length > 500) recientes.shift();
          onDeteccion({ midi, onsetSeg: p.tiempo, tDeteccionSeg, msProceso });
        }
      }
    },
  });
  flujo.iniciar();
  return { detener: () => flujo.detener() };
}

/** Escucha por ventana deslizante (basic-pitch u Onsets and Frames): la última ventana de `ventanaSeg`, cada `intervaloMs`. */
export function crearEscuchaVentana(
  mic: Microfono,
  motor: Motor,
  ventanaSeg: number,
  intervaloMs: number,
  onDeteccion: (d: DeteccionContinua) => void,
): Escucha {
  const reportadas: { midi: number; onset: number }[] = [];
  let ocupado = false;
  const timer = window.setInterval(async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      const { datos, tiempoInicio } = mic.ultimos(ventanaSeg);
      if (datos.length < mic.tasa * 0.5) return; // el micrófono recién arranca
      // Compuerta: si en toda la ventana no hubo señal, no molestamos al modelo.
      const compuerta = mic.compuertaDb;
      if (compuerta !== null) {
        const paso = Math.floor(mic.tasa * 0.1);
        let maximo = -180;
        for (let i = 0; i + paso <= datos.length; i += paso) maximo = Math.max(maximo, dB(rms(datos.subarray(i, i + paso))));
        if (maximo < compuerta) return;
      }
      const audio = await remuestrear(datos, mic.tasa, motor.tasa);
      const { notas, msProceso } = await motor.analizar(audio);
      const tDeteccionSeg = mic.ctx.currentTime;
      for (const n of notas) {
        // Solo miramos la parte "fresca" de la ventana: lo que entró desde los
        // dos últimos análisis. Lo anterior ya fue analizado con más contexto.
        // Además, una nota cortada por el borde de la ventana hace que el modelo
        // "invente" ataques sobre la parte sostenida; el refractario de 1 s por
        // nota los descarta (limitación: no distingue una repetición rápida real).
        if (n.inicioSeg < ventanaSeg - 2 * (intervaloMs / 1000) - 0.05) continue;
        const onset = tiempoInicio + n.inicioSeg;
        if (reportadas.some((r) => r.midi === n.midi && Math.abs(r.onset - onset) < 1.0)) continue;
        reportadas.push({ midi: n.midi, onset });
        onDeteccion({ midi: n.midi, onsetSeg: onset, tDeteccionSeg, msProceso });
      }
    } finally {
      ocupado = false;
    }
  }, intervaloMs);
  return { detener: () => window.clearInterval(timer) };
}
