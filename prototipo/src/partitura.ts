// ============================================================================
// partitura.ts — Envuelve OpenSheetMusicDisplay (OSMD) para tres cosas:
//
//   1. cargar(): renderizar un MusicXML dentro de un <div>.
//   2. notasEsperadas(): recorrer el modelo de datos de OSMD y sacar la lista
//      plana de notas {midi, pulso, compás} que el comparador necesita.
//   3. ocultarCompas(i): tapar un compás. OSMD no tiene "esconder compás",
//      así que ponemos un <div> blanco encima usando las coordenadas que OSMD
//      calculó para ese compás (GraphicSheet.MeasureList).
//
// Unidades de OSMD: 1 unidad = 10 píxeles a zoom 1.0 (el espacio entre dos
// líneas del pentagrama es 1 unidad).
// ============================================================================

import { OpenSheetMusicDisplay, type GraphicalMeasure } from 'opensheetmusicdisplay';
import type { NotaEsperada } from './comparador';

const PIXELES_POR_UNIDAD = 10;

export class Partitura {
  readonly numCompases: number;
  private readonly tapas = new Map<number, HTMLDivElement>();
  private readonly contenedor: HTMLElement;
  private readonly osmd: OpenSheetMusicDisplay;

  private constructor(contenedor: HTMLElement, osmd: OpenSheetMusicDisplay) {
    this.contenedor = contenedor;
    this.osmd = osmd;
    this.numCompases = osmd.Sheet.SourceMeasures.length;
  }

  /** `musicXml`: texto MusicXML, o un Blob si es un .mxl comprimido (OSMD lo descomprime). */
  static async cargar(contenedor: HTMLElement, musicXml: string | Blob): Promise<Partitura> {
    // OSMD dibuja dentro de un <div> hijo propio. Si se llama dos veces seguidas
    // (React en modo estricto lo hace), la segunda llamada reemplaza al hijo y
    // la primera termina dibujando en un div que ya no está en la página.
    const hijo = document.createElement('div');
    contenedor.replaceChildren(hijo);
    const osmd = new OpenSheetMusicDisplay(hijo, {
      backend: 'svg',
      autoResize: false,
      drawTitle: true,
      drawPartNames: false,
      drawMeasureNumbers: true,
    });
    await osmd.load(musicXml);
    osmd.render();
    return new Partitura(contenedor, osmd);
  }

  /** Lista plana de notas de la partitura, ordenada por tiempo. */
  notasEsperadas(): NotaEsperada[] {
    const notas: NotaEsperada[] = [];
    this.osmd.Sheet.SourceMeasures.forEach((compas, indiceCompas) => {
      for (const columna of compas.VerticalSourceStaffEntryContainers) {
        // Un "container" es una columna vertical de tiempo: todo lo que suena
        // en ese instante en todos los pentagramas.
        const pulso = columna.getAbsoluteTimestamp().RealValue * 4; // RealValue: 1 = redonda
        for (const entrada of columna.StaffEntries) {
          if (!entrada) continue;
          for (const voz of entrada.VoiceEntries) {
            if (voz.IsGrace) continue;
            for (const nota of voz.Notes) {
              if (nota.isRest()) continue;
              // Nota ligada a la anterior: no se vuelve a tocar, no cuenta.
              if (nota.NoteTie && nota.NoteTie.StartNote !== nota) continue;
              notas.push({
                // OSMD guarda "halfTone" con C4 = 48; MIDI usa C4 = 60.
                midi: nota.Pitch.getHalfTone() + 12,
                pulso,
                duracionPulsos: nota.Length.RealValue * 4,
                compas: indiceCompas,
              });
            }
          }
        }
      }
    });
    return notas.sort((a, b) => a.pulso - b.pulso || a.midi - b.midi);
  }

  /** Tapa el compás `indice` (0-based) con un rectángulo blanco. */
  ocultarCompas(indice: number): void {
    if (this.tapas.has(indice)) return;
    const porPentagrama = this.osmd.GraphicSheet.MeasureList[indice];
    if (!porPentagrama) return;

    // Ancho: el compás en todos los pentagramas.
    let x0 = Infinity, x1 = -Infinity;
    for (const medida of porPentagrama) {
      if (!medida) continue;
      const pos = medida.PositionAndShape.AbsolutePosition;
      const tam = medida.PositionAndShape.Size;
      // beginInstructionsWidth = ancho de clave + armadura + compás al inicio
      // del sistema. No lo tapamos para que la clave siga visible.
      x0 = Math.min(x0, pos.x + (medida.beginInstructionsWidth ?? 0));
      x1 = Math.max(x1, pos.x + tam.width);
    }
    if (!isFinite(x0)) return;
    // La caja de un compás termina antes de la barra que lo cierra. Sin este
    // pedacito, entre tapa y tapa queda un hilo de pentagrama a la vista.
    x1 += 0.6;

    // Alto: el del SISTEMA entero (el renglón de música), no el de cada compás.
    // La caja de un compás depende de sus notas, así que si cada tapa usa la
    // suya quedan a distinta altura y la fila se ve dentada.
    const { y0, y1, margen } = this.altoDelSistema(porPentagrama);

    const escala = PIXELES_POR_UNIDAD * this.osmd.zoom;
    const tapa = document.createElement('div');
    tapa.className = 'tapa';
    tapa.dataset.compas = String(indice);
    tapa.style.left = `${x0 * escala}px`;
    tapa.style.top = `${(y0 - margen) * escala}px`;
    tapa.style.width = `${(x1 - x0) * escala}px`;
    tapa.style.height = `${(y1 - y0 + 2 * margen) * escala}px`;
    this.contenedor.appendChild(tapa);
    this.tapas.set(indice, tapa);
  }

  /**
   * Extensión vertical de la tapa, en unidades de OSMD. Se toma del sistema
   * (el renglón completo, con sus dos pentagramas) para que todas las tapas
   * del mismo renglón queden alineadas. Si por lo que sea no hay sistema, se
   * cae a la caja de cada compás con un margen a ojo para plicas y líneas
   * adicionales.
   */
  private altoDelSistema(porPentagrama: GraphicalMeasure[]): { y0: number; y1: number; margen: number } {
    // Las cajas de los pentagramas (las cinco líneas) son iguales en todo el
    // renglón, a diferencia de las de cada compás. El margen cubre lo que se
    // dibuja fuera del pentagrama: plicas, líneas adicionales y el número de
    // compás. La del sistema entero sobra por abajo, por eso no se usa.
    const lineas = porPentagrama.map((m) => m?.ParentStaffLine).filter(Boolean);
    if (lineas.length > 0) {
      const arriba = Math.min(...lineas.map((l) => l.PositionAndShape.AbsolutePosition.y));
      const abajo = Math.max(...lineas.map((l) => l.PositionAndShape.AbsolutePosition.y + l.PositionAndShape.Size.height));
      return { y0: arriba, y1: abajo, margen: 2.5 };
    }
    let y0 = Infinity, y1 = -Infinity;
    for (const medida of porPentagrama) {
      if (!medida) continue;
      y0 = Math.min(y0, medida.PositionAndShape.AbsolutePosition.y);
      y1 = Math.max(y1, medida.PositionAndShape.AbsolutePosition.y + medida.PositionAndShape.Size.height);
    }
    return { y0, y1, margen: 3 };
  }

  mostrarTodo(): void {
    for (const tapa of this.tapas.values()) tapa.remove();
    this.tapas.clear();
  }

  get compasesOcultos(): number[] {
    return [...this.tapas.keys()].sort((a, b) => a - b);
  }
}
