// ============================================================================
// Medicion.tsx — Pantalla de B2: medir la detección por micrófono con dos
// motores intercambiables (basic-pitch y huellas/NMF), con la misma batería
// de pruebas para poder compararlos.
//
// Bloques, de menos a más "real":
//   1. Micrófono: elegir dispositivo, nivel en dB, aviso de saturación,
//      calibrar el silencio de la sala (piso de ruido → compuerta).
//   2. Calibración de huellas (solo motor huellas): aprender cómo suena cada
//      tecla en este piano.
//   3. Prueba sintética: acordes generados por cálculo → motor. Sin mic.
//   4. Archivo de audio: grabás el piano con el celular y subís el archivo.
//   5. Precisión con micrófono: tocás un acorde, se graba, se compara contra
//      lo que dijiste que ibas a tocar (texto o teclado MIDI).
//   6. Latencia continua: cada nota nueva, cuánto tardó en aparecer.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Detector, Microfono, decodificarArchivo, listarMicrofonos, remuestrear, UMBRALES_DEFECTO,
  type DispositivoAudio, type NotaDetectada, type Umbrales,
} from './detector';
import { STFT } from './fft';
import { cargarHuellas, huellasVacias, teclasCalibradas, type Huellas } from './huellas';
import { DetectorHuellas } from './nmf';
import { analizarClip, motorBasicPitch, motorHuellas, motorOnsetsFrames, type Motor, type NombreMotor } from './motores';
import { crearEscuchaHuellas, crearEscuchaVentana, type Escucha } from './continuo';
import { DetectorOaf } from './oaf';
import { ACORDES_PRUEBA, sintetizarAcorde } from './sintetizador';
import { compararAcorde, correrPruebaSintetica, percentil, totalizar, type ComparacionAcorde, type ResultadoSintetico } from './metricas';
import { conectarMidi, leerNotas, nombreNota, suscribirNotas, type NotaMidi } from '../midi';
import { tiempoPerfATiempoAudio } from '../metronomo';
import Calibracion from './Calibracion';

const nombres = (midis: number[]) => midis.map(nombreNota).join(' ') || '—';

interface FilaPrecision {
  n: number;
  comparacion: ComparacionAcorde;
  msProceso: number;
  referencia: 'MIDI' | 'texto';
  nivelDb: number;
  silencio: boolean;
  satura: boolean;
  detalle: string;
}

interface FilaLatencia {
  midi: number;
  onsetSeg: number;
  latenciaModeloMs: number;
  latenciaMidiMs: number | null;
  msInferencia: number;
}

export default function Medicion() {
  // --- modelo basic-pitch ------------------------------------------------------
  const [detector, setDetector] = useState<Detector | null>(null);
  const [errorModelo, setErrorModelo] = useState('');
  const [umbrales, setUmbrales] = useState<Umbrales>(UMBRALES_DEFECTO);
  useEffect(() => {
    Detector.crear().then(setDetector, (e: unknown) => setErrorModelo(String(e)));
  }, []);

  // --- micrófono ---------------------------------------------------------------
  const [mic, setMic] = useState<Microfono | null>(null);
  const [micEstado, setMicEstado] = useState('cerrado');
  const [micros, setMicros] = useState<DispositivoAudio[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const abrirMic = async () => {
    try {
      const m = await Microfono.abrir(10, deviceId || undefined);
      setMic(m);
      setMicEstado(`abierto: ${m.nombre} (${m.tasa} Hz, ${m.captura})`);
      setMicros(await listarMicrofonos());
    } catch (e) {
      setMicEstado(`error: ${String(e)}`);
    }
  };
  const cerrarMic = () => {
    detenerContinuo();
    mic?.cerrar();
    setMic(null);
    setMicEstado('cerrado');
  };
  useEffect(() => () => mic?.cerrar(), [mic]);

  // --- huellas ------------------------------------------------------------------
  const tasaHuellas = mic?.tasa ?? 48000;
  const stft = useMemo(() => new STFT(tasaHuellas), [tasaHuellas]);
  const [huellas, setHuellas] = useState<Huellas>(() => cargarHuellas(stft) ?? huellasVacias(stft, 41, 74));
  useEffect(() => setHuellas(cargarHuellas(stft) ?? huellasVacias(stft, 41, 74)), [stft]);
  useEffect(() => {
    if (mic && huellas.pisoDb !== null) mic.pisoDb = huellas.pisoDb;
  }, [mic, huellas.pisoDb]);
  const detectorHuellas = useMemo(() => new DetectorHuellas(stft, huellas), [stft, huellas]);

  // --- Onsets and Frames (se carga a pedido: 60 MB) ---------------------------------
  const [oaf, setOaf] = useState<DetectorOaf | null>(null);
  const [oafEstado, setOafEstado] = useState('sin cargar');
  const cargarOaf = async () => {
    try {
      setOaf(await DetectorOaf.crear(setOafEstado));
      setOafEstado('listo');
    } catch (e) {
      setOafEstado(`error: ${String(e)}`);
    }
  };

  // --- motor --------------------------------------------------------------------
  const [nombreMotor, setNombreMotor] = useState<NombreMotor>('basic-pitch');
  const [soloEsperadas, setSoloEsperadas] = useState(true);
  const motor: Motor | null = useMemo(() => {
    if (nombreMotor === 'huellas') return motorHuellas(detectorHuellas, soloEsperadas);
    if (nombreMotor === 'onsets-frames') return oaf ? motorOnsetsFrames(oaf) : null;
    return detector ? motorBasicPitch(detector, umbrales) : null;
  }, [nombreMotor, detectorHuellas, soloEsperadas, detector, umbrales, oaf]);

  // --- MIDI compartido (referencia) ---------------------------------------------
  const [midiEstado, setMidiEstado] = useState('sin conectar');
  const notasMidiRef = useRef<NotaMidi[]>([]);
  useEffect(() => suscribirNotas((n) => {
    notasMidiRef.current.push(n);
    if (notasMidiRef.current.length > 200) notasMidiRef.current.shift();
  }), []);
  const conectar = async () => {
    try {
      const n = await conectarMidi();
      setMidiEstado(n.length ? `conectado: ${n.join(', ')}` : 'sin entradas MIDI detectadas');
    } catch (e) {
      setMidiEstado(String(e));
    }
  };

  // --- 3. prueba sintética --------------------------------------------------------
  const [sintetico, setSintetico] = useState<ResultadoSintetico | null>(null);
  const [progreso, setProgreso] = useState('');
  const correrSintetico = async (conRuido: boolean) => {
    if (!motor) return;
    setSintetico(null);
    const r = await correrPruebaSintetica(motor, conRuido, (h, t) => setProgreso(`${h}/${t}`));
    setProgreso('');
    setSintetico(r);
  };

  // --- 4. archivo -----------------------------------------------------------------
  const [notasArchivo, setNotasArchivo] = useState<{ notas: NotaDetectada[]; ms: number; detalle: string } | null>(null);
  const analizarArchivo = async (archivo: File | undefined) => {
    if (!archivo || !motor) return;
    const clip = await decodificarArchivo(archivo, motor.tasa);
    const r = await analizarClip(motor, clip, null, 10);
    setNotasArchivo({ notas: r.notas, ms: r.msProceso, detalle: r.detalle });
  };

  // --- 5. precisión por acorde ----------------------------------------------------
  const [indiceAcorde, setIndiceAcorde] = useState(0);
  const [textoEsperado, setTextoEsperado] = useState(nombres(ACORDES_PRUEBA[0].midis));
  const [usarMidi, setUsarMidi] = useState(false);
  const [cuenta, setCuenta] = useState('');
  const [filasPrecision, setFilasPrecision] = useState<FilaPrecision[]>([]);

  const grabarAcorde = async () => {
    if (!mic || !motor) return;
    const midiAntes = notasMidiRef.current.length;
    let inicioGrabacion = mic.ctx.currentTime;
    for (let s = 3; s > 0; s--) {
      setCuenta(`toca en ${s}...`);
      // La captura arranca en el "1" para no perder el ataque si tocás un poco antes.
      if (s === 1) inicioGrabacion = mic.ctx.currentTime;
      await new Promise((r) => setTimeout(r, 700));
    }
    setCuenta('¡grabando!');
    await new Promise((r) => setTimeout(r, 2500));
    setCuenta('analizando...');
    const { datos } = mic.ultimos(mic.ctx.currentTime - inicioGrabacion);
    const clip = await remuestrear(datos, mic.tasa, motor.tasa);
    const midisMidi = notasMidiRef.current.slice(midiAntes).map((n) => n.midi);
    const referencia = usarMidi && midisMidi.length > 0 ? 'MIDI' : 'texto';
    const esperadas = referencia === 'MIDI' ? midisMidi : leerNotas(textoEsperado);
    const r = await analizarClip(motor, clip, mic.pisoDb, mic.margenCompuertaDb, esperadas);
    setFilasPrecision((f) => [...f, {
      n: f.length + 1,
      comparacion: compararAcorde(esperadas, r.notas.map((n) => n.midi)),
      msProceso: r.msProceso,
      referencia,
      nivelDb: r.nivelDb,
      silencio: r.silencio,
      satura: r.satura,
      detalle: r.detalle,
    }]);
    setCuenta('');
  };
  const siguienteAcorde = () => {
    const i = (indiceAcorde + 1) % ACORDES_PRUEBA.length;
    setIndiceAcorde(i);
    setTextoEsperado(nombres(ACORDES_PRUEBA[i].midis));
  };
  const reproducirSugerido = () => {
    const ctx = mic?.ctx ?? new AudioContext();
    const datos = sintetizarAcorde(ACORDES_PRUEBA[indiceAcorde].midis, 1.5, ctx.sampleRate, 0.5);
    const buffer = ctx.createBuffer(1, datos.length, ctx.sampleRate);
    buffer.copyToChannel(datos as Float32Array<ArrayBuffer>, 0);
    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(ctx.destination);
    fuente.start();
  };

  // --- 6. latencia continua ---------------------------------------------------------
  const [continuo, setContinuo] = useState(false);
  const [ventanaSeg, setVentanaSeg] = useState(1.0);
  // 100 ms dio el mejor balance medido (ver docs/B2): latencia ~200 ms y 96% de precisión.
  const [intervaloMs, setIntervaloMs] = useState(100);
  const [framesEval, setFramesEval] = useState(4);
  const [filasLatencia, setFilasLatencia] = useState<FilaLatencia[]>([]);
  const escuchaRef = useRef<Escucha | null>(null);
  const detenerContinuo = () => {
    escuchaRef.current?.detener();
    escuchaRef.current = null;
    setContinuo(false);
  };
  const iniciarContinuo = () => {
    if (!mic || !motor) return;
    setFilasLatencia([]);
    const onDeteccion = (d: { midi: number; onsetSeg: number; tDeteccionSeg: number; msProceso: number }) => {
      // Referencia MIDI: la tecla igual más cercana en el tiempo (±0.5 s).
      const midiRef = notasMidiRef.current
        .map((m) => ({ midi: m.midi, t: tiempoPerfATiempoAudio(mic.ctx, m.tiempoPerfMs) }))
        .filter((m) => m.midi === d.midi && Math.abs(m.t - d.onsetSeg) < 0.5)
        .sort((a, b) => Math.abs(a.t - d.onsetSeg) - Math.abs(b.t - d.onsetSeg))[0];
      setFilasLatencia((f) => [...f, {
        midi: d.midi,
        onsetSeg: d.onsetSeg,
        latenciaModeloMs: Math.round((d.tDeteccionSeg - d.onsetSeg) * 1000),
        latenciaMidiMs: midiRef ? Math.round((d.tDeteccionSeg - midiRef.t) * 1000) : null,
        msInferencia: d.msProceso,
      }].slice(-400));
    };
    escuchaRef.current = nombreMotor === 'huellas'
      ? crearEscuchaHuellas(mic, detectorHuellas, detectorHuellas.candidatos(), framesEval, onDeteccion)
      : crearEscuchaVentana(mic, motor, ventanaSeg, intervaloMs, onDeteccion);
    setContinuo(true);
  };
  useEffect(() => detenerContinuo, []);

  // --- resumen exportable -------------------------------------------------------------
  const totalesPrecision = totalizar(filasPrecision);
  const latModelo = filasLatencia.map((f) => f.latenciaModeloMs);
  const latMidi = filasLatencia.map((f) => f.latenciaMidiMs).filter((x): x is number => x !== null);
  // Memorizado: armar este JSON en cada render es caro y no cambia con el medidor de nivel.
  const exportable = useMemo(() => ({
    fecha: new Date().toISOString(),
    motor: nombreMotor,
    backend: detector?.backend,
    umbrales,
    huellas: { calibradas: teclasCalibradas(huellas).length, rango: [huellas.midiMin, huellas.midiMax], pisoDb: huellas.pisoDb, soloEsperadas },
    mic: mic ? { nombre: mic.nombre, tasa: mic.tasa, pisoDb: mic.pisoDb } : null,
    continuo: { ventanaSeg, intervaloMs, framesEval },
    sintetico: sintetico ? { motor: sintetico.motor, conRuido: sintetico.conRuido, totales: sintetico.totales } : null,
    precisionMicrofono: { filas: filasPrecision, totales: totalesPrecision },
    latencia: {
      muestras: filasLatencia.length,
      modelo_medianaMs: percentil(latModelo, 50),
      modelo_p90Ms: percentil(latModelo, 90),
      midi_muestras: latMidi.length,
      midi_medianaMs: percentil(latMidi, 50),
      midi_p90Ms: percentil(latMidi, 90),
      inferencia_mediaMs: filasLatencia.length ? Math.round(filasLatencia.reduce((s, f) => s + f.msInferencia, 0) / filasLatencia.length) : 0,
      detecciones: filasLatencia,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [nombreMotor, detector, umbrales, huellas, mic, soloEsperadas, ventanaSeg, intervaloMs, framesEval, sintetico, filasPrecision, filasLatencia]);
  const exportableTexto = useMemo(() => JSON.stringify(exportable, null, 2), [exportable]);

  return (
    <div>
      <p>
        Motor:{' '}
        <select id="motor" value={nombreMotor} onChange={(e) => { detenerContinuo(); setNombreMotor(e.target.value as NombreMotor); }}>
          <option value="basic-pitch">basic-pitch (red neuronal, 88 teclas)</option>
          <option value="huellas">huellas + NMF (informado por la partitura)</option>
          <option value="onsets-frames">Onsets and Frames (Magenta, específico de piano)</option>
        </select>
        {nombreMotor === 'onsets-frames' && <> · {oaf ? <b>listo</b> : <><button id="btn-cargar-oaf" onClick={cargarOaf} disabled={oafEstado !== 'sin cargar' && !oafEstado.startsWith('error')}>Cargar modelo (60 MB)</button> <span id="oaf-estado">{oafEstado}</span></>}</>}
        {nombreMotor === 'basic-pitch'
          ? <> · {detector ? <b>listo (backend {detector.backend})</b> : errorModelo ? <span className="mal">{errorModelo}</span> : 'cargando…'}
              {' · '}umbrales:{' '}
              <label>onset <input type="number" step="0.05" min="0" max="1" value={umbrales.onset} onChange={(e) => setUmbrales({ ...umbrales, onset: Number(e.target.value) })} /></label>
              <label>frame <input type="number" step="0.05" min="0" max="1" value={umbrales.frame} onChange={(e) => setUmbrales({ ...umbrales, frame: Number(e.target.value) })} /></label>
              <label>min frames <input id="min-frames" type="number" step="1" min="1" value={umbrales.minFrames} onChange={(e) => setUmbrales({ ...umbrales, minFrames: Number(e.target.value) })} /></label>
              <label>MIDI mín <input type="number" step="1" min="21" max="108" value={umbrales.midiMin} onChange={(e) => setUmbrales({ ...umbrales, midiMin: Number(e.target.value) })} /></label>
              <label>MIDI máx <input type="number" step="1" min="21" max="108" value={umbrales.midiMax} onChange={(e) => setUmbrales({ ...umbrales, midiMax: Number(e.target.value) })} /></label>
              <label>amplitud mín. relativa <input id="amplitud-relativa" type="number" step="0.05" min="0" max="1" value={umbrales.amplitudRelativa} onChange={(e) => setUmbrales({ ...umbrales, amplitudRelativa: Number(e.target.value) })} /></label>
            </>
          : nombreMotor === 'huellas' && <> · <b>{teclasCalibradas(huellas).length}</b> teclas calibradas (las demás usan huella sintética)
              {' · '}<label><input id="solo-esperadas" type="checkbox" checked={soloEsperadas} onChange={(e) => setSoloEsperadas(e.target.checked)} /> buscar solo las notas esperadas y sus vecinas</label>
            </>}
      </p>

      <div className="caja">
        <h3>1. Micrófono</h3>
        <p>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={!!mic}>
            <option value="">micrófono por defecto</option>
            {micros.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>{' '}
          {!mic
            ? <button id="btn-mic" onClick={abrirMic}>Abrir micrófono</button>
            : <button id="btn-mic-cerrar" onClick={cerrarMic}>Cerrar micrófono</button>}
          <span id="mic-estado">{micEstado}</span>
          {mic && <NivelMic mic={mic} />}
          {' · '}<button onClick={conectar}>Conectar MIDI (referencia)</button> {midiEstado}
        </p>
        <p className="mono">
          Consejos: el micrófono a 50 cm – 1 m del piano (a 10 cm satura); en Windows, desactivar "mejoras de audio" del micrófono; calibrar el silencio con la sala como va a estar.
        </p>
      </div>

      <div className="caja">
        <h3>2. Calibración de huellas (motor huellas)</h3>
        <Calibracion mic={mic} stft={stft} huellas={huellas} onCambio={setHuellas} />
      </div>

      <div className="caja">
        <h3>3. Prueba sintética (sin micrófono)</h3>
        <button id="btn-sintetico" onClick={() => correrSintetico(false)} disabled={!motor}>Correr 20 acordes sintéticos + silencio</button>
        <button id="btn-sintetico-ruido" onClick={() => correrSintetico(true)} disabled={!motor}>Correr con ruido de fondo</button>
        {progreso && <span> {progreso}</span>}
        {sintetico && (
          <>
            <p>
              Motor <b>{sintetico.motor}</b>: acordes exactos <b>{sintetico.totales.acordesExactos}/{sintetico.totales.acordes} ({sintetico.totales.porcentajeExactos}%)</b>
              {' · '}Recall notas: <b>{sintetico.totales.recall}%</b>
              {' · '}Precisión notas: <b>{sintetico.totales.precision}%</b>
              {' · '}Proceso medio: <b>{sintetico.totales.msProcesoMedio} ms</b> por clip de 1.5 s
            </p>
            <TablaAcordes filas={sintetico.filas.map((f, i) => ({ n: i + 1, nombre: f.nombre, comparacion: f.comparacion, ms: f.msProceso, detalle: f.detalle }))} />
            <pre id="resultado-sintetico" className="mono" hidden>{JSON.stringify(sintetico)}</pre>
          </>
        )}
      </div>

      <div className="caja">
        <h3>4. Archivo de audio grabado (wav/mp3/ogg)</h3>
        <input id="archivo-audio" type="file" accept="audio/*" onChange={(e) => analizarArchivo(e.target.files?.[0])} disabled={!motor} />
        {notasArchivo && (
          <>
            <p className="mono">
              {notasArchivo.detalle} · {notasArchivo.notas.length} notas en {notasArchivo.ms} ms:{' '}
              {notasArchivo.notas.map((n) => `${nombreNota(n.midi)}@${n.inicioSeg.toFixed(2)}s`).join('  ')}
            </p>
            <pre id="resultado-archivo" className="mono" hidden>{JSON.stringify({ motor: nombreMotor, ...notasArchivo })}</pre>
          </>
        )}
      </div>

      <div className="caja">
        <h3>5. Precisión con micrófono, acorde por acorde</h3>
        <p>
          Acorde sugerido {indiceAcorde + 1}/{ACORDES_PRUEBA.length}: <b>{ACORDES_PRUEBA[indiceAcorde].nombre}</b>{' '}
          <button onClick={siguienteAcorde}>siguiente</button>
          <button onClick={reproducirSugerido}>reproducir por parlantes (loopback)</button>
        </p>
        <p>
          <label>Voy a tocar: <input style={{ width: 200 }} value={textoEsperado} onChange={(e) => setTextoEsperado(e.target.value)} /></label>
          <label><input type="checkbox" checked={usarMidi} onChange={(e) => setUsarMidi(e.target.checked)} /> usar las teclas MIDI como referencia</label>
          <button onClick={grabarAcorde} disabled={!mic || !motor || !!cuenta}>Grabar (3 s)</button> <b>{cuenta}</b>
        </p>
        {filasPrecision.length > 0 && (
          <>
            <p>
              Acordes exactos: <b>{totalesPrecision.acordesExactos}/{totalesPrecision.acordes} ({totalesPrecision.porcentajeExactos}%)</b>
              {' · '}Recall: <b>{totalesPrecision.recall}%</b> · Precisión: <b>{totalesPrecision.precision}%</b>
              {' · '}Proceso medio: <b>{totalesPrecision.msProcesoMedio} ms</b>
            </p>
            <TablaAcordes filas={filasPrecision.map((f) => ({
              n: f.n,
              nombre: `${f.referencia} · ${f.nivelDb} dB${f.satura ? ' · SATURA' : ''}${f.silencio ? ' · silencio' : ''}`,
              comparacion: f.comparacion, ms: f.msProceso, detalle: f.detalle,
            }))} />
          </>
        )}
      </div>

      <div className="caja">
        <h3>6. Latencia (modo continuo)</h3>
        <p>
          {!continuo
            ? <button id="btn-continuo" onClick={iniciarContinuo} disabled={!mic || !motor}>Iniciar escucha continua</button>
            : <button id="btn-continuo-detener" onClick={detenerContinuo}>Detener</button>}
          {nombreMotor !== 'huellas'
            ? <>
                <label>ventana (s) <input id="ventana-seg" type="number" step="0.25" min="0.5" max="2" value={ventanaSeg} onChange={(e) => setVentanaSeg(Number(e.target.value))} disabled={continuo} /></label>
                <label>cada (ms) <input id="intervalo-ms" type="number" step="50" min="50" max="1000" value={intervaloMs} onChange={(e) => setIntervaloMs(Number(e.target.value))} disabled={continuo} /></label>
              </>
            : <label>frames tras el ataque <input id="frames-eval" type="number" step="1" min="1" max="20" value={framesEval} onChange={(e) => setFramesEval(Number(e.target.value))} disabled={continuo} /> (×{Math.round(stft.hopSeg * 1000)} ms)</label>}
          Toca notas o acordes sueltos. Si hay MIDI conectado, "latencia vs MIDI" es la medida buena.
        </p>
        {filasLatencia.length > 0 && (
          <>
            <p>
              Latencia: mediana <b>{percentil(latModelo, 50)} ms</b>, p90 <b>{percentil(latModelo, 90)} ms</b> ({latModelo.length} notas)
              {latMidi.length > 0 && <> · vs MIDI: mediana <b>{percentil(latMidi, 50)} ms</b>, p90 <b>{percentil(latMidi, 90)} ms</b> ({latMidi.length} notas)</>}
              {' · '}proceso medio: <b>{exportable.latencia.inferencia_mediaMs} ms</b>
            </p>
            <table>
              <thead><tr><th>nota</th><th>ataque (s)</th><th>latencia (ms)</th><th>vs MIDI (ms)</th><th>proceso (ms)</th></tr></thead>
              <tbody>
                {filasLatencia.slice(-15).map((f, i) => (
                  <tr key={i}><td>{nombreNota(f.midi)}</td><td>{f.onsetSeg.toFixed(2)}</td><td>{f.latenciaModeloMs}</td><td>{f.latenciaMidiMs ?? '—'}</td><td>{f.msInferencia}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="caja">
        <h3>Resultados para el documento (copiar y pegar)</h3>
        <textarea id="exportable" readOnly rows={8} style={{ width: '100%' }} value={exportableTexto} />
      </div>
    </div>
  );
}

/** Medidor de nivel. Es un componente aparte para que su refresco (cada 150 ms) no re-renderice toda la página. */
function NivelMic({ mic }: { mic: Microfono }) {
  const [nivel, setNivel] = useState({ db: -180, satura: false, piso: mic.pisoDb });
  useEffect(() => {
    const t = window.setInterval(() => setNivel({ db: Math.round(mic.nivelDb()), satura: mic.satura, piso: mic.pisoDb }), 150);
    return () => window.clearInterval(t);
  }, [mic]);
  return (
    <>
      {' · '}nivel <b>{nivel.db} dB</b> <span className="mono">{'█'.repeat(Math.max(0, Math.min(30, Math.round((nivel.db + 60) / 2))))}</span>
      {nivel.satura && <span className="satura"> SATURA: alejá el micrófono </span>}
      {' · '}piso {nivel.piso === null ? <span className="mal">sin calibrar</span> : <>{Math.round(nivel.piso)} dB, compuerta {Math.round(nivel.piso + mic.margenCompuertaDb)} dB</>}
    </>
  );
}

function TablaAcordes({ filas }: { filas: { n: number; nombre: string; comparacion: ComparacionAcorde; ms: number; detalle: string }[] }) {
  return (
    <table>
      <thead><tr><th>#</th><th>acorde / referencia</th><th>esperadas</th><th>detectadas</th><th>faltantes</th><th>extras</th><th>exacto</th><th>ms</th><th>detalle</th></tr></thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.n}>
            <td>{f.n}</td><td>{f.nombre}</td>
            <td>{nombres(f.comparacion.esperadas)}</td><td>{nombres(f.comparacion.detectadas)}</td>
            <td className="mal">{nombres(f.comparacion.faltantes)}</td><td className="extra">{nombres(f.comparacion.extras)}</td>
            <td className={f.comparacion.exacto ? 'ok' : 'mal'}>{f.comparacion.exacto ? 'sí' : 'no'}</td><td>{f.ms}</td><td>{f.detalle}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
