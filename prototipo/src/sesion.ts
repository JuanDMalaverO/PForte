// ============================================================================
// sesion.ts — T1: cada vez que un alumno termina el ejercicio, esto arma el
// JSON de la sesión y lo baja como archivo. Sin backend: Blob + enlace.
//
// Por qué existe: sin esto, lo que hace un alumno vive en la pantalla y se
// pierde al recargar. Con esto, cada sesión queda en un archivo con fecha y
// hora en el nombre, y se puede comparar una sesión con otra.
//
// Unidades: todo lo musical se mide en "pulsos" (negras) desde el inicio de
// la pieza; acá se convierte a SEGUNDOS relativos al inicio de cada compás,
// que es lo que pide el formato. Los pulsos vienen del reloj de audio (ver
// metronomo.ts), no de setTimeout: por eso los tiempos sirven para medir
// ritmo más adelante.
// ============================================================================

import type { Comparador } from './comparador';

/** Todo lo que no sabe el comparador y hace falta para interpretar la sesión. */
export interface DatosSesion {
  alumno: string;
  tempo: number;
  pulsosPorCompas: number;
  numCompases: number;
  /** Desfase de ocultamiento en pulsos, tal como está en la pantalla. */
  desfasePulsos: number;
  /** Qué se tocó: "pieza fija (pieza.ts)", "generado: nivel 2, semilla 7", etc. */
  pieza: string;
  /** "MIDI" o "teclado de PC". Cambia cómo hay que leer los tiempos. */
  entrada: string;
}

export interface CompasSesion {
  n: number;
  esperadas: number[];
  tocadas: number[];
  faltantes: number[];
  extras: number[];
  /** Instante de cada nota de `tocadas`, en segundos desde el inicio del compás. */
  tiempos: number[];
  /** Instante de cada nota de `esperadas`, en segundos desde el inicio del compás. */
  tiemposEsperados: number[];
}

export interface Sesion {
  fecha: string;
  alumno: string;
  tempo: number;
  compasesOcultos: number;
  compases: CompasSesion[];
  total: { correctas: number; faltantes: number; extras: number };
  // --- contexto: sin esto, dentro de una semana el archivo no se puede leer ---
  pieza: string;
  entrada: string;
  desfasePulsos: number;
  toleranciaPulsos: number;
}

/** "2026-09-21T15:30:00" en hora local (no UTC: es la hora que vio el alumno). */
function fechaLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const aMilisegundos = (segundos: number) => Math.round(segundos * 1000) / 1000;

/**
 * Cuántos compases por delante se ocultan.
 *   desfase  0 → 0: el compás se tapa justo cuando empieza a tocarse.
 *   desfase -4 → 1: se tapa un compás antes (queda 1 compás oculto por delante).
 * Con desfase positivo (se tapa después de tocado) no hay compases ocultos
 * por delante, así que es 0. El valor crudo va aparte en `desfasePulsos`.
 */
function compasesOcultos(desfasePulsos: number, pulsosPorCompas: number): number {
  return Math.max(0, Math.round(-desfasePulsos / pulsosPorCompas));
}

/**
 * Arma el objeto de la sesión. El comparador tiene que estar cerrado
 * (`cerrar()`), si no las notas que nunca llegaron siguen "pendientes".
 */
export function construirSesion(comparador: Comparador, d: DatosSesion, ahora = new Date()): Sesion {
  const segundosPorPulso = 60 / d.tempo;
  const inicioDe = (compas: number) => compas * d.pulsosPorCompas;

  // Cada nota extra se atribuye al compás donde cayó en el tiempo. Si alguien
  // toca durante la cuenta de entrada el pulso es negativo: se atribuye al
  // primer compás (es una nota de más, pero no se pierde del archivo).
  const compasDeExtra = (pulso: number) =>
    Math.min(d.numCompases - 1, Math.max(0, Math.floor(pulso / d.pulsosPorCompas)));

  const compases: CompasSesion[] = [];
  for (let c = 0; c < d.numCompases; c++) {
    const resultados = comparador.resultados
      .filter((r) => r.esperada.compas === c)
      .sort((a, b) => a.esperada.pulso - b.esperada.pulso || a.esperada.midi - b.esperada.midi);

    // Notas tocadas atribuidas a este compás: las que emparejaron con una nota
    // esperada de acá, más las extras que cayeron acá. Ordenadas por tiempo.
    const tocadasDelCompas = [
      ...resultados
        .filter((r) => r.estado === 'correcta' && r.pulsoTocado !== undefined)
        .map((r) => ({ midi: r.esperada.midi, pulso: r.pulsoTocado! })),
      ...comparador.extras.filter((e) => compasDeExtra(e.pulso) === c),
    ].sort((a, b) => a.pulso - b.pulso || a.midi - b.midi);

    compases.push({
      n: c + 1,
      esperadas: resultados.map((r) => r.esperada.midi),
      tocadas: tocadasDelCompas.map((t) => t.midi),
      faltantes: resultados.filter((r) => r.estado !== 'correcta').map((r) => r.esperada.midi),
      extras: comparador.extras.filter((e) => compasDeExtra(e.pulso) === c).sort((a, b) => a.pulso - b.pulso).map((e) => e.midi),
      tiempos: tocadasDelCompas.map((t) => aMilisegundos((t.pulso - inicioDe(c)) * segundosPorPulso)),
      tiemposEsperados: resultados.map((r) => aMilisegundos((r.esperada.pulso - inicioDe(c)) * segundosPorPulso)),
    });
  }

  return {
    fecha: fechaLocal(ahora),
    alumno: d.alumno,
    tempo: d.tempo,
    compasesOcultos: compasesOcultos(d.desfasePulsos, d.pulsosPorCompas),
    compases,
    total: {
      correctas: comparador.resultados.filter((r) => r.estado === 'correcta').length,
      faltantes: comparador.resultados.filter((r) => r.estado !== 'correcta').length,
      extras: comparador.extras.length,
    },
    pieza: d.pieza,
    entrada: d.entrada,
    desfasePulsos: d.desfasePulsos,
    toleranciaPulsos: comparador.toleranciaPulsos,
  };
}

/** `sesion-A1-2026-09-21_15-30-00.json`. Sin ":" porque Windows no lo admite. */
export function nombreArchivo(s: Sesion): string {
  const alumno = (s.alumno || 'sin-nombre').replace(/[^\w.-]+/g, '_');
  return `sesion-${alumno}-${s.fecha.replace('T', '_').replace(/:/g, '-')}.json`;
}

/**
 * JSON indentado, pero con las listas de números en una sola línea. Es JSON
 * válido; la diferencia es que `JSON.stringify(x, null, 2)` pone cada número
 * en su propio renglón y el archivo se vuelve ilegible para una persona.
 */
export function comoTexto(valor: unknown, sangria = ''): string {
  if (Array.isArray(valor)) {
    if (valor.length === 0) return '[]';
    if (valor.every((v) => typeof v === 'number')) return `[${valor.join(', ')}]`;
    const dentro = `${sangria}  `;
    return `[\n${valor.map((v) => dentro + comoTexto(v, dentro)).join(',\n')}\n${sangria}]`;
  }
  if (valor && typeof valor === 'object') {
    const entradas = Object.entries(valor);
    if (entradas.length === 0) return '{}';
    const dentro = `${sangria}  `;
    return `{\n${entradas.map(([k, v]) => `${dentro}${JSON.stringify(k)}: ${comoTexto(v, dentro)}`).join(',\n')}\n${sangria}}`;
  }
  return JSON.stringify(valor);
}

/** Baja el JSON como archivo. Devuelve el nombre usado. */
export function descargarSesion(s: Sesion): string {
  const nombre = nombreArchivo(s);
  const url = URL.createObjectURL(new Blob([comoTexto(s)], { type: 'application/json' }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Liberar el objeto después de que el navegador tomó el archivo.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return nombre;
}
