// ============================================================================
// generador.ts — Generación algorítmica de ejercicios (ruta 2 de B3).
//
// Idea: para entrenar lectura a primera vista no hace falta repertorio
// bonito; hace falta DIFICULTAD CONTROLADA. Este módulo produce un MusicXML
// de N compases a partir de parámetros explícitos (tonalidad, figuras
// permitidas, salto máximo, ámbito, patrón de mano izquierda) y una semilla
// para que el mismo ejercicio se pueda regenerar.
//
// Devuelve también la lista de notas que escribió: así podemos comprobar que
// partitura.ts (que lee el MusicXML con OSMD) extrae exactamente las mismas.
// ============================================================================

import type { NotaEsperada } from './comparador';

export type Tonalidad = 'C' | 'G' | 'F';
export type Figura = 1 | 2 | 4; // duración en pulsos (negra, blanca, redonda)

export interface ParametrosEjercicio {
  compases: number;
  tonalidad: Tonalidad;
  /** Figuras permitidas en la mano derecha. */
  figurasDerecha: Figura[];
  /** Salto máximo entre notas consecutivas, en grados de la escala (1 = grado conjunto). */
  saltoMaximo: number;
  /** Ámbito de la mano derecha en números MIDI [mínimo, máximo]. */
  ambitoDerecha: [number, number];
  manoIzquierda: 'ninguna' | 'redondas' | 'blancas' | 'acordes';
  semilla: number;
}

export const NIVELES: Record<string, Omit<ParametrosEjercicio, 'semilla'>> = {
  'Nivel 1: grados conjuntos, solo mano derecha': {
    compases: 8, tonalidad: 'C', figurasDerecha: [1, 2, 4], saltoMaximo: 1,
    ambitoDerecha: [60, 67], manoIzquierda: 'ninguna',
  },
  'Nivel 2: saltos de tercera, izquierda en redondas': {
    compases: 8, tonalidad: 'G', figurasDerecha: [1, 2], saltoMaximo: 2,
    ambitoDerecha: [60, 72], manoIzquierda: 'redondas',
  },
  'Nivel 3: saltos hasta quinta, izquierda con acordes': {
    compases: 8, tonalidad: 'F', figurasDerecha: [1, 2], saltoMaximo: 4,
    ambitoDerecha: [57, 74], manoIzquierda: 'acordes',
  },
};

// --- música ----------------------------------------------------------------

const ESCALA_MAYOR = [0, 2, 4, 5, 7, 9, 11]; // semitonos desde la tónica
const TONICA_PC: Record<Tonalidad, number> = { C: 0, G: 7, F: 5 };
const FIFTHS: Record<Tonalidad, number> = { C: 0, G: 1, F: -1 };
// Grados de la progresión de bajos, por compás: I IV V I I IV V I
const PROGRESION = [0, 3, 4, 0, 0, 3, 4, 0];

/** Todas las notas de la escala mayor dentro del ámbito, como MIDI ordenado. */
function notasEscala(tonalidad: Tonalidad, [min, max]: [number, number]): number[] {
  const salida: number[] = [];
  for (let m = min; m <= max; m++) {
    const grado = (((m - TONICA_PC[tonalidad]) % 12) + 12) % 12;
    if (ESCALA_MAYOR.includes(grado)) salida.push(m);
  }
  return salida;
}

/** Generador pseudoaleatorio con semilla (mulberry32): mismo número → mismo ejercicio. */
function crearAzar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- MusicXML --------------------------------------------------------------

type Alteracion = 0 | 1 | -1;
const CON_SOSTENIDOS: [string, Alteracion][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const CON_BEMOLES: [string, Alteracion][] = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
const TIPO: Record<Figura, string> = { 1: 'quarter', 2: 'half', 4: 'whole' };

function pitchXml(midi: number, tonalidad: Tonalidad): string {
  const [paso, alter] = (tonalidad === 'F' ? CON_BEMOLES : CON_SOSTENIDOS)[midi % 12];
  const octava = Math.floor(midi / 12) - 1;
  return `<pitch><step>${paso}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octava}</octave></pitch>`;
}

function notaXml(midi: number, figura: Figura, pentagrama: 1 | 2, tonalidad: Tonalidad, acorde = false): string {
  return `<note>${acorde ? '<chord/>' : ''}${pitchXml(midi, tonalidad)}<duration>${figura * 4}</duration>` +
    `<voice>${pentagrama}</voice><type>${TIPO[figura]}</type><staff>${pentagrama}</staff></note>`;
}

export interface Ejercicio {
  musicXml: string;
  notas: NotaEsperada[];
  parametros: ParametrosEjercicio;
}

export function generarEjercicio(p: ParametrosEjercicio): Ejercicio {
  const azar = crearAzar(p.semilla);
  const escala = notasEscala(p.tonalidad, p.ambitoDerecha);
  const notas: NotaEsperada[] = [];
  const compasesXml: string[] = [];
  let indice = Math.floor(escala.length / 2); // arranca en el medio del ámbito

  for (let c = 0; c < p.compases; c++) {
    const ultimo = c === p.compases - 1;
    let xml = '';
    let pulso = 0;

    // Mano derecha: rellena 4 pulsos con figuras permitidas, camino aleatorio
    // por la escala con salto acotado.
    while (pulso < 4) {
      const posibles = p.figurasDerecha.filter((f) => pulso + f <= 4);
      let figura = posibles[Math.floor(azar() * posibles.length)] ?? 1;
      if (ultimo && pulso === 0 && p.figurasDerecha.includes(4)) figura = 4; // final largo
      if (!(c === 0 && pulso === 0)) {
        const salto = Math.floor(azar() * (2 * p.saltoMaximo + 1)) - p.saltoMaximo;
        indice = Math.max(0, Math.min(escala.length - 1, indice + salto));
      }
      if (ultimo && pulso + figura >= 4) indice = indiceTonicaCercana(escala, indice, p.tonalidad);
      const midi = escala[indice];
      xml += notaXml(midi, figura, 1, p.tonalidad);
      notas.push({ midi, pulso: c * 4 + pulso, duracionPulsos: figura, compas: c });
      pulso += figura;
    }

    // Mano izquierda: bajo de la progresión I-IV-V-I, en la octava C3..B3.
    if (p.manoIzquierda !== 'ninguna') {
      xml += '<backup><duration>16</duration></backup>';
      const bajo = 48 + ((TONICA_PC[p.tonalidad] + ESCALA_MAYOR[PROGRESION[c % PROGRESION.length]]) % 12);
      const agregar = (midi: number, figura: Figura, enPulso: number, acorde = false) => {
        xml += notaXml(midi, figura, 2, p.tonalidad, acorde);
        notas.push({ midi, pulso: c * 4 + enPulso, duracionPulsos: figura, compas: c });
      };
      if (p.manoIzquierda === 'redondas') {
        agregar(bajo, 4, 0);
      } else if (p.manoIzquierda === 'blancas') {
        agregar(bajo, 2, 0);
        agregar(bajo + 7, 2, 2); // quinta
      } else {
        agregar(bajo, 4, 0);
        agregar(bajo + 4, 4, 0, true); // tercera mayor (I, IV y V son mayores)
        agregar(bajo + 7, 4, 0, true); // quinta
      }
    }
    compasesXml.push(xml);
  }

  const atributos = `<attributes><divisions>4</divisions><key><fifths>${FIFTHS[p.tonalidad]}</fifths></key>` +
    `<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>` +
    `<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`;

  const musicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Ejercicio generado (semilla ${p.semilla})</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
${compasesXml.map((c, i) => `    <measure number="${i + 1}">${i === 0 ? atributos : ''}${c}</measure>`).join('\n')}
  </part>
</score-partwise>`;

  notas.sort((a, b) => a.pulso - b.pulso || a.midi - b.midi);
  return { musicXml, notas, parametros: p };
}

function indiceTonicaCercana(escala: number[], desde: number, tonalidad: Tonalidad): number {
  let mejor = desde;
  let mejorDist = Infinity;
  escala.forEach((midi, i) => {
    if ((midi - TONICA_PC[tonalidad]) % 12 === 0 && Math.abs(i - desde) < mejorDist) {
      mejor = i;
      mejorDist = Math.abs(i - desde);
    }
  });
  return mejor;
}

// --- métrica de dificultad -------------------------------------------------
// Sirve para comparar rutas de contenido con números: un ejercicio generado
// tiene dificultad predecible; un fragmento de repertorio, no.

export interface Dificultad {
  notasPorCompas: number;
  saltoMedioSemitonos: number;
  ambitoSemitonos: number;
  figurasDistintas: number;
  notasSimultaneasMax: number;
}

export function medirDificultad(notas: NotaEsperada[], numCompases: number): Dificultad {
  if (notas.length === 0) {
    return { notasPorCompas: 0, saltoMedioSemitonos: 0, ambitoSemitonos: 0, figurasDistintas: 0, notasSimultaneasMax: 0 };
  }
  const porPulso = new Map<number, number[]>();
  for (const n of notas) porPulso.set(n.pulso, [...(porPulso.get(n.pulso) ?? []), n.midi]);
  // Salto: entre la nota más aguda de cada instante y la del siguiente (aprox. la melodía).
  const agudas = [...porPulso.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => Math.max(...m));
  let sumaSaltos = 0;
  for (let i = 1; i < agudas.length; i++) sumaSaltos += Math.abs(agudas[i] - agudas[i - 1]);
  const midis = notas.map((n) => n.midi);
  return {
    notasPorCompas: Math.round((notas.length / numCompases) * 10) / 10,
    saltoMedioSemitonos: agudas.length > 1 ? Math.round((sumaSaltos / (agudas.length - 1)) * 10) / 10 : 0,
    ambitoSemitonos: Math.max(...midis) - Math.min(...midis),
    figurasDistintas: new Set(notas.map((n) => n.duracionPulsos)).size,
    notasSimultaneasMax: Math.max(...[...porPulso.values()].map((v) => v.length)),
  };
}
