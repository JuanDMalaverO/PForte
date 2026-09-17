// ============================================================================
// fft.ts — Transformada rápida de Fourier (FFT) y espectrograma (STFT), sin
// librerías. Es la base de la detección por huellas (nmf.ts) y del detector
// de ataques (ataques.ts).
//
// Idea en una frase: un trozo de audio de N muestras se convierte en N/2
// "bins", cada uno con cuánta energía hay en una franja de frecuencia.
// Con tasa 48000 y N = 4096, cada bin mide 11,7 Hz y el trozo dura 85 ms.
// ============================================================================

export class FFT {
  readonly N: number;
  private readonly cosT: Float32Array;
  private readonly sinT: Float32Array;
  private readonly rev: Uint32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;

  constructor(N: number) {
    if (N & (N - 1)) throw new Error('N debe ser potencia de 2');
    this.N = N;
    this.cosT = new Float32Array(N / 2);
    this.sinT = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) {
      this.cosT[i] = Math.cos((2 * Math.PI * i) / N);
      this.sinT[i] = -Math.sin((2 * Math.PI * i) / N);
    }
    // Tabla de "bit reversal": el orden en que el algoritmo iterativo lee la entrada.
    this.rev = new Uint32Array(N);
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
      this.rev[i] = r;
    }
    this.re = new Float32Array(N);
    this.im = new Float32Array(N);
  }

  /** Magnitud del espectro de `x` (largo N). Devuelve N/2+1 valores. */
  magnitud(x: Float32Array, salida: Float32Array = new Float32Array(this.N / 2 + 1)): Float32Array {
    const { N, re, im, rev, cosT, sinT } = this;
    for (let i = 0; i < N; i++) {
      re[rev[i]] = x[i];
      im[rev[i]] = 0;
    }
    for (let tam = 2; tam <= N; tam <<= 1) {
      const mitad = tam >> 1;
      const paso = N / tam;
      for (let inicio = 0; inicio < N; inicio += tam) {
        for (let k = 0; k < mitad; k++) {
          const c = cosT[k * paso];
          const s = sinT[k * paso];
          const a = inicio + k;
          const b = a + mitad;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    for (let i = 0; i < salida.length; i++) salida[i] = Math.hypot(re[i], im[i]);
    return salida;
  }
}

export interface Frames {
  espectros: Float32Array[];
  /** Instante (segundos desde el inicio del clip) en que empieza cada frame. */
  tiempos: number[];
  /** Nivel RMS de cada frame (0..1). */
  rms: number[];
}

/** Espectrograma: corta el audio en frames solapados y calcula el espectro de cada uno. */
export class STFT {
  readonly tasa: number;
  readonly N: number;
  readonly hop: number;
  /** Cuántos bins conservamos (hasta `frecuenciaMax`). */
  readonly bins: number;
  readonly hzPorBin: number;
  private readonly fft: FFT;
  private readonly ventana: Float32Array;
  private readonly conVentana: Float32Array;
  private readonly completo: Float32Array;

  constructor(tasa: number, N = 4096, hop = N / 4, frecuenciaMax = 5000) {
    this.tasa = tasa;
    this.N = N;
    this.hop = hop;
    this.hzPorBin = tasa / N;
    this.bins = Math.min(N / 2 + 1, Math.floor(frecuenciaMax / this.hzPorBin) + 1);
    this.fft = new FFT(N);
    // Ventana de Hann: suaviza los bordes del frame para que no "suenen".
    this.ventana = new Float32Array(N);
    for (let i = 0; i < N; i++) this.ventana[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    this.conVentana = new Float32Array(N);
    this.completo = new Float32Array(N / 2 + 1);
  }

  get hopSeg(): number {
    return this.hop / this.tasa;
  }

  binDe(hz: number): number {
    return hz / this.hzPorBin;
  }

  /** Espectro (magnitud) de un frame de N muestras. Devuelve una copia de `bins` valores. */
  espectro(frame: Float32Array): Float32Array {
    for (let i = 0; i < this.N; i++) this.conVentana[i] = frame[i] * this.ventana[i];
    this.fft.magnitud(this.conVentana, this.completo);
    return this.completo.slice(0, this.bins);
  }

  /** Todos los frames de un clip. */
  frames(clip: Float32Array): Frames {
    const salida: Frames = { espectros: [], tiempos: [], rms: [] };
    for (let inicio = 0; inicio + this.N <= clip.length; inicio += this.hop) {
      const frame = clip.subarray(inicio, inicio + this.N);
      salida.espectros.push(this.espectro(frame));
      salida.tiempos.push(inicio / this.tasa);
      salida.rms.push(rms(frame));
    }
    return salida;
  }
}

export function rms(x: Float32Array): number {
  let suma = 0;
  for (let i = 0; i < x.length; i++) suma += x[i] * x[i];
  return x.length ? Math.sqrt(suma / x.length) : 0;
}

/** Nivel en decibeles (0 dB = amplitud 1.0). */
export function dB(amplitud: number): number {
  return 20 * Math.log10(amplitud + 1e-9);
}

export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor((p / 100) * orden.length))];
}
