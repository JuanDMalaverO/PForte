// ============================================================================
// midi.ts — Entrada MIDI con la Web MIDI API (nativa de Chrome/Edge, sin librerías).
//
// Un mensaje MIDI son 3 bytes: [estado, nota, velocidad].
//   estado & 0xF0 === 0x90 → "note on" (tecla presionada)
//   velocidad === 0 en un note on → en la práctica es "note off"
// La nota es el número MIDI: 60 = Do central (C4), 61 = Do#, ... 72 = C5.
//
// Cada evento trae `timeStamp` (mismo reloj que performance.now()). Eso nos
// permite ubicar la nota en el tiempo musical aunque React tarde en pintar.
//
// Este módulo es un pequeño "bus": quien quiera recibir notas se suscribe con
// suscribirNotas(). Así el prototipo (B1) y la medición (B2) comparten el
// mismo teclado sin pisarse.
// ============================================================================

export interface NotaMidi {
  midi: number;
  velocidad: number;
  /** performance.now() en ms en que el navegador recibió el mensaje. */
  tiempoPerfMs: number;
}

export type EscuchaNota = (n: NotaMidi) => void;

const escuchas = new Set<EscuchaNota>();
let acceso: MIDIAccess | null = null;

function emitir(nota: NotaMidi): void {
  for (const fn of escuchas) fn(nota);
}

/** Suscribe una función a todas las notas (MIDI o teclado de prueba). Devuelve el "desuscribir". */
export function suscribirNotas(fn: EscuchaNota): () => void {
  escuchas.add(fn);
  return () => escuchas.delete(fn);
}

/** Pide acceso MIDI (una sola vez) y escucha todas las entradas, presentes y futuras. */
export async function conectarMidi(): Promise<string[]> {
  if (!navigator.requestMIDIAccess) {
    throw new Error('Este navegador no tiene Web MIDI. Usa Chrome o Edge.');
  }
  if (!acceso) {
    acceso = await navigator.requestMIDIAccess();
    acceso.inputs.forEach(escuchar);
    // Si conectan el teclado después de abrir la página, también lo escuchamos.
    acceso.onstatechange = (ev) => {
      const puerto = (ev as MIDIConnectionEvent).port;
      if (puerto && puerto.type === 'input' && puerto.state === 'connected') {
        escuchar(puerto as MIDIInput);
      }
    };
  }
  const nombres: string[] = [];
  acceso.inputs.forEach((e) => nombres.push(e.name ?? 'entrada sin nombre'));
  return nombres;
}

function escuchar(entrada: MIDIInput): void {
  entrada.onmidimessage = (ev: MIDIMessageEvent) => {
    const datos = ev.data;
    if (!datos || datos.length < 3) return;
    const tipo = datos[0] & 0xf0;
    const nota = datos[1];
    const velocidad = datos[2];
    if (tipo === 0x90 && velocidad > 0) {
      emitir({ midi: nota, velocidad, tiempoPerfMs: ev.timeStamp });
    }
  };
}

// ----------------------------------------------------------------------------
// Modo de prueba SIN teclado MIDI: el teclado de la computadora simula notas.
// Fila "a s d f g h j k" = C4 D4 E4 F4 G4 A4 B4 C5.
// Fila "z x c v b n m"   = C3 D3 E3 F3 G3 A3 B3.
// Fila "q w e r"         = F2 G2 A2 B2.
// Solo sirve para probar el flujo sin hardware; no es parte del producto.
// ----------------------------------------------------------------------------
const TECLAS: Record<string, number> = {
  a: 60, s: 62, d: 64, f: 65, g: 67, h: 69, j: 71, k: 72,
  z: 48, x: 50, c: 52, v: 53, b: 55, n: 57, m: 59,
  q: 41, w: 43, e: 45, r: 47,
};

export function activarTecladoDePrueba(): () => void {
  const presionadas = new Set<string>();
  const abajo = (ev: KeyboardEvent) => {
    const etiqueta = (ev.target as HTMLElement | null)?.tagName;
    if (etiqueta === 'INPUT' || etiqueta === 'TEXTAREA' || etiqueta === 'SELECT') return;
    const midi = TECLAS[ev.key.toLowerCase()];
    if (midi === undefined || presionadas.has(ev.key)) return;
    presionadas.add(ev.key);
    emitir({ midi, velocidad: 100, tiempoPerfMs: ev.timeStamp });
  };
  const arriba = (ev: KeyboardEvent) => presionadas.delete(ev.key);
  window.addEventListener('keydown', abajo);
  window.addEventListener('keyup', arriba);
  return () => {
    window.removeEventListener('keydown', abajo);
    window.removeEventListener('keyup', arriba);
  };
}

/** 60 → "C4", 61 → "C#4" (solo para mostrar en pantalla). */
export function nombreNota(midi: number): string {
  const nombres = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return nombres[midi % 12] + (Math.floor(midi / 12) - 1);
}

/** "C4 E4 G4" → [60, 64, 67]. Acepta # y b. Ignora lo que no entiende. */
export function leerNotas(texto: string): number[] {
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const salida: number[] = [];
  for (const parte of texto.trim().split(/[\s,]+/)) {
    const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(parte);
    if (!m) continue;
    const alteracion = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    salida.push((Number(m[3]) + 1) * 12 + base[m[1].toUpperCase()] + alteracion);
  }
  return salida;
}
