# B5 · Explicabilidad: qué hace cada archivo y qué partes no entiendo

Este documento es el guion para el sábado. La idea es poder explicar el prototipo **sin leerlo**. Primero un mapa de una frase por archivo, después el recorrido de una sesión, y al final, con honestidad, las partes que no entiendo del todo y qué haría para entenderlas.

## 1. Mapa: una frase por archivo

Todo vive en `prototipo/src/`. Son 21 archivos de código; el más largo es la pantalla B2 (~450 líneas), el resto entre 10 y 280.

### El prototipo (B1) y el generador (B3)

| Archivo | Qué hace, en una frase | Depende de |
|---|---|---|
| `main.tsx` | Arranca React y monta `<App />` en el `div#root` de `index.html`. | App |
| `App.tsx` | La pantalla B1: botones, tabla de resultados, y el "pegamento" que conecta metrónomo, partitura, MIDI y comparador. No tiene lógica musical propia. | todos |
| `pieza.ts` | La única pieza hardcodeada: un MusicXML de 8 compases escrito con tres ayudantes (`negra`, `blanca`, `redonda`). Exporta también el número de notas (42) para comprobar la extracción. | nada |
| `partitura.ts` | Envuelve OpenSheetMusicDisplay (OSMD): dibuja el MusicXML, recorre su modelo de datos para sacar la lista de notas `{midi, pulso, compás}`, y **tapa** un compás poniendo un `<div>` blanco encima usando las coordenadas que OSMD calculó. | OSMD |
| `metronomo.ts` | Click con Web Audio y "scheduling anticipado": un timer poco preciso cada 25 ms agenda con el reloj de audio (preciso) los clicks de los próximos 100 ms. Es también el reloj musical: convierte "instante" en "pulso". | Web Audio |
| `midi.ts` | Web MIDI: escucha `note on` de todos los teclados conectados y avisa a quien se haya suscrito. Incluye el modo de prueba con el teclado de la PC y dos utilidades (`nombreNota`, `leerNotas`). | Web MIDI |
| `comparador.ts` | La regla de corrección: una nota tocada es correcta si hay una esperada con el mismo MIDI a menos de medio pulso de distancia; si no, es extra; lo que nunca llegó es fallido. | nada |
| `generador.ts` | Ruta 2 de B3: fabrica un MusicXML de N compases a partir de parámetros de dificultad y una semilla; devuelve también la lista de notas que escribió. Incluye `medirDificultad`. | nada |

### La medición por micrófono (B2), en `src/medicion/`

| Archivo | Qué hace, en una frase | Depende de |
|---|---|---|
| `Medicion.tsx` | La pantalla B2: selector de motor, micrófono, calibración, prueba sintética, archivo, precisión por acorde, latencia continua, JSON exportable. Solo interfaz; la lógica está en los módulos de abajo. | todo lo de `medicion/` |
| `detector.ts` | Dos cosas: (a) envuelve **basic-pitch** (modelo en `public/model/`): audio mono 22050 Hz → notas; (b) el **micrófono** con higiene de señal: AudioWorklet, filtro pasa-altos 40 Hz, buffer circular, nivel en dB, saturación, piso de ruido y compuerta. Más remuestrear y decodificar archivos. | basic-pitch, TF.js, Web Audio |
| `fft.ts` | Transformada de Fourier y espectrograma (STFT) escritos a mano: audio → frames de 85 ms → cuánta energía hay en cada franja de 11,7 Hz. Más `rms`, `dB`, `percentil`. | nada |
| `huellas.ts` | La "huella espectral" de cada tecla: por fórmula (armónicos que decaen) o calibrada (espectro promedio de esa tecla grabada). Se guardan en localStorage. | fft |
| `ataques.ts` | Detector de ataques por flujo espectral: un ataque es un pico de "subidas" del espectro que supera claramente el promedio reciente. Da el *cuándo* con 21 ms de precisión. | nada |
| `nmf.ts` | El motor de **huellas**: explica el espectro tras un ataque como mezcla no negativa de las huellas candidatas (esperadas y vecinas) más ruido; las candidatas con activación grande están sonando. Da el *qué*. | fft, huellas, ataques |
| `oaf.ts` | Envuelve **Onsets and Frames** (Magenta): modelo neuronal específico de piano, entrenado con piano real (MAESTRO). Pesos en `public/model-oaf/` (60 MB), se cargan a pedido. | @magenta/music, TF.js |
| `motores.ts` | Los tres motores detrás de una misma interfaz, y la **compuerta**: si el clip no supera el piso de ruido en 10 dB, no se analiza y el resultado es "silencio". | detector, nmf, oaf |
| `continuo.ts` | Escucha continua con cada motor: `FlujoEspectral` (lee el micrófono de a pedazos y arma frames), `crearEscuchaHuellas` (ataque → NMF) y `crearEscuchaBasicPitch` (ventana deslizante). | detector, fft, ataques, nmf |
| `Calibracion.tsx` | La calibración: mide el silencio de la sala y pide una tecla por vez (o corta una grabación de la escala por ataques) para aprender las huellas. | continuo, huellas |
| `sintetizador.ts` | Piano "de juguete" por suma de armónicos, y la lista de 20 acordes de prueba (que es también el protocolo con piano real). | nada |
| `metricas.ts` | Cómo contamos: aciertos/faltantes/extras por acorde, recall, precisión, percentiles, y la corrida de la prueba sintética (20 acordes + silencio). | motores, sintetizador |

Fuera de `src/`:

- `public/model/` — el modelo de basic-pitch (model.json + pesos, 900 KB). `public/model-oaf/` — Onsets and Frames (60 MB). Se sirven como archivos estáticos.
- `scripts/parchar-magenta.mjs` — corre en `npm install`: cambia tres `import * as X` por `import X` dentro de Magenta (paquetes CommonJS usados como funciones), que en ESM de verdad no funcionan. `vite.config.ts` además fuerza una sola copia de TensorFlow.js (basic-pitch y Magenta traen cada uno la suya) y define `global` para una dependencia de Magenta.
- `scripts/verificar.mjs` — prueba automática con Playwright: toca la pieza con el teclado de prueba, genera ejercicios, carga repertorio real, corre los dos motores sobre acordes sintéticos, calibra huellas desde un WAV de escala y mide latencia con un WAV como micrófono falso. Escribe capturas y JSON en `docs/resultados/`.
- `index.html`, `vite.config.ts`, `tsconfig*.json`, `package.json` — plantilla estándar de Vite + React + TypeScript.

## 2. Recorrido de una sesión (para contarlo en voz alta)

**B1, tocar la pieza:**

1. **Abrir la página.** `main.tsx` monta `App`. `App` llama a `Partitura.cargar` con el MusicXML de `pieza.ts`. OSMD lo dibuja. `notasEsperadas()` recorre compás → columna de tiempo → pentagrama → voz → nota y arma la lista de 42 notas. En pantalla: "OK: 42 notas extraídas".
2. **Conectar MIDI.** `conectarMidi()` pide permiso y engancha cada entrada. Cada tecla llega como 3 bytes; nos quedamos con `note on` con velocidad > 0 y guardamos `timeStamp`.
3. **Iniciar.** Se crea el `AudioContext` (en un click, lo exigen los navegadores). Se crea un `Comparador` con las 42 notas. El metrónomo arranca con un compás de cuenta de entrada.
4. **Cada pulso.** El metrónomo agenda el click con el reloj de audio y avisa a la UI con un `setTimeout` apuntado al mismo instante. `App` tapa los compases cuyo turno llegó (`indice >= compás*4 + desfase`), el comparador marca fallidas las notas cuyo momento pasó, se actualiza la tabla.
5. **Cada nota tocada.** El `timeStamp` se convierte a tiempo de audio ("ahora en audio − lo que hace que ocurrió") y de ahí a pulso con decimales. El comparador busca una esperada con ese MIDI a ≤ 0,5 pulsos.
6. **Fin.** Un pulso después del último, `onFin`: el comparador cierra y la tabla muestra el total.

**B2, un acorde por micrófono con el motor de huellas:**

1. El micrófono abre con un AudioWorklet que manda trozos de 2048 muestras al buffer circular; el filtro pasa-altos saca el zumbido. "Calibrar silencio" mide 2 s de sala: piso de ruido y huella del ruido.
2. "Calibrar teclas": la app pide Fa2; `FlujoEspectral` corta frames y `DetectorAtaques` avisa el ataque; se promedian los espectros de los 400 ms siguientes → huella de Fa2 → siguiente tecla.
3. "Grabar (3 s)": el clip pasa por `analizarClip` (compuerta: ¿hay señal 10 dB sobre el piso?), luego `DetectorHuellas.analizarClip`: ataques (solo los que traen subida de energía) → 12 frames tras el ataque → **selección dispersa**: se agregan candidatas de a una, siempre la que mejor explica lo que falta explicar, hasta que la siguiente ya no reduce el residuo un 1 %. Así Fa4 explica el espectro y Fa3 (cuyos armónicos pares son los de Fa4) no entra. Se compara con lo esperado.

## 3. Decisiones que conviene poder defender

- **Tapar en vez de borrar.** OSMD no tiene "ocultar compás". Un `div` blanco encima es feo, simple y no toca OSMD.
- **Pulsos con decimales como unidad de tiempo.** Todo está en negras desde el pulso 0. Cambia el bpm y nada más cambia.
- **La tolerancia (0,5 pulsos) es una constante, no una ciencia.** Está en un solo lugar.
- **El desfase de ocultamiento es un número.** Por la patente (B4): 0 = tapa cuando empieza el compás; negativo = antes (lo que reivindica la patente).
- **Dos motores, una interfaz.** `motores.ts` hace que la pantalla, la batería de pruebas y el script no sepan cuál motor corre. Por eso los números son comparables.
- **La compuerta vive antes del motor, no adentro.** Ningún modelo debería ver silencio. Es la corrección del caso "G1 D2 en un cuarto callado".
- **AudioWorklet en vez de ScriptProcessorNode.** Lo segundo pierde bloques cuando el hilo principal está ocupado; lo vimos en los datos (detecciones que se adelantaban cada vez más). Lo primero corre en el hilo de audio.
- **NMF informada por la partitura en vez de transcripción genérica.** Sabemos qué esperamos; el problema es más chico, y la solución corre en CPU en un celular.
- **La calibración es parte del producto.** Un piano vertical, uno de cola y un teclado con parlantes no suenan igual; un minuto de "tocá esta escala" lo resuelve y de paso es el tutorial.

## 4. Qué partes del código no entiendo (y qué haría)

Honesto: el código lo escribí con asistencia de IA, y hay zonas donde entiendo **qué** hacen pero no del todo **por qué** funcionan así.

1. **Las coordenadas de OSMD (`partitura.ts`).** Sé que 1 unidad = 10 px y que `beginInstructionsWidth` es el ancho de clave + armadura + compás. No sé cómo se calcula `Size.height` de un compás; por eso hay un `margen = 3` a ojo. *Qué haría:* medir el `<rect>` en el inspector con notas muy agudas.
2. **El post-proceso de basic-pitch (`outputToNotesPoly`).** Entiendo las tres matrices de salida y los umbrales, no el "melodia trick" ni `energyTolerance`. Por eso en el modo continuo una nota cortada por la ventana a veces se reporta como ataque nuevo; lo mitigué con dos reglas empíricas (parte fresca de la ventana; no repetir una nota dentro de 1 s). *Qué haría:* leer `toMidi.ts` con un caso impreso.
3. **La regla de actualización de NMF y la selección dispersa (`nmf.ts`).** Entiendo qué minimiza (la distancia entre el espectro y la mezcla) y que las activaciones no pueden ser negativas; sé aplicar la fórmula multiplicativa `h ← h · (Wᵀv) / (WᵀW h)`, pero no sabría demostrar por qué converge ni cuándo conviene la otra variante (divergencia KL) que usan los papers. La selección dispersa es "matching pursuit": la primera versión, sin ella, repartía la energía entre Fa4 y Fa3 con el piano real de Juan. Los umbrales (mejora mínima 1 %, 20 % de la máxima, 12 frames, 60 iteraciones) salieron de probar. *Qué haría:* leer Lee & Seung (2001) y Ewert & Müller sobre NMF informada por partitura.
4. **El umbral del detector de ataques (`ataques.ts`).** "2 veces el promedio reciente más 0,05" funciona con el piano sintético; con uno real hay pedal, ruido de martillo y resonancias. Es el parámetro más probable de tener que retocar. *Qué haría:* grabar 20 ataques reales y mirar la curva de flujo.
5. **La relación entre relojes.** `performance.now()` y `AudioContext.currentTime` avanzan al mismo ritmo, así que resto "cuánto hace que ocurrió". Probé primero con `getOutputTimestamp()` y daba un corrimiento de ~400 ms que no expliqué. La versión simple está verificada: 42/42 con desvío medio de ~20 ms.
6. **React en modo estricto ejecutando dos veces el `useEffect`.** Me dibujó la partitura dos veces y me cerró el micrófono dos veces; ambos resueltos (div hijo nuevo; `cerrar()` idempotente). No domino el modelo mental completo.

## 5. Cómo se corre

```
cd prototipo
npm install
npm run dev          # abre http://localhost:5173 en Chrome o Edge (Web MIDI)
node scripts/verificar.mjs   # en otra terminal: prueba automática + números
```

Si PowerShell dice que "running scripts is disabled": `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` una vez, o usar `npm.cmd`.
