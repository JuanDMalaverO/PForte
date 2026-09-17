# B4 · Verificación de la patente de Hardaway y Johansen

**Resumen en una línea:** la patente existe, está **viva** (tasas pagadas hasta 2025), vence el **8 de octubre de 2033**, pertenece a la **Universidad Johns Hopkins** (no a la empresa Read Ahead, así que el cierre de la empresa no la afecta) y **solo tiene efecto en Estados Unidos**. Fuera de EE.UU. no hay patente equivalente.

## 1. La patente

| Dato | Valor |
|---|---|
| Número | **US 9,767,704 B2** |
| Título | *Method and device for training a user to sight read music* |
| Inventores | Richard Travis Hardaway, Ken Lund Johansen |
| Titular (original y actual) | The Johns Hopkins University |
| Fecha de prioridad | 8 oct 2012 (provisional US) |
| Solicitud PCT | WO 2014/058845 A1, presentada 8 oct 2013 |
| Solicitud US | 14/434,160 (publicada como US 2015/0262500 A1) |
| Concesión | 19 sep 2017 |
| Tasa de mantenimiento 3.5 años | pagada 19 mar 2021 |
| Tasa de mantenimiento 7.5 años | pagada 19 mar 2025 |
| Próxima tasa (11.5 años) | ventana sep 2028 – mar 2029 (+6 meses de gracia). Si no la pagan, caduca. |
| Estado en Google Patents | **Active** |
| Vencimiento previsto | **8 oct 2033** |

Fuente: https://patents.google.com/patent/US9767704B2/en (pestaña "Legal Events").

## 2. Cobertura territorial

- El PCT (WO2014058845) entró en fase nacional **solo en EE.UU.**
- Fase europea EP13844793: **"no entrada en fase nacional"** (nov 2015). No hay patente en Europa.
- No hay entradas en CN, JP, CA, BR, MX ni ningún otro país.
- Fuente: https://patents.google.com/patent/WO2014058845A1/en

Consecuencia: **para un mercado fuera de EE.UU. esta patente no aplica.** Para EE.UU., sí.

## 3. Qué reivindica exactamente

Reivindicación 1 (método), texto literal traducido; los elementos numerados son míos:

> Un método para entrenar a un usuario a leer música a primera vista que comprende:
> (a) pedir al usuario que fije un tempo;
> (b) mostrar al menos un primer compás y un segundo compás de música, donde el primer compás está en una primera posición, delante del segundo;
> (c) **quitar el primer compás de la pantalla antes de que el usuario deba tocarlo**, de modo que se lo anime a leer adelante; y
> (d) sincronizar esa remoción con el tempo.

La reivindicación 9 es lo mismo formulado como sistema (pantalla + interfaz + programa). Las dependientes agregan: click-track audible (2, 11), cuenta de entrada (3, 12), tempo preprogramado según nivel (4, 13), punto focal para la fóvea/parafóvea (5, 14), conjunto inicial de obras (6, 15), material nuevo periódico (7, 16), grabación de la ejecución (17) y comparación con una pista de referencia (18).

Para infringir hay que cumplir **todos** los elementos (a)–(d) de la reivindicación independiente. El elemento decisivo es (c): el compás se quita **antes** de que toque tocarlo.

## 4. Qué hace nuestro prototipo frente a eso

El prototipo B1 tiene tempo elegido por el usuario (a), muestra los 8 compases (b), y los va tapando al ritmo del metrónomo (d). Lo único que cambia es **cuándo** tapa cada compás. Está parametrizado con un número, `desfase` (en pulsos), en `App.tsx`:

| desfase | Qué pasa | Frente al elemento (c) |
|---|---|---|
| negativo (p. ej. −4) | el compás se tapa un compás **antes** de tocarlo | coincide literalmente con la patente |
| 0 (valor por defecto) | el compás se tapa **en el instante** en que empieza a tocarse | no es "antes"; el usuario ya tuvo el compás visible hasta el momento de tocarlo |
| positivo (p. ej. +4) | el compás se tapa **después** de tocado | claramente fuera del texto literal |

Nota: la app original Read Ahead, según reseñas de 2016, borraba el compás al tocar su primera nota, es decir con desfase ≈ 0. Que la reivindicación diga "antes" y el producto hiciera "al empezar" es un detalle que un abogado de patentes debería mirar (en EE.UU. existe la "doctrina de equivalentes", que puede extender la cobertura más allá del texto literal). **Esto no es asesoría legal**; es lo que dice el documento.

## 5. Otra patente que apareció en la búsqueda

**US 8,697,972 B2** — *Method and apparatus for computer-mediated timed sight reading with assessment*, MakeMusic Inc. (Dripps, Massoth, Sturm). Presentada 31 jul 2012, concedida 15 abr 2014, activa, vence 26 sep 2032, también solo EE.UU. Reivindica: biblioteca de piezas + mostrar la partitura un tiempo predeterminado **antes** de que el usuario empiece + entrada de audio/MIDI + evaluar la corrección y guardar el registro. No cubre ocultar compases, pero cubre "temporizador de preparación + entrada + evaluación + historial", que es algo que un producto completo probablemente tenga. Fuente: https://patents.google.com/patent/US8697972B2/en

## 6. Qué cambia en el plan

- **Técnicamente, nada.** El mecanismo es el mismo; el momento de ocultar es un parámetro. El prototipo ya corre con desfase 0.
- **Comercialmente, depende del mercado inicial:**
  - Fuera de EE.UU.: sin restricción por estas dos patentes.
  - En EE.UU.: hay tres caminos, no excluyentes: (1) diseñar alrededor (desfase ≥ 0) y validarlo con un abogado; (2) pedir licencia a Johns Hopkins (las universidades licencian rutinariamente y la empresa que la explotaba cerró, así que la licencia exclusiva, si existía, probablemente ya no está activa); (3) esperar: si JHU no paga la tasa de 2028-29, cae; si la paga, vence en 2033.
- **Acción concreta antes de vender en EE.UU.:** una hora de un abogado de patentes con este documento, la reivindicación 1 y la captura del prototipo con desfase 0.

## 7. Cómo se hizo la verificación

1. Google Patents, búsqueda por inventores `Hardaway` + `Johansen` + "sight reading" → US 9,767,704 (y su PCT WO2014058845).
2. Pestaña *Legal Events* de Google Patents: concesión 2017, pagos de mantenimiento 2021 y 2025, sin eventos de caducidad, estado "Active".
3. Página del PCT: lista de fases nacionales → solo US; EP marcada como no entrada.
4. Lectura del texto de las reivindicaciones 1 y 9 y de las dependientes.
5. Búsqueda de patentes vecinas con "sight reading" + "measure" → US 8,697,972 (MakeMusic).

Fecha de la verificación: 15 sep 2026.
