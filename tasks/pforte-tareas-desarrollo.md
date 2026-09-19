# PForte — Tareas de desarrollo · Semana de pruebas

**Contexto:** esta semana pasan tres alumnos por el prototipo. El desarrollo sirve a esas pruebas; no las reemplaza.
**Regla:** ninguna función nueva. Todo lo que no esté aquí va a la lista de hallazgos.

---

## T1 · Guardar la sesión — *primero, medio día*

Cada vez que un alumno termina el ejercicio, el prototipo escribe un archivo JSON. Sin esto, los datos de las tres sesiones se pierden o quedan en capturas de pantalla.

**Contenido mínimo del JSON:**

```json
{
  "fecha": "2026-09-21T15:30:00",
  "alumno": "A1",
  "tempo": 80,
  "compasesOcultos": 1,
  "compases": [
    { "n": 1, "esperadas": [60, 64, 67], "tocadas": [60, 64, 67], "faltantes": [], "extras": [], "tiempos": [0.02, 0.51, 1.01] },
    { "n": 2, "..." : "..." }
  ],
  "total": { "correctas": 40, "faltantes": 2, "extras": 0 }
}
```

**Criterio de listo:** un alumno toca, termina, y hay un archivo en disco con esa forma sin que nadie toque nada más.

**Notas:**
- Descarga por navegador (`Blob` + enlace) es suficiente. Sin backend.
- El nombre del archivo lleva fecha y hora, para no pisar sesiones.
- `tiempos` es el instante de cada nota relativo al inicio del compás, en segundos, sobre el reloj de audio. Hoy no se usa; después va a ser lo que mida ritmo.

---

## T2 · Lo que confundió al primer alumno — *una hora, solo si aplica*

El primer alumno dijo que al inicio se confundió. Antes de tocar código, Julián responde: **¿con qué?**

| Si fue… | Entonces… |
|---|---|
| No sabía cuándo arrancar | Hacer visible el compás de entrada (contar 1-2-3-4 en pantalla) |
| No veía qué compás le tocaba | Resaltar el compás activo |
| No entendió que el compás iba a desaparecer | Una línea de texto antes de Empezar, y ya |
| Fue el método en sí — ver desaparecer la música | **No se toca.** Eso es lo que estamos probando |

**Criterio de listo:** el alumno dos no hace la misma pregunta que el alumno uno.

---

## T3 · Explicabilidad — *pendiente desde el 5 de septiembre*

Sin abrir el agente. Sin abrir el código.

1. **Dibujar a mano el diagrama de los archivos de `prototipo/src/`** (los del producto, no los de `medicion/`): quién importa a quién, qué le pasa cada uno al siguiente.
2. **Responder por escrito, con tus palabras:** qué pasa entre que se pulsa "Empezar" y el momento en que desaparece el primer compás.
3. **Verificar contra el código** solo después de haber escrito los dos anteriores. Anotar qué te faltó.

**Criterio de listo:** si el alumno dos rompe algo, sabes en qué archivo mirar antes de preguntarle a nadie.

---

## Lo que NO se hace esta semana

- Niveles del generador — los define Julián en una página antes de que se toque `generador.ts`
- Interfaz visual, colores, diseño
- Cuentas, login, progreso, estadísticas
- Micrófono dentro del producto — el motor de huellas queda en `medicion/` hasta nuevo aviso
- Más de una pieza
- Cualquier cosa de la lista de sesenta

---

## Orden y cierre

T1 → T2 (si aplica) → T3.

Cada tarea cerrada se reporta con una frase: qué se hizo y cómo se verificó. La semana cierra el domingo con **tres pares** — para cada alumno, la línea que Julián escribió antes de que tocara y la tabla que el prototipo produjo después.
