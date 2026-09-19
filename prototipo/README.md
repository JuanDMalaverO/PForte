# Prototipo · lectura a primera vista (Tarea B)

Web en TypeScript + React (Vite). Una pieza de 8 compases, metrónomo con Web Audio, compases que se tapan al ritmo, notas MIDI comparadas contra la partitura, y una pantalla para medir la detección por micrófono con dos motores (basic-pitch y huellas + NMF).

## Correr

```
npm install
node scripts/descargar-modelo-oaf.mjs   # una vez: baja el modelo Onsets and Frames (60 MB)
npm run dev
```

Abrir http://localhost:5173 en **Chrome o Edge** (Web MIDI no funciona en Firefox ni Safari). Si PowerShell bloquea `npm`: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` una vez, o usar `npm.cmd`.

- **B1 · Prototipo:** "Conectar MIDI" → "Iniciar". Sin teclado MIDI, marcar "teclado de PC como MIDI de prueba" (`a s d f g h j k` = C4..C5, `z x c v b n m` = C3..B3, `q w e r` = F2..B2).
- **B2 · Medición por micrófono:** elegir motor; abrir el micrófono (a 50 cm – 1 m del piano; si dice SATURA, alejarlo); calibrar silencio; con el motor de huellas, calibrar teclas (1 minuto); después prueba sintética, archivo, precisión acorde por acorde y latencia continua. El bloque final tiene el JSON para el documento.

## Guardar la sesión (T1)

Cuando el alumno termina el ejercicio, el navegador baja solo un archivo
`sesion-<alumno>-<fecha>_<hora>.json` con la partitura esperada, lo que tocó,
lo que le faltó, lo que tocó de más y el instante de cada nota dentro de su
compás. Nadie tiene que apretar nada. El nombre del alumno se escribe en el
campo "alumno" antes de empezar; el archivo cae en la carpeta de descargas del
navegador.

La primera vez que se baja una segunda sesión, Chrome pregunta "¿Permitir
varias descargas?": hay que decir que sí una vez y no vuelve a preguntar. Si
alguna descarga se pierde, el botón "descargar de nuevo" queda en pantalla
hasta que empiece la sesión siguiente.

Ejemplos del formato: `docs/resultados/sesion-ejemplo.json` (todo bien) y
`docs/resultados/sesion-ejemplo-con-errores.json` (un compás salteado y una
nota de más).

## Prueba automática

Con `npm run dev` corriendo, en otra terminal:

```
node scripts/verificar.mjs
```

Abre Chromium sin cabeza, toca la pieza completa con el teclado de prueba, genera ejercicios, carga dos piezas de repertorio real, corre los dos motores sobre 20 acordes sintéticos (+ un clip de silencio), calibra huellas desde un WAV de escala cromática y mide latencia usando un WAV como micrófono falso. Deja capturas y JSON en `docs/resultados/`.

## Archivos

Ver `../docs/B5-explicabilidad.md`: una frase por archivo y el recorrido de una sesión.

```
src/
  main.tsx            arranque de React
  App.tsx             la pantalla B1 (une los módulos)
  pieza.ts            la pieza hardcodeada (MusicXML)
  partitura.ts        OSMD: dibujar, extraer notas, tapar compases
  metronomo.ts        Web Audio con scheduling anticipado; reloj musical
  midi.ts             Web MIDI + teclado de PC de prueba
  comparador.ts       nota tocada vs nota esperada
  sesion.ts           al terminar, arma el JSON de la sesión y lo baja (T1)
  generador.ts        ejercicios generados con dificultad controlada (B3)
  medicion/
    Medicion.tsx      pantalla B2
    detector.ts       basic-pitch + micrófono (AudioWorklet, filtro, compuerta, saturación)
    fft.ts            FFT y espectrograma a mano
    huellas.ts        huella espectral de cada tecla (sintética o calibrada)
    ataques.ts        detector de ataques por flujo espectral
    nmf.ts            motor de huellas: NMF informada por la partitura, selección dispersa
    oaf.ts            motor Onsets and Frames (Magenta, específico de piano)
    motores.ts        los tres motores tras una interfaz + compuerta de energía
    continuo.ts       escucha continua con cada motor
    Calibracion.tsx   calibración del silencio y de las teclas
    sintetizador.ts   piano de juguete y los 20 acordes de prueba
    metricas.ts       aciertos, recall, precisión, percentiles
public/model/         modelo de basic-pitch (TensorFlow.js)
public/model-oaf/     modelo Onsets and Frames (60 MB; no está en git: `node scripts/descargar-modelo-oaf.mjs`)
scripts/verificar.mjs prueba automática con Playwright (batería completa)
scripts/verificar-sesion.mjs  verifica T1: la sesión se guarda sola y con la forma pedida
scripts/pieza-fija.mjs  la pieza de pieza.ts para los scripts, y cómo "tocarla"
scripts/parchar-magenta.mjs  parche a Magenta para Vite (corre en npm install)
scripts/barrer-amplitud.mjs  barrido del filtro de amplitud de basic-pitch
scripts/evaluar-grabacion.mjs  los tres motores sobre una grabación real de la escala (docs/resultados/muestras/)
scripts/evaluar-acordes.mjs    calibra con la escala y evalúa la grabación de los 20 acordes con los tres motores
scripts/descargar-modelo-oaf.mjs  baja el modelo Onsets and Frames (no está en git)
docs/resultados/      capturas y JSON de la última corrida
```
