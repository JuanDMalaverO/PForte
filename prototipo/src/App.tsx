// ============================================================================
// App.tsx — La pantalla. Une los módulos; no contiene lógica musical propia.
//
//   pieza.ts      → el MusicXML fijo
//   generador.ts  → MusicXML generado (ruta 2 de B3)
//   partitura.ts  → OSMD: dibuja, extrae notas, oculta compases
//   metronomo.ts  → click con Web Audio + reloj musical (pulsos)
//   midi.ts       → notas del teclado (Web MIDI o teclado de PC de prueba)
//   comparador.ts → nota tocada vs nota esperada
//   sesion.ts     → al terminar, arma el JSON de la sesión y lo baja
//   medicion/     → pantalla B2 (basic-pitch)
//
// Flujo de una sesión:
//   Iniciar → metrónomo cuenta 1 compás → en cada pulso:
//     (a) se ocultan los compases que ya "tocan" según el desfase elegido,
//     (b) el comparador marca como fallidas las notas cuyo momento pasó.
//   Cada nota MIDI → se convierte a pulso (con decimales) → comparador.
//   Al terminar → resumen por compás y total, y se baja el JSON de la sesión.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Partitura } from './partitura';
import { Metronomo, type Pulso } from './metronomo';
import { activarTecladoDePrueba, conectarMidi, nombreNota, suscribirNotas, type NotaMidi } from './midi';
import { Comparador, type NotaEsperada, type Resumen } from './comparador';
import { PIEZA_MUSICXML, PIEZA_TOTAL_NOTAS, TEMPO_BPM } from './pieza';
import { NIVELES, generarEjercicio, medirDificultad } from './generador';
import { construirSesion, descargarSesion, type Sesion } from './sesion';
import Medicion from './medicion/Medicion';

export default function App() {
  const [vista, setVista] = useState<'prototipo' | 'medicion'>('prototipo');
  return (
    <div>
      <header className="encabezado">
        <h1>PForte</h1>
        <span className="subtitulo">lectura a primera vista · prototipo</span>
        <nav className="pestanas">
          <button onClick={() => setVista('prototipo')} disabled={vista === 'prototipo'}>B1 · Prototipo</button>
          <button id="btn-vista-medicion" onClick={() => setVista('medicion')} disabled={vista === 'medicion'}>B2 · Medición por micrófono</button>
        </nav>
      </header>
      {vista === 'prototipo' ? <Prototipo /> : <Medicion />}
    </div>
  );
}

type Estado = 'cargando' | 'listo' | 'tocando' | 'terminado';

interface Fuente {
  nombre: string;
  /** Texto MusicXML, o un Blob si es un .mxl comprimido. */
  musicXml: string | Blob;
  /** Si la pieza fue generada, las notas que el generador dice haber escrito. */
  notasGeneradas?: NotaEsperada[];
}

function Prototipo() {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const partituraRef = useRef<Partitura | null>(null);
  const metronomoRef = useRef<Metronomo | null>(null);
  const comparadorRef = useRef<Comparador | null>(null);
  const tocandoRef = useRef(false);

  const [fuente, setFuente] = useState<Fuente>({ nombre: 'pieza fija (pieza.ts)', musicXml: PIEZA_MUSICXML });
  const [notasEsperadas, setNotasEsperadas] = useState<NotaEsperada[]>([]);
  const [chequeo, setChequeo] = useState('');
  const [estado, setEstado] = useState<Estado>('cargando');
  const [bpm, setBpm] = useState(TEMPO_BPM);
  const [desfase, setDesfase] = useState(0);
  const [midiEstado, setMidiEstado] = useState('sin conectar');
  const [tecladoPrueba, setTecladoPrueba] = useState(false);
  const [pulso, setPulso] = useState<Pulso | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [porCompas, setPorCompas] = useState<Resumen[]>([]);
  const [registro, setRegistro] = useState<{ texto: string; clase: string }[]>([]);
  const [desvio, setDesvio] = useState<{ media: number; max: number; n: number } | null>(null);
  const [nivel, setNivel] = useState(Object.keys(NIVELES)[0]);
  const [semilla, setSemilla] = useState(1);
  const [alumno, setAlumno] = useState('A1');
  // Última sesión guardada: sirve para volver a bajarla si el navegador
  // bloqueó la descarga automática.
  const [guardado, setGuardado] = useState<{ sesion: Sesion; nombre: string } | null>(null);

  // Cargar (o recargar) la partitura cuando cambia la fuente.
  useEffect(() => {
    let cancelado = false;
    setEstado('cargando');
    Partitura.cargar(contenedorRef.current!, fuente.musicXml).then((p) => {
      if (cancelado) return;
      partituraRef.current = p;
      const notas = p.notasEsperadas();
      setNotasEsperadas(notas);
      // Comprobación cruzada: lo que OSMD leyó vs lo que sabemos que escribimos.
      if (fuente.notasGeneradas) {
        const iguales = JSON.stringify(notas) === JSON.stringify(fuente.notasGeneradas);
        setChequeo(iguales
          ? `OK: OSMD extrajo las mismas ${notas.length} notas que escribió el generador`
          : `ERROR: OSMD extrajo ${notas.length} notas; el generador escribió ${fuente.notasGeneradas.length}`);
      } else if (fuente.musicXml === PIEZA_MUSICXML) {
        setChequeo(notas.length === PIEZA_TOTAL_NOTAS
          ? `OK: ${notas.length} notas extraídas de la partitura (esperadas ${PIEZA_TOTAL_NOTAS})`
          : `ERROR: ${notas.length} notas extraídas, esperadas ${PIEZA_TOTAL_NOTAS}`);
      } else {
        setChequeo(`cargado: ${p.numCompases} compases, ${notas.length} notas extraídas`);
      }
      setResumen(null); setPorCompas([]); setRegistro([]); setPulso(null); setDesvio(null);
      setEstado('listo');
    });
    return () => { cancelado = true; };
  }, [fuente]);

  const actualizarTablas = useCallback(() => {
    const c = comparadorRef.current;
    const p = partituraRef.current;
    if (!c || !p) return;
    setResumen(c.resumen());
    setPorCompas(c.porCompas(p.numCompases));
  }, []);

  const agregarFila = (texto: string, clase: string) =>
    setRegistro((r) => [{ texto, clase }, ...r].slice(0, 60));

  // Cada nota (MIDI real o teclado de prueba) pasa por acá.
  const alTocarNota = useCallback((n: NotaMidi) => {
    const m = metronomoRef.current;
    const c = comparadorRef.current;
    if (!m || !c || !tocandoRef.current) {
      agregarFila(`${nombreNota(n.midi)} (fuera del ejercicio)`, '');
      return;
    }
    const pulsoTocado = m.tiempoAPulso(m.tiempoPerfATiempoAudio(n.tiempoPerfMs));
    const r = c.registrar({ midi: n.midi, pulso: pulsoTocado });
    if (r) {
      const desvioMs = Math.round((r.desvioPulsos ?? 0) * m.segundosPorPulso * 1000);
      agregarFila(`${nombreNota(n.midi)} en pulso ${pulsoTocado.toFixed(2)} → correcta (${desvioMs >= 0 ? '+' : ''}${desvioMs} ms)`, 'ok');
    } else {
      agregarFila(`${nombreNota(n.midi)} en pulso ${pulsoTocado.toFixed(2)} → extra`, 'extra');
    }
    actualizarTablas();
  }, [actualizarTablas]);

  useEffect(() => suscribirNotas(alTocarNota), [alTocarNota]);
  useEffect(() => (tecladoPrueba ? activarTecladoDePrueba() : undefined), [tecladoPrueba]);

  const conectar = async () => {
    try {
      const nombres = await conectarMidi();
      setMidiEstado(nombres.length ? `conectado: ${nombres.join(', ')}` : 'acceso OK pero sin entradas MIDI; conecta el teclado');
    } catch (e) {
      setMidiEstado(String(e));
    }
  };

  const iniciar = () => {
    const p = partituraRef.current;
    if (!p) return;
    // El AudioContext se crea en un click (los navegadores lo exigen).
    if (!metronomoRef.current) metronomoRef.current = new Metronomo(new AudioContext());
    const m = metronomoRef.current;
    void m.ctx.resume();
    m.bpm = bpm;
    p.mostrarTodo();
    const c = new Comparador(notasEsperadas);
    comparadorRef.current = c;
    setRegistro([]); setDesvio(null); setGuardado(null);
    // Se congelan acá los datos de la sesión: son los ajustes con los que el
    // alumno tocó, no los que queden en pantalla después.
    const datosSesion = {
      alumno,
      tempo: bpm,
      pulsosPorCompas: m.pulsosPorCompas,
      numCompases: p.numCompases,
      desfasePulsos: desfase,
      pieza: fuente.nombre,
      entrada: midiEstado.startsWith('conectado') ? 'MIDI' : tecladoPrueba ? 'teclado de PC' : 'sin entrada declarada',
    };
    m.onPulso = (pu) => {
      setPulso(pu);
      // Regla de ocultamiento: el compás i se tapa cuando llega el pulso i*4 + desfase.
      // desfase 0 = al empezar a tocarlo; -4 = un compás antes; +4 = al terminarlo.
      for (let i = 0; i < p.numCompases; i++) {
        if (pu.indice >= i * m.pulsosPorCompas + desfase) p.ocultarCompas(i);
      }
      c.actualizar(pu.indice);
      actualizarTablas();
    };
    m.onFin = () => {
      c.cerrar();
      tocandoRef.current = false;
      setEstado('terminado');
      actualizarTablas();
      const d = m.desviosMs;
      if (d.length) setDesvio({ media: Math.round(d.reduce((s, x) => s + x, 0) / d.length * 10) / 10, max: Math.round(Math.max(...d) * 10) / 10, n: d.length });
      // T1: la sesión se guarda sola, sin que nadie toque nada más.
      const sesion = construirSesion(c, datosSesion);
      setGuardado({ sesion, nombre: descargarSesion(sesion) });
    };
    tocandoRef.current = true;
    setEstado('tocando');
    actualizarTablas();
    m.iniciar(p.numCompases * m.pulsosPorCompas);
  };

  const detener = () => {
    metronomoRef.current?.detener();
    tocandoRef.current = false;
    setEstado('listo');
  };

  const cargarGenerado = () => {
    const ej = generarEjercicio({ ...NIVELES[nivel], semilla });
    setFuente({ nombre: `generado: ${nivel}, semilla ${semilla}`, musicXml: ej.musicXml, notasGeneradas: ej.notas });
  };

  // Ruta 1 de B3: cargar una pieza de repertorio (.musicxml, .xml o .mxl comprimido).
  const cargarArchivo = async (archivo: File | undefined) => {
    if (!archivo) return;
    const contenido = archivo.name.toLowerCase().endsWith('.mxl') ? archivo : await archivo.text();
    setFuente({ nombre: `archivo: ${archivo.name}`, musicXml: contenido });
  };

  const numCompases = partituraRef.current?.numCompases ?? 8;
  const dificultad = medirDificultad(notasEsperadas, numCompases);

  return (
    <div>
      <div className="caja">
        <p className="titulo-seccion">Sesión</p>
        <div className="controles">
          <label className="campo">
            <span>Alumno</span>
            <input id="alumno" style={{ width: 90 }} value={alumno} onChange={(e) => setAlumno(e.target.value)} disabled={estado === 'tocando'} />
          </label>
          <label className="campo">
            <span>Tempo (bpm)</span>
            <input type="number" value={bpm} min={30} max={200} onChange={(e) => setBpm(Number(e.target.value))} disabled={estado === 'tocando'} />
          </label>
          <label className="campo">
            <span>Ocultar (pulsos)</span>
            <input id="desfase" type="number" value={desfase} min={-8} max={8} onChange={(e) => setDesfase(Number(e.target.value))} disabled={estado === 'tocando'} />
          </label>
          <div className="campo">
            <span>Entrada</span>
            <div>
              <button onClick={conectar}>Conectar MIDI</button>
              <label className="interruptor">
                <input type="checkbox" checked={tecladoPrueba} onChange={(e) => setTecladoPrueba(e.target.checked)} />
                teclado de PC
              </label>
            </div>
          </div>
        </div>

        <div className="tira-estado">
          <button id="btn-iniciar" className="principal" onClick={iniciar} disabled={estado !== 'listo' && estado !== 'terminado'}>Empezar</button>
          <button onClick={detener} disabled={estado !== 'tocando'}>Detener</button>
          <span id="estado" className={`chip ${estado}`}>{estado}</span>
          <div className="pulsos">
            {[0, 1, 2, 3].map((i) => <span key={i} className={`pulso${pulso && pulso.pulsoEnCompas === i ? ' activo' : ''}`} />)}
          </div>
          {pulso && (
            <span className="donde">
              {pulso.compas < 0 ? 'cuenta de entrada' : `compás ${pulso.compas + 1}`}, pulso {pulso.pulsoEnCompas + 1}
            </span>
          )}
        </div>

        <p className="mono" style={{ margin: '10px 0 0' }}>
          MIDI: {midiEstado}
          {tecladoPrueba && ' · teclas de prueba: a s d f g h j k = C4..C5, z x c v b n m = C3..B3, q w e r = F2..B2'}
        </p>
      </div>

      <div id="partitura" className={estado === 'tocando' ? 'tocando' : ''} ref={contenedorRef} />
      <p className="pie mono" id="chequeo">{fuente.nombre} · {chequeo}</p>

      {guardado && (
        <p className="aviso-guardado" id="sesion-guardada">
          <span>Sesión guardada: <b>{guardado.nombre}</b></span>
          <button style={{ marginLeft: 'auto' }} onClick={() => descargarSesion(guardado.sesion)}>descargar de nuevo</button>
        </p>
      )}

      {/* El resultado aparece recién al terminar: ver la tabla llenarse de rojo
          mientras toca cambia lo que hace el alumno, y eso es justo lo que se
          está midiendo. Para verlo en vivo, quitar `estado !== 'tocando'`. */}
      {resumen && estado !== 'tocando' && (
        <div className="caja">
          <p className="titulo-seccion">Resultado</p>
          <table id="tabla-resultados">
            <thead><tr><th>compás</th><th>esperadas</th><th>correctas</th><th>fallidas</th><th>pendientes</th><th>%</th></tr></thead>
            <tbody>
              {porCompas.map((r, i) => (
                <tr key={i}><td>{i + 1}</td><td>{r.esperadas}</td><td className="ok">{r.correctas}</td><td className="mal">{r.fallidas}</td><td>{r.pendientes}</td><td>{r.porcentaje}</td></tr>
              ))}
              <tr><th>total</th><th>{resumen.esperadas}</th><th className="ok">{resumen.correctas}</th><th className="mal">{resumen.fallidas}</th><th>{resumen.pendientes}</th><th>{resumen.porcentaje}%</th></tr>
              <tr><td colSpan={6}>notas extra (no estaban en la partitura): <span className="extra">{resumen.extras}</span>
                {desvio && <> · desvío click→pantalla: media {desvio.media} ms, máx {desvio.max} ms ({desvio.n} pulsos)</>}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Lo de abajo es para quien conduce la prueba, no para el alumno: va plegado. */}
      <details className="caja">
        <summary>Registro de notas</summary>
        <div className="contenido">
          <div className="mono">{registro.map((f, i) => <div key={i} className={f.clase}>{f.texto}</div>)}</div>
        </div>
      </details>

      <details className="caja">
        <summary>Qué pieza se toca · generador y repertorio</summary>
        <div className="contenido">
          <div className="controles">
            <label className="campo">
              <span>Nivel</span>
              <select value={nivel} onChange={(e) => setNivel(e.target.value)}>
                {Object.keys(NIVELES).map((k) => <option key={k}>{k}</option>)}
              </select>
            </label>
            <label className="campo">
              <span>Semilla</span>
              <input type="number" value={semilla} onChange={(e) => setSemilla(Number(e.target.value))} />
            </label>
            <div className="campo">
              <span>&nbsp;</span>
              <div>
                <button id="btn-generar" onClick={cargarGenerado} disabled={estado === 'tocando'}>Generar y cargar</button>
                <button onClick={() => setFuente({ nombre: 'pieza fija (pieza.ts)', musicXml: PIEZA_MUSICXML })} disabled={estado === 'tocando'}>Volver a la pieza fija</button>
              </div>
            </div>
            <label className="campo">
              <span>Repertorio real (.xml, .musicxml, .mxl)</span>
              <input id="archivo-musicxml" type="file" accept=".xml,.musicxml,.mxl" onChange={(e) => cargarArchivo(e.target.files?.[0])} disabled={estado === 'tocando'} />
            </label>
          </div>
          <div className="mono" id="dificultad" style={{ marginTop: 12 }}>
            dificultad medida: {dificultad.notasPorCompas} notas/compás · salto medio {dificultad.saltoMedioSemitonos} semitonos ·
            ámbito {dificultad.ambitoSemitonos} semitonos · {dificultad.figurasDistintas} figuras distintas · máx {dificultad.notasSimultaneasMax} notas simultáneas
          </div>
        </div>
      </details>
    </div>
  );
}
