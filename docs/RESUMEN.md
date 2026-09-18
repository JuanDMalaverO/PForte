# Tarea B · Resumen para Julián

Fecha: 17 sep 2026 (ronda 4, con grabaciones del piano real). Entregable: prototipo funcionando + tres mediciones. Todo está en esta carpeta; el detalle de cada punto en B2–B5.

## 1. Qué hay

**Prototipo** (`prototipo/`, TypeScript + React + Vite): una pieza de 8 compases en pantalla (OpenSheetMusicDisplay), metrónomo con Web Audio y scheduling anticipado, compases que se tapan uno a uno al ritmo, notas MIDI (Web MIDI) comparadas contra la partitura, tabla de resultados por compás. Feo a propósito. Además: un generador de ejercicios (B3), carga de repertorio real en MusicXML, y una pantalla de medición por micrófono (B2) con **tres motores intercambiables**: basic-pitch (red neuronal de Spotify, genérica), **huellas + NMF** (nuestro, informado por la partitura, con calibración del piano del alumno, sin GPU) y Onsets and Frames (Magenta, red específica de piano). Se corre con `npm install && npm run dev` en Chrome.

**Prueba automática** (`prototipo/scripts/verificar.mjs`): abre Chromium, toca la pieza entera con un teclado simulado, genera ejercicios, carga dos piezas reales, corre los dos motores sobre acordes sintéticos y mide latencia usando un WAV como micrófono. Capturas y JSON en `prototipo/docs/resultados/`.

## 2. Las tres mediciones

### Medición 1 · El prototipo hace lo que dice (precisión del reloj y de la comparación)

Tocando la pieza completa (42 notas, 8 compases, 120 bpm) con teclas simuladas en el pulso exacto:

| Métrica | Resultado |
|---|---|
| Notas correctas | **42/42**, 0 fallidas, 0 extras |
| Compases ocultados al ritmo | 8/8 |
| Desvío entre el click (audio) y el aviso a la pantalla | media 1–11 ms, máx 12–20 ms |
| Desvío entre la tecla y el pulso esperado, medido por el sistema | media 14–29 ms, máx 40 ms |

El metrónomo no deriva; una nota tocada a tiempo se registra con ~20 ms de error contra una tolerancia de medio pulso (375 ms a 80 bpm). Con teclado MIDI real falta probarlo; el código es el mismo.

### Medición 2 · Micrófono: porcentaje de acierto (20 acordes de piano + un clip de silencio), tres motores

| Condición | Motor | Acordes exactos | Notas vistas (recall) | Precisión |
|---|---|---|---|---|
| Sintético con ruido de fondo | basic-pitch (Spotify, genérico) | 86 % | 100 % | 93 % |
| Sintético con ruido de fondo | **huellas + NMF** (nuestro, informado por la partitura) | **100 %** | **100 %** | **100 %** |
| Sintético con ruido de fondo | Onsets and Frames (Magenta, específico de piano) | 48 % | 80 % | **100 %** |
| Pipeline completo de micrófono | basic-pitch | 90 % | 100 % | 97 % |
| Pipeline completo de micrófono | **huellas + NMF** | **100 %** | **100 %** | **100 %** |
| Pipeline completo de micrófono | Onsets and Frames | 70 % | 100 % | 91 % |
| Clip de silencio | los tres | nada detectado (compuerta) | | |
| **Piano real de Juan, escala de 34 notas sueltas (grabación)** | huellas sin calibrar | 65 % | 100 % | 74 % |
| **Piano real de Juan, escala de 34 notas sueltas (grabación)** | **huellas calibradas** | **100 %** | **100 %** | **100 %** |
| **Piano real de Juan, escala de 34 notas sueltas (grabación)** | basic-pitch | 76 % | 100 % | 81 % |
| **Piano real de Juan, escala de 34 notas sueltas (grabación)** | Onsets and Frames | 97 % | 100 % | 97 % |

| **Piano real de Juan, 20 acordes (grabación)** | **huellas, sabiendo qué se espera** | **80 %** | 93 % | **96 %** |
| **Piano real de Juan, 20 acordes (grabación)** | Onsets and Frames | 45 % | 94 % | 83 % |
| **Piano real de Juan, 20 acordes (grabación)** | basic-pitch | 10 % | 96 % | 67 % |

Con piano real: en notas sueltas los motores son casi perfectos; en acordes, **el motor de huellas informado por la partitura es el mejor** (16/20; de los 4 fallos, uno es un acorde tocado distinto de la lista). Las dos redes ven casi todo pero inventan octavas. Detalle y lecciones en B2 §4c.

### Medición 3 · Micrófono: latencia (ataque real → detección disponible)

| Motor | Mediana | p90 | Cómputo por detección | Necesita GPU |
|---|---|---|---|---|
| basic-pitch (análisis cada 100 ms) | 235–455 ms | 237–476 ms | 41–52 ms | sí (sin GPU: 1,2–1,4 s) |
| **huellas + NMF** (4 frames tras el ataque) | **209 ms** | 230 ms | **< 1 ms** | **no** |
| Onsets and Frames (cada 250 ms) | 210 ms | 460 ms | 133 ms | sí |

**Conclusión B2 (con datos del piano real):** MIDI sigue siendo la entrada principal (15 ms, exacta). **El micrófono entra como segunda vía** para puntuar las notas esperadas: motor de huellas informado por la partitura, sin GPU, 21 ms por acorde, recall 93 % y precisión 96 % en acordes reales. No sirve para transcripción libre (sin saber qué se espera cae a 20 % de acordes exactos); para eso el mejor es Onsets and Frames, 20 veces más caro. Pendiente: repetir con un micrófono mejor que el del celular/laptop, porque la falta de graves es lo que limita la calibración.

## 3. Decisiones que salieron de los datos

- **B3 · Contenido → generador algorítmico.** 0,012 ms por ejercicio, dificultad controlada por nivel, sin licencias. El repertorio de dominio público es grande (PDMX: 254.000 MusicXML CC0) pero no graduado: hasta el minueto "fácil" de Bach queda por encima de nuestro nivel 3. Repertorio solo como premio curado. Detalle en B3.
- **B4 · Patente → viva, pero solo en EE.UU.** US 9,767,704 (Johns Hopkins), vence oct 2033; sin fase europea ni otros países. Reivindica quitar el compás *antes* de tocarlo; el prototipo lo tapa *al empezar* (parámetro `desfase`). Fuera de EE.UU. no cambia nada; en EE.UU., abogado antes de vender. Detalle en B4.
- **B5 · Explicabilidad:** una frase por archivo (ahora 20 archivos), el recorrido de una sesión y las zonas que no entiendo del todo. En B5.

## 4. Qué falta y quién lo hace

| Pendiente | Quién | Tiempo |
|---|---|---|
| Probar en vivo el motor de huellas con "buscar solo las esperadas y sus vecinas" marcado y **sin calibrar teclas** (solo silencio), a 50 cm | Juan | 10 min |
| Si consiguen un micrófono USB o de condensador: repetir las dos grabaciones y correr los dos scripts | Juan | 15 min |
| Probar con teclado MIDI real conectado por USB | Juan | 5 min |
| Correr `verificar.mjs` en una laptop sin GPU dedicada (el motor de huellas debería dar lo mismo; basic-pitch no) | Juan | 10 min |
| Consulta con abogado de patentes si el mercado incluye EE.UU. | ambos | 1 h |
| Ensayar la explicación de B5 sin leer | Juan | 30 min |
