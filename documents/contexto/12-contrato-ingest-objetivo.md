# 12 — Contrato de `POST /api/ingest`: ANTES y DESPUÉS

Comparación campo por campo entre el contrato **actual**
(`01-contrato-ingest.md`, verificado sobre `app/api/ingest/route.ts`) y el
**objetivo** (`10-arquitectura.md`).

Regla que ordena este documento y que se demuestra abajo:

> **Invariante R-4. `rele` y `alarma` no cambian de nombre, ni de tipo, ni de
> posición, ni de significado observable para el nodo.**

El motivo no es estético. `02-contrato-firmware.md` §6.2, puntos 7 y 8, dice que
renombrar o cambiar el tipo de cualquiera de los dos es **el modo de falla más
peligroso de toda la lista**: ArduinoJson devuelve el default `false` sin error
(`.ino:604-608`), así que el relé quedaría apagado para siempre y la sirena
muda, **con el nodo reportando 200 OK y aparentando salud total**.

---

## 1. Request

### 1.1 Método y ruta

| Aspecto | ANTES | DESPUÉS | ¿Cambia? |
|---|---|---|---|
| Ruta | `/api/ingest` | `/api/ingest` | **no** |
| `POST` | handler principal (`route.ts:77`) | ídem | **no** |
| `GET` | 405 con `{ok:false, error:"Usá POST…"}` (`route.ts:221-226`) | ídem | **no** |
| Ruta pública en el proxy | sí (`proxy.ts:12`) | sí | **no** |

### 1.2 Headers

| Header | ANTES | DESPUÉS | ¿Cambia? |
|---|---|---|---|
| `x-device-key` | obligatorio; se compara por igualdad con `DEVICE_KEY` (`route.ts:86`) | **mismo nombre, obligatorio**; ahora identifica una **credencial de dispositivo** | **el nombre no**; cambia contra qué se verifica |
| `content-type: application/json` | de hecho obligatorio (`route.ts:92`) | ídem | **no** |

**Punto crítico para el nodo:** el firmware manda el header en `.ino:546-549`
con el nombre `x-device-key` y el valor grabado en `.ino:57`. **Ninguna de las dos cosas
cambia.** Lo que cambia es del lado del servidor: en vez de comparar contra una
constante global, busca a qué dispositivo pertenece ese secreto. Para el
firmware es indistinguible.

### 1.3 Cuerpo — los cinco campos

El firmware manda exactamente cinco campos (`.ino:551-571`) y no puede mandar
uno más.

| Campo | Tipo ANTES | Tipo DESPUÉS | Rol ANTES | Rol DESPUÉS |
|---|---|---|---|---|
| `dispositivo` | `string` no vacío, obligatorio (`route.ts:56-58`) | **igual**: `string` no vacío, obligatorio | se guarda en `lecturas.dispositivo`; **no** identifica | se sigue guardando en `lecturas.dispositivo` (invariante R-2); además es la **pista** que ubica la credencial legada `bcrypt-v1` |
| `area` | `string` no vacío, obligatorio, `.toUpperCase()` (`route.ts:60-61`, `:70`) | **igual en validación**: sigue siendo obligatorio y no vacío | **determina el área** vía `areas.codigo` (`route.ts:109`) | **informativo**. El área sale de `dispositivos.area_id` |
| `temperatura` | `number \| null`; acepta string numérico; nunca falla (`route.ts:39-47`) | **idéntico** | se guarda y se evalúa | igual |
| `humedad` | `number \| null`; ídem | **idéntico** | igual | igual |
| `boton` | `"NINGUNO" \| "NORMAL" \| "EMERGENCIA"`; ausente ⇒ `"NINGUNO"` (`route.ts:63-66`) | **idéntico**, mismos tres valores en mayúsculas | genera llamado con `origen: "EMPLEADO"` | igual |

**Ningún campo del cuerpo se elimina, se renombra, se vuelve obligatorio ni
cambia de tipo.** Eso descarta de entrada los puntos 11, 12 y 13 de la lista de
rupturas de `02-contrato-firmware.md` §6.2:

- `boton` sigue aceptando los mismos tres literales en mayúsculas ⇒ el nodo
  nunca recibe un 400 que le deje el botón sin confirmar en un bucle infinito.
- No se agrega ningún campo obligatorio nuevo ⇒ los cinco campos del firmware
  siguen alcanzando.
- `temperatura` y `humedad` siguen aceptando `null` ⇒ el caso "DHT en fallo con
  botón pendiente" (`.ino:704-712`), que es el más urgente del nodo, sigue
  entrando.

**`area` sigue siendo obligatorio aunque ya no se use para resolver.** Es
deliberado: volverlo opcional sería un cambio de contrato innecesario, y
mantenerlo permite detectar la discrepancia del caso 5 de
`10-arquitectura.md` §8.3.

---

## 2. Respuesta 200 — la parte que no puede cambiar

### 2.1 ANTES (`route.ts:207-217`, verificado)

```json
{
  "ok": true,
  "rele": false,
  "alarma": false,
  "area": "INV-N",
  "llamados": [
    { "motivo": "Temperatura por encima del umbral", "tipo": "EMERGENCIA", "resultado": "creado" }
  ]
}
```

### 2.2 DESPUÉS

```json
{
  "ok": true,
  "rele": false,
  "alarma": false,
  "area": "INV-N",
  "llamados": [
    { "motivo": "Temperatura por encima del umbral", "tipo": "EMERGENCIA", "resultado": "creado" }
  ]
}
```

**La misma forma.** Campo por campo:

| Campo | Nombre ANTES | Nombre DESPUÉS | Tipo ANTES | Tipo DESPUÉS | ¿Lo lee el firmware? |
|---|---|---|---|---|---|
| `ok` | `ok` | `ok` | `true` literal | `true` literal | **no** (`.ino:583-631` no lo menciona) |
| **`rele`** | **`rele`** | **`rele`** | **`boolean`** | **`boolean`** | **SÍ** — `.ino:604-605` |
| **`alarma`** | **`alarma`** | **`alarma`** | **`boolean`** | **`boolean`** | **SÍ** — `.ino:607-608` |
| `area` | `area` | `area` | `string` | `string` | **no** |
| `llamados` | `llamados` | `llamados` | `array` de `{motivo, tipo, resultado}` | igual | **no** |

Los dos campos que el firmware **sí** lee conservan:

- **el nombre exacto**: `rele` y `alarma`, minúsculas, sin acento, sin prefijo;
- **el tipo exacto**: booleano JSON, no `"ON"`, no `1`, no un objeto — lo que
  descarta el punto 8 de `02-contrato-firmware.md` §6.2;
- **el nivel exacto**: raíz del objeto, no anidados bajo `ordenes` ni
  `actuadores`. `datos["rele"]` accede a la raíz.

Los tres campos que el firmware **ignora** (`ok`, `area`, `llamados`) también se
conservan, porque los usa el simulador (`dispositivos/acciones.ts:99-115` lee
`ok`, `rele`, `alarma` y `error`) y porque `area` es el canal de diagnóstico que
delata la discrepancia del caso 5 (`10-arquitectura.md` §8.4).

### 2.3 Qué cambia **detrás** de cada valor

| Campo | Cómo se calcula ANTES | Cómo se calcula DESPUÉS |
|---|---|---|
| `rele` | `(temp != null && temp > temp_max) \|\| (hum != null && hum < hum_min)` — expresión cableada (`route.ts:200-203`) | la misma expresión, con cada término condicionado por su flag: `(temp != null && auto_temp_alta && temp > temp_max) \|\| … \|\| (hum != null && auto_hum_baja && hum < hum_min)`. **Con los defaults `true/false/false/true` del paso 3, se reduce a la expresión de antes** (`10-arquitectura.md` §7.3). Además: `false` forzado si `dispositivos.acciona_rele = false`, si el dispositivo está inactivo o si no tiene área |
| `alarma` | `hayEmergenciaAbierta(area.id)` (`route.ts:205`, `lib/alertas.ts:194-203`) | **la misma función, sin cambios**. `false` forzado en los mismos tres casos de arriba, y si `acciona_alarma = false` |
| `area` | `area.codigo` del área hallada por `body.area` | `area.codigo` del área **asignada al dispositivo** |
| `llamados` | de `evaluarDesvios()` + botón, dentro de `if (area.activa)` | **idéntico**: `evaluarDesvios()` no se toca (invariante R-3) |

**Comparaciones y guardas idénticas:** `>` y `<` siguen siendo estrictos (estar
exactamente en el límite no acciona) y las guardas `!= null` se conservan, tal
como están en `route.ts:200-203`.

### 2.4 Demostración de que `NODO-INV-N-01` recibe lo mismo

El nodo real, después del paso 7, con la base tal como está hoy:

| Insumo | Valor | Origen verificado |
|---|---|---|
| Credencial | la legada, `bcrypt-v1` | sembrada en el paso 4 con el hash de `.ino:57` |
| Dispositivo resuelto | `NODO-INV-N-01`, `activo = true`, `naturaleza = FISICO` | paso 2 |
| Área | `id = 1`, `INV-N`, `activa = true` | `00-auditoria.md` §4.11 |
| Umbrales | `temp 20–25`, `hum 60–80` | ídem (base real, no `sql/02_datos.sql`) |
| Flags | `true, false, false, true` | default del paso 3 |
| `acciona_rele` / `acciona_alarma` | `true` / `true` | default del paso 2 |

Con esos valores, la expresión objetivo se reduce a
`(temp > 25) || (hum < 60)`, que es exactamente lo que `route.ts:200-203`
calcula hoy con esos mismos umbrales. Y `alarma` es
`hayEmergenciaAbierta(1)`, la misma llamada a la misma función.

**Antes y después producen la misma respuesta para el mismo insumo.** El nodo no
puede distinguir un despliegue del otro.

---

## 3. Códigos de respuesta: ANTES y DESPUÉS

| Código | ANTES | DESPUÉS | ¿Cambia? |
|---|---|---|---|
| **200** | camino feliz (`route.ts:207`) | camino feliz **y además** los tres casos nuevos de "no accionar" (dispositivo inactivo, sin área, con `rele:false` y `alarma:false`) | **se amplía**: casos que antes eran imposibles ahora responden 200 |
| **401** | `x-device-key` ≠ `DEVICE_KEY` (`:86-88`) | ninguna credencial verifica: ni `sha256-v1`, ni `bcrypt-v1`, ni el fallback global si está encendido. También si la credencial está `REVOCADA` o vencida | **mismo código, mismo cuerpo**; se amplían las causas |
| **400** | cuerpo no-JSON, o falta `dispositivo`/`area`, o `boton` inválido (`:90-100`) | **idéntico**, mismos cuatro mensajes | **no** |
| **404** | `body.area` no existe en `areas` (`:119-124`) | **solo** cuando se entra por el fallback global. **Desaparece** al terminar el paso 9 | **se reduce y luego desaparece** |
| **500** | `DEVICE_KEY` sin configurar; error de base al leer el área o guardar la lectura (`:78-84`, `:113-118`, `:136-144`) | error de base al leer o escribir. El de `DEVICE_KEY` sin configurar solo aplica si el fallback está encendido | **se reduce** |
| **405** | `GET` (`:221-226`) | idéntico | **no** |

**Ningún código nuevo.** Nada de 403, 409, 422, 204 ni 201. Esto es deliberado y
cierra el punto 10 de `02-contrato-firmware.md` §6.2: el firmware compara
`if (codigo == 200)` (`.ino:583`) de forma **estricta**, así que un 201 o un 204
lo dejarían tratando al servidor como caído.

### 3.1 La decisión que más importa: nunca un 4xx para apagar el relé

Del contrato del firmware salen dos hechos:

1. **Cualquier 200 con JSON legible rearma el failsafe** (`.ino:599-602`).
2. **Cualquier respuesta que no sea 200 deja el relé en su último estado**
   hasta que pasen los 45 segundos del failsafe (`.ino:326-348`).

Por eso, ante un dispositivo mal configurado —inactivo, o sin área— el objetivo
responde **200 con `rele: false`** y no un 4xx:

| Respuesta | Cuándo se apaga el relé | Botón pendiente | Lectura |
|---|---|---|---|
| **200 + `rele:false`** | **en el acto** | se confirma y se limpia (`.ino:612-622`) | se guarda |
| 4xx | **a los 45 segundos** | queda pendiente y se reintenta cada 10 s | se pierde |

El 4xx es peor en las tres columnas. Contradice el reflejo habitual, y por eso
queda escrito.

---

## 4. Efectos en la base: ANTES y DESPUÉS

| Tabla / columna | ANTES | DESPUÉS |
|---|---|---|
| `lecturas.dispositivo` | `body.dispositivo` textual (`route.ts:129`) | **igual, intacta** (invariante R-2) |
| `lecturas.dispositivo_id` | **no existe** | FK al dispositivo resuelto por la credencial; **nulo** solo si se entró por el fallback global |
| `lecturas.area_id` | id del área hallada por `body.area` (`:130`) | id de `dispositivos.area_id`; **puede ser nulo** si el dispositivo no tiene área asignada |
| `lecturas.temperatura` / `humedad` / `tomada_en` | sin cambios | sin cambios |
| `llamados.*` | insertados por `registrarLlamado()` (`lib/alertas.ts:167-175`) | **sin cambios**. Mismos motivos, mismo antirrebote, mismo `creado_por` textual |
| `dispositivos.ultimo_contacto_en` | **no existe** | actualizada en cada ingesta, dentro de `after()` |
| `dispositivo_credenciales.usada_en` | **no existe** | actualizada en cada verificación exitosa, dentro de `after()` |

Las dos escrituras nuevas van en `after()` (`10-arquitectura.md` §1.6), fuera del
camino crítico. Motivo: `HTTP_TIMEOUT_MS = 6000` (`.ino:102`, aplicado en
`:527-528`), y el punto 15 de `02-contrato-firmware.md` §6.2 avisa que agregar
trabajo síncrono al handler puede hacer que el nodo corte antes de leer la
respuesta.

**`lecturas.area_id` puede ser nulo por primera vez.** Impacto verificado:

- `revisarNodosCaidos()` ya descarta explícitamente los nodos con
  `area_id === null` (`lib/alertas.ts:290`).
- Las funciones `reporte_*` comparan contra `p_area` o hacen `left join`
  (`sql/03_reportes.sql:83`, `:203`), así que un nulo no ensucia ninguna
  agregación.
- Hoy hay **0 filas** con `area_id` nulo, en `lecturas` y en `llamados`
  (verificado, `10-arquitectura.md` §0).

---

## 5. Lo que se conserva de la mecánica interna

Ninguna de estas piezas se toca. Se listan para que no se den por negociables:

| Pieza | Archivo | Estado |
|---|---|---|
| `evaluarDesvios()` y los márgenes `MARGEN_TEMP_NORMAL = 3` / `MARGEN_HUM_NORMAL = 10` | `lib/alertas.ts:14-15`, `:40-101` | **sin cambios** (invariante R-3) |
| Antirrebote por `(area_id, motivo)` y escalada NORMAL → EMERGENCIA | `lib/alertas.ts:128-191` | sin cambios en esta etapa (deuda C-1) |
| `hayEmergenciaAbierta()` | `lib/alertas.ts:194-203` | sin cambios (pregunta abierta A-3) |
| Catálogo cerrado `MOTIVOS` | `lib/catalogos.ts:137-149` | **sin cambios**: son la clave de deduplicación (`lib/catalogos.ts:133-136`) |
| `avisarNuevoLlamado()` solo al **crear**, nunca al actualizar | `lib/alertas.ts:179-188` | sin cambios |
| `if (area.activa)` alrededor de la generación de llamados | `route.ts:150` | sin cambios |
| `rele` y `alarma` calculados **fuera** de `if (area.activa)` | `route.ts:200-205` | sin cambios (pregunta abierta A-1) |
| Semántica de `temp_min` / `temp_max` / `hum_min` / `hum_max` | `areas` | **sin cambios**: siguen definiendo normalidad y alertas |

---

## 6. Verificación contra `02-contrato-firmware.md` §6

Recorro los 15 modos de ruptura del contrato del firmware y digo qué hace este
diseño con cada uno. **Ninguno se dispara.**

| # | Modo de ruptura | ¿Lo dispara este diseño? |
|---|---|---|
| 1 | Cambiar ruta o dominio | **No.** `/api/ingest` en el mismo dominio |
| 2 | Rotar `DEVICE_KEY` sin reflashear | **No.** El valor actual se siembra como credencial del dispositivo (paso 4). La rotación real es el paso 10, **con acceso físico** y ventana de gracia |
| 3 | Renombrar `x-device-key` | **No.** Mismo nombre |
| 4 | Exigir sesión en `/api/ingest` | **No.** Sigue en `RUTAS_PUBLICAS` (`proxy.ts:12`) |
| 5 | Renombrar o borrar el área `INV-N` | **No.** Y además el objetivo lo vuelve **inofensivo**: el área sale de `dispositivos.area_id`, no de `body.area`, así que renombrar el código dejaría de romper al nodo |
| 6 | Cambiar la validación TLS | **No.** No se toca el firmware hasta el paso 10 |
| 7 | **Renombrar `rele` o `alarma`** | **No.** Invariante R-4, demostrado en §2.2 |
| 8 | Cambiar su tipo | **No.** Siguen siendo booleanos JSON |
| 9 | Devolver 200 sin JSON válido | **No.** Todas las respuestas salen por `Response.json()` |
| 10 | Devolver 201/204 en vez de 200 | **No.** Ningún código nuevo (§3) |
| 11 | Cambiar el contrato de `boton` | **No.** Mismos tres literales en mayúsculas |
| 12 | Volver obligatorio un campo nuevo | **No.** Los cinco campos siguen alcanzando |
| 13 | Dejar de aceptar `null` en `temperatura`/`humedad` | **No.** `aNumero()` sin cambios |
| 14 | Bajar `SEGUNDOS_SIN_SENAL` por debajo de ~20 s | **No.** Sigue en 90 (`lib/alertas.ts:18`) |
| 15 | Superar los 6 s de respuesta | **No, y se cuida activamente:** las dos escrituras nuevas van en `after()` (§4), y la autenticación pasa de una comparación de strings a **una consulta indexada** — no a un bcrypt, salvo el único dispositivo legado (`10-arquitectura.md` §5.4) |

El punto 5 merece subrayarse: el objetivo no solo evita la ruptura, **la
elimina**. Hoy renombrar `INV-N` deja al nodo recibiendo 404 y perdiendo
telemetría en silencio (`03-riesgos.md` R7). Después del paso 7 el nodo ya no
depende del código de área que tiene grabado.

---

## 7. Resumen en una frase

> El cuerpo que el nodo manda, el header con el que se autentica y los dos
> campos que lee de la respuesta —**`rele` y `alarma`, booleanos, en la raíz**—
> son **exactamente los mismos antes y después**. Lo único que cambia es de
> dónde saca el servidor la identidad y el área: antes se las creía al cuerpo,
> ahora las deduce de la credencial.

---

# 8. Contrato IMPLEMENTADO

Escrito el **2026-09-09** en `app/api/ingest/route.ts`. Esta sección **manda
sobre las anteriores** donde difieran: §1 a §7 describían el plan, esto es lo
que quedó. Probado con curl en `40-pruebas-ingest.md`.

## 8.1 Request

| Aspecto | ANTES | DESPUÉS | ¿Nuevo? |
|---|---|---|---|
| Ruta y método | `POST /api/ingest` | igual | no |
| `x-device-key` | obligatorio, igualdad contra `DEVICE_KEY` | obligatorio, **identifica una credencial** | mecanismo |
| `dispositivo` | obligatorio | **obligatorio** | no |
| `area` | **obligatorio** | **opcional** — informativo, no decide nada | **SÍ** |
| `temperatura` / `humedad` | `number \| null` | igual, **pero se descarta lo físicamente imposible** | **SÍ** |
| `boton` | ausente ⇒ `NINGUNO` | igual | no |
| Tamaño del cuerpo | sin tope | **tope de 8 KB** | **SÍ** |

Rangos físicos: temperatura **−40 a 85 °C**, humedad **0 a 100 %**. Fuera de
eso, el valor se guarda como `null` y se avisa. **Se descarta el valor, no la
petición**: un 400 dejaría al nodo sin órdenes y con el botón reintentándose
cada 10 segundos mientras el sensor siga roto.

## 8.2 Respuesta 200

```json
{
  "ok": true,
  "rele": false,
  "alarma": true,
  "area": "INV-N",
  "llamados": [],
  "dispositivo": "NODO-INV-N-01",
  "compatibilidad": false,
  "area_declarada": "INV-N",
  "avisos": []
}
```

| Campo | ANTES | DESPUÉS | ¿Lo lee el firmware? |
|---|---|---|---|
| `ok` | `true` | `true` | no |
| **`rele`** | `boolean` en la raíz | **idéntico** | **SÍ** (`.ino:604-605`) |
| **`alarma`** | `boolean` en la raíz | **idéntico** | **SÍ** (`.ino:607-608`) |
| `area` | código hallado por `body.area` | código **resuelto desde `dispositivos.area_id`**; `null` si no tiene | no |
| `llamados` | array | igual | no |
| `dispositivo` | — | **NUEVO**: código resuelto | no |
| `compatibilidad` | — | **NUEVO**: `true` si entró por la clave global | no |
| `area_declarada` | — | **NUEVO**: lo que dijo el body | no |
| `avisos` | — | **NUEVO**: array de textos | no |

Los cuatro campos nuevos son **aditivos**. El firmware lee dos campos y ninguno
más: agregar claves no lo afecta.

## 8.3 Todos los códigos de estado

| Código | ANTES | DESPUÉS | ¿Nuevo? |
|---|---|---|---|
| **200** | camino feliz | camino feliz | no |
| **200** | — | **dispositivo dado de baja**: `rele:false`, `alarma:false`, **NO se guarda lectura** | **SÍ** |
| **200** | — | **dispositivo sin área**: `rele:false`, `alarma:false`, lectura con `area_id` null | **SÍ** |
| **200** | — | **modo compatibilidad**: `compatibilidad: true` | **SÍ** |
| **400** | JSON inválido / falta `dispositivo` / falta `area` / `boton` inválido | JSON inválido / falta `dispositivo` / `boton` inválido / **cuerpo > 8 KB** | falta `area` **eliminado**; tope **nuevo** |
| **401** | clave ≠ `DEVICE_KEY` | sin cabecera, clave sin credencial, **credencial revocada o vencida**, o clave global con el flag apagado | causas nuevas, **mismo cuerpo** |
| **404** | `body.area` no existe en `areas` | **dispositivo no registrado**, solo alcanzable en modo compatibilidad | **cambió de significado** |
| **405** | `GET` | igual | no |
| **500** | `DEVICE_KEY` sin configurar | **eliminado** — ya no se exige | **eliminado** |
| **500** | error al leer el área | **eliminado** — se responde 200 con aviso | **eliminado** |
| **500** | error al guardar la lectura | igual | no |

**Ningún código nuevo en el conjunto.** Siguen siendo 200/400/401/404/405/500,
que es lo que el firmware sabe manejar: compara `if (codigo == 200)` de forma
estricta (`.ino:583`), así que un 201 o un 204 lo dejarían tratando al servidor
como caído.

## 8.4 La variable de entorno del fallback

| | |
|---|---|
| **Nombre** | `INGEST_PERMITE_CLAVE_GLOBAL` |
| **Valores** | `"1"` enciende el fallback. Cualquier otra cosa lo apaga |
| **Default** | **apagado** — ausente o vacía significa que no hay fallback |
| **Dónde se lee** | `app/api/ingest/route.ts`, constante `FLAG_CLAVE_GLOBAL` |

El default cerrado es deliberado: fallar cerrado acá es **observable**. Sin
credencial el nodo recibe 401, a los 45 segundos su propio failsafe apaga el
relé —estado seguro— y a los 90 la vigilancia levanta "Sensor sin señal".

Para apagarlo definitivamente, la compuerta medible es contar las lecturas
recientes con `dispositivo_id` nulo. Hoy ese contador **ya está en cero**: el
backfill de `sql/06` completó las 5 683 filas y la ruta nueva siempre resuelve
un dispositivo antes de insertar, así que **`lecturas.dispositivo_id` nunca
vuelve a ser null**. La señal a mirar pasa a ser `compatibilidad: true` en los
logs.

## 8.5 Advertencia: el simulador y el modo compatibilidad

**Dos cosas que hay que saber antes de desplegar.**

**El simulador del panel se rompe con el flag apagado.** `simularLectura()` usa
`process.env.DEVICE_KEY` (`dispositivos/acciones.ts:47`), así que sin fallback
recibe **401**. Mientras no tenga credencial propia, `/dispositivos` necesita
`INGEST_PERMITE_CLAVE_GLOBAL=1` para que el simulador funcione. Es lo que el
plan de migración ya preveía: la credencial del simulador va antes del apagado.

**El modo compatibilidad reabre el riesgo R1.** Sin credencial no hay identidad,
así que el dispositivo se resuelve por el código que declara el cuerpo. Un
simulador que declare `NODO-INV-N-01` vuelve a escribir bajo la identidad del
nodo físico. El área ya no se puede falsear —siempre sale de la base—, pero la
**identidad** sí. R1 queda cerrado recién cuando el fallback se apague.

## 8.6 Diferencias con lo que decía el diseño

**El dispositivo dado de baja no guarda la lectura.** `10-arquitectura.md` §8.3
caso 3 decía 200 **y guardar** la lectura, con el argumento de que un aparato
dado de baja que sigue hablando es información operativa. La consigna de esta
etapa pidió no guardarla. Se implementó como se pidió: 200 con `rele:false`
—que es el código que el diseño fijó— y **sin insertar**. Lo que se pierde es
el rastro en `lecturas`; queda un `console.warn` en el log del servidor.

**Los flags de automatización no se usan todavía.** `resolverArea()` los trae en
`area`, pero el cálculo de `rele` es byte por byte el anterior:
`(temp != null && temp > temp_max) || (hum != null && hum < hum_min)`.
Separarlo es la etapa siguiente.

**`acciona_rele` y `acciona_alarma` tampoco se aplican**, por lo mismo:
aplicarlos cambiaría el valor de `rele` para entradas existentes.

**El autor de los llamados pasa a ser el código resuelto.** `creado_por` y el
detalle usan `dispositivo.codigo` en vez del texto del cuerpo. En la práctica
son idénticos; la diferencia solo aparece si un aparato declara un código que
no es el suyo, y en ese caso el resuelto es el correcto. Los **motivos** no se
tocaron: son la clave de deduplicación del antirrebote.

---

# 9. Actualización: el actuador se separó de las alertas

**2026-09-09.** Supera el punto de §8.6 que decía que los interruptores de
automatización todavía no se usaban. Ya se usan. Detalle completo y tabla de
verdad en `50-alertas-vs-automatizacion.md`.

## 9.1 Qué cambió en el cálculo de `rele`

| | ANTES (§8) | DESPUÉS |
|---|---|---|
| Dónde se decide | expresión suelta en `app/api/ingest/route.ts` | `lib/automatizacion.ts`, `decidirActuadorDeArea()` |
| Regla | `(temp > temp_max) \|\| (hum < hum_min)`, cableada | una condición enciende **solo si el área la tiene marcada** |
| Configurable por área | no | **sí**, cuatro interruptores |
| Comparaciones | estrictas | **estrictas, iguales** |
| Magnitud en `null` | no acciona | **no acciona** |
| Área dada de baja | **accionaba** | **`rele` queda en `false`** |

**En `/api/ingest` ya no queda ninguna comparación contra un umbral.** Si
reaparece un `temperatura > area.temp_max` en ese archivo, la separación se
rompió.

## 9.2 Lo que NO cambió

- **`rele` y `alarma`**: mismo nombre, mismo tipo booleano, misma posición en la
  raíz. El firmware no percibe nada.
- **`alarma`** sigue siendo `hayEmergenciaAbierta(area.id)`, sin tocar.
- **El shape de la respuesta** es el mismo de §8.2. Lo único que cambia es el
  **contenido** del array `avisos`, que ya existía y que el firmware ignora:
  ahora dice por qué se encendió el actuador, o por qué no se encendió habiendo
  desvío.
- **Las alertas**: `evaluarDesvios()`, los textos de `MOTIVOS`,
  `MARGEN_TEMP_NORMAL`, `MARGEN_HUM_NORMAL` y el antirrebote quedaron
  **intactos**. `lib/alertas.ts` no se modificó.
- **Los códigos de estado** de §8.3: ninguno cambia, ninguno se agrega.

## 9.3 Regresión verificada

Un área que nadie tocó —las ocho, con el backfill de `sql/07`— devuelve **el
mismo `rele` que antes del refactor**, comprobado de dos formas:

- Test unitario sobre una grilla de 9 temperaturas × 8 humedades, con `null` y
  los límites exactos incluidos, contra la expresión vieja escrita a mano.
- De punta a punta con curl: `27 °C / 70 %` sobre INV-N devolvió `rele: true`,
  que es lo que devolvía antes (27 > 25).

## 9.4 Cambio de conducta que hay que conocer

**Un área dada de baja ya no acciona el relé.** Antes sí: `rele` se calculaba
fuera del `if (area.activa)`. Resuelve la pregunta abierta A-1 de
`10-arquitectura.md` §7.6.

Lo demás en un área de baja no cambia: **la lectura se sigue guardando** y no se
generan llamados.

**Impacto hoy: ninguno**, porque las ocho áreas están activas.
