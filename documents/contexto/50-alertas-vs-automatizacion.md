# 50 — Alertas y automatización: dos decisiones separadas

Desde el **2026-09-09**, decidir *si algo está fuera de rango* y decidir *si hay
que encender el actuador* son dos preguntas distintas, que se responden en dos
archivos distintos y que no se vuelven a tocar entre sí.

## 1. La regla, en una frase

> **Los umbrales definen la normalidad y generan las alertas, siempre, en las
> cuatro condiciones. La automatización elige cuáles de esos cuatro desvíos,
> además, encienden el actuador.**
>
> Desmarcar una casilla apaga una bomba. **Nunca apaga una alarma.**

## 2. Quién decide qué

| | Alertas (llamados) | Automatización (relé) |
|---|---|---|
| Archivo | `lib/alertas.ts`, `evaluarDesvios()` | `lib/automatizacion.ts`, `decidirActuador()` |
| Entrada | umbrales + lectura | **interruptores** + umbrales + lectura |
| Salida | desvíos → llamados | `rele` de la respuesta 200 |
| ¿Depende de los interruptores? | **no, nunca** | sí, es su razón de ser |
| ¿Se puede configurar por área? | los umbrales, sí | los cuatro interruptores, sí |
| Configurado en | pantalla Áreas → **Umbrales de alerta** | pantalla Áreas → **Automatización** |
| Columnas | `temp_min`, `temp_max`, `hum_min`, `hum_max` | `auto_temp_baja`, `auto_temp_alta`, `auto_hum_baja`, `auto_hum_alta` |

**Los dos módulos no se importan entre sí.** `lib/alertas.ts` no se modificó
para escribir `lib/automatizacion.ts`: `evaluarDesvios()`, los textos de
`MOTIVOS`, `MARGEN_TEMP_NORMAL`, `MARGEN_HUM_NORMAL` y el antirrebote quedaron
intactos.

Que estén desacoplados abre un riesgo: que uno cambie el criterio de comparación
y el otro no. Contra eso hay un **test de contrato**
(`tests/automatizacion.test.ts`, bloque "contrato con lib/alertas.ts") que
recorre una grilla de 10 × 10 lecturas y exige que las dos detecten exactamente
las mismas condiciones. Si alguien cambia un `>` por un `>=` en un solo lado, el
test falla.

## 3. Tabla de verdad

Con un área **activa**, umbrales **20–25 °C** y **60–80 %**.

`✓` = la casilla de esa condición está marcada. `—` = está desmarcada.

| Lectura | Condición detectada | ¿Genera llamado? | Casilla | `rele` |
|---|---|---|---|---|
| 27 °C / 70 % | Temperatura por encima del máximo | **sí** | ✓ | **true** |
| 27 °C / 70 % | Temperatura por encima del máximo | **sí** | — | **false** |
| 18 °C / 70 % | Temperatura por debajo del mínimo | **sí** | ✓ | **true** |
| 18 °C / 70 % | Temperatura por debajo del mínimo | **sí** | — | **false** |
| 22 °C / 48 % | Humedad por debajo del mínimo | **sí** | ✓ | **true** |
| 22 °C / 48 % | Humedad por debajo del mínimo | **sí** | — | **false** |
| 22 °C / 95 % | Humedad por encima del máximo | **sí** | ✓ | **true** |
| 22 °C / 95 % | Humedad por encima del máximo | **sí** | — | **false** |
| 22 °C / 70 % | ninguna | no | cualquiera | **false** |

**La columna "¿Genera llamado?" no depende nunca de la casilla.** Esa es toda la
separación.

### 3.1 Los cuatro casos del enunciado

Con **solo "temperatura por encima del máximo"** marcada:

| Lectura | Alerta | `rele` |
|---|---|---|
| 27 °C / 70 % | Temperatura por encima del umbral | **true** |
| 22 °C / 48 % | Humedad por debajo del umbral | **false** |
| 18 °C / 70 % | Temperatura por debajo del umbral | **false** |
| 22 °C / 70 % | — | **false** |

Verificado en `tests/automatizacion.test.ts`, bloque "la tabla del enunciado".

### 3.2 Casos especiales

| Situación | ¿Llamado? | `rele` | Por qué |
|---|---|---|---|
| **Ninguna casilla marcada** | sí, normal | **siempre false** | El área no automatiza nada |
| **Todas marcadas** | sí, normal | true ante cualquier desvío | — |
| **Dos desvíos a la vez**, ambos marcados | dos llamados | true | Basta uno |
| **Dos desvíos a la vez**, ninguno marcado | dos llamados | **false** | — |
| `temperatura: null` | no, por esa magnitud | esa condición **no** puede accionar | Sin dato no hay decisión; accionar por un sensor roto es peor que no accionar |
| `humedad: null` | ídem | ídem | ídem |
| **25,0 °C con máximo 25** | **no** | **false** | La comparación es estricta: estar en el límite no es estar afuera |
| **25,1 °C con máximo 25** | sí | true si está marcada | — |
| **Área dada de baja** | **no** | **false** | Ver §4 |
| **Dispositivo sin área** | no | **false** | Sin umbrales no hay nada que evaluar |
| **Dispositivo dado de baja** | no | **false** | Y la lectura tampoco se guarda |

## 4. Área dada de baja: el relé queda apagado

Esto **es una decisión nueva**, tomada en esta etapa, y cambia una conducta que
antes estaba indefinida. `10-arquitectura.md` §7.6 la había dejado anotada como
pregunta abierta A-1; **queda resuelta acá**.

Antes, `rele` se calculaba fuera del `if (area.activa)`: un área dada de baja
seguía recibiendo órdenes de actuación. Ahora no.

**Por qué apagado:** un área de baja tampoco genera llamados, así que nadie está
mirando lo que pase ahí. Dejar el riego o la ventilación corriendo solos en un
sector que nadie atiende es exactamente el tipo de cosa que se descubre cuando
ya hizo daño. Es coherente con lo que ya hace un dispositivo dado de baja.

**Qué NO cambia** en un área de baja: la lectura **se sigue guardando**, y no se
generan llamados. Esa es la conducta de siempre.

**Impacto hoy: ninguno.** Las ocho áreas están activas, así que no hay ninguna
lectura cuyo `rele` cambie por esto. Se verifica en la base con
`select codigo, activa from areas`.

## 5. Regresión: el backfill reproduce la conducta anterior

Antes del refactor, la expresión era literalmente:

```ts
rele = (temp != null && temp > temp_max) || (hum != null && hum < hum_min)
```

El backfill de `sql/07_automatizacion_areas.sql` dejó las ocho áreas con
`auto_temp_alta = true`, `auto_hum_baja = true` y las otras dos en `false`.
Reemplazando esos valores en la regla nueva, los dos términos del medio se
anulan y queda **la misma expresión**.

Verificado de dos maneras:

- **Test unitario** — `tests/automatizacion.test.ts`, bloque "regresión":
  recorre una grilla de 9 temperaturas × 8 humedades, incluyendo `null` y los
  límites exactos, y exige que la regla nueva con la configuración del backfill
  dé **el mismo resultado** que la expresión vieja, celda por celda.
- **En la base** — las ocho áreas tienen hoy exactamente esa configuración,
  confirmado antes de empezar.

## 6. Prueba de extremo a extremo

Mismo POST, moviendo **solo** las casillas del área INV-N (20–25 °C, 60–80 %).

```bash
export PAB_CLAVE=$(sed -n 's/^const char\* DEVICE_KEY = "\(.*\)";.*/\1/p' \
  firmware/produccion_parque/produccion_parque.ino)

POST='{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":27,"humedad":70,"boton":"NINGUNO"}'

curl -s -X POST http://localhost:3000/api/ingest \
  -H "content-type: application/json" -H "x-device-key: $PAB_CLAVE" -d "$POST"
```

**Estado A** — `auto_temp_alta = true` (el backfill):

```json
{"ok":true,"rele":true,"alarma":true,"area":"INV-N",
 "llamados":[{"motivo":"Temperatura por encima del umbral","tipo":"NORMAL","resultado":"actualizado"}],
 "avisos":["Actuador encendido por: Temperatura por encima del máximo."]}
```

**Estado B** — se desmarca **solo** esa casilla, no se toca nada más:

```json
{"ok":true,"rele":false,"alarma":true,"area":"INV-N",
 "llamados":[{"motivo":"Temperatura por encima del umbral","tipo":"NORMAL","resultado":"actualizado"}],
 "avisos":["Fuera de rango sin automatización marcada: Temperatura por encima del máximo."]}
```

`rele` pasó de `true` a `false` y **el llamado es idéntico**: mismo motivo,
mismo tipo, mismo resultado. Eso es la separación, vista desde afuera.

**Estado C** — ninguna casilla marcada, lectura con **dos** desvíos
(27 °C / 48 %):

```json
{"ok":true,"rele":false,"alarma":true,"area":"INV-N",
 "llamados":[{"motivo":"Temperatura por encima del umbral","tipo":"NORMAL","resultado":"actualizado"},
             {"motivo":"Humedad por debajo del umbral","tipo":"EMERGENCIA","resultado":"actualizado"}],
 "avisos":["Fuera de rango sin automatización marcada: Temperatura por encima del máximo, Humedad por debajo del mínimo."]}
```

Dos llamados, relé apagado.

**Efectos sobre la base:** +3 lecturas. **Llamados: 431 antes y 431 después** —
ya había llamados abiertos con esos motivos en INV-N, así que el antirrebote
solo les refrescó el detalle y no creó ninguno nuevo ni disparó avisos. La
configuración de INV-N quedó restaurada al backfill.

## 7. Dónde se configura, y quién puede

Pantalla **Áreas** → botón *Editar* → sección **Automatización**, debajo de los
umbrales. Cuatro casillas, cada una con el umbral vigente al lado, para que se
lea la relación entre el valor y la decisión:

```
[ ] Temperatura por debajo del mínimo   (menos de 20,0 °C)
[x] Temperatura por encima del máximo   (más de 25,0 °C)
[x] Humedad por debajo del mínimo       (menos de 60,0 %)
[ ] Humedad por encima del máximo       (más de 80,0 %)
```

Si no queda ninguna marcada, el formulario lo dice explícitamente.

**Permisos: solo ADMINISTRADOR**, y no por ocultar la sección:

- La página `/areas` llama `exigirAdmin()` antes de leer nada.
- `crearArea()` y `actualizarArea()` **cada una** llaman `exigirAdmin()` como
  primera línea.

Un EMPLEADO que llame la Server Action a mano recibe **403**. La matriz completa
está en `13-matriz-permisos.md`.

## 8. Lo que NO se puede hacer

- **Llevar esta configuración al firmware.** El nodo no decide umbrales ni
  automatización: reporta números y obedece `rele` y `alarma`. Está escrito en
  el encabezado del propio `.ino` y es lo que permite cambiar el comportamiento
  del parque desde una pantalla, sin reflashear nada.
- **Cambiar el significado de los umbrales.** `temp_min`, `temp_max`, `hum_min`
  y `hum_max` siguen definiendo la normalidad. La automatización no los
  reinterpreta: los usa.
- **Cambiar los textos de `MOTIVOS`.** Son la clave de deduplicación del
  antirrebote.
- **Volver a poner una comparación contra un umbral en `/api/ingest`.** Si
  aparece un `temperatura > area.temp_max` en ese archivo, la separación se
  rompió. La ruta llama a `decidirActuadorDeArea()` y nada más.
