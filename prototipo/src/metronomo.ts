// ============================================================================
// metronomo.ts — Metrónomo con Web Audio API y "scheduling anticipado".
//
// Problema: setInterval/setTimeout en el navegador se atrasan (pestaña
// ocupada, GC, etc.). Si el click se dispara "cuando llega el timer", el
// tempo se desincroniza y arruina la medición.
//
// Solución (patrón "A Tale of Two Clocks", Chris Wilson):
//   - Un setInterval poco preciso corre cada 25 ms. NO hace sonar nada.
//   - En cada vuelta mira: "¿qué pulsos caen dentro de los próximos 100 ms?"
//     y los agenda con el reloj del AudioContext (osc.start(tiempoExacto)),
//     que es preciso a nivel de muestra de audio.
//   - Así, aunque el timer se atrase 20 ms, el click ya estaba agendado.
//
// El metrónomo también es la fuente de verdad del TIEMPO MUSICAL: convierte
// un instante del reloj de audio a "pulso" (con decimales) con tiempoAPulso().
// ============================================================================

export interface Pulso {
  /** 0 = primer pulso del compás 1. Negativos = cuenta de entrada. */
  indice: number;
  /** Compás 0-based (negativo durante la cuenta de entrada). */
  compas: number;
  /** Posición dentro del compás: 0..pulsosPorCompas-1 */
  pulsoEnCompas: number;
  /** Instante (reloj del AudioContext, segundos) en que suena el click. */
  tiempoAudio: number;
}

/**
 * Convierte un timeStamp de evento DOM (reloj de performance.now(), en ms) al
 * reloj del AudioContext (segundos): "ahora en audio" menos "cuánto hace que
 * ocurrió el evento". Los dos relojes avanzan al mismo ritmo, así que la
 * conversión es exacta salvo por el tiempo que tardó el navegador en entregar
 * el evento (unos pocos ms).
 */
export function tiempoPerfATiempoAudio(ctx: AudioContext, tiempoPerfMs: number): number {
  return ctx.currentTime - (performance.now() - tiempoPerfMs) / 1000;
}

export class Metronomo {
  readonly ctx: AudioContext;
  bpm = 80;
  pulsosPorCompas = 4;
  compasesDeEntrada = 1;
  /** Se llama justo cuando suena cada click (para la UI y para ocultar compases). */
  onPulso: ((p: Pulso) => void) | null = null;
  /** Se llama un pulso después del último pulso agendado. */
  onFin: (() => void) | null = null;
  /** Retrasos medidos entre el click (audio) y el aviso a la UI, en ms. */
  readonly desviosMs: number[] = [];

  private timer: number | null = null;
  private proximoIndice = 0;
  private proximoTiempo = 0;
  private tiempoPulsoCero = 0;
  private ultimoIndice = 0;
  private readonly intervaloTimerMs = 25; // cada cuánto revisa el timer
  private readonly anticipacionSeg = 0.1; // cuánto hacia adelante agenda

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  get segundosPorPulso(): number {
    return 60 / this.bpm;
  }

  get activo(): boolean {
    return this.timer !== null;
  }

  /** Arranca: cuenta de entrada + `totalPulsos` pulsos de música. */
  iniciar(totalPulsos: number): void {
    this.detener();
    this.desviosMs.length = 0;
    this.proximoIndice = -this.compasesDeEntrada * this.pulsosPorCompas;
    this.proximoTiempo = this.ctx.currentTime + 0.2;
    // El pulso 0 ocurre `compasesDeEntrada * pulsosPorCompas` pulsos después del primero.
    this.tiempoPulsoCero = this.proximoTiempo - this.proximoIndice * this.segundosPorPulso;
    this.ultimoIndice = totalPulsos - 1;
    this.timer = window.setInterval(() => this.agendar(), this.intervaloTimerMs);
    this.agendar();
  }

  detener(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Convierte un instante del reloj de audio a pulso musical (con decimales). */
  tiempoAPulso(tiempoAudio: number): number {
    return (tiempoAudio - this.tiempoPulsoCero) / this.segundosPorPulso;
  }

  /** Convierte un timeStamp de evento DOM (reloj performance.now) a tiempo de audio. */
  tiempoPerfATiempoAudio(tiempoPerfMs: number): number {
    return tiempoPerfATiempoAudio(this.ctx, tiempoPerfMs);
  }

  // --- interno ------------------------------------------------------------

  private agendar(): void {
    // Agenda todos los pulsos que caigan dentro de la ventana de anticipación.
    while (this.proximoTiempo < this.ctx.currentTime + this.anticipacionSeg) {
      if (this.proximoIndice > this.ultimoIndice) {
        // Ya agendamos el último. Avisamos "fin" un pulso después y paramos.
        const retrasoMs = (this.proximoTiempo - this.ctx.currentTime) * 1000;
        window.setTimeout(() => this.onFin?.(), Math.max(0, retrasoMs));
        this.detener();
        return;
      }
      const n = this.pulsosPorCompas;
      const pulsoEnCompas = ((this.proximoIndice % n) + n) % n; // módulo positivo
      const pulso: Pulso = {
        indice: this.proximoIndice,
        compas: Math.floor(this.proximoIndice / n),
        pulsoEnCompas,
        tiempoAudio: this.proximoTiempo,
      };
      this.sonarClick(pulso.tiempoAudio, pulsoEnCompas === 0);
      this.avisarUI(pulso);
      this.proximoIndice += 1;
      this.proximoTiempo += this.segundosPorPulso;
    }
  }

  private sonarClick(tiempo: number, acento: boolean): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = acento ? 1200 : 800;
    gain.gain.setValueAtTime(0.4, tiempo);
    gain.gain.exponentialRampToValueAtTime(0.001, tiempo + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(tiempo);
    osc.stop(tiempo + 0.06);
  }

  private avisarUI(pulso: Pulso): void {
    // La UI no necesita precisión de muestra: un setTimeout que apunte al
    // instante del click es suficiente. Medimos cuánto se atrasa (desvío).
    const retrasoMs = (pulso.tiempoAudio - this.ctx.currentTime) * 1000;
    window.setTimeout(() => {
      this.desviosMs.push((this.ctx.currentTime - pulso.tiempoAudio) * 1000);
      this.onPulso?.(pulso);
    }, Math.max(0, retrasoMs));
  }
}
