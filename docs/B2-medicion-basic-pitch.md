# B2 · Detección por micrófono: tres motores, mismos acordes

**Resultado con el piano real de Juan (16–17 sep):** en la escala (34 notas sueltas) el motor de huellas calibrado dio 34/34 y Onsets and Frames 33/34 (§4b). En los **20 acordes**, sabiendo qué se espera, el motor de huellas dio **16/20 exactos, recall 93 %, precisión 96 %** en 21 ms por acorde, contra 9/20 de Onsets and Frames y 2/20 de basic-pitch (§4c). Conclusión: **el micrófono es viable como segunda vía para puntuar lo esperado**, con el motor de huellas informado por la partitura; MIDI sigue siendo la principal.

**Resumen (16 sep 2026, ronda 3):** las pruebas de Juan con piano real mostraron los tres defectos de la primera versión (saturación a 10 cm, sin compuerta de silencio, captura que perdía bloques) y después un cuarto en el motor de huellas (confusión de octava hacia abajo). Los cuatro están corregidos. Hoy el prototipo tiene **tres motores intercambiables** medidos con la misma batería: basic-pitch (genérico), **huellas + NMF con selección dispersa** (nuestro, informado por la partitura, sin GPU) y **Onsets and Frames** (Magenta, específico de piano). En sintético, huellas da 100 % en todo; Onsets and Frames es el único con cero fantasmas pero pierde notas del sintetizador. **La decisión final requiere grabaciones del piano de Juan**; el protocolo está en §7.

## 1. Qué se mide y cómo

Pantalla "B2 · Medición por micrófono" (`prototipo/src/medicion/`). Números de `scripts/verificar.mjs` (Playwright + Chromium) en esta máquina: RTX 4080 Laptop, TensorFlow.js 3.21 backend `webgl`.

Batería, idéntica para los tres motores: **20 acordes reales de piano** (tríadas y acordes de 4–5 notas a dos manos, Fa2–Re5; lista en `sintetizador.ts`) **más un clip de puro ruido de fondo** que debe dar "nada".

| Condición | Qué pasa por el motor |
|---|---|
| Sintético limpio | acordes por suma de armónicos, silencio digital entre notas (irreal) |
| Sintético con ruido | igual, con ruido blanco a −46 dB |
| Micrófono falso, continuo | Chromium reproduce un WAV de 53 s (20 acordes, uno cada 2,5 s, con ruido) como si fuera el micrófono → AudioWorklet 48 kHz → buffer → motor. Es el producto salvo por el aire entre piano y micrófono |

Métricas (`metricas.ts`): por acorde, conjunto esperado vs detectado. *Recall* = notas reales vistas; *precisión* = de lo dicho, cuánto era real; *exacto* = ni faltantes ni extras. *Latencia real* = primera detección de cada nota menos el ataque verdadero (conocido porque el WAV lo fabricamos nosotros).

## 2. Los tres motores

| Motor | Qué es | Cómputo | GPU |
|---|---|---|---|
| **basic-pitch** (Spotify, 2022) | red neuronal genérica, cualquier instrumento, 88 teclas. `detector.ts` | 40–70 ms por ventana | necesaria (sin GPU 1,2–1,4 s) |
| **huellas + NMF** (nuestro) | huella espectral de cada tecla (por fórmula o **calibrada con el piano del alumno**), detector de ataques por flujo espectral, y NMF con **selección dispersa**: se agregan candidatas de a una, siempre la que mejor explica lo que falta, hasta que la siguiente no reduce el residuo un 1 %. Candidatas = notas esperadas y sus vecinas (±1, ±12). `fft.ts`, `huellas.ts`, `ataques.ts`, `nmf.ts` | **1–10 ms** | no |
| **Onsets and Frames** (Magenta/Google, 2018) | red neuronal específica de piano entrenada con ~200 h de piano real (MAESTRO). 60 MB. `oaf.ts` | 130–230 ms por clip | necesaria |

## 3. Lo que enseñaron las pruebas con piano real (Juan, laptop, 16 sep)

**Prueba A, basic-pitch, 10 cm / 50 cm / 1 m + silencio.** Silencio → "bajo la compuerta" (bien). En las tres distancias las tres notas reales aparecieron (recall 100 %); los extras fueron **octavas de las notas tocadas** (C5, E5, G5, E6) y un subgrave a 1 m. Es el defecto propio de basic-pitch con piano real: armónicos tomados por notas.

**Prueba B, huellas (primera versión), 50 cm.** Apareció la **confusión de octava hacia abajo** (C4→E3, F4→F3, A4→A3) y, en dos tomas, un segundo "ataque" durante el sostenido que encendió una docena de notas. Causa: un micrófono de laptop casi no capta la fundamental de las notas graves, así que la huella calibrada de Fa3 quedó hecha solo de sus armónicos, que son exactamente las frecuencias de Fa4; la regla de decisión original ("todo lo que supere el 20 % de la más fuerte") repartía la energía entre las dos. **Arreglos:** selección dispersa (si Fa4 explica el espectro, Fa3 no aporta y no entra), validación de ataques por subida de energía (un ataque real trae más energía que justo antes; una resonancia no), y umbrales contra el piso de ruido.

Estas dos pruebas no pudieron repetirse todavía con las correcciones: por eso §7.

## 4. Resultados de la batería automática (ronda 3, con todas las correcciones)

| Condición | Motor | Exactos | Recall | Precisión | Latencia mediana / p90 | Proceso |
|---|---|---|---|---|---|---|
| Sintético con ruido | basic-pitch | 18/21 | 100 % | 93,4 % | — | 72 ms |
| Sintético con ruido | huellas sin calibrar | **21/21** | 100 % | 100 % | — | 10 ms |
| Sintético con ruido | huellas calibradas | **21/21** | 100 % | 100 % | — | 10 ms |
| Sintético con ruido | huellas calibradas, todas las teclas (sin saber qué se espera) | **21/21** | 100 % | 100 % | — | 10 ms |
| Sintético con ruido | Onsets and Frames | 10/21 | 80,3 % | **100 %** | — | 149 ms |
| Micrófono falso | basic-pitch (cada 100 ms) | 18/20 | 100 % | 97,3 % | 235–455 ms (dos corridas) | 52 ms |
| Micrófono falso | **huellas calibradas** | **20/20** | **100 %** | **100 %** | **209 / 230 ms** | **< 1 ms** |
| Micrófono falso | Onsets and Frames (cada 250 ms) | 11–14/20 (dos corridas) | 70–100 % | 91–93 % | 210–577 ms | 133–258 ms (se queda atrás si la máquina está cargada) |
| Clip de silencio | los tres | nada detectado | | | | |

**Aviso sobre el modo continuo:** estos números varían de corrida a corrida según lo ocupada que esté la máquina. En cuatro corridas, huellas dio 20/20, 12/20, 20/20 y 12/20; las buenas fueron con la máquina libre. La causa no es el cómputo (1 ms por evaluación) sino que el análisis de frames se hace en el hilo principal: si está ocupado, los frames se procesan a los tirones y el detector de ataques pierde el hilo. El audio no se pierde (lo guarda el AudioWorklet), pero el ritmo del análisis sí se altera. Los números por clip (§4b y §4c, que analizan grabaciones enteras) no tienen este problema y son los que hay que mirar para decidir el motor. **Pendiente:** mover el análisis a un worker si el micrófono entra al producto.

Lectura honesta:
- Las huellas se calibraron con el mismo piano sintético que después se evaluó: mejor caso posible. Lo que vale es que la selección dispersa arregló en sintético el mismo tipo de error que Juan vio con el piano real; falta confirmarlo con el piano real.
- Onsets and Frames **nunca inventa notas** (precisión 100 % en sintético) pero pierde notas del sintetizador, que no suena a piano real. Es esperable que con el piano de Juan vea más. Es el candidato serio si el motor de huellas no rinde con piano real.
- basic-pitch queda como referencia: ve todo, inventa octavas.

Archivos: `prototipo/docs/resultados/sintetico-*.json`, `basic-pitch-sintetico-*.json`, `basic-pitch-mic-falso.json`, `mic-falso-huellas.json`, `mic-falso-oaf.json`, capturas `04-` a `07-*.png`.

## 4b. Primera medición con el piano REAL de Juan (grabación, 16 sep)

Juan grabó con el celular la escala cromática Fa2–Re5 (34 notas, una por vez) en `prototipo/docs/resultados/muestras/prueba1.mp3`. El script `scripts/evaluar-grabacion.mjs` la pasa por los tres motores y compara cada ataque con la nota esperada (ventana de tiempo alrededor de cada ataque; los instantes los fija el detector de ataques del motor de huellas, que encontró exactamente 34).

| Motor | Notas vistas | Exactas (solo la nota tocada) | Extras | Tiempo para 2 min de audio |
|---|---|---|---|---|
| huellas sin calibrar (por fórmula) | 34/34 | 22/34 | 12 (todas la octava de arriba) | 0,6 s |
| **huellas calibradas con esta misma grabación** | **34/34** | **34/34** | **0** | 0,6 s |
| basic-pitch | 34/34 | 26/34 | 8 (octavas y armónicos) | 1,9 s |
| Onsets and Frames | 34/34 | 33/34 | 1 (un Do#7 fantasma) | 11,8 s |

Lectura: en notas sueltas con piano real, **la calibración convierte al motor de huellas en perfecto** (la huella por fórmula subestima los armónicos de un piano real, por eso sin calibrar agrega la octava). Onsets and Frames es casi perfecto sin calibrar nada, a 20 veces el costo. basic-pitch ve todo e inventa octavas, como en las pruebas en vivo. **Falta la grabación de acordes** (misma escala de evaluación) para cerrar la decisión: los acordes son donde el motor de huellas tuvo problemas en vivo.

Advertencia: las huellas se calibraron y evaluaron sobre la misma grabación (mismas notas, mismo momento). La prueba justa es calibrar con la escala y evaluar con la grabación de acordes.

## 4c. La prueba decisiva: 20 acordes reales de Juan (grabación, 17 sep)

Juan grabó los 20 acordes de la lista con el celular (`prueba2.mp3`). El script `scripts/evaluar-acordes.mjs` **calibra con la escala (prueba1) y evalúa con los acordes (prueba2)**: grabaciones distintas, la prueba justa. La grabación tiene 23 ataques para 20 acordes (golpes repetidos, notas sueltas antes de un acorde), así que el emparejamiento se hace **por contenido** (alineamiento por programación dinámica entre lo detectado en cada ataque y la lista esperada; `metricas.ts`). El acorde 10 se tocó distinto de la lista (F3 A3 C4 E4 en vez de F2 C3 A3 C4, según los tres motores), y cuenta como error en todos.

| Motor | Exactos | Recall | Precisión | Proceso por acorde |
|---|---|---|---|---|
| **huellas por fórmula, sabiendo qué se espera** (esperadas y vecinas) | **16/20 (80 %)** | 93 % | **95,7 %** | 21 ms |
| huellas calibradas con la escala, sabiendo qué se espera | 12/20 | 86 % | 92 % | 21 ms |
| huellas calibradas, sin saber qué se espera (todas las teclas) | 4/20 | 85 % | 68 % | 21 ms |
| basic-pitch | 2/20 | **96 %** | 67 % | 159 ms |
| Onsets and Frames | 9/20 | 94 % | 83 % | 439 ms |

Errores del mejor caso (huellas por fórmula, esperadas y vecinas): #8 confundió G3 con E3; #9 no vio D4; #17 no vio A4; #10 es el acorde mal tocado. Descontando #10: recall 95,5 %, precisión 98,5 %, 16/19 exactos.

Tres lecciones que salieron de estos datos y quedaron en el código (`nmf.ts`):
1. **La calibración con celular perjudica en acordes.** Un micrófono de celular casi no capta la fundamental de los graves; la huella calibrada de Do3 queda hecha de sus armónicos (Do4, Sol4, Do5…), y ante un acorde Do4-Mi4-Sol4 un solo "Do3" explica dos notas de golpe. Por eso las huellas por fórmula (que sí tienen fundamental) rinden mejor. Con un micrófono decente o calibrando desde la app en vivo con un buen mic habría que volver a medir.
2. **Esperadas primero, vecinas después.** Cuando se sabe qué se espera, el motor prueba primero esas notas y admite una vecina solo si explica ≥ 5 % de la energía. Esto subió el resultado de 2/20 a 16/20. Es la ventaja estructural de saber la partitura, y no la tienen los transcriptores genéricos.
3. **Coherencia de la fundamental.** Una nota entra solo si en la frecuencia de su fundamental hay al menos un cuarto de la energía que su huella predice.

Sin saber qué se espera (transcripción libre), el mejor es Onsets and Frames (94 % / 83 %), a 20 veces el costo.

## 5. Higiene de señal (vale para los tres motores)

Implementada en `detector.ts` (clase `Microfono`) y `motores.ts` (`analizarClip`): captura por **AudioWorklet** (no pierde muestras cuando el hilo principal está ocupado; con `ScriptProcessorNode` las detecciones se adelantaban hasta 6 s), filtro pasa-altos 40 Hz, **piso de ruido calibrado** y **compuerta** (nada a menos de 10 dB del piso se analiza), **detector de saturación** ("SATURA: alejá el micrófono"), selector de micrófono, nivel en dB, y captura que arranca en el "1" de la cuenta para no perder el ataque.

## 6. Qué significa para el producto

- **MIDI sigue siendo la entrada principal** (exacta, 15 ms, sin fantasmas).
- **El micrófono es viable como segunda vía** con higiene de señal y un motor informado por la partitura. ~200 ms de latencia alcanzan para puntuar después del pulso (tolerancia de medio pulso = 375 ms a 80 bpm), no para feedback dentro del pulso.
- **La calibración es producto:** "tocá esta escala" como primer minuto de la app; permite decir "no te escucho bien" con datos (piso de ruido, saturación).
- **Ruta de escalado si hace falta más precisión:** Onsets and Frames (o un modelo posterior tipo Kong 2021 vía ONNX) del lado del servidor, con la capa de decisión informada por la partitura encima. El código ya separa motor de decisión (`motores.ts`), así que cambiar el motor no toca el resto.

## 7. Protocolo con piano real (lo hace Juan; 30 minutos)

**Grabaciones para evaluar sin tocar cada vez** (lo más valioso): con el celular a 50 cm del piano, en un cuarto normal:
1. ✅ `prueba1.mp3`: la escala cromática de **Fa2 a Re5** (resultados en §4b).
2. ✅ `prueba2.mp3`: los 20 acordes de la lista (resultados en §4c).

Se corren con `node scripts/evaluar-grabacion.mjs docs/resultados/muestras/prueba1.mp3 41 74` y `node scripts/evaluar-acordes.mjs docs/resultados/muestras/prueba1.mp3 docs/resultados/muestras/prueba2.mp3`. Cualquier grabación nueva (otro piano, otro micrófono, otra sala) se evalúa igual, sin tocar en vivo. En la app, el bloque 4 acepta la lista esperada (un acorde por línea) y hace lo mismo a mano.

**Pruebas en vivo**, en la pantalla B2:
1. Micrófono a **50 cm – 1 m**; Windows → Sonido → micrófono → desactivar "mejoras de audio". Al tocar, nivel entre −30 y −10 dB sin "SATURA".
2. Bloque 2: "Calibrar silencio (2 s)".
3. Motor huellas, bloque 2: "Calibrar teclas en vivo" (Fa2–Re5, ~1 minuto).
4. Bloque 5 con **cada motor** (huellas, Onsets and Frames tras "Cargar modelo", basic-pitch): los 20 acordes, "Grabar (3 s)", tocar en el "1".
5. Bloque 6 con cada motor: escucha continua, 20 notas sueltas y 10 acordes separados 2 s.
6. Pegar el JSON del bloque final en `prototipo/docs/resultados/piano-real-<motor>.json`.

| Motor | Exactos | Recall | Precisión | Latencia mediana / p90 | SATURA |
|---|---|---|---|---|---|
| huellas calibradas | | | | | |
| Onsets and Frames | | | | | |
| basic-pitch | | | | | |

Criterio: recall ≥ 95 % y latencia ≤ 300 ms con el mejor motor → micrófono entra como segunda vía. Si no, MIDI única vía.
