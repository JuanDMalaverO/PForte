// ============================================================================
// pieza.ts — LA pieza hardcodeada del prototipo (B1).
//
// Es un MusicXML: 8 compases en Do mayor, 4/4, dos pentagramas
// (mano derecha en clave de sol, mano izquierda en clave de fa).
//
// Cómo leer MusicXML en 30 segundos:
//   <divisions>4</divisions>  → una negra vale 4 unidades de <duration>.
//                               negra = 4, blanca = 8, redonda = 16.
//   <staff>1</staff>          → pentagrama de arriba (mano derecha).
//   <staff>2</staff>          → pentagrama de abajo (mano izquierda).
//   <backup>                  → "retrocede" el tiempo para escribir el otro
//                               pentagrama del mismo compás.
//   <chord/>                  → esta nota suena junto con la anterior.
// ============================================================================

export const TEMPO_BPM = 80;

// Ayudantes mínimos para no repetir 40 veces el mismo XML. Cada uno devuelve
// un <note> completo. No hay lógica: son plantillas de texto.
const nota = (paso: string, octava: number, duracion: number, tipo: string, pentagrama: 1 | 2, acorde = false) =>
  `<note>${acorde ? '<chord/>' : ''}<pitch><step>${paso}</step><octave>${octava}</octave></pitch>` +
  `<duration>${duracion}</duration><voice>${pentagrama}</voice><type>${tipo}</type><staff>${pentagrama}</staff></note>`;

const negra = (p: string, o: number, s: 1 | 2, ac = false) => nota(p, o, 4, 'quarter', s, ac);
const blanca = (p: string, o: number, s: 1 | 2, ac = false) => nota(p, o, 8, 'half', s, ac);
const redonda = (p: string, o: number, s: 1 | 2, ac = false) => nota(p, o, 16, 'whole', s, ac);

// Separa mano derecha (staff 1) de mano izquierda (staff 2) dentro de un compás.
const MANO_IZQ = '<backup><duration>16</duration></backup>';

const compases: string[] = [
  // 1
  negra('C', 4, 1) + negra('D', 4, 1) + negra('E', 4, 1) + negra('F', 4, 1) +
    MANO_IZQ + redonda('C', 3, 2),
  // 2
  blanca('G', 4, 1) + blanca('E', 4, 1) +
    MANO_IZQ + redonda('C', 3, 2) + redonda('E', 3, 2, true) + redonda('G', 3, 2, true),
  // 3
  negra('F', 4, 1) + negra('E', 4, 1) + negra('D', 4, 1) + negra('C', 4, 1) +
    MANO_IZQ + blanca('F', 2, 2) + blanca('G', 2, 2),
  // 4
  blanca('D', 4, 1) + blanca('G', 4, 1) +
    MANO_IZQ + redonda('G', 2, 2) + redonda('B', 2, 2, true) + redonda('D', 3, 2, true),
  // 5
  negra('E', 4, 1) + negra('F', 4, 1) + negra('G', 4, 1) + negra('A', 4, 1) +
    MANO_IZQ + redonda('C', 3, 2),
  // 6
  blanca('G', 4, 1) + blanca('C', 5, 1) +
    MANO_IZQ + blanca('E', 3, 2) + blanca('G', 3, 2),
  // 7
  negra('B', 4, 1) + negra('A', 4, 1) + negra('G', 4, 1) + negra('F', 4, 1) +
    MANO_IZQ + redonda('G', 2, 2) + redonda('D', 3, 2, true),
  // 8
  blanca('E', 4, 1) + blanca('C', 4, 1) + blanca('E', 4, 1, true) + blanca('G', 4, 1, true) +
    MANO_IZQ + redonda('C', 3, 2) + redonda('G', 3, 2, true),
];

// Cabecera del primer compás: divisiones, tonalidad (0 alteraciones = Do mayor),
// compás 4/4, dos pentagramas con sus claves y el tempo.
const ATRIBUTOS = `
  <attributes>
    <divisions>4</divisions>
    <key><fifths>0</fifths></key>
    <time><beats>4</beats><beat-type>4</beat-type></time>
    <staves>2</staves>
    <clef number="1"><sign>G</sign><line>2</line></clef>
    <clef number="2"><sign>F</sign><line>4</line></clef>
  </attributes>
  <direction placement="above">
    <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${TEMPO_BPM}</per-minute></metronome></direction-type>
    <sound tempo="${TEMPO_BPM}"/>
  </direction>`;

export const PIEZA_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>Ejercicio 1 - 8 compases</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
${compases.map((c, i) => `    <measure number="${i + 1}">${i === 0 ? ATRIBUTOS : ''}${c}</measure>`).join('\n')}
  </part>
</score-partwise>`;

// Cantidad de notas de la pieza (sirve como comprobación: partitura.ts debe
// extraer exactamente este número). Contadas a mano: 5+5+6+5+5+4+6+6.
export const PIEZA_TOTAL_NOTAS = 42;
