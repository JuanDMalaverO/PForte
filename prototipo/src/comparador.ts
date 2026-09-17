// ============================================================================
// comparador.ts — Compara las notas tocadas contra las notas de la partitura.
//
// Todo se mide en "pulsos" (negras) desde el inicio de la pieza:
//   pulso 0 = primer tiempo del compás 1; pulso 4 = primer tiempo del compás 2.
//
// Regla, deliberadamente simple:
//   Una nota tocada es CORRECTA si existe una nota esperada, todavía sin
//   emparejar, con el mismo número MIDI y cuyo pulso está a menos de
//   `toleranciaPulsos` de distancia (por defecto media negra).
//   Si no hay pareja, es una nota EXTRA.
//   Al terminar, toda nota esperada sin pareja es FALLIDA.
// ============================================================================

export interface NotaEsperada {
  midi: number;
  /** Pulso (negra) en que debe sonar, desde el inicio de la pieza. */
  pulso: number;
  duracionPulsos: number;
  /** Compás 0-based. */
  compas: number;
}

export interface NotaTocada {
  midi: number;
  pulso: number;
}

export type EstadoNota = 'pendiente' | 'correcta' | 'fallida';

export interface ResultadoNota {
  esperada: NotaEsperada;
  estado: EstadoNota;
  /** Cuánto se adelantó (-) o atrasó (+) la nota tocada, en pulsos. */
  desvioPulsos?: number;
}

export interface Resumen {
  esperadas: number;
  correctas: number;
  fallidas: number;
  pendientes: number;
  extras: number;
  porcentaje: number; // correctas / esperadas * 100
}

export class Comparador {
  readonly resultados: ResultadoNota[];
  readonly extras: NotaTocada[] = [];
  readonly toleranciaPulsos: number;

  constructor(esperadas: NotaEsperada[], toleranciaPulsos = 0.5) {
    this.resultados = esperadas.map((e) => ({ esperada: e, estado: 'pendiente' }));
    this.toleranciaPulsos = toleranciaPulsos;
  }

  /** Registra una nota tocada. Devuelve el resultado emparejado o null si fue extra. */
  registrar(tocada: NotaTocada): ResultadoNota | null {
    let mejor: ResultadoNota | null = null;
    let mejorDistancia = Infinity;
    for (const r of this.resultados) {
      if (r.estado !== 'pendiente' || r.esperada.midi !== tocada.midi) continue;
      const distancia = Math.abs(r.esperada.pulso - tocada.pulso);
      if (distancia <= this.toleranciaPulsos && distancia < mejorDistancia) {
        mejor = r;
        mejorDistancia = distancia;
      }
    }
    if (mejor) {
      mejor.estado = 'correcta';
      mejor.desvioPulsos = tocada.pulso - mejor.esperada.pulso;
      return mejor;
    }
    this.extras.push(tocada);
    return null;
  }

  /** Marca como fallidas las notas cuyo momento ya pasó (más allá de la tolerancia). */
  actualizar(pulsoActual: number): void {
    for (const r of this.resultados) {
      if (r.estado === 'pendiente' && pulsoActual - r.esperada.pulso > this.toleranciaPulsos) {
        r.estado = 'fallida';
      }
    }
  }

  /** Al terminar la pieza: todo lo pendiente es fallido. */
  cerrar(): void {
    this.actualizar(Infinity);
  }

  resumen(): Resumen {
    return resumir(this.resultados, this.extras.length);
  }

  /** Resumen por compás, para la tabla de la pantalla. */
  porCompas(numCompases: number): Resumen[] {
    const lista: Resumen[] = [];
    for (let c = 0; c < numCompases; c++) {
      lista.push(resumir(this.resultados.filter((r) => r.esperada.compas === c), 0));
    }
    return lista;
  }
}

function resumir(resultados: ResultadoNota[], extras: number): Resumen {
  const esperadas = resultados.length;
  const correctas = resultados.filter((r) => r.estado === 'correcta').length;
  const fallidas = resultados.filter((r) => r.estado === 'fallida').length;
  return {
    esperadas,
    correctas,
    fallidas,
    pendientes: esperadas - correctas - fallidas,
    extras,
    porcentaje: esperadas === 0 ? 0 : Math.round((correctas / esperadas) * 1000) / 10,
  };
}
