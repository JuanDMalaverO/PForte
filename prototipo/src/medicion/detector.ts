// ============================================================================
// detector.ts — Envuelve basic-pitch (Spotify) para detectar notas en audio,
// más utilidades de audio: remuestrear a 22050 Hz, decodificar archivos y
// capturar el micrófono con higiene de señal (filtro, compuerta, saturación).
//
// Cómo funciona basic-pitch en dos líneas:
//   Es una red neuronal pequeña (TensorFlow.js) que recibe audio mono a
//   22050 Hz en ventanas de 2 segundos y devuelve, para cada "frame" (~11.6 ms),
//   la probabilidad de que cada una de las 88 teclas esté sonando ("frames")
//   y de que esté empezando ("onsets"). outputToNotesPoly convierte esas
//   matrices en una lista de notas {midi, inicio, duración}.
//
// No es "streaming": procesa un buffer completo. Por eso la latencia real
// incluye: esperar a tener audio + remuestrear + inferencia + post-proceso.
// Y no tiene noción de silencio: sobre ruido de fondo también devuelve notas.
// Por eso la compuerta de energía vive en el micrófono, no en el modelo.
// ============================================================================

import * as tf from '@tensorflow/tfjs';
import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import { dB, rms } from './fft';

export const TASA_MODELO = 22050;

export interface NotaDetectada {
  midi: number;
  inicioSeg: number;
  duracionSeg: number;
  amplitud: number;
}

export interface Deteccion {
  notas: NotaDetectada[];
  /** Tiempo total de inferencia + post-proceso, en ms. */
  msInferencia: number;
}

export interface Umbrales {
  /** Probabilidad mínima de "onset" para abrir una nota (0-1). Default de Spotify: 0.5 */
  onset: number;
  /** Probabilidad mínima de "frame" para sostener una nota (0-1). Default: 0.3 */
  frame: number;
  /** Largo mínimo de una nota en frames (~11.6 ms cada uno). Default: 11 */
  minFrames: number;
  /** Rango de notas MIDI aceptado. 21..108 = piano completo (sin filtro). */
  midiMin: number;
  midiMax: number;
  /**
   * Descarta notas cuya amplitud sea menor que esta fracción de la nota más
   * fuerte del clip. Los fantasmas de octava suelen ser débiles. 0 = sin filtro.
   */
  amplitudRelativa: number;
}

export const UMBRALES_DEFECTO: Umbrales = { onset: 0.5, frame: 0.3, minFrames: 11, midiMin: 21, midiMax: 108, amplitudRelativa: 0 };

const midiAHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class Detector {
  private readonly modelo: BasicPitch;
  readonly backend: string;

  private constructor(modelo: BasicPitch, backend: string) {
    this.modelo = modelo;
    this.backend = backend;
  }

  /** Carga el modelo (public/model/model.json) y elige el backend más rápido disponible. */
  static async crear(): Promise<Detector> {
    try {
      await tf.setBackend('webgl');
    } catch {
      await tf.setBackend('cpu');
    }
    await tf.ready();
    const modelo = new BasicPitch(`${import.meta.env.BASE_URL}model/model.json`);
    await modelo.model;
    const detector = new Detector(modelo, tf.getBackend());
    // Calentamiento: la primera inferencia compila los shaders de WebGL y tarda
    // ~3-4 s. La hacemos ahora, con silencio, para que la primera real sea rápida.
    await detector.detectar(new Float32Array(TASA_MODELO * 2));
    return detector;
  }

  /** Audio mono a 22050 Hz → notas detectadas. */
  async detectar(audio22050: Float32Array, umbrales: Umbrales = UMBRALES_DEFECTO): Promise<Deteccion> {
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contornos: number[][] = [];
    const t0 = performance.now();
    await this.modelo.evaluateModel(
      audio22050,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contornos.push(...c);
      },
      () => {},
    );
    // Los dos últimos parámetros acotan el rango en Hz (null = sin límite).
    const eventos = outputToNotesPoly(
      frames, onsets, umbrales.onset, umbrales.frame, umbrales.minFrames, true,
      umbrales.midiMax >= 108 ? null : midiAHz(umbrales.midiMax),
      umbrales.midiMin <= 21 ? null : midiAHz(umbrales.midiMin),
    );
    const notas = noteFramesToTime(addPitchBendsToNoteEvents(contornos, eventos));
    const maxima = notas.reduce((m, n) => Math.max(m, n.amplitude), 0);
    return {
      notas: notas
        .filter((n) => n.amplitude >= umbrales.amplitudRelativa * maxima)
        .map((n) => ({ midi: n.pitchMidi, inicioSeg: n.startTimeSeconds, duracionSeg: n.durationSeconds, amplitud: n.amplitude }))
        .sort((a, b) => a.inicioSeg - b.inicioSeg || a.midi - b.midi),
      msInferencia: Math.round(performance.now() - t0),
    };
  }
}

/** Remuestrea audio mono a otra tasa usando el motor del navegador (OfflineAudioContext). */
export async function remuestrear(datos: Float32Array, tasaOrigen: number, tasaDestino = TASA_MODELO): Promise<Float32Array> {
  if (tasaOrigen === tasaDestino) return datos;
  const largo = Math.ceil((datos.length * tasaDestino) / tasaOrigen);
  const offline = new OfflineAudioContext(1, largo, tasaDestino);
  const buffer = offline.createBuffer(1, datos.length, tasaOrigen);
  buffer.copyToChannel(datos as Float32Array<ArrayBuffer>, 0);
  const fuente = offline.createBufferSource();
  fuente.buffer = buffer;
  fuente.connect(offline.destination);
  fuente.start();
  return (await offline.startRendering()).getChannelData(0);
}

/** Decodifica un archivo de audio (wav/mp3/ogg) a mono a la tasa pedida. */
export async function decodificarArchivo(archivo: File, tasaDestino = TASA_MODELO): Promise<Float32Array> {
  const ctx = new AudioContext();
  const buffer = await ctx.decodeAudioData(await archivo.arrayBuffer());
  await ctx.close();
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const canal = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += canal[i] / buffer.numberOfChannels;
  }
  return remuestrear(mono, buffer.sampleRate, tasaDestino);
}

export interface DispositivoAudio {
  id: string;
  nombre: string;
}

/** Lista los micrófonos disponibles (los nombres aparecen después de dar permiso una vez). */
export async function listarMicrofonos(): Promise<DispositivoAudio[]> {
  const todos = await navigator.mediaDevices.enumerateDevices();
  return todos.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, nombre: d.label || `micrófono ${i + 1}` }));
}

// Código del AudioWorklet: corre en el hilo de audio, junta bloques de 128
// muestras hasta 2048 y los manda al hilo principal con el instante de la
// primera muestra. A diferencia de ScriptProcessorNode, no pierde bloques
// cuando el hilo principal está ocupado (inferencia, render): los mensajes
// se encolan y llegan todos.
const CODIGO_WORKLET = `
class CapturaPiano extends AudioWorkletProcessor {
  constructor() { super(); this.trozos = []; this.largo = 0; this.tiempo = 0; }
  process(inputs) {
    const canal = inputs[0] && inputs[0][0];
    if (canal) {
      if (this.largo === 0) this.tiempo = currentTime;
      this.trozos.push(canal.slice(0));
      this.largo += canal.length;
      if (this.largo >= 2048) {
        const datos = new Float32Array(this.largo);
        let i = 0;
        for (const t of this.trozos) { datos.set(t, i); i += t.length; }
        this.port.postMessage({ datos, tiempo: this.tiempo }, [datos.buffer]);
        this.trozos = []; this.largo = 0;
      }
    }
    return true;
  }
}
registerProcessor('captura-piano', CapturaPiano);
`;

/**
 * Captura del micrófono en un buffer circular de `capacidadSeg` segundos.
 * Usa un AudioWorklet (con ScriptProcessorNode como plan B en navegadores viejos).
 *
 * Higiene de señal:
 *  - Pedimos el micrófono SIN cancelación de eco, supresión de ruido ni control
 *    automático de ganancia: esos filtros están pensados para voz y destrozan
 *    los armónicos del piano.
 *  - Filtro pasa-altos en 40 Hz: saca el zumbido eléctrico y el rumor de la
 *    sala (que el modelo confundía con notas graves).
 *  - Piso de ruido calibrado (calibrarSilencio) y compuerta: nada que esté a
 *    menos de `margenCompuertaDb` por encima del piso se analiza.
 *  - Detección de saturación: si el pico se acerca a 1.0, la señal está
 *    recortada y el espectro es basura; hay que alejar el micrófono.
 */
export class Microfono {
  readonly ctx: AudioContext;
  readonly tasa: number;
  readonly nombre: string;
  margenCompuertaDb = 10;
  /** 'worklet' o 'scriptprocessor' (plan B). */
  readonly captura: string;
  private readonly flujo: MediaStream;
  private nodo: AudioNode | null = null;
  private readonly anillo: Float32Array;
  private escritas = 0; // muestras totales escritas desde el inicio
  private tiempoBase: number | null = null; // tiempo de audio de la muestra 0
  private piso: number | null = null; // dB

  private constructor(ctx: AudioContext, flujo: MediaStream, capacidadSeg: number, nombre: string, captura: string) {
    this.ctx = ctx;
    this.tasa = ctx.sampleRate;
    this.flujo = flujo;
    this.nombre = nombre;
    this.captura = captura;
    this.anillo = new Float32Array(Math.floor(capacidadSeg * this.tasa));
  }

  static async abrir(capacidadSeg = 10, deviceId?: string): Promise<Microfono> {
    const flujo = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
      },
    });
    const ctx = new AudioContext();
    await ctx.resume();
    const pista = flujo.getAudioTracks()[0];
    const conWorklet = typeof ctx.audioWorklet !== 'undefined';
    const mic = new Microfono(ctx, flujo, capacidadSeg, pista?.label || 'micrófono', conWorklet ? 'worklet' : 'scriptprocessor');
    await mic.conectar(conWorklet);
    return mic;
  }

  private async conectar(conWorklet: boolean): Promise<void> {
    const { ctx } = this;
    const fuente = ctx.createMediaStreamSource(this.flujo);
    const pasaAltos = ctx.createBiquadFilter();
    pasaAltos.type = 'highpass';
    pasaAltos.frequency.value = 40;
    pasaAltos.Q.value = 0.7;
    // Nada de esto debe sonar por los parlantes: ganancia 0 hacia la salida
    // (los nodos solo procesan si están conectados a la salida).
    const silencio = ctx.createGain();
    silencio.gain.value = 0;
    if (conWorklet) {
      const url = URL.createObjectURL(new Blob([CODIGO_WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      const nodo = new AudioWorkletNode(ctx, 'captura-piano', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      nodo.port.onmessage = (ev: MessageEvent<{ datos: Float32Array; tiempo: number }>) => this.escribir(ev.data.datos, ev.data.tiempo);
      fuente.connect(pasaAltos).connect(nodo).connect(silencio).connect(ctx.destination);
      this.nodo = nodo;
    } else {
      const procesador = ctx.createScriptProcessor(4096, 1, 1);
      procesador.onaudioprocess = (ev) => this.escribir(ev.inputBuffer.getChannelData(0), ev.playbackTime);
      fuente.connect(pasaAltos).connect(procesador).connect(silencio).connect(ctx.destination);
      this.nodo = procesador;
    }
  }

  /** Guarda un trozo en el anillo. `tiempo` es el instante de audio de su primera muestra. */
  private escribir(datos: Float32Array, tiempo: number): void {
    if (this.tiempoBase === null) this.tiempoBase = tiempo - this.escritas / this.tasa;
    for (let i = 0; i < datos.length; i++) {
      this.anillo[this.escritas % this.anillo.length] = datos[i];
      this.escritas++;
    }
  }

  /** Índice absoluto de la última muestra escrita. */
  get escritasTotal(): number {
    return this.escritas;
  }

  /** Tiempo de audio (reloj del AudioContext) de una muestra por su índice absoluto. */
  tiempoDe(indice: number): number {
    return (this.tiempoBase ?? 0) + indice / this.tasa;
  }

  /** Devuelve los últimos `segundos` de audio y el tiempo de audio de su primera muestra. */
  ultimos(segundos: number): { datos: Float32Array; tiempoInicio: number } {
    const n = Math.min(Math.floor(segundos * this.tasa), this.anillo.length, this.escritas);
    return this.leerRango(this.escritas - n, n);
  }

  /** Lee desde un índice absoluto hasta lo último escrito (para consumo incremental). */
  leerDesde(indice: number): { datos: Float32Array; indice: number; tiempoInicio: number } {
    const desde = Math.max(indice, this.escritas - this.anillo.length, 0);
    const { datos, tiempoInicio } = this.leerRango(desde, this.escritas - desde);
    return { datos, indice: this.escritas, tiempoInicio };
  }

  private leerRango(desde: number, n: number): { datos: Float32Array; tiempoInicio: number } {
    const datos = new Float32Array(Math.max(0, n));
    for (let i = 0; i < n; i++) datos[i] = this.anillo[(desde + i) % this.anillo.length];
    return { datos, tiempoInicio: this.tiempoDe(desde) };
  }

  /** Nivel RMS de los últimos 100 ms, en dB. */
  nivelDb(): number {
    return dB(rms(this.ultimos(0.1).datos));
  }

  /** Pico absoluto de los últimos 100 ms (0..1). Cerca de 1 = saturación. */
  pico(): number {
    let p = 0;
    for (const x of this.ultimos(0.1).datos) p = Math.max(p, Math.abs(x));
    return p;
  }

  get satura(): boolean {
    return this.pico() > 0.98;
  }

  /** Mide el piso de ruido con los últimos `segundos` (la sala en silencio). */
  calibrarSilencio(segundos = 2): number {
    this.piso = dB(rms(this.ultimos(segundos).datos));
    return this.piso;
  }

  get pisoDb(): number | null {
    return this.piso;
  }

  set pisoDb(valor: number | null) {
    this.piso = valor;
  }

  /** Umbral en dB por encima del cual consideramos que hay señal. */
  get compuertaDb(): number | null {
    return this.piso === null ? null : this.piso + this.margenCompuertaDb;
  }

  cerrar(): void {
    if (this.ctx.state === 'closed') return; // ya cerrado (React puede llamar dos veces)
    this.nodo?.disconnect();
    this.flujo.getTracks().forEach((t) => t.stop());
    void this.ctx.close();
  }
}
