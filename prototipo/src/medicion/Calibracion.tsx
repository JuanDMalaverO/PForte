// ============================================================================
// Calibracion.tsx — Aprender cómo suena ESTE piano en ESTA sala con ESTE mic.
//
// Dos modos:
//   En vivo: la app mide 1,5 s de silencio (piso de ruido + huella del
//            ruido), y después pide una tecla por vez. Detecta el ataque,
//            promedia el espectro de los ~400 ms siguientes, guarda la huella
//            y pasa a la siguiente. Termina en ~1 minuto para 3 octavas.
//   Archivo: una grabación de la escala cromática (una nota por vez, en
//            orden ascendente) hecha con el celular; se corta por ataques.
//
// Las huellas quedan en localStorage y las usa nmf.ts.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { decodificarArchivo, type Microfono } from './detector';
import { dB, percentil, type STFT } from './fft';
import { ataquesDeFrames } from './ataques';
import { FlujoEspectral, type FrameVivo } from './continuo';
import { borrarHuellas, guardarHuellas, huellaDesdeEspectros, huellasVacias, teclasCalibradas, type Huellas } from './huellas';
import { nombreNota } from '../midi';

interface Props {
  mic: Microfono | null;
  stft: STFT;
  huellas: Huellas;
  onCambio: (h: Huellas) => void;
}

const FRAMES_TRAS_ATAQUE = 20; // ≈ 430 ms de sostenido para promediar
const FRAMES_SALTEADOS = 2; // los primeros frames tras el ataque son ruido de martillo

export default function Calibracion({ mic, stft, huellas, onCambio }: Props) {
  const [estado, setEstado] = useState('');
  const [enVivo, setEnVivo] = useState(false);
  const [teclaActual, setTeclaActual] = useState<number | null>(null);
  const flujoRef = useRef<FlujoEspectral | null>(null);
  const huellasRef = useRef(huellas);
  huellasRef.current = huellas;

  const calibradas = teclasCalibradas(huellas);
  const total = huellas.midiMax - huellas.midiMin + 1;

  const actualizar = (h: Huellas) => {
    guardarHuellas(h);
    onCambio(h);
  };

  const cambiarRango = (midiMin: number, midiMax: number) => {
    if (midiMin >= midiMax) return;
    actualizar({ ...huellas, midiMin, midiMax });
  };

  const detener = () => {
    flujoRef.current?.detener();
    flujoRef.current = null;
    setEnVivo(false);
    setTeclaActual(null);
  };
  useEffect(() => detener, []);

  // --- silencio -----------------------------------------------------------------
  const calibrarSilencio = async () => {
    if (!mic) return;
    setEstado('midiendo la sala en silencio (2 s)...');
    await new Promise((r) => setTimeout(r, 2000));
    const piso = mic.calibrarSilencio(2);
    const { espectros } = stft.frames(mic.ultimos(2).datos);
    const h = { ...huellasRef.current, pisoDb: Math.round(piso * 10) / 10, ruido: Array.from(huellaDesdeEspectros(espectros)) };
    actualizar(h);
    setEstado(`piso de ruido: ${h.pisoDb} dB (compuerta en ${Math.round(piso + mic.margenCompuertaDb)} dB)`);
  };

  // --- en vivo ------------------------------------------------------------------
  const iniciarEnVivo = async () => {
    if (!mic) return;
    await calibrarSilencio();
    const pendientes = [...Array(total).keys()].map((i) => huellasRef.current.midiMin + i);
    let esperandoSilencio = false;
    let framesEnSilencio = 0;
    let captura: { midi: number; indice: number } | null = null;
    setEnVivo(true);
    setTeclaActual(pendientes[0]);
    setEstado(`tocá ${nombreNota(pendientes[0])} y sostenela`);
    const flujo = new FlujoEspectral(mic, stft, {
      onAtaque: (_tiempo, indice) => {
        if (captura || esperandoSilencio || pendientes.length === 0) return;
        captura = { midi: pendientes[0], indice };
      },
      onFrame: (f: FrameVivo) => {
        const compuerta = mic.compuertaDb ?? -40;
        if (esperandoSilencio) {
          framesEnSilencio = dB(f.rms) < compuerta ? framesEnSilencio + 1 : 0;
          if (framesEnSilencio >= 5) {
            esperandoSilencio = false;
            if (pendientes.length === 0) {
              detener();
              setEstado(`calibración completa: ${total} teclas`);
            } else {
              setTeclaActual(pendientes[0]);
              setEstado(`tocá ${nombreNota(pendientes[0])} y sostenela`);
            }
          }
          return;
        }
        if (!captura || f.indice < captura.indice + FRAMES_TRAS_ATAQUE) return;
        const frames = flujo.frames.filter(
          (x) => x.indice > captura!.indice + FRAMES_SALTEADOS && x.indice <= captura!.indice + FRAMES_TRAS_ATAQUE && dB(x.rms) > compuerta,
        );
        if (frames.length < 5) {
          setEstado(`no escuché bien ${nombreNota(captura.midi)}; tocala de nuevo más fuerte`);
          captura = null;
          return;
        }
        const h = { ...huellasRef.current, porMidi: { ...huellasRef.current.porMidi, [captura.midi]: Array.from(huellaDesdeEspectros(frames.map((x) => x.espectro))) } };
        actualizar(h);
        pendientes.shift();
        setEstado(`✓ ${nombreNota(captura.midi)} · soltá y esperá`);
        captura = null;
        esperandoSilencio = true;
        framesEnSilencio = 0;
      },
    });
    flujoRef.current = flujo;
    flujo.iniciar();
  };

  // --- desde archivo ----------------------------------------------------------------
  const calibrarDesdeArchivo = async (archivo: File | undefined) => {
    if (!archivo) return;
    setEstado('analizando el archivo...');
    const clip = await decodificarArchivo(archivo, stft.tasa);
    const { espectros, tiempos, rms } = stft.frames(clip);
    const rmsDb = rms.map(dB);
    const piso = Math.min(percentil(rmsDb, 10), -40);
    const compuerta = piso + 10;
    const ataques = ataquesDeFrames(espectros, tiempos, stft.hopSeg).filter((i) => rmsDb[Math.min(i + 1, rmsDb.length - 1)] > compuerta);
    const esperados = huellasRef.current.midiMax - huellasRef.current.midiMin + 1;
    if (ataques.length !== esperados) {
      setEstado(`el archivo tiene ${ataques.length} ataques y el rango pide ${esperados} notas (${nombreNota(huellasRef.current.midiMin)} a ${nombreNota(huellasRef.current.midiMax)}). Ajustá el rango o grabá de nuevo.`);
      return;
    }
    const porMidi: Record<string, number[]> = {};
    ataques.forEach((a, k) => {
      const frames = espectros.filter((_, i) => i > a + FRAMES_SALTEADOS && i <= a + FRAMES_TRAS_ATAQUE && rmsDb[i] > compuerta);
      if (frames.length) porMidi[String(huellasRef.current.midiMin + k)] = Array.from(huellaDesdeEspectros(frames));
    });
    const silenciosos = espectros.filter((_, i) => rmsDb[i] < piso + 3);
    const h: Huellas = {
      ...huellasRef.current,
      porMidi,
      ruido: silenciosos.length ? Array.from(huellaDesdeEspectros(silenciosos)) : huellasRef.current.ruido,
      pisoDb: Math.round(piso * 10) / 10,
    };
    if (mic) mic.pisoDb = h.pisoDb;
    actualizar(h);
    setEstado(`calibradas ${Object.keys(porMidi).length} teclas desde el archivo · piso ${h.pisoDb} dB`);
  };

  const borrar = () => {
    borrarHuellas();
    if (mic) mic.pisoDb = null;
    onCambio(huellasVacias(stft, huellas.midiMin, huellas.midiMax));
    setEstado('huellas borradas');
  };

  return (
    <div>
      <p>
        Rango: <label>de <input type="number" min={21} max={108} value={huellas.midiMin} onChange={(e) => cambiarRango(Number(e.target.value), huellas.midiMax)} disabled={enVivo} /> ({nombreNota(huellas.midiMin)})</label>
        <label>a <input type="number" min={21} max={108} value={huellas.midiMax} onChange={(e) => cambiarRango(huellas.midiMin, Number(e.target.value))} disabled={enVivo} /> ({nombreNota(huellas.midiMax)})</label>
        {' · '}<span id="calib-estado"><b>{calibradas.length}/{total}</b> teclas calibradas · piso {huellas.pisoDb ?? 'sin medir'} dB</span>
      </p>
      <p>
        <button id="btn-calibrar-silencio" onClick={calibrarSilencio} disabled={!mic || enVivo}>Calibrar silencio (2 s)</button>
        {!enVivo
          ? <button id="btn-calibrar-vivo" onClick={iniciarEnVivo} disabled={!mic}>Calibrar teclas en vivo</button>
          : <button onClick={detener}>Detener calibración</button>}
        <label>o desde archivo (escala cromática, una nota por vez, ascendente): <input id="archivo-calibracion" type="file" accept="audio/*" onChange={(e) => calibrarDesdeArchivo(e.target.files?.[0])} disabled={enVivo} /></label>
        <button onClick={borrar} disabled={enVivo}>Borrar huellas</button>
      </p>
      <p>
        {teclaActual !== null && <b style={{ fontSize: 24 }}>{nombreNota(teclaActual)} </b>}
        <span className="mono">{estado}</span>
      </p>
    </div>
  );
}
