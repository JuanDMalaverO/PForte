# B3 · De dónde sale el contenido

**Recomendación:** generar los ejercicios algorítmicamente (ruta 2) como fuente principal, y usar repertorio de dominio público (ruta 1) solo como "premio" ocasional, más adelante y con curaduría manual pieza por pieza. Los datos están abajo.

## 1. Qué necesita el producto

Read Ahead funcionaba con cientos de piezas cortas **escritas a propósito** con dificultad graduada. Lo que necesitamos no es repertorio bonito sino:

- fragmentos de **8 compases** que empiecen y terminen bien;
- **dificultad controlada** y creciente (ámbito, saltos, figuras, mano izquierda);
- **volumen**: un alumno que practica 10 minutos por día quema 20–30 ejercicios diarios; no puede repetirlos;
- **licencia limpia** de la obra y de la codificación;
- MusicXML **que nuestro pipeline lea sin sorpresas** (OSMD dibuja casi todo; nuestra extracción de notas es simple y no maneja repeticiones, tresillos, adornos ni voces cruzadas).

## 2. Ruta 1 — Repertorio de dominio público en MusicXML

| Fuente | Tamaño | Formato | Licencia | Piano solo | Problema principal |
|---|---|---|---|---|---|
| **Mutopia** (mutopiaproject.org) | ~2.100 piezas, ~1/3 piano | **LilyPond**, PDF, MIDI. **No hay MusicXML.** | CC / dominio público | sí | Formato: convertir LilyPond → MusicXML no es confiable (no hay herramienta madura). Descartada. |
| **OpenScore Lieder** (openscore.cc / GitHub) | ~1.500 canciones s. XIX | mscx en GitHub; mxl/mscz en fourscoreandmore.org; individual en MuseScore.com | **CC0** | no: voz + piano | Habría que extraer el acompañamiento y cortarlo. Dificultad alta (Schubert, Schumann, Brahms). |
| **OpenScore String Quartets / Orchestral** | ~700 mov. / ~100 mov. | igual | CC0 | no | No es piano. |
| **PDMX** (arXiv 2409.10831, 2024) | **254.077 MusicXML** (102.635 sin duplicados; 14.182 con calificación) | MusicXML | CC0 o "Public Domain Mark" declarado por el usuario en MuseScore.com | ~50% son obras "solo" pero sin etiqueta fiable de instrumento | Calidad y licencia autodeclaradas por usuarios; hay que filtrar y verificar. Es la fuente más grande. |
| **musetrainer/library** (GitHub) | 81 archivos .mxl | MusicXML comprimido | "dominio público" (sin detalle de la codificación) | sí, mayoría piano | Chico. Útil para probar el pipeline (lo usé). |
| **KernScores / Humdrum** (kern.humdrum.org) | 108.703 archivos; sonatas de Beethoven, Chopin, Bach, Mozart | **kern**, convertible a MusicXML con Verovio/humlib | varía; muchas codificaciones son CC BY-NC-SA (no comercial) | sí | Licencia de la codificación no comercial en muchos casos; conversión extra. |

### Prueba real con el pipeline

Cargué dos piezas de musetrainer/library en el prototipo (botón "o repertorio real" en la pantalla B1) y medí la dificultad con la misma métrica que uso para los ejercicios generados:

| Pieza | Compases | Notas | Notas/compás | Salto medio | Ámbito | Máx. notas simultáneas |
|---|---|---|---|---|---|---|
| Bach, Minueto en Sol BWV Anh. 114 | 32 | 204 | 6,4 | 4,0 st | 40 st | 4 |
| Satie, Gymnopédie n.º 1 | 47 | 282 | 6,0 | 9,1 st | 48 st | 7 |
| Ejercicio generado nivel 1 (promedio de 200) | 8 | ~17 | 2,1 | 1,1 st | 5,8 st | 1 |
| Ejercicio generado nivel 2 | 8 | ~31 | 3,9 | 1,8 st | 22,9 st | 2 |
| Ejercicio generado nivel 3 | 8 | ~47 | 5,9 | 3,2 st | 24,5 st | 4 |

Los dos archivos cargaron y se dibujaron sin errores (capturas en `prototipo/docs/resultados/03-repertorio-*.png`). Pero incluso el Minueto "fácil" está por encima del nivel 3 generado en salto y ámbito, y tiene 32 compases: habría que cortarlo en 4 fragmentos de 8 y decidir qué hacer con la anacrusa, la repetición y la armadura de cada fragmento. Y la Gymnopédie tiene acordes de 7 notas y saltos de 9 semitonos: no sirve para principiantes.

**Costo estimado por pieza de repertorio** (buscar, verificar licencia de la codificación, limpiar el MusicXML, cortar en fragmentos, clasificar dificultad, probar en el pipeline): 20–40 minutos de trabajo manual. Para 300 fragmentos: 100–200 horas.

## 3. Ruta 2 — Generación algorítmica

Está implementada en `prototipo/src/generador.ts` y se prueba desde la pantalla B1 ("Generar y cargar"). Parámetros: tonalidad (Do, Sol, Fa), figuras permitidas, salto máximo en grados, ámbito de la mano derecha, patrón de la mano izquierda (nada / redondas / blancas / acordes), semilla.

Datos medidos (`scripts/verificar.mjs` y un benchmark en Node):

| Métrica | Valor |
|---|---|
| Tiempo de generación | **0,012 ms por ejercicio** (1.000 ejercicios en 11,8 ms). Es gratis. |
| Reproducibilidad | misma semilla → mismo ejercicio (para que profesor y alumno vean lo mismo) |
| Verificación de formato | OSMD lee cada ejercicio y extrae **exactamente** las mismas notas que el generador escribió (chequeo automático en pantalla, 3 niveles, OK) |
| Dificultad controlada | nivel 1: 2,1 notas/compás, salto 1,1 st, ámbito 5,8 st; nivel 3: 5,9 notas/compás, salto 3,2 st, ámbito 24,5 st. Los rangos entre semillas son estrechos (ver tabla arriba): la dificultad no "se escapa". |
| Licencia | ninguna: el contenido es nuestro. |

Limitaciones actuales del generador (son trabajo, no riesgo): solo compás de 4/4, sin silencios, sin corcheas, sin alteraciones fuera de la tonalidad, sin ligaduras, la melodía es un camino aleatorio (suena a ejercicio, no a música). Todas son extensiones directas del mismo archivo. Read Ahead también sonaba a ejercicio.

## 4. Decisión propuesta

1. **Fuente principal: generador.** Ya funciona, cuesta cero por ejercicio, la dificultad es un número que controlamos, sin licencias.
2. **Repertorio como complemento curado** (fase posterior): tomar de PDMX/OpenScore/musetrainer 20–50 fragmentos verificados a mano como "piezas de verdad" de cierre de nivel. No como base del catálogo.
3. **No** invertir en Mutopia (formato) ni en KernScores (licencia no comercial) para un producto comercial.

Fuentes: PDMX https://arxiv.org/abs/2409.10831 · OpenScore https://fourscoreandmore.org/openscore/ y https://github.com/OpenScore/Lieder · Mutopia https://www.mutopiaproject.org/ · musetrainer https://github.com/musetrainer/library · KernScores http://kern.humdrum.org/
