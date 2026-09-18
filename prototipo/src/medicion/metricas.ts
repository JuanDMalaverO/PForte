// ============================================================================
// metricas.ts — Cómo contamos "acierto" y "latencia" en B2. Sin magia:
//
//   Por acorde: comparamos el CONJUNTO de notas esperadas con el CONJUNTO
//   detectado (sin importar el orden ni la duración).
//     aciertos  = esperadas que sí se detectaron
//     faltantes = esperadas que NO se detectaron
//     extras    = detectadas que NO estaban en el acorde
//     exacto    = faltantes == 0 y extras == 0
//
//   Totales:
//     recall    = aciertos / esperadas   ("¿cuántas de las notas reales vio?")
//     precisión = aciertos / detectadas  ("¿cuántas de las que dijo eran reales?")
//     % acordes exactos = acordes sin ningún error / acordes
//
//   Latencia: se mide en el modo continuo (ver Medicion.tsx).
//     Reportamos mediana y percentil 90 porque el promedio esconde picos.
// ============================================================================

import { ACORDES_PRUEBA, agregarRuido, sintetizarAcorde } from './sintetizador';
import { analizarClip, type Motor } from './motores';

export interface ComparacionAcorde {
  esperadas: number[];
  detectadas: number[];
  aciertos: number[];
  faltantes: number[];
  extras: number[];
  exacto: boolean;
}

export function compararAcorde(esperadas: number[], detectadas: number[]): ComparacionAcorde {
  const e = [...new Set(esperadas)].sort((a, b) => a - b);
  const d = [...new Set(detectadas)].sort((a, b) => a - b);
  const aciertos = e.filter((m) => d.includes(m));
  const faltantes = e.filter((m) => !d.includes(m));
  const extras = d.filter((m) => !e.includes(m));
  return { esperadas: e, detectadas: d, aciertos, faltantes, extras, exacto: faltantes.length === 0 && extras.length === 0 };
}

export interface Totales {
  acordes: number;
  acordesExactos: number;
  porcentajeExactos: number;
  notasEsperadas: number;
  notasDetectadas: number;
  aciertos: number;
  recall: number;
  precision: number;
  msProcesoMedio: number;
}

export function totalizar(filas: { comparacion: ComparacionAcorde; msProceso: number }[]): Totales {
  const acordes = filas.length;
  const notasEsperadas = filas.reduce((s, f) => s + f.comparacion.esperadas.length, 0);
  const notasDetectadas = filas.reduce((s, f) => s + f.comparacion.detectadas.length, 0);
  const aciertos = filas.reduce((s, f) => s + f.comparacion.aciertos.length, 0);
  const acordesExactos = filas.filter((f) => f.comparacion.exacto).length;
  const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);
  return {
    acordes,
    acordesExactos,
    porcentajeExactos: pct(acordesExactos, acordes),
    notasEsperadas,
    notasDetectadas,
    aciertos,
    recall: pct(aciertos, notasEsperadas),
    precision: pct(aciertos, notasDetectadas),
    msProcesoMedio: acordes === 0 ? 0 : Math.round(filas.reduce((s, f) => s + f.msProceso, 0) / acordes),
  };
}

export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const i = Math.min(orden.length - 1, Math.floor((p / 100) * orden.length));
  return Math.round(orden[i]);
}

// --- alineamiento --------------------------------------------------------------

/** Parecido entre dos conjuntos de notas (Jaccard): 1 = iguales, 0 = nada en común. */
export function parecido(a: number[], b: number[]): number {
  const A = new Set(a);
  const B = new Set(b);
  const comunes = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : comunes / union;
}

/**
 * Empareja ataques detectados con acordes esperados respetando el orden pero
 * tolerando ataques de más (golpes repetidos, notas sueltas) y de menos
 * (acordes no tocados). Programación dinámica clásica (como alinear dos
 * secuencias): se maximiza la suma de parecidos; un par con parecido menor
 * que `minimo` no cuenta como emparejado.
 * Devuelve, para cada esperado j, el índice del ataque emparejado o null.
 */
export function alinear(similitud: number[][], numEsperados: number, minimo = 0.15): (number | null)[] {
  const K = similitud.length;
  const J = numEsperados;
  const dp: number[][] = Array.from({ length: K + 1 }, () => new Array<number>(J + 1).fill(0));
  for (let k = 1; k <= K; k++) {
    for (let j = 1; j <= J; j++) {
      const s = similitud[k - 1][j - 1];
      dp[k][j] = Math.max(dp[k - 1][j], dp[k][j - 1], dp[k - 1][j - 1] + (s >= minimo ? s : 0));
    }
  }
  const salida: (number | null)[] = new Array(J).fill(null);
  let k = K;
  let j = J;
  while (k > 0 && j > 0) {
    const s = similitud[k - 1][j - 1];
    if (s >= minimo && dp[k][j] === dp[k - 1][j - 1] + s) {
      salida[j - 1] = k - 1;
      k--;
      j--;
    } else if (dp[k][j] === dp[k - 1][j]) {
      k--;
    } else {
      j--;
    }
  }
  return salida;
}

// --- prueba sintética ---------------------------------------------------------

export interface FilaSintetica {
  nombre: string;
  comparacion: ComparacionAcorde;
  msProceso: number;
  detalle: string;
}

export interface ResultadoSintetico {
  motor: string;
  conRuido: boolean;
  filas: FilaSintetica[];
  totales: Totales;
}

/**
 * Pasa los 20 acordes sintéticos (más un clip de puro silencio/ruido) por el
 * motor, uno por uno (1.5 s cada uno, igual que el protocolo con piano real)
 * y devuelve la tabla y los totales.
 */
export async function correrPruebaSintetica(
  motor: Motor,
  conRuido: boolean,
  alAvanzar?: (hechos: number, total: number) => void,
): Promise<ResultadoSintetico> {
  const casos = [...ACORDES_PRUEBA, { nombre: 'silencio (solo piso de ruido)', midis: [] as number[] }];
  const filas: FilaSintetica[] = [];
  for (const [i, caso] of casos.entries()) {
    let audio = caso.midis.length ? sintetizarAcorde(caso.midis, 1.5, motor.tasa) : new Float32Array(Math.floor(1.5 * motor.tasa));
    if (conRuido) audio = agregarRuido(audio);
    const r = await analizarClip(motor, audio, null, 10, caso.midis);
    filas.push({
      nombre: caso.nombre,
      comparacion: compararAcorde(caso.midis, r.notas.map((n) => n.midi)),
      msProceso: r.msProceso,
      detalle: r.detalle,
    });
    alAvanzar?.(i + 1, casos.length);
  }
  return { motor: motor.nombre, conRuido, filas, totales: totalizar(filas) };
}
