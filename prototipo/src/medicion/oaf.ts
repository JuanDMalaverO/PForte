// ============================================================================
// oaf.ts — Onsets and Frames (Magenta, Google): modelo neuronal ESPECÍFICO de
// piano, entrenado con ~200 horas de piano real (MAESTRO). Es el estándar
// académico de transcripción de piano; basic-pitch es genérico y liviano.
//
// Pesos en public/model-oaf/ (60 MB, se cargan solo cuando se elige el motor).
// Procesa clips completos (no streaming). Internamente remuestrea a 16 kHz y
// calcula un espectrograma mel; devuelve notas con inicio, fin y velocidad.
// ============================================================================

import { OnsetsAndFrames } from '@magenta/music/esm/transcription';
import type { Deteccion } from './detector';

export const TASA_OAF = 16000;

export class DetectorOaf {
  private readonly modelo: OnsetsAndFrames;

  private constructor(modelo: OnsetsAndFrames) {
    this.modelo = modelo;
  }

  static async crear(alAvanzar?: (texto: string) => void): Promise<DetectorOaf> {
    alAvanzar?.('descargando pesos (60 MB)...');
    const modelo = new OnsetsAndFrames(`${import.meta.env.BASE_URL}model-oaf`);
    await modelo.initialize();
    const detector = new DetectorOaf(modelo);
    alAvanzar?.('calentando...');
    await detector.detectar(new Float32Array(TASA_OAF));
    return detector;
  }

  /** Audio mono a 16 kHz → notas. */
  async detectar(audio16k: Float32Array): Promise<Deteccion> {
    const t0 = performance.now();
    const buffer = new OfflineAudioContext(1, audio16k.length, TASA_OAF).createBuffer(1, audio16k.length, TASA_OAF);
    buffer.copyToChannel(audio16k as Float32Array<ArrayBuffer>, 0);
    const secuencia = await this.modelo.transcribeFromAudioBuffer(buffer);
    const notas = (secuencia.notes ?? [])
      .map((n) => ({
        midi: n.pitch ?? 0,
        inicioSeg: n.startTime ?? 0,
        duracionSeg: (n.endTime ?? 0) - (n.startTime ?? 0),
        amplitud: (n.velocity ?? 0) / 127,
      }))
      .sort((a, b) => a.inicioSeg - b.inicioSeg || a.midi - b.midi);
    return { notas, msInferencia: Math.round(performance.now() - t0) };
  }
}
